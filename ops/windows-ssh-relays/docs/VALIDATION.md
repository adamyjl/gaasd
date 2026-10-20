# 验证记录

以下保留中转电脑 `D:\Server\gaasd-ssh-relays` 随附的原部署验收记录。“当前电脑”“本机”指该 Windows 中转机，断线恢复与安装记录不是本次整合中重新执行的测试。本次从维护电脑进行的只读核验及源码检查见 [中转总览](../../../docs/ssh-relays.md)。

验证时间：2026-10-20，Asia/Shanghai。

## 用户公钥

- RSA 3072 位，指纹 `SHA256:E8yG4UtPspvZ3Z/H1FZpi2iDBaOpmZ8alpA43beyMhg`。
- 已追加到 `user001@192.168.1.111` 的 `/home/user001/.ssh/authorized_keys`，保留原有 5 枚公钥。
- `.ssh` 权限为 700，`authorized_keys` 为 600；已有内容已备份。
- 使用该公钥进行 SSH 探测时，Linux 返回 `Server accepts key`。当前电脑没有那台电脑的配对私钥，因此没有代替用户完成该 RSA 密钥的签名认证。最后的实际 RSA 登录应由持有私钥的电脑完成。
- 这枚 RSA 公钥也已在 Windows `tsari` 和腾讯云 `ubuntu` 入口授权。

## SYSTEM 自启动

- `GAASD-Tsari-SSH-Relay` 与 `GAASD-Windows-SSH-Relay` 均为 `Running`。
- Principal 为 `SYSTEM`，LogonType 为 `ServiceAccount`，RunLevel 为 Highest。
- 均有开机触发器及 5 分钟重复触发器；开机延迟 15 秒，运行时长无限制，重复实例策略为 IgnoreNew。
- 两个运行实例的状态均为 `account: NT AUTHORITY\SYSTEM`、`sessionId: 0`，证明当前运行不依赖用户的交互会话。
- Windows `sshd`、`WlanSvc`、`ZeroTierOneService` 都为 Running / Automatic。
- 本次没有重启或注销整台 Windows，避免中断用户工作；实际重启后的完整验收尚未执行。

## 断线恢复与端到端验证

使用 `Test-RelayRecovery.ps1` 分别模拟两条隧道无法连接云端的情形：

| 路线 | 原 SSH PID | 首次失败尝试 PID | 恢复后 PID | 结果 |
|---|---:|---:|---:|---|
| Linux | 2360 | 1192 | 2532 | 失败后自动重试并重新建立 TCP |
| Windows | 8476 | 6312 | 6744 | 失败后自动重试并重新建立 TCP |

日志记录了 5 秒重试、连接失败退出码 255、10 秒重试及恢复后的新连接。没有断开物理网卡或修改其他代理。

恢复后，经腾讯云跳板使用本机既有登录私钥完成实际 SSH 登录：

- Linux 返回 `tsari-server` / `user001`。
- Windows 返回 `DESKTOP-9TOSVU4` / `desktop-9tosvu4\tsari`。

## 现有腾讯云服务

迁移前后的以下文件 SHA-256 完全一致：

- `/etc/nginx/nginx.conf`
- `/etc/nginx/sites-enabled/*`
- `/etc/nginx/snippets/*`
- `/etc/ssh/sshd_config` 与 `/etc/ssh/sshd_config.d/*`
- `/etc/openvpn/client/platform.conf`

Nginx、OpenVPN、SSH、gaasd-analytics 的主进程 PID 和启动时间均未变化。

| 检查项 | 结果 |
|---|---|
| `https://gaasd.com/` | HTTP 200 |
| 清华 A100 后端 `http://192.168.2.201:3000/` | HTTP 200 |
| 现有办公室监控 `http://127.0.0.1:18765/`（云端） | HTTP 200 |
| `https://gaasd.com/status2/` 匿名请求 | HTTP 401，符合既有认证配置 |
| 现有办公室 `127.0.0.1:2222` / `18765` | 原监听进程保持运行 |
| 新增两条路线 | 仅监听云端 `127.0.0.1:2223` / `2224` |

## 发布范围

发布目录不包含实际私钥、完整 authorized_keys、运行日志、安装包或个人 SSH 配置。任务的生产运行文件位于独立的 ProgramData 目录。

本次实际执行了公钥追加、任务安装、SYSTEM 运行、故障恢复测试和端到端登录。可选的新机器 Windows 安装脚本及通用云端账户脚本由已部署流程整理而成；对整理后的版本做语法检查，没有为了验证重装现有 Windows 服务或重新创建云端账户。
