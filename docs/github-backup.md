# GitHub 代码备份说明

仓库：<https://github.com/adamyjl/gaasd>。首次代码快照日期：2026-09-24。

## 保存范围

- `site/` 中的 HTML、CSS、JavaScript 与文本 SVG 图标：英文首页、中文首页、隐私页、播放器和统计采集。
- `backend/` 中的 Python、管理页面、测试、依赖清单，以及地区库的来源和许可证说明。
- `scripts/`、`tests/`、根目录构建/检查配置、`package-lock.json` 和维护文档。
- [external-assets.json](external-assets.json)：未上传的运行媒体和地区库的相对路径、字节数及 SHA-256，仅记录元数据。

视频、音频、位图封面、PDF 和原始设计素材不进入 Git。`node_modules/`、`.tools/`、`dist/`、`work/`、数据库、日志、测试报告、归档、生产账号配置和证书私钥也不进入 Git。`.gitignore` 已配置相应排除规则。`site/favicon.svg` 是文本源码，随代码保存。

本地文件仍保留原位，线上服务不受本次提交影响。仓库未配置自动部署；GitHub 上的代码备份不能替代含媒体、配置和数据的完整备份。源码中的 `qa` / `local-test-only` 是本地测试账号，不用于生产。

## 从代码仓库恢复开发环境

```powershell
git clone https://github.com/adamyjl/gaasd.git GAASD-Web
Set-Location GAASD-Web
npm ci
```

在执行 `npm run build`、浏览器测试或部署前，补齐资源：

1. 按 [BACKUP.md](../BACKUP.md) 校验完整项目包，在独立目录解压。
2. 将包内 `project/site/media/` 和 `project/site/images/` 复制到克隆目录对应位置；将 `project/backend/geo-data/` 中的 `.xdb` 文件复制到 `backend/geo-data/`。保留目录层级和文件名，不覆盖克隆目录中的新版源码。
3. 用 `external-assets.json` 的字节数与 SHA-256 核对资源。清单包含旧地址兼容媒体，不仅是当前播放的十段视频。
4. 按主 README 建立 Python 环境、安装依赖，然后运行构建和所需检查。

当前配套完整备份为 `20260924T102025`：

- 本地：`D:/Code/GAASD-Web-Backups/20260924T102025/GAASD-Project-20260924T102025.tar.gz`。
- 服务器：`/var/backups/gaasd-web/full/20260924T102025/GAASD-Project-20260924T102025.tar.gz`，通过已有 SSH 权限访问。

如果没有项目包，可从服务器活动前端 `/var/www/gaasd-test/public/` 取回 `media/` 和 `images/`；地区库位于活动后端 `/opt/gaasd-analytics/current/geo-data/`。取回后仍应与清单核对。`scripts/prepare-geo.py` 可下载新的地区库，但新的上游版本不保证与此快照哈希相同。

```powershell
npm run format:check
npm run lint
npm run typecheck
npm run build
```

构建脚本会校验视频和封面是否存在；未补齐资源时构建失败是预期行为，不能发布缺媒体的包。生产认证配置、TLS 证书、SQLite 数据和 systemd/Nginx 实际配置从受限运行备份恢复，流程见 BACKUP.md，不能从公开仓库取得。

## 后续提交

```powershell
git status --short
git add -- .gitignore README.md BACKUP.md STATISTICS.md STATUS.md docs site backend scripts tests
git diff --cached --stat
git diff --cached --name-only
git commit -m "Describe the website change"
git push origin main
```

提交前确认暂存区只有源码和说明文件，不要用 `git add -f` 绕过媒体、数据或凭据排除规则。新增根目录构建配置时单独 `git add` 对应文件。更新视频只需提交对应路径/文案及新的资源校验清单，视频文件继续通过原服务器部署流程传输。详细技术实现、部署和恢复步骤见 [README.md](../README.md)。
