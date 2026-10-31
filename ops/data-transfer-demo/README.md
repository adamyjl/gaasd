# A100 ↔ RTX 5090 数据交换 Demo

用途：训练工作流的数据下发及结果回收验证。只提供文件传输，不提供跨机 GPU 通信、共享文件系统或训练任务调度。2026-10-27 的实测与现网保护检查见 [验收记录](../../docs/data-transfer-demo-20261027.md)。

## 方案与边界

```text
A100 aiusr 的传输脚本（按需启动）
  └─ SSH → 腾讯云公网 49.232.60.144:22
       └─ 受限公钥强制执行 nc 127.0.0.1 2223
            └─ 原 Windows SSH 反向中转 → RTX 5090 user001:22
                 └─ 受限 rrsync → 独立 inbox / outbox
```

最内层 SSH 端到端认证 5090，腾讯云仅转发加密字节，不落盘保存数据。A100 同时可以推送数据、拉取结果；这两个方向都由 A100 发起，符合现有训练工作流主平台的位置。传输不经过操作笔记本，但沿用 2223 的路径仍依赖研究院 Windows 中转机在线。

复用已安装的 OpenSSH、rsync、rrsync、Python 标准库和 nc，无 pip/apt 安装，无常驻服务，无新增公网/回环监听端口，不改 IP、MTU、路由、VPN、Nginx、sshd_config 或现有隧道。每次运行会创建独立 SSH 会话，不使用现有人员会话的 ControlMaster。连接完成后进程退出，重启后直接再次调用即可，无需增加自启任务。

此方式与原 SSH 入口共享底层链路，传输必然消耗带宽，不能承诺物理资源完全隔离。默认 **128 KiB/s（约 1.05 Mbps）**、单实例、nice 10、I/O idle 优先级。`--bwlimit 0` 仅在确认可占用带宽时取消限速；本次短测曾使用它，长测上限是 512 KiB/s。

## 已安装位置

| 机器 | 路径 | 用途 |
| --- | --- | --- |
| A100 | `/models/yjl/gaasd-data-demo/outbox/` | 待发送的数据集 |
| A100 | `/models/yjl/gaasd-data-demo/inbox/` | 拉回的结果 |
| A100 | `/models/yjl/gaasd-data-demo/bin/transfer.py` | 本目录 `transfer.py` 的运行副本 |
| A100 | `/models/yjl/gaasd-data-demo/reports/` | 验收日志 |
| A100 | `~/.config/gaasd-data-demo/client.json` | 本机数据根目录及独立 SSH 配置路径 |
| A100 | `~/.ssh/gaasd-data-demo/` | 两枚专用密钥、config、可信 known_hosts；私钥不离开 A100 |
| 5090 | `/home/user001/yin/gaasd-data-demo/inbox/` | 接收数据 |
| 5090 | `/home/user001/yin/gaasd-data-demo/outbox/` | 待回收结果 |

A100 数据目录在 `/models` 大容量盘，5090 目录在 `/home` 大容量卷；不是临时目录或显卡显存。单个目录名只允许字母、数字、点、横杠、下划线，必须以字母或数字开头。默认不压缩，不传符号链接或设备文件，不使用 `--delete`，不原地覆写正在使用的文件。相同文件名会按 rsync 内容校验进行更新；建议用不可变数据集/任务 ID 防止覆盖已经发布的版本。

## 立即运行

从维护电脑登录 A100：

```sh
ssh -J ubuntu@49.232.60.144 -p 2202 aiusr@192.168.2.201
```

在 **A100** 执行，现有测试数据已经就位：

```sh
# 查看 5090 交换目录，不进入交互 shell
/usr/bin/python3 /models/yjl/gaasd-data-demo/bin/transfer.py list

# A100 → 5090：同名数据已经完整时只校验，不重复传全量
/usr/bin/python3 /models/yjl/gaasd-data-demo/bin/transfer.py push upload-01

# 5090 → A100
/usr/bin/python3 /models/yjl/gaasd-data-demo/bin/transfer.py pull download-01

# 已生成并成功回收的校验结果示例（没有启动训练）
/usr/bin/python3 /models/yjl/gaasd-data-demo/bin/transfer.py pull result-demo-001

# 断线/退出码非零：保留原目录，再运行同一条命令，复用 .rsync-partial
# 需要加速且链路允许时，可显式使用 --bwlimit 256（单位 KiB/s）
```

发送自己的数据集，在 A100 准备一个新目录（以下源文件路径须替换）：

```sh
mkdir -p /models/yjl/gaasd-data-demo/outbox/dataset-demo-001
cp /path/to/small-sample.bin /models/yjl/gaasd-data-demo/outbox/dataset-demo-001/sample.bin
cd /models/yjl/gaasd-data-demo/outbox/dataset-demo-001
sha256sum sample.bin > SHA256SUMS
/usr/bin/python3 /models/yjl/gaasd-data-demo/bin/transfer.py push dataset-demo-001
```

5090 上验证，并放一个结果用于回收（示例不启动 GPU 任务）：

```sh
# 从维护电脑登录 5090
ssh -J ubuntu@49.232.60.144 -p 2223 user001@127.0.0.1

# 以下在 5090 执行
cd /home/user001/yin/gaasd-data-demo/inbox/dataset-demo-001
sha256sum -c SHA256SUMS
mkdir -p /home/user001/yin/gaasd-data-demo/outbox/result-demo-001
printf '%s\n' '{"job":"demo-001","data_verified":true}' > /home/user001/yin/gaasd-data-demo/outbox/result-demo-001/result.json
cd /home/user001/yin/gaasd-data-demo/outbox/result-demo-001
sha256sum result.json > SHA256SUMS
```

再在 A100 执行：

```sh
/usr/bin/python3 /models/yjl/gaasd-data-demo/bin/transfer.py pull result-demo-001
cd /models/yjl/gaasd-data-demo/inbox/result-demo-001
sha256sum -c SHA256SUMS
```

接入现有训练后台时可使用参数数组执行，不拼接 shell 命令。等待退出码 0、验证 manifest 后再把数据集标为 ready 并提交训练任务。非零退出码表示失败/中断，不能因文件夹存在就启动训练。文件是逐个完成的，目录级发布并非原子事务；本 Demo 尚未把按钮或调度状态接入现有页面。

```python
subprocess.run(
    ["/usr/bin/python3", "/models/yjl/gaasd-data-demo/bin/transfer.py", "push", dataset_id],
    check=True,
)
```

## 原始 rsync 指令

在 A100、目录已经准备好时使用；通常优先使用上面的脚本，因为它还执行单实例及路径检查。

```sh
# 本地 outbox → 远端 inbox；远端路径相对受限根目录，不写 /home/user001/...
rsync -rt --checksum --partial-dir=.rsync-partial --timeout=90 --bwlimit=128 \
  -e 'ssh -F /home/aiusr/.ssh/gaasd-data-demo/config' \
  /models/yjl/gaasd-data-demo/outbox/dataset-demo-001/ \
  gaasd-data-5090:inbox/dataset-demo-001/

# 远端 outbox → 本地 inbox（先建目的目录）
mkdir -p /models/yjl/gaasd-data-demo/inbox/result-demo-001
rsync -rt --checksum --partial-dir=.rsync-partial --timeout=90 --bwlimit=128 \
  -e 'ssh -F /home/aiusr/.ssh/gaasd-data-demo/config' \
  gaasd-data-5090:outbox/result-demo-001/ \
  /models/yjl/gaasd-data-demo/inbox/result-demo-001/
```

## 授权与恢复

独立 SSH 配置模板是 [ssh_config.example](ssh_config.example)，只替换绝对 HOME 路径。客户端 JSON 格式如下；实际文件含本机路径，不含密码。

```json
{"data_root":"/models/yjl/gaasd-data-demo","ssh_config":"/home/aiusr/.ssh/gaasd-data-demo/config"}
```

首次安装须在 A100 本机各生成一枚专用 Ed25519 密钥，绝不复制人员私钥或云监控私钥：

- `id_ed25519_relay.pub` 追加到云端 ubuntu 的 authorized_keys，前缀 `restrict,command="/usr/bin/nc 127.0.0.1 2223"`。没有 shell、PTY、agent 或 SSH 端口转发权限，仅可桥接固定的 5090 入口。
- `id_ed25519_peer.pub` 追加到 5090 user001 的 authorized_keys，前缀 `restrict,command="/usr/bin/ionice -c 3 /usr/bin/nice -n 10 /usr/bin/rrsync -munge -no-del /home/user001/yin/gaasd-data-demo"`。只能在交换目录内读写，拒绝 `..`、任意 shell、删除选项；使用 `-munge` 处理链接。此限制隔离专用密钥，不是隔离同一 user001 账号下其他人员的沙箱。
- 从已有可信管理员 SSH 连接获取两台主机的 Ed25519 **公钥**，写入独立 known_hosts，保持 `StrictHostKeyChecking yes`。不要用未核验的 ssh-keyscan 替代身份验证。
- 追加前备份 authorized_keys，保留全部原授权；不改 sshd_config，不需要重载或重启 SSH。

停用时不再调用脚本即可。撤销时只删除标记 `gaasd-data-demo-a100-relay` 和 `gaasd-data-demo-a100-peer` 的本次公钥行，不能把旧 authorized_keys 整份覆盖回去。确认不再使用后可自行清理明确的 Demo 目录；不要触碰 `/models/yjl` 或 `/home/user001/yin` 内其他数据。

官方参数依据：[rsync](https://download.samba.org/pub/rsync/rsync.1)、[rrsync](https://download.samba.org/pub/rsync/rrsync.1)、[OpenSSH authorized_keys](https://man.openbsd.org/sshd.8)。默认内容校验、断点部分文件、带宽限制与目录受限授权分别由这些现有组件提供。
