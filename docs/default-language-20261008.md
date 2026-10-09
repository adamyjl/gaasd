# 2026-10-08 主站默认中文

`https://gaasd.com/` 直接返回中文首页，英文入口为 `https://gaasd.com/en/`。原 `/cn/` 保留相同的中文内容，canonical 指向 `/`。不根据浏览器语言或旧偏好跳转，默认始终是中文；顶部 EN / 中文切换保留当前板块。

根目录的隐私说明同步为中文，英文隐私页为 `/en/privacy.html`，旧 `/cn/privacy.html` 继续可用。英文页的 CSS、JS、图片、资料和视频使用站点根路径，防止被错误解析为 `/en/media/` 等地址。中英文主标题、布局、视频内容与封面不变。

后台只在事件路径白名单中增加 `/en`、`/en/`、`/en/index.html`，保留全部原访问路径及历史数据。没有修改数据库、账号、统计口径、状态采集或 Nginx 配置。

## 发布

- 前端：`/var/www/gaasd-test/releases/20261008T095600`。
- 后端：`/opt/gaasd-analytics/releases/20261008T095600`。
- 部署记录：`/var/backups/gaasd-language-20261008T095600/deployment.json`。
- 保留的前版：前端 `20260929T204817`，后端 `20261001T210800`。
- 本地构建与记录：`D:/Code/GAASD-Web-Review/work/default-language/` 及 `work/default-language-*.log`。
- 发布脚本：`scripts/deploy-default-language.py`，上传包仅含 6 个 HTML、完整静态资源清单、`backend/app.py` 和版本校验元数据。

脚本先校验活动版本与上传包 SHA-256，从原前端建立新版本目录，断开被修改文件的硬链接后写入；验证全部 59 个资源，新旧媒体哈希不变。后端复制原版本，仅更新 app.py。原子切换版本后检查源站根首页、六个 HTML 和后端健康；失败自动恢复原链接与统计服务。

GitHub Pages 现有评审网址本次没有重新发布；预览构建脚本已适配新的根目录中文和 `/en/` 结构，后续显式发布预览时生效。没有合并 main。

回退可先确认上述前版目录存在，再将 `/var/www/gaasd-test/public` 和 `/opt/gaasd-analytics/current` 用临时软链接原子替换为前版目录，并重启 `gaasd-analytics`。无需移动数据库、媒体或恢复管理员凭据。

## 检查

- 生产构建（59 个文件）、预览构建、Prettier、ESLint、TypeScript 和 Python Ruff 通过。
- Python 后端 53 项通过，覆盖新增英文路径的访问、播放及 CSV 记录。
- 本地正式入口检查 10 项通过，6 项重复视口检查跳过；覆盖 1440 / 1024 / 390 / 320px、默认中文、旧中文地址、语言切换、流程交互和统计事件拦截。
- 本地双语视频 8 项通过：10 段视频实际播放、拖动和 HTTP 206 均正常，隐私偏好跨语言共享。
- 本地原页面回归 15 项通过，9 项重复视口检查跳过。
- 线上正式入口检查 10 项通过、6 项重复视口检查跳过；桌面和手机双语视频检查 8 项通过，全部实际播放与拖动正常。页面、语言切换与旧中文地址均正确，没有页面脚本异常或横向溢出。
- 预览构建的两种语言在真实 Chrome 的项目子路径下均通过入口、切换、工作流及禁止统计检查（2 项）。本次没有发布 Pages。
- 腾讯云 Nginx、统计后台及两项状态采集服务均 active；状态页未登录仍返回 401。

正式页浏览器截图保存于 `work/default-language/online/`；实际线上测试结果以 `work/default-language-online.log` 和 `work/default-language-videos-online.log` 为准。测试拦截业务事件，不往生产数据库写入 QA 访问及播放数据。
