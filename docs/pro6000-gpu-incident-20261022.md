# PRO 6000：第三次卡死与重启后 NVIDIA 不可用

核查时间：2026-10-22 13:49 起，北京时间。本轮通过腾讯云 SSH 读取现场，没有重启、切换内核、卸载 nouveau 或安装显卡驱动。

## 结论

本次有两个不同问题：

1. **重启后的 nvidia-smi 失败原因已经明确：当前内核缺少 NVIDIA 模块。** 实际启动的是 `7.0.0-38-generic`，`modinfo -k 7.0.0-38-generic nvidia` 返回 `Module nvidia not found`。NVIDIA 595.58.03 模块只存在于 `6.11.0-17-generic`。当前没有 `/proc/driver/nvidia/version`，PCI `01:00.0` 由 nouveau 接管，nvidia-smi 退出码为 9。
2. **重启前再次出现内核内存页异常及 CPU soft lockup。** 这是与前两次相似的系统故障，不能用重启后才出现的驱动缺失解释。具体是物理内存/内存控制器/平台问题，还是内核/驱动破坏内存，仍待验证。

## 时间线

| 时间 | 证据 |
| --- | --- |
| 12:41:29 | 故障前最后云端聚合点：CPU 4.03%、内存 4.13%、GPU 计算 8%、显存 0.52% |
| 12:42:15 | TPM requestAccess timeout，作为伴随现象保留，未判定为根因 |
| 12:42:20 | 第一条 Bad page state，随后多个 ps/sh 执行上下文出现同类异常 |
| 12:42:27 | 第一个 Oops：sshd 执行上下文，`__lruvec_stat_mod_folio+0x56/0xf0` |
| 12:42:32 | 腾讯云采集开始失败 |
| 12:42:52 起 | watchdog 报 CPU#4 soft lockup；随后 CPU#14 也被报告卡住，持续超过千秒 |
| 13:03:17 | 至少已记录到 Oops #6，包含空指针和异常调度；上一启动最后日志到 13:03:45 |
| 13:31:27 | 当前启动开始，内核为 7.0.0-38 |
| 13:31:29～30 | nouveau 初始化 NVIDIA GB202，识别 97,887 MiB VRAM |

上一启动 kernel journal 中有 25 条 Bad page state，重复出现 `memcg:40000000400`、`refcount:1024`、`mapcount:-1024`。与第一次事件共有 PFN `37977b`、`379793`、`3797b7`。相同异常位模式和部分页编号是供应商定位的重要线索，但不能仅凭这些值确定某根 DIMM 或插槽故障，也不能根据报错进程名认定该程序是破坏源。

保留日志中未找到 NVRM Xid、GPU fallen off、OOM kill 或 EXT4-fs error。这不排除所有硬件/驱动问题；当前未加载 NVIDIA 模块，更不能以没有 Xid 证明 NVIDIA 驱动健康。

## 显卡和启动项

当前 PCIe 可以枚举 NVIDIA `10de:2bb4`，nouveau 可以初始化显存，说明没有证据支持“系统完全枚举不到显卡”。这不等于显卡压力测试或硬件验收通过。PCIe x16 链路存在；配置空间有 CorrErr/UnsupReq 状态位，当前没有不可纠正错误状态，已保留原始输出，不能据此直接判定坏卡。

上次写入的 `/etc/default/grub.d/90-pro6000-driver-compat.cfg` 和 11:30 生成的 `/boot/grub/grub.cfg` 仍在，默认菜单 ID 仍指向 6.11。EFI 当前入口为 Ubuntu shim，ESP 的 grub.cfg 搜索实际系统分区 UUID；未发现之后改写这些文件的记录，当前没有 next_entry 覆盖。

但是实际启动结果为 7.0。用户不确定是否操作过启动菜单，现有记录不能追溯此次具体选择。因此不能宣称上次默认项通过重启验收，也不能断言用户手动改过配置。本轮没有再次盲目修改启动项。

## 后续处理

- 恢复 GPU：为选定的受支持内核安装兼容的 NVIDIA 内核模块，纳入 DKMS 或发行版预编译模块管理。机器当前没有 DKMS。不能只重装 nvidia-smi，也不能在模块尚未准备好时单独禁用 nouveau。当前桌面使用 nouveau，驱动切换应安排维护窗口和现场恢复手段。
- 已运行 ubuntu-drivers devices，能识别该设备并列出驱动候选；候选列表不等于与新内核的兼容性已验证。本轮未安装驱动。
- 定位卡死：供应商应先做全容量、多轮离线内存诊断，必要时交叉验证 DIMM/插槽，同时解码 BERT/平台错误。若硬件测试通过，再对匹配好的内核/驱动进行锁屏空闲及工作负载复测。
- 多次出错的旧内核不宜作为长期稳定性方案；没有 NVIDIA 的新内核短暂运行也不能证明硬件正常。

本轮腾讯云 SSH 正常，反向隧道与 MTU timer 均 active，ZeroTier 接口 MTU 为 1280。维护电脑的一次 ZeroTier 直连尝试超时，后续使用腾讯云，未将两个通道都标记为本轮验证通过。

## 证据与范围

本地原始材料：`work/pro6000-gpu-incident-20261022/`（Git 忽略）。开发机备份：`/var/backups/gaasd-pro6000-gpu-incident/20261022T1331/`。保存上一启动日志、当前内核日志、pstore、BERT、启动路径、驱动检查及云端历史；原始材料不上传公共仓库。

本轮没有重载驱动、重启、修改磁盘或运行压力测试。GPU 尚未恢复，卡死根因尚未定位到具体部件。

参考：[NVIDIA 595.58.03 内核模块与 DKMS 说明](https://download.nvidia.com/XFree86/Linux-x86_64/595.58.03/README/installdriver.html)、[Ubuntu NVIDIA 驱动安装说明](https://ubuntu.com/server/docs/how-to/graphics/install-nvidia-drivers/)。
