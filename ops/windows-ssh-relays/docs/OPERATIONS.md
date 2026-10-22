# 运维与回退

## 运行文件

```text
C:\ProgramData\GAASD-SSH-Relays\
├── bin\                       # SYSTEM 执行的正式脚本
├── config\linux.conf          # 2223 -> 192.168.1.111:22
├── config\windows.conf        # 2224 -> 127.0.0.1:22
├── config\rtx4090.conf        # 2225 -> 192.168.1.19:22
├── credentials\               # SYSTEM / Administrators 专用
│   ├── linux_ed25519
│   ├── windows_ed25519
│   ├── rtx4090_ed25519
│   └── cloud_known_hosts
├── relays.json
├── runtime\linux\             # relay.log、ssh.log、state.json、relay.lock
├── runtime\windows\
├── runtime\rtx4090\
└── backups\                   # 安装前的任务 XML、运行定义与共享脚本
```

`relay.log` 是监督脚本日志；`ssh.log` 是 SSH 诊断日志。在连接重试时检查并轮转大于 1 MB 的日志，只保留一个 `.1` 备份。长期连续连接期间 SSH 日志仍可能增长。查看 `ssh.log` 和私钥 ACL 需管理员权限，不要输出或分享私钥内容。

`state.json` 的 `connecting-or-running` 只表示 SSH 进程存活，**不单独证明端到端连接成功**。最终以实际 SSH 登录为准。

## 启停操作

状态命令可在普通 PowerShell 使用，修改状态的命令在管理员 PowerShell 使用：

```powershell
$control = 'C:\ProgramData\GAASD-SSH-Relays\bin\Control-Relay.ps1'
& $control -Action Status
& $control -Action Restart -Name linux
& $control -Action Restart -Name windows
& $control -Action Restart -Name rtx4090
& $control -Action Stop -Name all
& $control -Action Start -Name all
```

`Stop` 同时禁用计划任务并写入停用标记，避免 5 分钟触发器重新拉起；`Start` 清除标记并启用任务。不要只在任务管理器结束 `ssh.exe`，监督脚本会自动重连。

新增 4090 路线如需暂时回退，执行 `-Action Stop -Name rtx4090` 即可；原 2223 / 2224 不受影响。无需恢复整份旧 `relays.json` 或删除专用密钥。恢复时使用 `-Action Start -Name rtx4090`。

## 断线恢复测试

在**本机管理员控制台**执行：

```powershell
& 'C:\ProgramData\GAASD-SSH-Relays\bin\Test-RelayRecovery.ps1' -Name all
# 仅测试 4090；不会测试或中断另外两条路线
& 'C:\ProgramData\GAASD-SSH-Relays\bin\Test-RelayRecovery.ps1' -Name rtx4090
```

该测试逐条把隧道连接目标暂时改为本机未监听的端口 1，结束该隧道 SSH 子进程，确认监督脚本开始重试，再恢复配置并检查新 TCP 连接。配置恢复放在 `finally` 中。测试会短暂中断被测隧道，但不会改动网卡、Wi-Fi、防火墙、Nginx 或其他隧道。

随后再次执行：

```powershell
ssh -tt tsari-via-cloud 'hostname; id -un; exit'
ssh -tt windows-via-cloud 'hostname; whoami; exit'
ssh -tt rtx4090-via-cloud 'hostname; id -un; exit'
```

## 连接故障

1. 查看本机任务是否 `Running`，状态文件是否为 SYSTEM / session 0。
2. 确认本机能连接 `49.232.60.144:22`；5090 和 4090 路线分别还需能连接 `192.168.1.111:22` 与 `192.168.1.19:22`。Wi-Fi / ZeroTier 应在系统启动时即可联网。
3. 以管理员身份查看相应 `runtime\<name>\ssh.log` 与 `relay.log`。主机指纹变化、专用密钥权限错误、云端端口被占用会在日志中显示。
4. 云端可执行 `sudo ss -lntp`，确认本项目只监听 `127.0.0.1:2223`、`127.0.0.1:2224`、`127.0.0.1:2225`。
5. “Permission denied” 时区分是腾讯云 `ubuntu` 的第一次认证，还是目标 `user001` / `tsari` / `centos` 的第二次认证。`ssh -vv <别名>` 可辅助定位。
6. 若隧道正常而 Windows 登录失败，检查 `Get-Service sshd`。该服务应为自动启动，仅监听 `127.0.0.1:22`。

其他电脑首次连接时需核验主机指纹。当前 Ed25519 指纹：

| 主机 | SHA-256 指纹 |
|---|---|
| 腾讯云 | `SHA256:gXs2kdeIwkmakRGLw0QMhpG5viOU0uizpcjSy3IsRoY` |
| Linux `192.168.1.111` | `SHA256:oJel9mfqymph//FFBcmCiZZXmHC8eaTqFH/Av6NaB74` |
| Windows `DESKTOP-9TOSVU4` | `SHA256:XPTKoI420dStr9n3cOwuScLCHYJgn4+BJhFPkPkGqFo` |
| 4090 `192.168.1.19` | `SHA256:cavK9dsPoWugv2XDva9fsVoijfY7JghCTQbPHuNLLNg` |

## 回退至旧版任务

通常修复配置并重装 SYSTEM 任务即可。确实需要回退时，在本机管理员控制台逐条操作，避免新旧隧道争用同一云端端口。

1. 分别用 `Control-Relay.ps1 -Action Stop -Name linux` 和 `-Action Stop -Name windows` 停止并禁用原两条 SYSTEM 任务。4090 没有旧版任务，不要使用 `-Name all` 连带停止它。
2. 在 `C:\ProgramData\GAASD-SSH-Relays\backups` 找到 **2026-10-20 首次迁移前** 的两份 XML，检查其中任务动作指向旧目录，且身份为 `tsari` / InteractiveToken。后续重装生成的备份可能已经是新版 SYSTEM 任务。
3. 用实际文件名恢复：

```powershell
# 下列时间戳需替换成步骤 2 查到的文件名。
Register-ScheduledTask -TaskName 'GAASD-Tsari-SSH-Relay' `
    -Xml (Get-Content -Raw 'C:\ProgramData\GAASD-SSH-Relays\backups\linux-YYYYMMDD-HHMMSS.xml') -Force
Register-ScheduledTask -TaskName 'GAASD-Windows-SSH-Relay' `
    -Xml (Get-Content -Raw 'C:\ProgramData\GAASD-SSH-Relays\backups\windows-YYYYMMDD-HHMMSS.xml') -Force
Remove-Item -LiteralPath 'D:\Server\tsari-relay\disabled' -ErrorAction SilentlyContinue
Remove-Item -LiteralPath 'D:\Server\windows-relay\disabled' -ErrorAction SilentlyContinue
Enable-ScheduledTask -TaskName 'GAASD-Tsari-SSH-Relay'
Enable-ScheduledTask -TaskName 'GAASD-Windows-SSH-Relay'
Start-ScheduledTask -TaskName 'GAASD-Tsari-SSH-Relay'
Start-ScheduledTask -TaskName 'GAASD-Windows-SSH-Relay'
```

旧版需要 `tsari` 登录 Windows 后才能运行。回退不会自动删除新运行目录、专用密钥或云端账户；保留它们便于再次迁移。不要递归清理 `C:\ProgramData\ssh` 或个人 `.ssh`。

## 上传 GitHub

源码现已整合至原 GAASD 仓库的 `ops/windows-ssh-relays/`。在同一功能分支中维护和推送，只提交源代码、参数模板及说明，不上传 ZIP 或整个 `D:\Server`。

项目的 `.gitignore` 排除了本地参数、密钥常见文件名、日志、运行目录和安装包。它不能代替人工审阅；本次打包已核查文件清单及私钥内容标记。新增文件后应重新检查 `git status`，不要把整个 `D:\Server` 当成待发布目录。

项目总览及端口登记见 [中转总览](../../../docs/ssh-relays.md)。推送 GitHub 不会安装或重启任何中转任务；实际运行仍使用 ProgramData 下的受保护副本。
