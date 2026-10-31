# Windows 无线网络自动恢复

2026-10-29 安装在研究院 Windows 中转机 `DESKTOP-9TOSVU4`。网卡为 **Realtek 8832CU Wireless LAN WiFi 6 USB NIC**，接口 `WLAN`，GUID `925b24d3-18f9-4312-91de-438c7a7f32f8`；已保存的全用户 Wi-Fi 配置和 SSID 均为 `tsari20F`。

## 行为

- 任务名 `GAASD-Wifi-Watchdog`，SYSTEM 身份，无需登录桌面或提供账号密码。开机延迟 45 秒检查，另外每 **5 分钟**检查一次。
- 只处理指定 GUID 的无线网卡和指定 SSID。切换到其他 SSID、手动禁用网卡、网卡不存在、WLAN 服务未运行，或出现多个无法明确识别的 WLAN 接口时记录并跳过；不切换用户选择的网络，不启用飞行模式下的设备。
- TCP 探测绑定 Wi-Fi 自己的 IPv4 地址，防止 ZeroTier 等接口掩盖 Wi-Fi 故障。探测腾讯云 `49.232.60.144:22` 及两处公网 DNS 的 TCP 53（`223.5.5.5`、`119.29.29.29`），任一可达即视为连通。每次连接最多 2.5 秒，不依赖 ICMP 或 Windows NCSI 图标。
- 第一轮均失败后等 10 秒重新判断；仍然均失败才执行相当于手工“断开 → 连接”的 `netsh wlan disconnect/connect`。没有关联 SSID 时直接连接保存的配置。
- 断开后 2 秒请求连接，等待 25 秒复查；失败记录日志，下一轮再试。保存最近操作时间并设置 270 秒防重复间隔，为每 5 分钟触发的探测耗时变化预留余量。单实例和文件锁防止重叠执行，任务最多运行 3 分钟。
- 无网络时仍允许运行；没有设置“仅网络可用才运行”的条件。正常联网只检查和记录，**不会每 5 分钟强制断开一次**。

沿用 Windows 已保存的 WPA2 配置，不导出/保存 Wi-Fi 密码。不改 IP、DNS、路由、MTU、驱动、电源选项、代理、ZeroTier 或原 SSH 中转任务；只新增本任务与独立目录。真实恢复过程中 Wi-Fi 会短暂断开，原反向 SSH 会话可能随之断开，由既有监督任务自动重连。

## 位置与操作

| 位置 | 用途 |
| --- | --- |
| `C:\ProgramData\GAASD-Wifi-Watchdog` | 实际运行目录，只有 SYSTEM 和 Administrators 可写 |
| `Watch-Wifi.ps1` / `Wifi-Common.ps1` | 入口、探测与重连逻辑 |
| `config.json` | 指定网卡、SSID、保存配置名称及探测目标，不含密码 |
| `watchdog.jsonl` | 正常/失败/重连日志，超过 2 MiB 轮转，只保留一份旧文件 `.1` |
| `state.json` | 最近重连时间；首次正常检查不会创建此文件 |
| `D:\Server\gaasd-wifi-watchdog` | 该 Windows 中转机上的源代码、说明及原任务/配置核对记录 |

以下在 **Windows 中转机的管理员 PowerShell** 中执行：

```powershell
# 查看任务上次结果与下次运行时间；LastTaskResult=0 表示脚本运行成功
Get-ScheduledTaskInfo -TaskName 'GAASD-Wifi-Watchdog'

# 查看最近检查/重连记录；reconnect_finished 的 online 才是恢复结果
Get-Content 'C:\ProgramData\GAASD-Wifi-Watchdog\watchdog.jsonl' -Tail 20

# 仅检查，不执行重连
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'C:\ProgramData\GAASD-Wifi-Watchdog\Watch-Wifi.ps1' -CheckOnly

# 暂停自动恢复
Disable-ScheduledTask -TaskName 'GAASD-Wifi-Watchdog'

# 恢复自动检查
Enable-ScheduledTask -TaskName 'GAASD-Wifi-Watchdog'
Start-ScheduledTask -TaskName 'GAASD-Wifi-Watchdog'
```

暂停后如当前实例正在进行重连，应让本次实例完成，避免在已断开但尚未请求连接的间隙强行杀掉它。正常检查不到一分钟完成。

首次安装/更新命令（已完成，无需重复）：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File 'D:\Server\gaasd-wifi-watchdog\Install-WifiWatchdog.ps1' -InterfaceGuid '925b24d3-18f9-4312-91de-438c7a7f32f8'
```

执行策略 Bypass 仅作用于这个 PowerShell 进程，不修改系统全局执行策略。安装器限定目标机器，拒绝覆盖无本项目标记的目录/同名非本项目任务；更新时备份本任务与自身配置。

## 验证与边界

- Windows PowerShell 5.1 语法检查及 10 项状态机测试通过，覆盖健康不动作、瞬时失败不动作、连续失败重连、未关联直接连接、其他 SSID/禁用/多接口跳过、冷却、只读检查，以及断开报错后仍尝试连接。测试是 mock，**不属于真实断网恢复演练**。
- 在实际目标机器上完成只读联网检查；SYSTEM 计划任务也实际运行并记录 `healthy`。核验 5 分钟周期、开机触发器、SYSTEM 身份、离线可运行及单实例设置。
- 对比安装前后四项原 GAASD 监控/SSH 任务 XML，以及原三条隧道配置、sshd_config 的 SHA-256，保持一致。
- 未主动断开当前正常 Wi-Fi、重启网卡或重启整机，避免中断 5090、4090 及 Windows 自身的远程通道。因此尚未实测下一次自然故障后的恢复结果，可从日志确认。
- TCP 探测验证的是基础 IP 连通性，不代表所有网站、DNS 解析或门户认证均正常。重连无法保证修复 AP 故障、设备拔出、驱动崩溃、密码变更等根本问题；本次不从照片/日志断定具体硬件故障。

命令依据：[Microsoft netsh wlan](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/netsh-wlan)、[任务触发器](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasktrigger)。
