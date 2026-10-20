# 2026-10-20 六机监控发布

此次增加三个受保护入口，统一沿用 `/status` / `/statistics` 的 HTTP Basic 用户名、密码和认证域。未增加账号，未修改宣传页面、视频、Nginx 或已有 SSH 中转。源代码维护于 `feature/why-cbdes-review`；GitHub 推送不会自动部署生产。

## 入口与功能

| 地址 | 内容 |
| --- | --- |
| [六机总览](https://gaasd.com/status1) | A100 / 4090 / 5090 三台 GPU 服务器，腾讯云 / 3060 Ti / 苏州 Windows 三台开发及中转机；在线状态、CPU、内存、GPU、磁盘、网络、进程摘要和相对腾讯云延迟 |
| [Windows 监控](https://gaasd.com/status3) | 型号、主板、内存模块、磁盘型号/容量/健康/温度、CPU 每核、内存及分页文件、GPU、磁盘/网络速率、软件资源列表、24 小时趋势 |
| [苏州 GPU 监控](https://gaasd.com/status4) | 在 8×RTX 5090 / 8×RTX 4090 之间切换，实时硬件指标、8 张卡明细、GPU 进程、24 小时趋势、按日/周汇总 |
| [原腾讯云/A100](https://gaasd.com/status) | 原功能及 A100 历史保留，增加互相导航 |
| [原 3060 Ti 页面](https://gaasd.com/status2/) | 原开发机自行维护的监控页面，认证和转发保持原样 |
| `/status1/host?server=office` | 3060 Ti 统一格式详情，由总览进入，补充原 `/status2/` |

可直接访问 `/status4?server=rtx4090` 或 `?server=rtx5090`。所有页面、快照、历史和新增 JS/CSS 均要求管理员认证，沿用 no-store、CSP 和 Nginx 限流。对未知 server、路径或非 GET/HEAD 方法拒绝访问。

## 真实机器与采集路径

| ID | 机器 | 云端采集路径 |
| --- | --- | --- |
| cloud | 腾讯云 2 线程 / 约 7.4 GiB 内存 | 原本机采集服务 |
| intranet | `192.168.2.201`，112 线程，8×A100-SXM4-80GB | 原 OpenVPN + aiusr SSH 2202 |
| office | `192.168.0.37`，i7-12700K，RTX 3060 Ti | 原回环 SSH 2222 |
| windows | `DESKTOP-9TOSVU4`，i7-4790K，16 GB 内存，GTX 1060 3GB | 原回环 SSH 2224 |
| rtx5090 | `192.168.1.111`，192 线程，8×RTX 5090 | 原回环 SSH 2223，user001 |
| rtx4090 | `192.168.1.19`，128 线程，8×RTX 4090 | 原回环 SSH 2225，centos |

Windows 和两台苏州 GPU 服务器的远程采集依赖苏州 Windows 中转机开机联网；办公室 Ubuntu 与 A100 继续走各自独立路线。关闭用于操作的笔记本不会影响监控。

新增 `gaasd-status-fleet.service` 在腾讯云以 `gaasd-analytics` 运行，每 30 秒并行读取四个固定 SSH 目标。每个目标有独立受限密钥，只允许 `snapshot`；严格校验主机公钥、5 秒连接超时、26 秒命令上限。私钥不离开腾讯云。Linux 探针按需运行；Windows SYSTEM 任务本地周期采集，SSH 只读缓存。HTTP 请求仅读缓存，不启动远端命令。

## 指标口径

- 页面可选择 30 / 60 / 600 秒，支持暂停、手动刷新；后台采样保持 30 秒。超过 90 秒或连接失败明确标为过期，过期机器不计入总览在线汇总。
- CPU 汇总按在线逻辑核心数加权；内存和显存按容量相加。GPU 计算利用率是 NVIDIA 驱动采样值，不能解释为 FLOPS、计算任务时长或计费 GPU 小时。三台服务器与两台有显卡的开发机合计 26 卡。
- A100 的 ping 为腾讯云经 OpenVPN 发出的真实 ICMP；其余四台机器在目标端 ping 腾讯云公网，展示往返时间。SSH 反向端口不传 ICMP，因此不把 SSH 采集耗时冒充 ping。采集耗时单独显示，包含握手及读取硬件所需时间；腾讯云自身显示“本机基准”。
- 云端内核原先禁止普通组 ICMP Echo socket（`1 0`）；已仅允许监控组 GID 988，持久化于 `/etc/sysctl.d/60-gaasd-monitor-ping.conf`。采集服务仍没有 raw socket capability，保持 `NoNewPrivileges=true`。
- CPU 温度等指标以驱动实际提供为准。Windows 已读取 GPU、两块物理硬盘温度及 ACPI 热区；**没有 CPU 核心/封装温度**。页面明确区分这些温度。
- Windows 展示软件 CPU、常驻内存、GPU 引擎、可用的进程显存及 I/O 速率；进程显存性能计数器可能不精确。**逐软件网络字节量未提供**，网络使用量按网卡展示。I/O 计数器并非纯磁盘 I/O。
- Linux 非特权用户能读取的型号、传感器和进程指标按实际权限展示，缺失项保持未知。网络多接口合计可能包括虚拟网卡重复流量，明细可查看各接口。

4090 / 5090 的长期历史于 **2026-10-20 17:20:51 / 17:20:48（北京时间）** 首次采样开始积累，不补造之前数据。日/周计算、覆盖率、北京时间和 400 天保留规则与 A100 相同；切换服务器会取消旧查询。A100 自 2026-10-09 的原有历史不迁移、不清空。

## 文件、服务与数据

| 位置 | 用途 |
| --- | --- |
| `backend/fleet.py` | 固定主机注册表、缓存读取、六机总览 |
| `backend/fleet_collector.py` / `fleet_probe.py` | 云端轮询 / Linux 强制命令探针 |
| `backend/ui/fleet.*` | 总览 UI |
| `backend/ui/status.*` / `status-gpu-usage.js` | 复用详情及日/周统计 UI |
| `ops/fleet-monitor/` | 安装器、Windows 三个脚本、服务模板及 ICMP Echo 权限安装器 |
| `/etc/gaasd-analytics/fleet.json` / `fleet-ssh/` | 受限运行配置、四对独立密钥及固定 known_hosts |
| `/var/lib/gaasd-analytics/status/{office,windows,rtx4090,rtx5090}/` | latest/history/connection JSON，后两者另含 gpu-usage.sqlite3 |
| `/var/lib/gaasd-analytics/status/fleet-latency.json` | 腾讯云基准及 A100 ICMP 采样 |
| `~/.local/share/gaasd-fleet/{venv,releases,current}` | 三台 Linux 新探针，原应用环境保持原样 |
| Windows `D:\Server\gaasd-fleet-monitor` | 采集脚本发布副本 |
| Windows `C:\ProgramData\GAASD-Monitor` | 仅 SYSTEM/Administrators 可写的实际脚本、JSON 缓存、锁和有大小上限的日志 |
| `GAASD-Hardware-Monitor` | Windows SYSTEM 开机延迟 30 秒任务、5 分钟补启动、单实例 |

每日备份脚本新增 `gpu-rtx4090-YYYYMMDD.sqlite3`、`gpu-rtx5090-YYYYMMDD.sqlite3`，与原访问统计和 A100 库分别使用 SQLite 一致性备份 API，每类保留 14 份。运行数据和密钥不入 Git。

## 本次部署与验证

- 后端版本：`/opt/gaasd-analytics/releases/20261020T173725`；前一版本保留为 `/opt/gaasd-analytics/releases/20261009T120100`。
- 部署记录及前一服务单元：`/var/backups/gaasd-status-20261020T173725/`。本地对应源码包：`work/gaasd-status-20261020T173725.tar`，17 文件 SHA-256 清单。
- 静态站点仍为 `/var/www/gaasd-test/releases/20261008T095600`，未更改 Nginx；现有 `^~ /status` 代理覆盖新增入口，原更长的 `/status2/` 匹配保留。
- 三台 Linux 探针版本（UTC 名称）：office `20261020T091651`、rtx5090 `20261020T091658`、rtx4090 `20261020T091711`。各自 `.ssh/authorized_keys.before-fleet-<版本>` 保留原授权。
- Windows 原授权备份：`C:\ProgramData\GAASD-Monitor\backups\20261020-171402\authorized_keys`。软件排序修正前脚本另存 `backups\Collect-Hardware-before-process-sort.ps1`。
- 真实受限 SSH 采样成功：1 / 1 / 8 / 8 张显卡，四个目标用同一采集密钥请求 `id` 均拒绝。现有五个云端回环监听进程保持原 PID。
- 后端 **101 项通过**（包含三台 GPU 库的每日备份保留与活跃 WAL 一致性检查）；静态格式、ESLint、TypeScript、Ruff 和 PowerShell 语法检查通过。原状态页浏览器回归 **11 通过，9 个按视口跳过**。
- 本地合成数据的真实 Chromium 检查 4 个视口通过；另外以生产 HTTPS 和真实管理员登录分别检查 **1440 / 1024 / 390 / 320px**，4 项通过。覆盖六机在线、Windows 每核与软件面板、8 GPU、4090/5090 切换、日/周查询、刷新、A100 回归、未登录 401、无页面脚本异常和文档横向溢出。
- 生产截图保存在忽略目录 `work/fleet-screenshots/`；测试日志和部署记录在 `work/fleet-20261020/`。真实机器信息不嵌入公共源码。
- 修正 Windows 软件排行后重新验收生产桌面/手机，两项通过；另对原 `/status2/` 做生产桌面回归，两项通过。A100 ICMP、Windows 大内存进程及可用 GPU 进程计数器实际读取成功；新 GPU 库每日备份已执行，两个文件 `quick_check=ok`。
- 已验证服务 enabled/active、Windows 任务触发器和连续采样。**未重启整台 Windows / Linux / 云服务器**来演练断电启动；避免影响正在运行的任务。

## 维护与回退

首次安装步骤和配置结构见 [采集组件 README](../ops/fleet-monitor/README.md)。后续网页和云采集器继续使用 `build:status` / `deploy-status.py`；Windows 源码变更须更新受保护运行副本并仅重启 `GAASD-Hardware-Monitor`，不要重启中转任务。

```sh
sudo systemctl status gaasd-status-fleet
sudo journalctl -u gaasd-status-fleet -n 50 --no-pager
sudo -u gaasd-analytics /opt/gaasd-analytics/venv/bin/python /opt/gaasd-analytics/current/fleet_collector.py --once
```

`--once` 只用于排障，避免与持续采集器长时间并行运行。Windows 查看任务和 `C:\ProgramData\GAASD-Monitor\collector.log`，检查最新 JSON 时间是否持续前进。

回退网页/云采集器时：停止并禁用新增 `gaasd-status-fleet`；将后端 current 原子切回记录中的 previous_backend；恢复备份中的原 `gaasd-status-intranet.service`，daemon-reload 并重启 analytics、cloud collector、intranet collector。保留所有监控数据和新 GPU 历史库。旧版备份脚本不会自动备份新 GPU 库，回退期间需单独继续备份。

停止 Windows 采集只需停用 `GAASD-Hardware-Monitor`，不触碰三个 SSH relay 任务。需要撤销采集授权时，只按专用公钥指纹删除新加的一行，避免用整份旧授权覆盖后来新增的人员密钥。各 Linux 探针可切回其旧 current 或停用新受限公钥，保留原应用和历史。仅撤销本次 ICMP 配置时恢复原 `net.ipv4.ping_group_range=1 0` 并移除本次独立 sysctl 文件；若后来另有修改，先核对再恢复。
