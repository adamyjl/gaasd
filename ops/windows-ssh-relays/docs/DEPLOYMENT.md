# 部署与迁移

当前桌面已经部署完成。本文件用于重建、迁移或审阅实现，不需要为了日常连接再执行一遍。

## 前提

- Windows 有管理员权限、Windows PowerShell 5.1 和 `C:\Windows\System32\OpenSSH\ssh.exe`。
- Windows 能通过 SSH 公钥登录腾讯云 `ubuntu@49.232.60.144`，并可访问 `192.168.1.111:22`（5090）与 `192.168.1.19:22`（4090）。
- 腾讯云已有 OpenSSH 与 Python 3，`ubuntu` 可执行 `sudo`；SSH 服务允许 TCP 转发。脚本不会修改现有 sshd / Nginx / OpenVPN 配置。
- Linux 开启 SSH；Windows 目标的 SSH 服务监听本机 `127.0.0.1:22`。
- 当前 Windows 的 `sshd`、`WlanSvc`、`ZeroTierOneService` 均为自动启动。部署到别的机器时，须确保 Wi-Fi / VPN / 内网路由同样无需交互登录即可建立。

## 1. 给登录目标授权公钥

这里使用人员登录公钥，与后面的三个隧道专用密钥分开。`other-computer.pub` 必须是公钥文件。

以下相对命令须先进入总仓库的 `ops/windows-ssh-relays/` 目录：

```powershell
scp .\scripts\authorize-key.py user001@192.168.1.111:/tmp/gaasd-authorize-key.py
Get-Content C:\path\to\other-computer.pub |
    ssh user001@192.168.1.111 'python3 /tmp/gaasd-authorize-key.py'
```

脚本保留原有公钥、按密钥内容去重，并在首次追加前备份原文件。目标目录权限为 700，`authorized_keys` 为 600。重复执行不会重复添加。

4090 目标使用 `centos@192.168.1.19`，可按同样方式授权；其 Python 3 路径为 `/home/centos/miniconda3/bin/python3`。腾讯云的 `ubuntu` 登录入口也需要授权同一人员公钥。目标授权彼此独立，本次两枚 RSA 公钥的核验见 [4090 部署记录](../../../docs/rtx4090-relay-20261020.md)。

## 2. Windows SSH 服务（新机器可选）

当前桌面已经安装 Microsoft OpenSSH Server，仅监听回环地址，禁用密码登录并允许 `tsari` 公钥登录。

新机器如尚未安装服务，可从 [Microsoft Win32-OpenSSH Releases](https://github.com/PowerShell/Win32-OpenSSH/releases) 取得 MSI，然后在**本机管理员 PowerShell** 中运行：

```powershell
.\scripts\Install-WindowsSsh.ps1 `
    -UserName tsari `
    -PublicKeyFiles @('C:\path\to\local-login.pub','C:\path\to\other-computer.pub') `
    -MsiPath 'C:\Downloads\OpenSSH-Win64-v10.0.0.0.msi'
```

当前安装版本为 `v10.0.0.0p2-Preview`，脚本默认固定该安装包 SHA-256：

```text
ddec9c53864280759cf9f74791cefd387100e3946aa849a1c138a4ed1b96b7d9
```

使用其他版本时，先独立核验发布来源与文件哈希，再通过 `-MsiSha256` 显式传入相应值。脚本还会验证 Microsoft Authenticode 签名。安装包不随本仓库发布。

已有由本项目管理的服务时，脚本复用它并追加公钥；遇到其他项目的 SSH 配置会停止，避免覆盖。此脚本会重启 Windows sshd，因此从本机控制台运行，不要通过正在使用的 Windows SSH 会话运行。

## 3. 生成三个隧道专用密钥

当前机器已有以下文件，无需重新生成。新机器在自己的用户 `.ssh` 目录创建三组 Ed25519 密钥，**不要在仓库内创建私钥**：

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519_tsari_relay" -C tsari-windows-relay-192.168.1.111
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519_windows_relay" -C windows-desktop-relay-2224
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519_rtx4090_relay" -C gaasd-suzhou-rtx4090-relay
```

这三组无人值守专用密钥需要空口令；通过云端账号限制和本机 ACL 保护。人员登录私钥不需要空口令，也不需要复制到 SYSTEM 运行目录。

## 4. 腾讯云授权三个受限账户

只把 `.pub` 文件内容传给云端，私钥留在 Windows：

```powershell
scp .\cloud\setup-relay-user.py ubuntu@49.232.60.144:/tmp/gaasd-setup-relay-user.py
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_tsari_relay.pub" |
    ssh ubuntu@49.232.60.144 'sudo -n python3 /tmp/gaasd-setup-relay-user.py linux'
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_windows_relay.pub" |
    ssh ubuntu@49.232.60.144 'sudo -n python3 /tmp/gaasd-setup-relay-user.py windows'
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_rtx4090_relay.pub" |
    ssh ubuntu@49.232.60.144 'sudo -n python3 /tmp/gaasd-setup-relay-user.py rtx4090'
```

脚本只管理 `gaasd-tsari-relay`、`gaasd-windows-relay` 和 `gaasd-4090-relay` 三个 nologin 账户。每个公钥仅允许相应的 `127.0.0.1:2223`、`:2224` 或 `:2225` 反向监听，并禁止有用的本地端口转发、交互 shell、agent / X11 转发和 PTY。已有账户或授权内容不同会停止，需人工审阅，不会覆盖。

不要为这三个端口增加公网安全组规则，也不要设置 `GatewayPorts yes`。人员通过腾讯云现有 22 端口和 `ubuntu` 跳板访问。

## 5. 保存部署参数并安装开机任务

先正常连接腾讯云并核验主机指纹，让其主机公钥存在于个人 `known_hosts`。安装器只复制已经信任的云端主机公钥，不使用自动忽略主机检查的设置。

全新部署时复制模板到仓库外；已有机器直接编辑既有参数文件，保留原路线：

```powershell
Copy-Item .\config\relays.example.json D:\Server\relay-deployment.local.json
notepad D:\Server\relay-deployment.local.json
```

修改 `knownHostsSource` 和三条 `privateKeySource` 为中转机实际路径。当前机器对应 `C:\Users\tsari\.ssh\...`。安装器固定云端 `49.232.60.144:22`、三条隧道的 2223/2224/2225 分配、专用账户及任务名；4090 目标固定为 `192.168.1.19:22`。发现与注册分配不同会在任何运行配置或任务变更前退出；不能用这个安装器接管 2222/18765 或 A100 路线。

旧的 `linux` / `windows` 两条配置仍然有效。已安装第三条后，不指定 `-Name` 却提供缺少第三条的旧模板会被拒绝，避免无意丢失现有路线。

在管理员 PowerShell 中执行：

```powershell
# 全新安装
.\scripts\Install-Relays.ps1 -ConfigPath D:\Server\relay-deployment.local.json

# 已有两条路线时，仅新增/更新 4090（本次实际使用）
.\scripts\Install-Relays.ps1 -ConfigPath D:\Server\relay-deployment.local.json -Name rtx4090

# 从本机旧的两个登录时启动任务迁移（当前机器已执行）
.\scripts\Install-Relays.ps1 -ConfigPath D:\Server\relay-deployment.local.json -MigrateLegacy
```

安装器会备份运行定义、共享脚本及被选中任务的旧 XML，将运行文件部署到 `C:\ProgramData\GAASD-SSH-Relays`，注册 SYSTEM 开机任务并立即启动。只有指定 `-MigrateLegacy` 时停用相应旧脚本。任务不保存用户密码。脚本与配置只允许 SYSTEM / Administrators 修改；专用密钥和任务备份仅这两类身份可读。

`-Name` 只重建选中的路线；其他路线的配置、密钥和计划任务保持原样，运行定义从既有安装中保留。共享监督脚本和云端 known_hosts 会同步更新，已有进程继续运行，下次启动使用新脚本。选择安装需要已经存在的受管运行目录，不能用于全新安装。

不指定 `-Name` 会重建参数文件中的全部路线，应从中转机本地管理员控制台执行；不要重启自己唯一的远程管理通道。2026-10-20 新增 4090 时，只安装 `rtx4090` 并测试其自动重连，原两条路线未重启，见 [部署记录](../../../docs/rtx4090-relay-20261020.md)。

安装器遇错会保留错误信息及已有备份；没有自动事务回滚。迁移未完成时按 [运维说明](OPERATIONS.md) 恢复旧任务或修复后重试。

## 6. 验证

```powershell
& 'C:\ProgramData\GAASD-SSH-Relays\bin\Control-Relay.ps1' -Action Status
ssh -tt tsari-via-cloud 'hostname; id -un; exit'
ssh -tt windows-via-cloud 'hostname; whoami; exit'
ssh -tt rtx4090-via-cloud 'hostname; id -un; nvidia-smi -L; exit'
```

三条任务应为 `Running`、`SYSTEM`、`ServiceAccount`，状态文件应显示 `NT AUTHORITY\SYSTEM`、`sessionId: 0`。然后可按运维文档只对需要验证的路线进行短暂重连测试。

## 参考资料

- [Microsoft：计划任务运行身份](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal)
- [Microsoft：开机触发器](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasktrigger)
- [OpenSSH：反向转发与跳板连接](https://man.openbsd.org/ssh)
- [Microsoft：Windows OpenSSH 服务配置](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration)
- [Microsoft：使用 MSI 安装 OpenSSH](https://github.com/PowerShell/Win32-OpenSSH/wiki/Install-Win32-OpenSSH-Using-MSI)
