# 8 卡 A100 整体使用统计 · 2026-10-09

已发布：[内网服务器状态](https://gaasd.com/status?server=intranet)，使用原 `/statistics` 管理员账号。选择“按天 / 按周”与日期范围，查看整机计算利用率、显存使用量的均值、峰值、柱图、明细和采样覆盖率。实时面板显示 8 卡合计 640 GiB 显存和整体计算利用率。计算百分比取 8 卡均值，显存取合计。

## 发布与数据

- 后端：`/opt/gaasd-analytics/releases/20261009T120100`，活动链接 `/opt/gaasd-analytics/current`。
- 上一后端：`/opt/gaasd-analytics/releases/20261008T095600`，保留原目录。
- 前端仍为 `/var/www/gaasd-test/releases/20261008T095600`；本次没有变更宣传页、默认中文入口、媒体、Nginx、内网探针或 SSH 配置。
- 部署记录：`/var/backups/gaasd-status-20261009T120100/deployment.json`，同目录保存原内网采集服务配置。
- 本地代码发布包：`D:/Code/GAASD-Web-Review/work/gaasd-status-20261009T120100.tar`，11 个后端/管理界面源码文件；SHA-256 `ca11ec0e87cbb8d1def51c5a3a5b144996cd738052b900db0ca02698253127b8`。
- 长期统计库：`/var/lib/gaasd-analytics/status/intranet/gpu-usage.sqlite3`，从北京时间 **2026-10-09 12:00:47** 首次有效样本开始，30 秒一个时间槽，保存 400 天。此前没有完整日 / 周历史，未回填伪造数据。
- 每日备份：`/var/lib/gaasd-analytics/backups/gpu-usage-YYYYMMDD.sqlite3`，保留 14 份；首份 `gpu-usage-20261009.sqlite3` 已实际执行并通过完整性检查。数据库与备份权限均 0600。

## 实现

`backend/gpu_usage.py` 检查 8 张设备、有限数值和显存边界，去重后保存聚合样本。SQLite WAL 支持采集写入与只读报表同时运行；400 天清理每天至多执行一次。异常样本不保存，均值不把缺测当 0。

日 / 周使用北京时间日历边界（周一开始）；API 使用固定数据库、受限周期范围和参数校验。区间均值按样本加权，峰值仅代表采样中观察到的最高值。覆盖率包含部署前、断网和异常造成的缺测，不代表精确 GPU 任务时长或 FLOPS。页面支持旧日期查询，未知数据明确留空，存储过期或接口失败不显示假正常。

`status_remote.py` 在既有采样后写入聚合库，HTTP 不触发 SSH 或系统命令。新模块与后台沿用同一认证、CSP/no-store 和现有 Nginx 限流。新增前端模块取消过时请求，切换服务器后不混用数据。`backup.py` 同时备份访问统计与 GPU 库，完整运行备份脚本也使用在线 SQLite 快照。

## 验证

- Python 后端 **68 项通过**，覆盖日 / 周边界、8 卡计算均值与显存合计、重复槽、零值 / 缺测、加权平均 / 峰值、400 天清理、参数/认证、存储失败隔离、含 WAL 的每日/完整备份。没有执行新的全站完整归档；完整备份脚本的 GPU 部分通过含 WAL 的独立测试验证。
- ESLint、TypeScript、Prettier 和 Ruff 检查通过；`npm run build:status -- 20261009T120100` 生成并校验 11 文件发布包。
- 本地 Chrome：11 项通过、9 项按视口跳过；布局优化后额外 4 项日 / 周浏览器检查通过。测试使用独立合成数据，包含完整卡数、稀疏历史和缺测日，不写入生产统计。
- 线上 Chrome：**10 项通过、10 项有意跳过**。1440 / 1024 / 390 / 320px 均验证登录、真实 8 卡、640 GiB、日 / 周汇总、历史日期空值、图表/表格、无页面横向溢出，未新增脚本或资源错误。周期/故障用例只在桌面跑一次，人工注入的 GPU 查询失败/竞态仅本地测试。另观察到了线上 30 秒采样时间推进。
- 服务端：3 个服务正常运行；持久化样本数量持续增长。最新数据库记录与同时间的 8 卡快照逐项求和/求平均完全一致；GPU 统计库和首份备份 `quick_check=ok`。正式站点活动前端路径保持不变。
- 线上截图（忽略目录，不上传 Git）：`work/gpu-usage-screenshots/statistics-desktop-day.png`、`statistics-desktop-week.png`、`statistics-mobile-viewport.png`、`statistics-narrow-viewport.png`。线上报告 `work/gpu-usage-live-browser.log`。

## 回退

保留当前 GPU 数据库及备份。通过临时软链接加 `os.replace` 将 `/opt/gaasd-analytics/current` 原子切回 `20261008T095600`，重启 `gaasd-analytics`、`gaasd-status-collector`、`gaasd-status-intranet`，验证旧页面与快照。旧采集器不再写入长期 GPU 数据，恢复新代码后继续积累；回退期间是缺测，不应补 0。若只需恢复数据库，先停内网采集器和 HTTP 服务，保留原库及 WAL/SHM，安装独立一致性快照，避免混用旧日志。
