# 清华办公室 RTX PRO 6000：独立 SSH 与监控

2026-10-27 再次重装后已恢复原入口，当前备用 ZeroTier 地址为 `10.243.204.184`。当前基线为 Ubuntu 24.04.5 / 6.17.0-1032-oem，用户要求保留现有版本：`protect-platform.py` 提供有备份的 APT 固定版本策略，不执行升级，并覆盖拆分固件及 base-files。重装时须经可信会话更新主机密钥与专用隧道授权，不能直接绕过安装器的“旧密钥不同”检查；详细操作和备份见 [最新恢复记录](../../docs/pro6000-reinstall-20261027.md)。

本配置使用云端 **127.0.0.1:2226**，专用账户 `gaasd-pro6000-tunnel`。不得复用或改写原 2222 / 2223 / 2224 / 2225 / 18765。开发机主动连接腾讯云公网 22，不依赖操作笔记本、ZeroTier 或苏州 Windows 中转。

```sh
ssh -J ubuntu@49.232.60.144 -p 2226 lenovo@127.0.0.1
```

人员须分别持有腾讯云 `ubuntu` 与开发机 `lenovo` 的登录授权。隧道专用密钥仅用于反向转发，不提供腾讯云 shell。当前入口为 [PRO 6000 监控](https://gaasd.com/status5)，共用原 `/status` 管理员凭据；[全部主机](https://gaasd.com/status1) 显示七台主机。

## 安装顺序

安装器为 `scripts/setup-office-tunnel.py`，原默认 `office` 行为保留。新机器必须明确加 `--profile pro6000`，`--source` 指向本目录模板的远端暂存目录。脚本在目标 Linux 上以 root 执行。

1. 开发机：`--profile pro6000 office-prepare --source DIR`。在 `/var/lib/gaasd-pro6000-tunnel` 生成专用 Ed25519 密钥和非登录服务账户，私钥只留开发机。
2. 只将输出的公钥送到腾讯云，执行 `--profile pro6000 cloud-authorize --source DIR --public-key PUBLIC_KEY_FILE`。末尾追加独立 Match 块，校验 `sshd -t` 后 reload；受限账户只允许 `127.0.0.1:2226` 远程监听、MaxSessions=0。
3. 从已经可信的腾讯云管理员 SSH 会话取得 `/etc/ssh/ssh_host_ed25519_key.pub`，交给开发机执行 `--profile pro6000 office-start --source DIR --host-key CLOUD_HOST_PUBLIC_KEY`。固定主机公钥，严格校验，systemd enable/start。
4. 用可信开发机登录读取它的主机公钥，核对指纹并固定到访问端 `[127.0.0.1]:2226`。验证上面的端到端跳转。
5. 腾讯云 root 执行 `python3 provision-monitor.py WORKSTATION_HOST_PUBLIC_KEY`，创建独立采集密钥并增补 `fleet.json`。私钥不离开腾讯云；旧配置另行备份。
6. 依照 `ops/fleet-monitor/README.md` 安装 Linux 探针，目标用户 `lenovo`、`gpus=1`。仅复制采集公钥；授权 `restrict,command=...fleet_probe.py --gpus 1`。使用独立 venv，不改变项目 Python 或 GPU 驱动。
7. 先以 `gaasd-analytics` 运行受限 SSH 的 `snapshot`，确认只有一张 PRO 6000；请求 `id` 应拒绝。构建 `npm run build:status -- ID` 并执行现有 `scripts/deploy-status.py ID`。原 Nginx `/status` 前缀已覆盖 `/status5`，不需要新增代理或复制密码。

任何新机器应使用自己的公钥；不把本次的密钥、密码、授权文件、运行数据或备份提交 Git。密码不作为服务配置保存。

## 持久化与维护

| 机器 / 路径 | 用途 |
| --- | --- |
| 开发机 `/etc/systemd/system/gaasd-pro6000-tunnel.service` | 系统级自启；失联后 10 秒重启 |
| 开发机 `/etc/gaasd-pro6000-tunnel/ssh_config`、`known_hosts` | 单一反向转发、严格校验、20 秒心跳 / 3 次 |
| 腾讯云 `Match User gaasd-pro6000-tunnel` | `ClientAliveInterval 20` / `ClientAliveCountMax 3`，清理失联隧道，避免旧会话占住 2226 |
| 开发机 `pro6000-zerotier-mtu.timer` | 可选备用 ZeroTier 路线，每 30 秒检查指定虚拟网卡 MTU |
| 开发机 `/var/lib/gaasd-pro6000-tunnel/id_ed25519` | 私钥，0600，服务用户所有 |
| 开发机 `/home/lenovo/.local/share/gaasd-fleet/` | 独立只读采集探针 |
| 腾讯云 `/var/lib/gaasd-pro6000-tunnel/.ssh/authorized_keys` | 专用隧道受限公钥 |
| 腾讯云 `/etc/gaasd-analytics/fleet-ssh/pro6000_*` | 独立采集密钥及固定目标主机公钥 |
| 腾讯云 `/var/lib/gaasd-analytics/status/pro6000/` | 30 秒快照、连接状态、24 小时趋势 |

```sh
systemctl status gaasd-pro6000-tunnel
systemctl is-enabled gaasd-pro6000-tunnel
sudo journalctl -u gaasd-pro6000-tunnel -n 50 --no-pager
sudo systemctl restart gaasd-pro6000-tunnel
```

腾讯云每 30 秒通过受限 SSH 拉取一次快照，无远端常驻 HTTP 服务。网页显示 CPU 各核、内存、Swap、文件系统、磁盘 I/O、网卡、温度、GPU 显存/计算/功耗和进程，以及 24 小时趋势。日/周 GPU 历史目前仍专属于原三组八卡服务器。没有传感器数据的项目显示未知；未挂载磁盘只在硬件型号中显示，不冒充有可用文件系统容量。

退出笔记本或关闭网页不会停止隧道/采集。开发机需保持开机、联网且不休眠；本次没有擅自改变用户桌面电源策略。已经验证 systemd 启用及故障自动恢复，没有执行整机重启。

### ZeroTier 备用通道的 MTU

2026-10-22 现场验证 `ztr2q7djxe` 使用 MTU 1280 后普通 SSH 可用。此设置仅针对该开发机的 ZeroTier 接口，不修改物理网卡或整个 ZeroTier 网络，也不是腾讯云隧道的依赖。安装前确认接口名和 `/usr/sbin/ip` 路径；网络变更导致接口改名时需同步修改 service 的两处 sysfs 路径及 ExecStart。

在开发机上、以本目录为当前目录执行：

```sh
sudo systemd-analyze verify pro6000-zerotier-mtu.service pro6000-zerotier-mtu.timer
sudo install -o root -g root -m 644 pro6000-zerotier-mtu.service pro6000-zerotier-mtu.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ssh zerotier-one gaasd-pro6000-tunnel
sudo systemctl enable --now pro6000-zerotier-mtu.timer
sudo systemctl start pro6000-zerotier-mtu.service
systemctl is-enabled pro6000-zerotier-mtu.timer
systemctl is-active pro6000-zerotier-mtu.timer
cat /sys/class/net/ztr2q7djxe/mtu
```

预期为 enabled、active、1280。接口尚未创建或 MTU 已正确时，oneshot service 跳过是正常行为；应检查 timer 的 active 状态，不能要求 oneshot service 一直 active。已实际将 MTU 暂改为 1300，定时任务在下一次触发时恢复到 1280。

云端 ClientAlive 设置只对新建 SSH 会话生效。现有安装器不会覆盖已经存在的受管 Match 块；更新旧部署时，应备份当前配置，只修改该账户的原块，`sshd -t` 通过后 reload。若旧隧道已经卡住，先用 `ss -ltnp 'sport = :2226'` 核对监听进程及其专用账户，再清理该旧会话，不能重启整个云端 SSH 或批量终止 sshd。详见 [2026-10-22 恢复记录](../../docs/pro6000-recovery-20261022.md)。

## 回退

后端可将 `/opt/gaasd-analytics/current` 原子切回保留的前一发布版本，然后重启原监控服务；旧版本忽略 `fleet.json` 中新增的 `pro6000` 条目。保留采样文件，避免丢历史。

仅撤销新隧道时，在开发机 `sudo systemctl disable --now gaasd-pro6000-tunnel`；腾讯云撤销该专用账户授权，并移除 `BEGIN/END GAASD PRO6000 TUNNEL` 管理块后 `sshd -t`、reload。保留一个管理员会话，不覆盖整个 sshd_config 或其他账户授权。详细验收、备份位置和采购核对见 [接入记录](../../docs/pro6000-20261021.md)。
