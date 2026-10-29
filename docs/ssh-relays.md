# SSH 中转入口与源码维护

核验日期：2026-10-21（北京时间）。腾讯云 `49.232.60.144` 作为公共跳板，下面各路线独立运行。登录目标与云端专用隧道账户是两类账号：人员连接时先认证云端 `ubuntu`，再认证目标用户。

## 端口分配

| 路线 | 云端入口 / 目的地 | 目标用户 | 连接发起方 / 云端隧道账号 | 源码 |
| --- | --- | --- | --- | --- |
| 原办公室 Ubuntu 3060 Ti | `127.0.0.1:2222` → 开发机 `192.168.0.37:22` | `tsari` | Ubuntu 主动连接 / `gaasd-office-tunnel` | `ops/office-tunnel/` |
| 原办公室硬件监控 | `127.0.0.1:18765` → 同机 `127.0.0.1:8765` | 网页管理员 | 与上一条共用 Ubuntu 隧道 | `ops/office-tunnel/nginx-status2.conf` |
| 苏州内网 8 卡 RTX 5090 | `127.0.0.1:2223` → `192.168.1.111:22` | `user001` | 苏州 Windows 主动连接 / `gaasd-tsari-relay` | `ops/windows-ssh-relays/` |
| 苏州 Windows 中转机 | `127.0.0.1:2224` → 中转机 `127.0.0.1:22` | `tsari` | 同一 Windows 独立连接 / `gaasd-windows-relay` | `ops/windows-ssh-relays/` |
| 苏州内网 8 卡 RTX 4090 | `127.0.0.1:2225` → `192.168.1.19:22` | `centos` | 同一 Windows 独立连接 / `gaasd-4090-relay` | `ops/windows-ssh-relays/` |
| 清华办公室 RTX PRO 6000 | `127.0.0.1:2226` → 开发机本地 `127.0.0.1:22` | `lenovo` | 开发机主动连接 / `gaasd-pro6000-tunnel` | `ops/pro6000-tunnel/` |
| 清华内网 8 卡 A100 | 云端 OpenVPN → `192.168.2.201:2202` | `aiusr` | 原 OpenVPN 路线，无新增云端回环端口 | 原部署及 `STATUS.md` |

2222、2223、2224、2225、2226、18765 均只监听云端回环地址。`/status2/` 仍是原 3060 Ti 监控，`/status` 的内网选择仍是 A100。2026-10-20 另加 `/status1` 六机总览、`/status3` Windows 监控、`/status4` 苏州 GPU 监控；新采集复用这些路线及独立受限公钥，不修改中转任务或端口，见 [监控部署记录](fleet-monitor-20261020.md)。

**型号核对：** `192.168.1.111` / `tsari-server` 实测 8 张 **RTX 5090**，每张 32607 MiB。用户随后指定的 `192.168.1.19` / `localhost.localdomain` 是另一台机器，实测 8 张 **RTX 4090**，每张 24564 MiB。两台机器和入口分别保留，不把原 2223 改指向新机器。

2026-10-21 新增独立 PRO 6000 路线和 `/status5`；`/status1` 扩为七机总览。部署时发现 Windows 自身 2224 SSH 已提前断开并导致旧采样过期；2223/2225 转发仍可用。详情见 [PRO 6000 接入记录](pro6000-20261021.md)。

2026-10-26 PRO 6000 重装后已恢复相同的 2226 中转、两个人员 RSA 公钥及 `/status5` 监控；备用 ZeroTier 地址改为 `10.243.121.140`。已更新新系统的可信主机公钥，原其他路线不变；版本保护、当前 8 核/单盘变化及验证见 [重装恢复记录](pro6000-reinstall-20261026.md)。

2026-10-27 再次重装后，当前备用地址改为 `10.243.204.184`，2226 主入口不变；新主机身份、LG/adamy RSA 公钥、隧道及监控恢复完成。当前为 24 核、4×32GB、PRO 6000 96GB、单 2TB NVMe 测试配置；固定 Ubuntu 24.04.5 / 6.17 OEM 内核，详见 [最新恢复记录](pro6000-reinstall-20261027.md)。

## 登录命令

2026-10-29 已在 Windows 中转机增加独立 `GAASD-Wifi-Watchdog` 任务，开机及每 5 分钟检查 `tsari20F` 的实际连通性，连续失败才重连。SYSTEM 正常检查已验证，原三条 SSH 任务和配置保持一致；使用、日志与停用方法见 [Wi-Fi 自动恢复说明](../ops/windows-wifi-watchdog/README.md)。未主动断网演练。

2026-10-27 新增 [A100 ↔ 5090 数据交换 Demo](../ops/data-transfer-demo/README.md)：A100 的两枚独立受限密钥仅用于云端固定桥接到原 2223，以及 5090 独立目录内的 rsync。没有新增端口或修改下列登录方式；仍依赖 Windows 中转在线。该通道默认 128 KiB/s，较高速传输时曾观察到新 SSH 握手超时，详见 [带宽与稳定性报告](data-transfer-demo-20261027.md)。

```sh
# 苏州 Windows 中转电脑
ssh -J ubuntu@49.232.60.144 -p 2224 tsari@127.0.0.1

# 苏州内网 8 卡 RTX 5090
ssh -J ubuntu@49.232.60.144 -p 2223 user001@127.0.0.1

# 苏州内网 8 卡 RTX 4090
ssh -J ubuntu@49.232.60.144 -p 2225 centos@127.0.0.1

# 原办公室 Ubuntu 3060 Ti
ssh -J ubuntu@49.232.60.144 -p 2222 tsari@127.0.0.1

# 清华办公室 PRO 6000
ssh -J ubuntu@49.232.60.144 -p 2226 lenovo@127.0.0.1

# 原清华 A100
ssh -J ubuntu@49.232.60.144 -p 2202 aiusr@192.168.2.201
```

每条路线的目标公钥授权彼此独立。不要把隧道专用私钥拿来当人员登录密钥，也不要因新建别名而关闭主机密钥校验。可选客户端配置见 [SSH 模板](../ops/windows-ssh-relays/config/client-ssh.example.conf)，应审阅后合并，不能覆盖个人现有 `~/.ssh/config`。

原 Ubuntu 隧道由 Ubuntu 自己的 systemd 服务维持，与 Windows 无关。**苏州三条路线依赖 `DESKTOP-9TOSVU4` 开机并联网**，由它发起反向 SSH；关闭用户用于操作的笔记本不影响，但关闭或休眠这台 Windows 中转机将中断苏州路线。内网 GPU 服务器无需直接连接公网。

## 源码与运行配置

本次读取的是远端 Windows 中转机上的 `D:\Server`，本地维护电脑没有这个目录。

- 合并来源：`D:\Server\gaasd-ssh-relays` 中选定的 16 个源码、配置模板及说明文件。
- 合并位置：总仓库 `ops/windows-ssh-relays/`，不覆盖 `ops/office-tunnel/` 和原安装器。
- Windows 实际运行根目录：`C:\ProgramData\GAASD-SSH-Relays`，由 SYSTEM / Administrators 保护；计划任务不直接执行 D 盘发布目录的文件。
- 私钥只留在 Windows 本机；腾讯云只接收公钥，分别授权三个 nologin 隧道账户，各密钥仅允许指定的 2223、2224 或 2225 回环监听，并限制 shell、本地转发、Agent/X11/PTY。
- `D:\Server\relay-deployment.local.json`、旧脚本目录、任务备份、运行日志、ZIP、MSI、私钥及完整授权文件没有复制到可提交目录。源包自带的 `.gitignore` / `.gitattributes` 只作用于这个独立子目录。

三个计划任务：

| 名称 | 用途 | 身份与触发器 |
| --- | --- | --- |
| `GAASD-Tsari-SSH-Relay` | `linux` / 2223 | SYSTEM、开机延迟 15 秒、每 5 分钟补启动 |
| `GAASD-Windows-SSH-Relay` | `windows` / 2224 | SYSTEM、开机延迟 15 秒、每 5 分钟补启动 |
| `GAASD-RTX4090-SSH-Relay` | `rtx4090` / 2225 | SYSTEM、开机延迟 15 秒、每 5 分钟补启动 |

任务重复实例策略为 IgnoreNew；监督脚本还有独占锁。SSH 保活为 15 秒 / 3 次，断线后按 5、10、20、40、60 秒退避重连。`connecting-or-running` 只表示进程存在，端到端状态须实际登录验证。

合并后的源码保留原运行设计，并增加了安装前冲突检查：固定腾讯云入口、每条路线的端口、云端账户、任务名、Windows 回环目标及允许迁移的旧目录。误填 2222、18765、`gaasd-office-tunnel` 或其他任务会在变更任务和文件前拒绝。Python 文件按现有 Ruff 规范整理，公钥类型检查改为不可被 Python 优化模式跳过的显式校验。

首次整合仅合并源码。随后新增 4090 时，实际部署了支持 `-Name rtx4090` 的选择安装器和共享监督脚本，只注册启动新路线，原两条路线进程与配置保持不变。选择安装保留未选中的运行定义；不指定 `-Name` 将重建全部配置路线，需从中转机本地管理员控制台执行。GitHub 推送不会自动执行安装器，也不会部署网站。

部署、运维及原验收记录：

- [部署与迁移](../ops/windows-ssh-relays/docs/DEPLOYMENT.md)
- [启停、排查与回退](../ops/windows-ssh-relays/docs/OPERATIONS.md)
- [原部署验收记录](../ops/windows-ssh-relays/docs/VALIDATION.md)（来源材料，区别于下面的本次检查）
- [原 Ubuntu 隧道说明](office-tunnel-20261017.md)
- [新增 4090 的部署、授权与回退记录](rtx4090-relay-20261020.md)

## 新增 4090 的检查

- 2225 实际跳板登录成功，目标账户 `centos`，确认 8 张 RTX 4090。
- 两枚指定 RSA 公钥追加到 `centos`，保留原授权并备份；本机 RSA 签名登录成功，另一枚公钥被服务器接受，配对私钥未在本机测试。
- 新任务为 SYSTEM / session 0，已核验开机触发器。仅新路线进行断线模拟，自动重连后再次登录成功；未做整机重启。
- 原 2223 / 2224 监督进程、SSH 进程和配置哈希不变；新端口仅监听云端回环地址。
- `npm run test:relays` 扩展为 34 项，覆盖第三条路线的固定分配、选择安装保留旧配置、拒绝隐式删除路线及错误参数。
- 详细备份位置、认证范围和实际测试结果见上面的 4090 部署记录。

## 首次整合检查（新增 4090 之前）

- 通过用户给出的两个跳板命令实际登录成功：Windows 返回 `desktop-9tosvu4\tsari`；Linux 返回 `tsari-server` / `user001`。GPU 查询确认 8 张 RTX 5090。
- 两个任务均为 Running / SYSTEM / ServiceAccount，运行状态为 `NT AUTHORITY\SYSTEM`、session 0，动作指向受保护的 ProgramData 脚本。已核对开机与 5 分钟重复触发器；`sshd`、`WlanSvc`、`ZeroTierOneService` 为 Running / Auto，旧目录停用标记存在。
- 云端 2222、2223、2224、18765 的监听彼此独立；两个新账户的 `authorized_keys` 权限为 600，受限公钥选项与源码一致。原 `gaasd-office-tunnel` 的 Match 块保持独立。
- 主站 200，原云端 18765 监控 200，A100 Web 后端 200，`/status2/` 匿名 401；`nginx -t` 与 `sshd -t` 通过。
- 整合前后云端 SSH、Nginx、OpenVPN 配置文件的 SHA-256 完全一致，四个回环端口的监听进程 PID 也保持不变。
- `npm run test:relays` 在 Windows PowerShell 5.1 下完成 23 项只读检查：6 个 PowerShell 源文件语法、合法模板及 16 个错误配置。测试不会安装任务、访问凭据或连接服务器。
- Python Ruff、格式与语法检查，以及 Git 差异检查用于确认合并的代码质量。不把静态检查描述为重装验收。
- 本次不重复模拟断线或整机重启；源码包中的早先断线恢复记录保留原上下文。完整开机验证仍未执行。
- Windows 的默认 SFTP/scp 下载尝试返回 `Received message too long`，因此本次通过已认证的 SSH 只读获取选定源码文件。SSH 登录和隧道正常；SFTP 属于原 Windows SSH 服务的待排查项，本次未修改或重启该服务。

在仓库根目录运行只读检查：

```powershell
npm run test:relays
python -m ruff check ops/windows-ssh-relays
python -m ruff format --check ops/windows-ssh-relays
```

Python 需使用已安装 Ruff 的项目环境。日常状态查看仍在中转机执行：

```powershell
& 'C:\ProgramData\GAASD-SSH-Relays\bin\Control-Relay.ps1' -Action Status
```
