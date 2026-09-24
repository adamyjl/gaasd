# GAASD 服务器状态

入口：[https://gaasd.com/status](https://gaasd.com/status)。与 `/statistics` 使用同一管理员账号、同一密码和同一 HTTP Basic 认证域，不新增账户。两页顶部可互相跳转，页面、静态脚本和状态接口均要求登录。

## 展示内容

- 每个逻辑 CPU 核心的占用率、I/O 等待、虚拟机资源等待，整机 CPU、1 / 5 / 15 分钟负载和可用的频率信息。
- 物理内存总量、使用中、可用、空闲、缓存、缓冲区；Swap 总量、使用、可用及换入 / 换出速率。
- 本机磁盘与内存文件系统的容量、可用空间、空间使用率、inode 使用率；每个块设备读写速率、IOPS、繁忙度。COS 等远程挂载单独标注，不发起可能阻塞的远程容量探测，也不计入系统盘容量。
- 每个网卡的收发速率、开机累计流量、错误与丢包、地址、连接状态；TCP 状态汇总和监听端口。
- CPU 和内存各前 8 名进程的合集、PID、状态、CPU、常驻内存；不读取进程参数、环境变量或文件内容。
- Nginx、SSH、统计服务、采集服务、备份计时器、证书续期计时器；HTTPS 证书验证与到期时间、最近一次数据库备份。
- 主机、操作系统、内核、架构、运行时间、开机时间、文件句柄、CPU / 内存 / I/O 压力。虚拟机未提供的温度等指标明确标为未提供。

## 更新与数据口径

服务器每 5 秒独立采样，网页默认每 5 秒获取一次，可切换 10 / 30 秒、暂停或手动刷新。页面进入后台后暂停请求，返回时继续；关闭网页或关闭本机不影响服务器采集。

最近 24 小时趋势保存在服务器，每分钟聚合一次；首次有效样本会立即生成首个点，此后展示采样均值。可选择最近 1 / 6 / 24 小时，超过 24 小时的趋势自动轮替。进程明细只保存当前快照，不保存 24 小时的进程记录。历史数据从本功能上线开始积累，采集服务重启后读取已有趋势继续更新；中断超过 3 分钟的趋势线不连线。

单核心 CPU 为 0–100%，整机 CPU 为各核心平均，进程 CPU 按整机总算力归一化。CPU 首个样本、计数器重置时的速率显示采样中，避免展示假的 0。内存使用中为总量减可用，与 `free` 的缓冲 / 缓存分类存在口径差别。磁盘可用空间不包含系统保留块。网卡累计流量不代表腾讯云计费流量。

采样超过 20 秒未更新会显示过期提示，网络失败会保留最后一份数据并标明连接异常。证书、服务和备份每 60 秒检查一次。阈值提示包括内存 / Swap / 本机磁盘 / inode 达到 85%，瞬时 CPU 达到 90%，关键服务不活跃，证书不足 14 天，或 36 小时未发现备份。提示仅显示在页面，不发送通知。

## 实现与维护

Nginx `/status` → 原有 Flask / Gunicorn 服务 → 受限 JSON 快照。独立 `gaasd-status-collector.service` 用 `gaasd-analytics` 非特权系统用户采集，开机自启，失败重启。状态接口只读取快照，不在 HTTP 请求中运行系统命令，不提供重启、删除或修改系统的按钮。

| 位置 | 用途 |
| --- | --- |
| `backend/status_collector.py` | psutil / Linux procfs 采样，单进程计算增量 |
| `backend/ui/status.html`、`status.css`、`status.js` | 响应式状态页面 |
| `/var/lib/gaasd-analytics/status/latest.json` | 每 5 秒原子替换的最新快照 |
| `/var/lib/gaasd-analytics/status/history.json` | 最近 24 小时聚合趋势，最多 1440 点 |
| `gaasd-status-collector.service` | 常驻采集服务，最多 192 MiB 内存、20% 单核 CPU 配额 |
| `/status/api/snapshot`、`/status/api/history` | 共用管理员登录的只读接口 |

使用 psutil 获取系统指标，Linux `/proc/pressure` 和 `/proc/net/tcp*` 补充压力、连接信息。[psutil 官方文档](https://psutil.io/)

发布沿用 `scripts/build-analytics-release.mjs` 与 `scripts/deploy-analytics.py`，保留统计数据库、凭据、现有网站文件；发布失败会尝试恢复原页面、后端和配置。

```bash
sudo systemctl status gaasd-status-collector.service
sudo journalctl -u gaasd-status-collector.service -n 50
```

状态页运行在被监控的服务器本身；整机或公网链路不可用时页面也可能无法打开，这不等同于独立的外部可用性监控。云平台账单、云防火墙配置、实体硬盘 SMART 和未向虚拟机开放的硬件传感器不在本页采集范围。
