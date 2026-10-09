# GAASD 服务器状态

入口：[https://gaasd.com/status](https://gaasd.com/status)。与 `/statistics` 使用同一管理员账号、同一密码和同一 HTTP Basic 认证域，不新增账户。两页顶部可互相跳转，页面、静态脚本和状态接口均要求登录。

2026-10-01 更新：顶部可选择腾讯云服务器 `49.232.60.144`（默认）或内网服务器 `192.168.2.201`。可用 `/status?server=cloud`、`/status?server=intranet` 直接打开对应服务器；浏览器记住上次服务器和刷新间隔。切换时先隐藏上一台数据，旧请求不会覆盖新选择；内网不可用时不会误显示腾讯云数据。

## 展示内容

- 每个逻辑 CPU 核心的占用率、I/O 等待、虚拟机资源等待，整机 CPU、1 / 5 / 15 分钟负载和可用的频率信息。
- 物理内存总量、使用中、可用、空闲、缓存、缓冲区；Swap 总量、使用、可用及换入 / 换出速率。
- 本机磁盘与内存文件系统的容量、可用空间、空间使用率、inode 使用率；每个块设备读写速率、IOPS、繁忙度。COS 等远程挂载单独标注，不发起可能阻塞的远程容量探测，也不计入系统盘容量。
- 每个网卡的收发速率、开机累计流量、错误与丢包、地址、连接状态；TCP 状态汇总和监听端口。
- CPU 和内存各前 8 名进程的合集、PID、状态、CPU、常驻内存；不读取进程参数、环境变量或文件内容。
- Nginx、SSH、统计服务、采集服务、备份计时器、证书续期计时器；HTTPS 证书验证与到期时间、最近一次数据库备份。
- 主机、操作系统、内核、架构、运行时间、开机时间、文件句柄、CPU / 内存 / I/O 压力。虚拟机未提供的温度等指标明确标为未提供。
- 内网服务器：112 个逻辑核心、8 张 NVIDIA A100-SXM4-80GB（总显存 640 GiB）。GPU 0–7 分别展示计算利用率、显存总量/使用/可用、显存读写活动、温度、功耗及上限、性能状态、驱动、UUID/PCI 标识和计算进程显存。A100 SXM 的风扇指标未提供，显示“未提供”；显存被占用不等同于 GPU 正在计算。内网页面检查 SSH / Docker，不套用腾讯云的网站证书和数据库备份提示。

## 更新与数据口径

两台服务器每 30 秒独立采样，网页默认每 30 秒获取一次，可切换 **30 / 60 / 600 秒**、暂停或手动刷新，不再提供 5 秒选项。网页刷新间隔不改变服务器采样频率。页面进入后台后暂停请求，返回时继续；关闭网页或关闭本机不影响服务器采集。

腾讯云 CPU、网络和磁盘速率由相邻采样差值计算。内网每次 SSH 查询读取两次计数器，中间至少等待 1 秒，速率为该次短窗口的均值（当前实际约 2–3 秒，页面显示测量窗口），不表示整个 30 秒期间的连续平均。GPU 利用率是 NVIDIA 驱动报告的当次利用率，不是从显存占用推算。

最近 24 小时趋势保存在服务器，每分钟聚合一次；首次有效样本会立即生成首个点，此后展示采样均值。可选择最近 1 / 6 / 24 小时，超过 24 小时的趋势自动轮替。进程明细只保存当前快照，不保存 24 小时的进程记录。历史数据从本功能上线开始积累，采集服务重启后读取已有趋势继续更新；中断超过 3 分钟的趋势线不连线。

单核心 CPU 为 0–100%，整机 CPU 为各核心平均，进程 CPU 按整机总算力归一化。CPU 首个样本、计数器重置时的速率显示采样中，避免展示假的 0。内存使用中为总量减可用，与 `free` 的缓冲 / 缓存分类存在口径差别。磁盘可用空间不包含系统保留块。网卡累计流量不代表腾讯云计费流量。

快照超过 90 秒未更新会显示过期提示；内网 SSH 采集失败时立即标记连接中断，保留最后成功样本及原始时间。网页网络失败也会保留最后一份数据并明确标记。历史接口超过 180 秒标记过期。腾讯云证书、服务和备份每 60 秒检查一次，内网服务随每次远程采样检查。阈值提示包括内存 / Swap / 本机磁盘 / inode 达到 85%，瞬时 CPU 达到 90%，关键服务不活跃，证书不足 14 天，或 36 小时未发现备份。提示仅显示在页面，不发送通知。

## 8 卡 GPU 日 / 周统计（2026-10-09）

选择内网服务器，或直接打开 `/status?server=intranet`。新增“8 卡整体使用统计”：最近 14 / 30 / 90 天、4 / 12 / 26 周，支持指定截至日期回查，日期留空为今天。显示整体计算利用率与显存占用的采样均值、峰值、柱图、逐期明细和采样覆盖率。明细最新在前，手机端图表和表格可在各自区域内横向滚动。原 GPU 面板新增实时整机计算、显存已用、显存占用率和总容量。

- 计算利用率取 GPU 0–7 的算术平均，范围 0–100%，不是 FLOPS；显存使用量、容量按 8 卡相加（当前 640 GiB）。日 / 周均值对有效采样加权，不对各天均值做无权平均；峰值是已采样峰值，可能错过采样间的瞬时高峰。
- 时间使用北京时间；自然日 00:00 开始，自然周为周一至周日。截至日期选择该日期所在的日 / 整周，当前未完成周期标为“本期”。
- 仅保存 8 张卡全部完整有效的样本，每 30 秒时间槽最多一次，重复采样 / 重启不重复计数。覆盖率 = 有效槽数 / 所选日历范围内截至当前的预期槽数。部署前、采集失败和断线均属缺测，不写成 0；覆盖率不是任务时长或计费 GPU 小时。
- 长期统计从 **2026-10-09 12:00:47（北京时间）**开始积累，保存 400 天，每天清理过期样本。旧 24 小时分钟趋势保留原状，不冒充能还原峰值的长期原始样本。页面显示当前保留的最早和最近采样时间。
- 腾讯云既有内网采集服务独立写入 SQLite；关网页、本机关机不影响采集。页面随状态刷新读取统计，最多每分钟一次；手动查询可立即更新，暂停刷新后不主动轮询。超过 90 秒未更新显示过期，存储故障独立记录，不误报 SSH 断线。
- 既有每日备份服务通过 SQLite 在线备份 API 保存 `gpu-usage-YYYYMMDD.sqlite3`，保留 14 份，每份包含源库保留的历史。统计库和备份不提交 Git；回退代码不删除数据。

| 位置 | 用途 |
| --- | --- |
| `backend/gpu_usage.py` | 完整性检查、持久化、日 / 周聚合 |
| `backend/ui/status-gpu-usage.js` | 统计筛选、指标、图表和明细；取消旧服务器请求 |
| `/var/lib/gaasd-analytics/status/intranet/gpu-usage.sqlite3` | 长期聚合样本，非逐进程记录 |
| `/var/lib/gaasd-analytics/backups/gpu-usage-YYYYMMDD.sqlite3` | 每日一致性备份 |
| `/status/api/gpu-usage?group=day&count=14` | 日统计，可加 `through=YYYY-MM-DD` |
| `/status/api/gpu-usage?group=week&count=12` | 自然周统计；API 最多 52 周 / 90 天 |

新接口和脚本沿用管理员认证、no-store、CSP 和 Nginx 限流。接口只读固定 SQLite 文件，不接受文件路径或 SSH 参数。缺库返回明确的未就绪和空数据；损坏 / 读取失败返回 503，不返回伪造的 0。当前状态发布包为 11 个源码文件（增加持久化模块、统计面板和备份脚本），发布时校验首次新采样入库。部署和验证见 [GPU 统计更新记录](docs/status-gpu-usage-20261009.md)。

## 实现与维护

Nginx `/status` → 原有 Flask / Gunicorn 服务 → 受限 JSON 快照。独立 `gaasd-status-collector.service` 用 `gaasd-analytics` 非特权系统用户采集，开机自启，失败重启。状态接口只读取快照，不在 HTTP 请求中运行系统命令，不提供重启、删除或修改系统的按钮。

`gaasd-status-intranet.service` 同样运行于腾讯云，通过既有 OpenVPN → `192.168.2.201:2202` → aiusr 的受限 SSH 命令采集内网。内网端是独立 Python venv + psutil 7.2.2 + 系统 `nvidia-smi`，没有额外监听端口或常驻代理，不改变现有应用环境和 Docker。每次查询结束即退出；两台主机的 JSON 和趋势分别存放在腾讯云。

| 位置 | 用途 |
| --- | --- |
| `backend/status_collector.py` | psutil / Linux procfs 采样，单进程计算增量 |
| `backend/gpu_metrics.py` | 只读 NVIDIA CSV 查询，超时/缺失指标保留未知 |
| `backend/status_probe.py` | 内网 SSH 强制命令，仅接受 `snapshot` |
| `backend/status_remote.py` | 腾讯云固定目标轮询、连接状态与独立历史 |
| `backend/ui/status.html`、`status.css`、`status.js` | 响应式状态页面 |
| `/var/lib/gaasd-analytics/status/latest.json` | 每 30 秒原子替换的腾讯云快照 |
| `/var/lib/gaasd-analytics/status/history.json` | 最近 24 小时聚合趋势，最多 1440 点 |
| `gaasd-status-collector.service` | 常驻采集服务，最多 192 MiB 内存、20% 单核 CPU 配额 |
| `/var/lib/gaasd-analytics/status/intranet/` | 内网 latest.json、history.json、connection.json |
| `gaasd-status-intranet.service` | 内网轮询，最多 192 MiB 内存、20% 单核 CPU 配额 |
| `/etc/gaasd-analytics/status-remote.json` | 内网轮询的固定密钥路径、known_hosts 路径与缓存目录 |
| `/etc/gaasd-analytics/status-ssh/` | 专用 Ed25519 密钥和固定 SSH 主机公钥，仅服务器保存 |
| `/home/aiusr/.local/share/gaasd-status/`（内网） | venv、releases、current 探针链接 |
| `/status/api/snapshot?server=cloud`、`/status/api/history?server=intranet` | 共用管理员登录的只读接口；server 仅允许 cloud / intranet |

使用 psutil 获取系统指标，Linux `/proc/pressure` 和 `/proc/net/tcp*` 补充压力、连接信息。[psutil 官方文档](https://psutil.io/)

GPU 字段参照 [NVIDIA nvidia-smi 文档](https://docs.nvidia.com/deploy/nvidia-smi/index.html)。仅执行 `--query-gpu` 和 `--query-compute-apps`，不会调整 GPU、结束任务或读取进程参数。

专用 SSH 密钥在腾讯云生成，私钥不离开腾讯云，归 `gaasd-analytics` 所有、0600 权限。内网 aiusr 的 `authorized_keys` 新增一条带 `restrict,from="10.8.0.0/24",command="/home/aiusr/.local/share/gaasd-status/venv/bin/python /home/aiusr/.local/share/gaasd-status/current/status_probe.py"` 的公钥，保留原有所有登录密钥。禁用 PTY、转发和任意命令；探针额外要求 `SSH_ORIGINAL_COMMAND=snapshot`。云端启用严格主机密钥校验，known_hosts 从已有可信登录读取的主机公钥固定。参考 [OpenSSH authorized_keys](https://man.openbsd.org/sshd#AUTHORIZED_KEYS_FILE_FORMAT)。VPN 地址段变化时需管理员核对来源限制，不应直接取消限制。

## 发布与检查

状态更新使用 `npm run build:status -- YYYYMMDDTHHMMSS` 和 `scripts/deploy-status.py`：只打包 11 个状态及备份相关后端源码文件，校验清单，复制上一后端版本后覆盖这些文件，再原子切换后端链接并重启服务。保留网站版本、视频、Nginx、统计数据库和账号配置；失败会尝试恢复前一后端及服务配置。当前部署版本和结果见 [2026-10-09 发布记录](docs/status-gpu-usage-20261009.md)。联合部署脚本也包含新采集模块，并会重启已安装的内网采集服务。

首次安装需先完成内网探针 venv、三个模块（status_collector.py / gpu_metrics.py / status_probe.py）、云端专用密钥及固定目标配置。轮询配置只包含 `identity_file`、`known_hosts`、`directory`，HTTP 请求不能改变目标主机。更新内网探针时将三个文件上传新的 releases 子目录、校验后切换 current，再用受限密钥实际执行 snapshot 校验 8 张卡。旧探针版本保留用于回退。

```bash
npm run test:status
npm run build:status -- YYYYMMDDTHHMMSS
scp work/gaasd-status-YYYYMMDDTHHMMSS.tar scripts/deploy-status.py ubuntu@49.232.60.144:/tmp/
ssh ubuntu@49.232.60.144 'sudo python3 /tmp/deploy-status.py YYYYMMDDTHHMMSS'
```

浏览器测试使用独立端口 4174/4182 及合成主机数据；可通过 `GAASD_PYTHON` 指定本地 Python venv（需安装 backend/requirements.txt，并准备 geo-data）。`GAASD_TEST_URL=https://gaasd.com` 与指向本地临时凭据文件的 `GAASD_STATISTICS_CREDENTIALS` 可运行真实线上检查。测试文件与线上样本分开，模拟数据不能作为真实服务器验收结果。凭据和截图只放忽略的 work 目录。

```bash
sudo systemctl status gaasd-status-collector.service
sudo journalctl -u gaasd-status-collector.service -n 50
sudo systemctl status gaasd-status-intranet.service openvpn-client@platform.service
sudo journalctl -u gaasd-status-intranet.service -n 50
```

状态页运行在被监控的服务器本身；整机或公网链路不可用时页面也可能无法打开，这不等同于独立的外部可用性监控。云平台账单、云防火墙配置、实体硬盘 SMART 和未向虚拟机开放的硬件传感器不在本页采集范围。
