# 2026-09-28 中英文正式发布

本次按用户明确授权，将以 `6a2c399` 为基础的当前评审版发布至 `https://gaasd.com/` 和 `https://gaasd.com/cn/`，并更新方向 02、04 的四个视频。GitHub Pages 继续作为独立预览；没有合并 main，也没有更改统计、状态后台或服务器认证配置。

## 页面及媒体

正式页包含 Why CBDES 双语区块、挑战与方案、四步开发闭环、桌面 2×2 / 手机 1×4 视频卡片，以及观看总览按钮左侧的中英文切换。语言切换使用共享 `language-switch.js`，在正式域名及预览子路径下均保留对应板块。

正式页面使用生产构建，保留统计模块，不包含评审提示条、预览标志或禁用统计的 CSP。CSS、应用入口和语言切换脚本版本为 `production-20260928`。缺少公开地址的参考原图和 PDF 入口继续隐藏，页面没有无效资料链接。

| 方向 | 语言 | 输入文件 | 站点路径 | 时长 |
| --- | --- | --- | --- | --- |
| 02 AI 辅助开发 | EN | `gaasd-ai-en.mp4` | `/media/present2/en/ai-assist-20260928.mp4` | 239.30 秒 |
| 02 AI 辅助开发 | 中文 | `gaasd-ai-cn.mp4` | `/media/present2/cn/ai-assist-20260928.mp4` | 239.30 秒 |
| 04 VLA | EN | `gaasd-vla-en.mp4` | `/media/present2/en/vla-20260928.mp4` | 274.77 秒 |
| 04 VLA | 中文 | `gaasd-vla-cn.mp4` | `/media/present2/cn/vla-20260928.mp4` | 274.77 秒 |

输入来自 `C:/Users/LG-NB/Downloads/`，均为 1920×1080、30fps、H.264/AAC，且已具备 MP4 fast-start；逐字节复制，不转码、不改字幕、配音或画面。SHA-256 和大小见 [external-assets.json](external-assets.json)。总览、方向 01/03、全部封面及备案素材保持原样。旧视频地址继续保留；统计 ID 仍为 `ai-assist` 和 `vla`，延续历史报表。

## 版本、备份及回滚

- 正式前端版本：`/var/www/gaasd-test/releases/20260928T204607`。
- 活动链接：`/var/www/gaasd-test/public`。
- 可回滚版本：`/var/www/gaasd-test/releases/20260923T002235`。
- 发布前完整静态站备份：`/var/backups/gaasd-web/releases/20260928T204607/frontend-before.tar.gz`，root-only。
- 备份 SHA-256：`8be7f1da9ca4410fc9e41aeac59c8cdb407c7bc954d4c6b9658e20670691bf45`。
- 本地发布记录：`D:/Code/GAASD-Web-Review/work/production-20260928/`。
- 本地源码及增量媒体备份：`D:/Code/GAASD-Web-Backups/20260928T204607/`；这是源码及本次发布增量，不是包含数据库和系统配置的完整运行快照。

增量包对发布前活动版本及其 manifest 哈希做匹配检查，只更新前端文本与四个新视频。服务器从旧版建立新版本目录，写入修改前先断开对应硬链接，逐一校验完整 55 个文件，然后原子切换活动链接。源站内容或视频 Range 校验失败自动切回旧目录。Nginx 和后台无需重启。

手动回滚（先确认目标目录存在且仅切换前端）：

```bash
sudo ln -s /var/www/gaasd-test/releases/20260923T002235 /var/www/gaasd-test/public-rollback-20260928
sudo mv -Tf /var/www/gaasd-test/public-rollback-20260928 /var/www/gaasd-test/public
```

GitHub 仍只保存源码与说明；视频、图片、发布包、数据库和凭据不上传到 Git。当前源码保存在 `feature/why-cbdes-review`，原草稿 PR 继续保留。`main` 不会因正式服务器发布而自动合并。

## 验证记录

发布代码提交为 `c8af6ce`，后续仅补充验证与备份说明。实际检查结果保存在本次发布目录：

- Prettier、ESLint、TypeScript 检查通过；生产构建校验 55 个文件。
- 本地原页面回归：15 通过、9 项重复检查按配置跳过。
- 本地及线上双语视频检查：各 8 通过，四个新视频均已实际播放、核对时长、拖到尾部，并返回 HTTP 206。
- 本地及线上正式发布专项：各 9 通过、3 项重复统计检查跳过；覆盖 1440、1024、390、320px，中英文流程交互、语言切换保留板块、2×2 / 1×4 卡片和图片加载均正常，无新增脚本异常或横向溢出。
- 正式页统计模块能发出访问及播放事件；QA 在浏览器中拦截请求以避免写入业务数据。生产后端内部健康检查为正常，统计及状态入口未登录时均返回 401，Nginx、统计和状态采集服务均 active。
- 服务端完整 SHA-256 校验通过，旧媒体及封面哈希保持一致；源站新页面和四个视频的 Range 检查通过。

线上截图位于 `work/production-20260928/online/`。手机验证使用 Chrome 设备模拟；未做实体 iOS/Safari 验证。后端未修改，未重复执行后端测试。

生产专项浏览器检查：`npx playwright test -c playwright.release.config.mjs`。覆盖中英文正式页无评审标志、四步交互、语言跳转保留板块、卡片布局、图片及页面异常；统计检查在浏览器拦截事件，不写入生产访问数据。

双语视频检查：`npx playwright test -c playwright.videos.config.mjs`，验证十段总览/模块视频实际播放、四个模块的语言映射、时长、拖到末尾和 HTTP 206，以及隐私开关。
