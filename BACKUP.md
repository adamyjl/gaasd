# GAASD 完整备份与恢复

备份分为两个独立归档，并在本地和腾讯云服务器各保存一套。源码包可用于重新开发和构建；运行包可用于恢复当时线上网站、后端、统计数据和配置。

| 文件 / 目录                     | 内容                                                                                                          |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `GAASD-Project-<时间戳>.tar.gz` | `project/` 下的源码、测试、依赖锁文件、所有网站媒体、五段原始视频、PDF 和图片，以及当时静态发布清单           |
| `GAASD-Runtime-<时间戳>.tar.gz` | `runtime/` 下的线上静态版本、后端、数据库一致性快照、状态及每日备份、网站日志、Nginx/systemd/HTTPS/管理员配置 |
| `*.sha256`                      | 整个压缩包的 SHA-256，可对比本地与服务器文件                                                                  |
| 包内 `BACKUP-MANIFEST.json`     | 每个文件的长度与 SHA-256，以及证书软链接目标                                                                  |
| `*.json` / 验证记录             | 创建时间、来源版本、数据库完整性、文件校验及恢复检查结果                                                      |

本地目录：`D:\Code\GAASD-Web-Backups\<时间戳>\`。

服务器目录：`/var/backups/gaasd-web/full/<时间戳>/`。

运行包包含访问 IP、管理员凭据、ACME 账号与证书私钥。服务器完整备份目录仅 root 可访问，压缩包权限为 600；本地使用受限 NTFS ACL。文件没有额外密码加密，传输使用 SSH，不能放入 `site/`、`dist/` 或公开网盘。

## 一、包含范围与一致性

- 本地包包含 `site/`、`backend/`（含 IPv4/IPv6 地区库）、`scripts/`、`tests/`、源材料及根目录文档和配置。
- 不包含 `node_modules/`、`.tools/`、临时 `work/`、模型缓存、测试报告、Python 缓存或重复 `dist/`；单独保存 `dist/asset-manifest.json` 为 `project/release-asset-manifest.json`。
- 运行包捕获活动 `public` 和 `current` 链接所指的实际文件，不依赖旧版本目录仍然存在。
- SQLite 使用官方在线 `backup()` API 生成独立文件，并执行 `PRAGMA integrity_check`。不是直接复制可能仍在写入的数据库文件或 WAL。
- 状态 JSON 由服务原子写入，备份复制时会验证 JSON 可解析。日志和状态文件复制期间服务继续运行，因此不同文件的时间点可能相差数秒；不会停止线上服务。
- 保存当时生产环境的完整 `pip freeze`、systemd 定义、定时器、操作系统和活动版本信息。Python 虚拟环境及系统软件二进制不打包。
- HTTPS 的 live→archive 相对软链接和 ACME 续期配置一并保留。Nginx 的 `platform-relay` 配置仅作共享服务器配置参考；没有备份该应用的源码或数据。
- 不包含 SSH 私钥、整机系统镜像、其他应用数据或腾讯云控制台的 DNS/防火墙配置。重建服务器仍需已有 SSH 访问方式，并把域名解析到目标 IP、开放 80/443。

当前设置仍是每天 03:15 自动备份统计数据库、保留 14 份；以下整站备份是手动操作，不新增定时任务。

## 二、创建和双端保存

在本地项目执行。先完成文档/代码修改及 `npm run build`，再打包，避免包内文档落后于代码。

```powershell
Set-Location D:\Code\GAASD-Web
npm run build
$backupId = Get-Date -Format 'yyyyMMddTHHmmss'
$backupDir = "D:\Code\GAASD-Web-Backups\$backupId"
New-Item -ItemType Directory -Path $backupDir | Out-Null
$backupSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
icacls $backupDir /inheritance:r /grant:r "*${backupSid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'

& .tools/analytics-venv/Scripts/python.exe scripts/backup_project.py --output "$backupDir/GAASD-Project-$backupId.tar.gz"
scp scripts/backup_server.py scripts/backup_common.py scripts/verify_backup.py ubuntu@49.232.60.144:/tmp/
ssh ubuntu@49.232.60.144 "sudo python3 /tmp/backup_server.py $backupId"
```

两个创建脚本都会完整读取归档验证一次，再写入 `.sha256`。同名包或同名服务器备份目录已存在时会拒绝覆盖，应使用新的时间戳；失败的 `.partial` 或 staging 留待检查，不把它视为有效备份。

上传项目包：

```powershell
scp "$backupDir/GAASD-Project-$backupId.tar.gz" "$backupDir/GAASD-Project-$backupId.tar.gz.sha256" ubuntu@49.232.60.144:/tmp/
ssh ubuntu@49.232.60.144 "sudo install -m 600 /tmp/GAASD-Project-$backupId.tar.gz /tmp/GAASD-Project-$backupId.tar.gz.sha256 /var/backups/gaasd-web/full/$backupId/"
ssh ubuntu@49.232.60.144 "sudo python3 /tmp/verify_backup.py /var/backups/gaasd-web/full/$backupId/GAASD-Project-$backupId.tar.gz"
```

下载受限的运行包，通过仅 ubuntu 可访问的暂存目录导出，不修改正式备份权限：

```powershell
ssh ubuntu@49.232.60.144 'sudo install -d -o ubuntu -g ubuntu -m 700 /home/ubuntu/gaasd-backup-export'
ssh ubuntu@49.232.60.144 "sudo install -o ubuntu -g ubuntu -m 600 /var/backups/gaasd-web/full/$backupId/GAASD-Runtime-$backupId.tar.gz /var/backups/gaasd-web/full/$backupId/GAASD-Runtime-$backupId.tar.gz.sha256 /home/ubuntu/gaasd-backup-export/"
scp "ubuntu@49.232.60.144:/home/ubuntu/gaasd-backup-export/GAASD-Runtime-$backupId.tar.gz*" $backupDir
& .tools/analytics-venv/Scripts/python.exe scripts/verify_backup.py "$backupDir/GAASD-Runtime-$backupId.tar.gz"
Get-FileHash -Algorithm SHA256 "$backupDir/GAASD-Project-$backupId.tar.gz", "$backupDir/GAASD-Runtime-$backupId.tar.gz"
```

确认两端 SHA-256 一致后，可删除此次 `/tmp/GAASD-Project-<时间戳>...` 和 `/home/ubuntu/gaasd-backup-export/GAASD-Runtime-<时间戳>...` 暂存副本；不要删除正式备份目录。每次完成后记录两个包的版本、大小、校验值与验证结果。

## 三、读取与源码恢复

先运行完整校验；只检查 `tar -t` 的目录列表不足以确认文件未损坏。

```powershell
& D:/Code/GAASD-Web/.tools/analytics-venv/Scripts/python.exe D:/Code/GAASD-Web/scripts/verify_backup.py 'D:/Code/GAASD-Web-Backups/实际时间戳/GAASD-Project-实际时间戳.tar.gz'
# 解压至全新目录，不覆盖当前开发工作
New-Item -ItemType Directory -Path 'D:\Code\GAASD-Web-Restore' | Out-Null
tar.exe -xzf 'D:/Code/GAASD-Web-Backups/实际时间戳/GAASD-Project-实际时间戳.tar.gz' -C 'D:/Code/GAASD-Web-Restore'
Set-Location 'D:\Code\GAASD-Web-Restore\project'
npm ci
npm run build
```

Python 环境按 README 重建。完整项目包自带地区库和运行 MP4，不必重新从 Downloads 找文件。运行包内的 `runtime/inventory/pip-freeze.txt` 可用于恢复相同的生产 Python 传递依赖版本。

恢复出的静态构建可与 `project/release-asset-manifest.json` 或运行包 `runtime/public/asset-manifest.json` 对比。

## 四、服务器恢复步骤

以下为需要恢复时执行的流程，本次备份不会执行生产覆盖。数据库恢复会回到快照时间，丢失快照之后尚未另存的记录，因此先备份当前数据，记录当前两个活动链接。

### 4.1 在隔离目录解压并核验

在 Linux 使用 Python 3.12 或系统 tar 解压到新建的 root-only 目录，例如 `/var/backups/gaasd-web/restore-check/<时间戳>/`。先验证归档 SHA-256，再运行 `verify_backup.py`；恢复目录必须在公开站点之外。

```bash
sudo python3 /tmp/verify_backup.py /var/backups/gaasd-web/full/实际时间戳/GAASD-Runtime-实际时间戳.tar.gz
sudo install -d -m 700 /var/backups/gaasd-web/restore-check/实际时间戳
sudo tar -xzf /var/backups/gaasd-web/full/实际时间戳/GAASD-Runtime-实际时间戳.tar.gz -C /var/backups/gaasd-web/restore-check/实际时间戳
```

`runtime/runtime-info.json` 记录源版本；`runtime/data/analytics.sqlite3` 是一致性数据库副本。对该副本运行 `PRAGMA integrity_check`，结果应为 `ok`。

### 4.2 只恢复静态网页

将 `runtime/public/` 复制为全新版本目录 `/var/www/gaasd-test/releases/restore-<时间戳>/`，目录权限 755、文件 644。核验清单和 `nginx -t` 后，通过临时软链接加 `os.replace()` 原子切换 `/var/www/gaasd-test/public`。不要原地覆盖已发布版本，也不需要为了静态回滚清空统计数据库。

若旧版本仍在，只需原子切回该旧目录即可。`public` 始终应为指向 `releases/` 内目录的软链接。

### 4.3 恢复后端与数据

1. 记录当前前后端链接，先创建当前状态的独立备份。
2. 停止 `gaasd-analytics.service`、`gaasd-status-collector.service` 和 `gaasd-analytics-backup.timer`；确认备份 service 不在运行。
3. 把 `runtime/backend/` 复制为 `/opt/gaasd-analytics/releases/restore-<时间戳>/`。重建 `/opt/gaasd-analytics/venv`，用保存的 `pip-freeze.txt` 安装依赖；已有兼容环境也可使用。
4. 将旧 `analytics.sqlite3` 连同可能存在的 `-wal` / `-shm` 文件移入独立保留目录，再安装快照为 `/var/lib/gaasd-analytics/analytics.sqlite3`。**不能把新数据库与旧 WAL/SHM 混用**。
5. 恢复 `runtime/data/status/` 到 `/var/lib/gaasd-analytics/status/`。每日历史副本可恢复至 `/var/lib/gaasd-analytics/backups/`，无需覆盖快照后新产生的备份。
6. 数据目录属主设为 `gaasd-analytics:gaasd-analytics`，目录 700、文件 600。恢复 `/etc/gaasd-analytics/`：目录 `root:gaasd-analytics` 750、`config.json` 同组 640、`admin-credentials.json` 为 `root:root` 600。配置中的数据库、地区库、状态目录仍应指向正式路径。
7. 恢复四个 `gaasd-*.service/timer` 单元，原子切换后端 `current`，执行 `systemctl daemon-reload`，启动后端、采样和备份 timer。
8. 检查 `http://127.0.0.1:4180/internal/health`、两个管理页面及其 API。使用恢复的原管理员账号；不要把生产密码改成本地 `qa` 测试密码。

### 4.4 Nginx、证书与新服务器

已有服务器仅恢复 GAASD 对应的 `sites-available/gaasd-test`、`snippets/gaasd-analytics.conf`、`conf.d/gaasd-analytics-rate.conf` 并保持启用链接；不要整目录覆盖其他应用的 Nginx 设置。`platform-relay` 是共享服务器配置参考，恢复前应确认它仍适用。

新服务器需要先安装 Nginx、Python 3.12/venv、certbot 及 nginx 插件，创建 `gaasd-analytics` 系统用户和前述目录。恢复配置和 systemd 单元后，按正式路径恢复 `/etc/letsencrypt/` 中的 live、archive、renewal、accounts 等内容，保持软链接和私钥权限；确认证书有效或重新签发，再启用 certbot timer。旧证书过期后，不能只复制证书文件便认为 HTTPS 已恢复。

最后执行 `nginx -t`，启动/重载 Nginx，验证域名 DNS 指向目标服务器、云防火墙开放 80/443、HTTPS 正常、MP4 范围请求返回 206、两种语言页面使用各自视频，后台未登录为 401、登录后为 200。`/status` 的旧快照会由启动后的采样进程更新。

## 五、本次验证口径

有效完整备份需要同时满足：两个归档完整解压流校验通过；本地与服务器整包 SHA-256 相同；SQLite 完整性为 `ok`；在隔离目录读取恢复出的后端和数据库，验证健康检查、原管理员认证、统计及状态接口。隔离检查不修改当前活动链接、不停止线上服务、不向生产数据库写入测试事件。

每次验证结果放在对应备份目录的记录文件中。源码备份和运行备份可能有几分钟时间差，具体 UTC 时间和活动版本以各包清单为准。
