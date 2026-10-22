# 多机监控采集组件

网页、API 和云端采集器在 `backend/`；本目录保存远端探针安装器和 Windows 采集任务源码。现网入口、指标口径、验证与回退见 [2026-10-20 部署记录](../../docs/fleet-monitor-20261020.md)。

不创建隧道、不更改 SSH 端口、不替换 `ops/windows-ssh-relays`。必须先确认已有 2222 / 2223 / 2224 / 2225 路线端到端可用。

2026-10-21 另加 `pro6000`（`lenovo`、2226、`gpus=1`）；密钥和隧道独立，见 [安装说明](../pro6000-tunnel/README.md)。现在共七台监控主机、五个固定 fleet SSH 采集目标。原四台目标的配置和安装方法保持兼容。

## 首次安装

1. 在腾讯云为 `office`、`windows`、`rtx5090`、`rtx4090` 分别生成 Ed25519 采集密钥，保存在 `/etc/gaasd-analytics/fleet-ssh/`。私钥属于 `gaasd-analytics`，0600；目录 0700。私钥留在腾讯云。
2. 通过已可信的管理 SSH 连接读取各目标主机的 **SSH 主机公钥**，生成各自 `[127.0.0.1]:端口` 的 known_hosts。不能使用未经核验的扫描结果，也不能关闭主机密钥检查。
3. Linux：暂存 `install-linux-probe.py`、`backend/fleet_probe.py`、`backend/status_collector.py`、`backend/gpu_metrics.py` 和适配目标 Python / glibc 的 psutil **7.2.2** wheel。先从 PyPI 官方 JSON 核对 wheel SHA-256，再生成下方输入清单。以目标登录用户运行安装器。
4. Windows：将 `windows/` 三个脚本和对应的云端采集公钥暂存到 `D:\Server\gaasd-fleet-monitor`。在现有管理员 SSH 会话运行 `Install-Monitor.ps1 -PublicKeyFile <公钥路径>`。安装器固定检查现网自定义授权文件 `C:\ProgramData\ssh\gaasd_tsari_authorized_keys`；不适用于使用其他 AuthorizedKeysFile 的机器。
5. 在腾讯云创建下方只包含路径的 `fleet.json`（0600，归 `gaasd-analytics`）。安装器只追加带强制命令的公钥，保留原有登录密钥和授权备份。
6. `sudo python3 ops/fleet-monitor/enable-ping.py`：仅在当前策略为默认禁用 `1 0` 或已匹配监控组时，将 ICMP Echo socket 权限授予监控组。策略持久化至 `/etc/sysctl.d/60-gaasd-monitor-ping.conf`，保留服务的 `NoNewPrivileges` 和空 capability 集合。遇到其他既有策略会停止，供管理员检查，不覆盖。
7. 云端先以 `gaasd-analytics` 执行 `fleet_collector.py --once`，核对四台主机、GPU 数量及新鲜时间；用相同受限密钥请求 `id` 必须失败。然后执行根目录 `npm run build:status -- ID` 和 `scripts/deploy-status.py ID`。

Linux 安装器从标准输入读取 JSON，`hashes` 必须包含三个模块和 wheel 的 SHA-256：

```json
{
  "public_key": "这里填写对应云端采集公钥的一整行",
  "gpus": 8,
  "wheel": "经核验且适配目标平台的-psutil-7.2.2.whl",
  "hashes": {
    "fleet_probe.py": "64位SHA256",
    "status_collector.py": "64位SHA256",
    "gpu_metrics.py": "64位SHA256",
    "经核验且适配目标平台的-psutil-7.2.2.whl": "64位SHA256"
  }
}
```

3060 Ti 的 `gpus` 为 1，两台 GPU 服务器为 8。安装至登录用户的 `~/.local/share/gaasd-fleet/`，使用独立 venv，不修改现有项目 Python 环境，不常驻监听，不安装系统驱动。每次强制命令读取两次计数器后退出。

云端 `fleet.json` 结构：

```json
{
  "directory": "/var/lib/gaasd-analytics/status",
  "hosts": {
    "office": {
      "identity_file": "/etc/gaasd-analytics/fleet-ssh/office_ed25519",
      "known_hosts": "/etc/gaasd-analytics/fleet-ssh/office_known_hosts"
    },
    "windows": {
      "identity_file": "/etc/gaasd-analytics/fleet-ssh/windows_ed25519",
      "known_hosts": "/etc/gaasd-analytics/fleet-ssh/windows_known_hosts"
    },
    "rtx5090": {
      "identity_file": "/etc/gaasd-analytics/fleet-ssh/rtx5090_ed25519",
      "known_hosts": "/etc/gaasd-analytics/fleet-ssh/rtx5090_known_hosts"
    },
    "rtx4090": {
      "identity_file": "/etc/gaasd-analytics/fleet-ssh/rtx4090_ed25519",
      "known_hosts": "/etc/gaasd-analytics/fleet-ssh/rtx4090_known_hosts"
    }
  }
}
```

实际用户、端口固定在 `backend/fleet.py`；HTTP 请求只能选择注册的服务器 ID。不得把公钥示例、私钥、生产配置、实时快照或备份提交 Git。

## Windows 运行方式与限制

计划任务 `GAASD-Hardware-Monitor` 使用 SYSTEM、开机延迟 30 秒、每 5 分钟补启动、IgnoreNew 和文件独占锁。脚本常驻每 30 秒采集；硬件清单每 60 秒更新。`C:\ProgramData\GAASD-Monitor` 仅允许 SYSTEM / Administrators 写入，保护以 SYSTEM 执行的脚本。SSH 强制命令只读取最新 JSON，拒绝其他命令、PTY 和转发。

CPU 使用 raw 性能计数器差值，进程 CPU 使用进程 CPU 时间差值并按逻辑核心数归一化。进程列表合并 CPU / 常驻内存 / GPU / I/O 占用靠前的软件。数据项使用 `PSCustomObject`，确保 PowerShell 5.1 按指标排序。Windows I/O 包括文件和其他 I/O，不等同于纯磁盘流量。

GPU 整卡指标来自 `nvidia-smi`；每进程 GPU 取最忙引擎指标。驱动缺失的指标显示未知，不填零。Windows 的进程显存性能计数器可能有偏差，不能用于精确核算；总显存以 NVIDIA 整卡指标为准。CPU 核心温度当前未暴露，ACPI 热区不能冒充核心温度。网卡累计流量和速率正常显示；未实现逐软件网络字节量，避免为监控引入抓包驱动或持续 ETW 跟踪。

参考：[Windows raw 性能数据](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-perfrawdata)、[GPU 进程显存计数器的已知问题](https://learn.microsoft.com/en-us/troubleshoot/windows-client/performance/gpu-process-memory-counters-report-wrong-value)。
