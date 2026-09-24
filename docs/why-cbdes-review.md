# Why CBDES 设计评审

## 评审入口与边界

- 英文完整首页：<https://adamyjl.github.io/gaasd/review/why-cbdes/>
- 中文完整首页：<https://adamyjl.github.io/gaasd/review/why-cbdes/cn/>
- 功能分支：`feature/why-cbdes-review`，以 `main` 为目标的草稿 PR；评审期间不合并。
- Pages 分支：`preview-pages`，根目录发布，没有 `CNAME`，不绑定生产域名。
- 只发布静态前端，不发布后端和管理页面，不执行腾讯云部署脚本。

首次开始时 `origin/main` 为 `f485c00`，仓库没有 Pages、Actions 工作流或 webhook。实现使用独立 worktree，保留原项目及本地媒体。页面顶部短提交号对应功能分支的源码提交；发布分支的生成产物另有 Git 提交。

## 整合方式

参考附件 `GAASD-CBDES-Design-Preview.zip` 中的 DESIGN-PROPOSAL、两个首页新增片段、why-cbdes CSS/JS、局部预览及 why-copy 文案。仅提取新增板块与相关交互，没有整包覆盖项目，也没有提交附件、内嵌图片的演示 HTML 或 Base64 媒体。

页面顺序为原首页概览与视频 → 815+ / 04 数据栏 → Why CBDES → 四个开发方向 → 原页脚。保留原三行标题、缩写全称、播放器和双语视频映射。

新增区块包含三个挑战、CBDES = CBB + GAASD 分工，以及应用建模 → 部署下载 → 上车验证 → 优化迭代。四个原生按钮更新说明和产出，使用 `aria-pressed` 和 `aria-live`；反馈按钮回到第一步。桌面横向流程，手机纵向流程与左侧回流线。英文标题自然换行，不强制复用中文断行。

`site/index.html`、`site/cn/index.html` 独立维护静态文案，共享 `why-cbdes.css`、`why-cbdes.js`。主样式未改变。`.gitattributes` 固定文本 LF，修复 Windows 新 worktree 因 Git 自动转换 CRLF 导致的原有格式检查误差。

## 资源与统计

预览引用 `https://gaasd.com/` 已公开的 10 段视频、10 张封面和备案图标。21 个地址均以 HEAD 核查，视频另核查 HTTP 206；浏览器检查实际图片解码与视频播放。它们仍由正式站点分发，站点访问日志可能记录资源请求，但预览不发送业务访问或播放事件。

预览构建注入 `data-preview` 和媒体基址，替换统计模块为空实现，并用 CSP `connect-src 'none'` 阻断 fetch、XHR 与 beacon。原源码统计入口也包含预览标志判断。生产页面不带预览标志，生产业务统计保持原逻辑。

以下附件资料没有可用公开地址，候选地址均返回 404：

- `https://gaasd.com/images/why-cbdes-source.jpg`：研发背景中文原页。
- `https://gaasd.com/docs/GAASD-Develop.pdf`：英文平台介绍 PDF。

两项入口暂时隐藏，原图没有 `src`，不会请求失效资源。展开/收起逻辑保留在共享脚本；后续资料获准发布后，在 `site/why-resources.js` 填入已验证地址即可启用。若使用 gaasd.com 以外的图像域名，还需将该域名加入预览构建的 CSP 图片白名单。中文背景原图与英文 PDF 并非同一页资料。

## 构建与更新预览

```powershell
npm ci
npm run build:preview
node scripts/serve.mjs --dir preview-dist --port 4178
# http://127.0.0.1:4178/gaasd/review/why-cbdes/
npm run test:preview
```

`build:preview` 不需要本地媒体，只输出 HTML/CSS/JS、文本 SVG 及 JSON 元数据。它重写中英文根路径、隐私页和模块引用以适配项目子目录；语言切换保留当前可见板块。资源排除规则仍有效。构建中的 `-working` 表示未提交的开发预览，不能用发布脚本发布。

正式 `npm run build` 及其媒体检查保持原样。全新源码 worktree 首次因缺媒体报 ENOENT 是预期行为；本次仅从原本地项目补齐已公开媒体后，正式构建也已通过，未读取生产数据、凭据或运行备份。

后续同事反馈应继续提交到同一功能分支和 PR。提交后重新构建，准备独立的 Pages checkout（首次为空分支，已有则先 fetch/pull），然后运行：

```powershell
git push origin feature/why-cbdes-review
npm run build:preview
node scripts/stage-preview.mjs D:/Code/GAASD-Web-Review-Pages
git -C D:/Code/GAASD-Web-Review-Pages diff --stat
git -C D:/Code/GAASD-Web-Review-Pages add -- .nojekyll index.html review/why-cbdes
git -C D:/Code/GAASD-Web-Review-Pages commit -m "Update Why CBDES review preview"
git -C D:/Code/GAASD-Web-Review-Pages push origin preview-pages
```

脚本检查源提交干净、构建版本匹配、目标分支和仓库正确，只替换本次 `review/why-cbdes/` 路径，保留其他 Pages 内容。不要添加生产 `CNAME`，不要运行 `deploy.py` 或 `deploy-analytics.py`。首次 Pages 设置为 Settings → Pages → Deploy from a branch → `preview-pages` / `(root)`；以实际发布状态及浏览器验证为准。

## 验证与反馈

真实 Chrome 验证脚本：`tests/preview.test.mjs` / `playwright.preview.config.mjs`。覆盖中英文直接访问和刷新、1440/1024/390/320px 布局、四步及键盘切换、反馈回流、语言切换、方向跳转、图片加载、视频播放、无业务上报、页面异常和 HTTP 资源错误。媒体播放在桌面 1440px 和手机 390px 各运行一次，另外两个宽度的重复播放检查按配置跳过。手机为 Chrome 设备模拟，未在实体 iOS/Safari 验证。

```powershell
# 对真正的线上预览复验；不要使用正式站地址。
$env:GAASD_REVIEW_URL = 'https://adamyjl.github.io/gaasd/review/why-cbdes/'
$env:GAASD_REVIEW_SCREENSHOTS = 'work/review-online-screenshots'
npm run test:preview
```

报告和截图存于忽略的 `work/` 下，截图作为 PR 评审附件单独上传，不进入源码或 Pages 分支。源码检查运行 format:check、lint、typecheck、生产构建及已有页面测试；具体通过数量和线上验证结果记录在 PR 中。

请同事重点反馈：

- 新板块的位置与篇幅是否合适；
- 三个挑战是否准确；
- CBB 与 GAASD 的关系是否清楚；
- 开发闭环是否容易理解；
- 中英文与手机端是否协调。
