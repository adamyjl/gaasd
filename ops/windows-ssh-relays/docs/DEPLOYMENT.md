# 部署与迁移

当前桌面已经部署完成。本文件用于重建、迁移或审阅实现，不需要为了日常连接再执行一遍。

## 前提

- Windows 有管理员权限、Windows PowerShell 5.1 和 `C:\Windows\System32\OpenSSH\ssh.exe`。
- Windows 能通过 SSH 公钥登录腾讯云 `ubuntu@49.232.60.144`，并可访问 `192.168.1.111:22`。
- 腾讯云已有 OpenSSH 与 Python 3，`ubuntu` 可执行 `sudo`；SSH 服务允许 TCP 转发。脚本不会修改现有 sshd / Nginx / OpenVPN 配置。
- Linux 开启 SSH；Windows 目标的 SSH 服务监听本机 `127.0.0.1:22`。
- 当前 Windows 的 `sshd`、`WlanSvc`、`ZeroTierOneService` 均为自动启动。部署到别的机器时，须确保 Wi-Fi / VPN / 内网路由同样无需交互登录即可建立。

## 1. 给登录目标授权公钥

这里使用人员登录公钥，与后面的两个隧道专用密钥分开。`other-computer.pub` 必须是公钥文件。

以下相对命令须先进入总仓库的 `ops/windows-ssh-relays/` 目录：

```powershell
scp .\scripts\authorize-key.py user001@192.168.1.111:/tmp/gaasd-authorize-key.py
Get-Content C:\path\to\other-computer.pub |
    ssh user001@192.168.1.111 'python3 /tmp/gaasd-authorize-key.py'
```

脚本保留原有公钥、按密钥内容去重，并在首次追加前备份原文件。目标目录权限为 700，`authorized_keys` 为 600。重复执行不会重复添加。

腾讯云的 `ubuntu` 登录入口也需要授权同一人员公钥。当前用户提供的 RSA 公钥已经在腾讯云、Linux、Windows 三处授权。

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

## 3. 生成两个隧道专用密钥

当前机器已有以下文件，无需重新生成。新机器在自己的用户 `.ssh` 目录创建两组 Ed25519 密钥，**不要在仓库内创建私钥**：

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519_tsari_relay" -C tsari-windows-relay-192.168.1.111
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\id_ed25519_windows_relay" -C windows-desktop-relay-2224
```

这两组无人值守专用密钥需要空口令；通过云端账号限制和本机 ACL 保护。人员登录私钥不需要空口令，也不需要复制到 SYSTEM 运行目录。

## 4. 腾讯云授权两个受限账户

只把 `.pub` 文件内容传给云端，私钥留在 Windows：

```powershell
scp .\cloud\setup-relay-user.py ubuntu@49.232.60.144:/tmp/gaasd-setup-relay-user.py
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_tsari_relay.pub" |
    ssh ubuntu@49.232.60.144 'sudo -n python3 /tmp/gaasd-setup-relay-user.py linux'
Get-Content "$env:USERPROFILE\.ssh\id_ed25519_windows_relay.pub" |
    ssh ubuntu@49.232.60.144 'sudo -n python3 /tmp/gaasd-setup-relay-user.py windows'
```

脚本只管理 `gaasd-tsari-relay` 和 `gaasd-windows-relay` 两个 nologin 账户。每个公钥仅允许相应的 `127.0.0.1:2223` 或 `127.0.0.1:2224` 反向监听，并禁止有用的本地端口转发、交互 shell、agent / X11 转发和 PTY。已有账户或授权内容不同会停止，需人工审阅，不会覆盖。

不要为这两个端口增加公网安全组规则，也不要设置 `GatewayPorts yes`。人员通过腾讯云现有 22 端口和 `ubuntu` 跳板访问。

## 5. 保存部署参数并安装开机任务

先正常连接腾讯云并核验主机指纹，让其主机公钥存在于个人 `known_hosts`。安装器只复制已经信任的云端主机公钥，不使用自动忽略主机检查的设置。

复制模板到仓库外：

```powershell
Copy-Item .\config\relays.example.json D:\Server\relay-deployment.local.json
notepad D:\Server\relay-deployment.local.json
```

修改 `knownHostsSource` 和两条 `privateKeySource` 为中转机实际路径。当前机器对应 `C:\Users\tsari\.ssh\...`。整合版安装器固定云端 `49.232.60.144:22`、两条隧道的 2223/2224 分配、专用账户及任务名，发现与注册分配不同会在任何运行配置或任务变更前退出；不能用这个安装器接管 2222/18765 或 A100 路线。新增其他中转应先更新总览、隔离配置并测试，不能直接改模板冒用现有端口。

在管理员 PowerShell 中执行：

```powershell
# 全新安装
.\scripts\Install-Relays.ps1 -ConfigPath D:\Server\relay-deployment.local.json

# 从本机旧的两个登录时启动任务迁移（当前机器已执行）
.\scripts\Install-Relays.ps1 -ConfigPath D:\Server\relay-deployment.local.json -MigrateLegacy
```

安装器会备份旧任务 XML、停用旧脚本，将运行文件部署到 `C:\ProgramData\GAASD-SSH-Relays`，注册 SYSTEM 开机任务并立即启动。任务不保存用户密码。脚本与配置只允许 SYSTEM / Administrators 修改；专用密钥和任务备份仅这两类身份可读。

更新源码后如需部署新版本，重新运行安装器即可。它会短暂重建本项目的两条隧道，因此应从本机管理员控制台执行；此操作不涉及原有办公室或 A100 代理。

2026-10-20 仓库整合只同步源码，没有重新执行安装器或重连测试。运行版与仓库整理版的区别见 [中转总览](../../../docs/ssh-relays.md)。

安装器遇错会保留错误信息及已有备份；没有自动事务回滚。迁移未完成时按 [运维说明](OPERATIONS.md) 恢复旧任务或修复后重试。

## 6. 验证

```powershell
& 'C:\ProgramData\GAASD-SSH-Relays\bin\Control-Relay.ps1' -Action Status
ssh -tt tsari-via-cloud 'hostname; id -un; exit'
ssh -tt windows-via-cloud 'hostname; whoami; exit'
```

两条任务应为 `Running`、`SYSTEM`、`ServiceAccount`，状态文件应显示 `NT AUTHORITY\SYSTEM`、`sessionId: 0`。然后可按运维文档进行短暂的重连测试。

## 参考资料

- [Microsoft：计划任务运行身份](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtaskprincipal)
- [Microsoft：开机触发器](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasktrigger)
- [OpenSSH：反向转发与跳板连接](https://man.openbsd.org/ssh)
- [Microsoft：Windows OpenSSH 服务配置](https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh-server-configuration)
- [Microsoft：使用 MSI 安装 OpenSSH](https://github.com/PowerShell/Win32-OpenSSH/wiki/Install-Win32-OpenSSH-Using-MSI)
