# 办公室 3060 Ti 开发机：SSH 跳转与状态网页

2026-10-17 已部署。办公室 Ubuntu `192.168.0.37` 主动连接腾讯云 `49.232.60.144:22`，使用系统自带 OpenSSH 的反向端口转发及 systemd，不另装 frp。Windows 电脑仅用于配置和验证，不参与运行链路，关闭 Windows 不影响访问。办公室开发机、办公室网络及腾讯云须保持运行。

## 访问入口

- 网页：<https://gaasd.com/status2>，自动跳转 `/status2/`。与 `/status`、`/statistics` 使用同一管理员用户名、密码和认证域。
- SSH：在已有腾讯云 SSH 登录权限的电脑上运行：

```sh
ssh -J ubuntu@49.232.60.144 -p 2222 tsari@127.0.0.1
```

此处 `127.0.0.1:2222` 是跳板腾讯云上的监听端口，最终登录的是办公室开发机的 `tsari` 账户。目标机仍检查它自己的密码或授权公钥；隧道密钥不赋予用户登录开发机的权限。首次连接应核对开发机 SSH 主机指纹。

如需便于记忆，可在访问端的 `~/.ssh/config` 添加（保留原有配置）：

```sshconfig
Host gaasd-office
    HostName 127.0.0.1
    Port 2222
    User tsari
    ProxyJump ubuntu@49.232.60.144
    HostKeyAlias gaasd-office-dev
```

随后运行 `ssh gaasd-office`。本次没有修改访问端的 SSH 配置。

## 链路与权限

```text
办公室开发机 systemd / OpenSSH
  └─ 主动连接腾讯云 :22，公钥登录专用 gaasd-office-tunnel 账户
       ├─ 腾讯云 127.0.0.1:2222  → 办公室 127.0.0.1:22
       └─ 腾讯云 127.0.0.1:18765 → 办公室 127.0.0.1:8765

SSH 客户端 → 腾讯云 ubuntu 跳板 → 127.0.0.1:2222 → 开发机 tsari
浏览器 HTTPS /status2/ → Nginx → 原 /status 认证 → 127.0.0.1:18765
```

两个转发端口只监听腾讯云回环地址，不开放公网端口，也不需要新增腾讯云防火墙规则。原 OpenVPN / A100 代理保持原配置。

专用 Ed25519 密钥在开发机生成，私钥只存放在开发机 `/var/lib/gaasd-office-tunnel/id_ed25519`（服务用户所有、权限 600）。公钥加入腾讯云该专用账户的 `authorized_keys`，没有加入 `ubuntu` 的普通登录授权。

公钥 SHA-256 指纹：`SHA256:V+VBmL4/FsjSG6kVF2QZWMTjPN82eq4j7DbKmKtPSkA`。客户端固定从既有可信管理员连接取得的腾讯云主机公钥，开启严格主机密钥检查。私钥、公钥授权文件、管理员凭据及运行数据不提交 Git。

云端 `Match User gaasd-office-tunnel` 与公钥选项共同限制：仅公钥认证、仅远程转发、仅允许上述两个回环监听地址；禁止 shell 会话、PTY、Agent/X11 转发及本地转发。服务账号使用 `nologin`，不授予 sudo。

Nginx 通过内部 `auth_request` 请求现有后端 `/status`，复用既有认证校验及密码哈希，不新增密码副本。网页、JS、CSS、历史数据及硬件接口均需认证；向办公室应用转发时清除 Authorization 和 Cookie。只允许 GET / HEAD，响应不缓存，不允许外站嵌入。隧道不可用时返回 503。

办公室原硬件监控仍由 `hardware-monitor-web.service`、采集 timer 运行。原文件及局域网访问方式保持不变；仅在 Nginx 响应中将 `/app.js`、`/style.css`、`/api/*` 改写到 `/status2/` 下。将来升级监控应用时，如果资源引用或 API 写法变化，需要同步检查 `sub_filter` 规则。

## 文件与维护

| 机器 / 路径 | 用途 |
| --- | --- |
| 开发机 `/etc/systemd/system/gaasd-office-tunnel.service` | 开机自启、失败 10 秒后重启 |
| 开发机 `/etc/gaasd-office-tunnel/ssh_config` | 两条反向转发、20 秒心跳、3 次无响应断线 |
| 开发机 `/etc/gaasd-office-tunnel/known_hosts` | 固定腾讯云主机公钥 |
| 开发机 `/var/lib/gaasd-office-tunnel/id_ed25519` | 专用私钥，仅留在开发机 |
| 云端 `/var/lib/gaasd-office-tunnel/.ssh/authorized_keys` | 受限公钥授权 |
| 云端 `/etc/ssh/sshd_config` 末尾 | 专用用户的 Match 限制块 |
| 云端 `/etc/nginx/snippets/gaasd-status2.conf` | 认证及 `/status2/` 反向代理 |
| 云端 `/etc/nginx/sites-available/gaasd-test` | HTTPS server 引入上述 snippet |
| 仓库 `ops/office-tunnel/` | 不含密钥的配置模板 |
| 仓库 `scripts/setup-office-tunnel.py` | 分阶段安装及配置校验 |

开发机常用命令：

```sh
systemctl status gaasd-office-tunnel
systemctl is-enabled gaasd-office-tunnel
sudo journalctl -u gaasd-office-tunnel -n 50 --no-pager
sudo systemctl restart gaasd-office-tunnel
```

配置更新后执行 `sudo systemctl daemon-reload` 和 `sudo systemctl restart gaasd-office-tunnel`。systemd 服务不需要桌面登录；现有 Wi-Fi 配置已经启用自动连接且允许所有用户使用。

云端检查：

```sh
sudo sshd -t
sudo nginx -t
ss -lnt | grep -E '2222|18765'
curl --fail http://127.0.0.1:18765/api/status
```

安装脚本须以 root 执行：`office-prepare` 在开发机生成密钥；仅传公钥给云端运行 `cloud-authorize`；将可信腾讯云主机公钥交给开发机 `office-start`；确认隧道后在云端执行 `cloud-web`。各阶段 `--source` 指向配置模板目录，公钥由 `--public-key` / `--host-key` 指定。脚本拒绝覆盖不同的既有隧道公钥；云端 SSH 和 Nginx 修改先备份，并通过语法检查后 reload。

## 验证结果

- 经腾讯云跳板登录开发机成功，实际用户和主机名均为 `tsari`。
- systemd 已启用开机启动；终止隧道主进程后自动恢复，`NRestarts` 从 0 增至 1，16 秒后跳转 SSH 再次成功。未重启整台开发机或腾讯云，因此不将此记录描述为整机重启验收。
- 云端两个监听地址均为 `127.0.0.1`；`sshd -T` 确认用户限制生效；使用隧道密钥尝试执行远程 shell 命令被拒绝。
- `/status2/`、脚本、CSS、各数据接口匿名及错误密码均返回 401；同一管理员凭据可访问 `/status2/`、`/status`、`/statistics`；内部认证 URI 对外 404；POST 返回 403。
- Chrome 实际访问 1440、1024、390、320px：GPU 型号 RTX 3060 Ti、显存 8192 MiB、采样在线；历史范围切换、刷新、重载成功，无页面横向溢出、脚本错误和根路径资源误请求。5 项通过，3 项为同一认证检查在其余视口的刻意跳过。
- 原 `/status/api/snapshot?server=intranet` 返回 200；云端原默认 HTTP `/login` 返回 200。既有网站前后端发布版本未切换。
- `npm run lint`、Ruff 检查和格式检查通过。只修改运维配置和独立验证入口，没有重新构建或发布宣传页和状态后端。

浏览器测试命令：

```powershell
$env:GAASD_STATUS2_URL='https://gaasd.com'
$env:GAASD_STATISTICS_CREDENTIALS='绝对路径/临时凭据.json'
npm run test:status2
```

临时凭据使用 `username`、`password` 字段，只存放于受控本地位置，测试后删除；不得上传测试 trace、凭据或运行数据。截图位于本地 `work/status2-screenshots/`，报告位于 `work/status2-test-report/`，均被 Git 排除。

页面中原有的磁盘告警来自开发机已有监控数据，本次没有修改告警判断或历史数据。

## 备份与回退

本次云端变更前备份：

- SSH：`/var/backups/gaasd-office-tunnel/20261017T143656912563Z/sshd_config`
- Nginx：`/var/backups/gaasd-office-tunnel/20261017T143721072400Z/gaasd-test`

均为 root 可读。回退时先保留一个已登录的管理员 SSH 会话；在云端移除 `/status2` snippet 的 include，`nginx -t` 成功后 reload。开发机执行 `sudo systemctl disable --now gaasd-office-tunnel` 停止转发。需要撤销专用密钥时，移走云端专用账户的 `authorized_keys`，再移除 sshd 中 `BEGIN/END GAASD OFFICE TUNNEL` 管理块，`sshd -t` 成功后 reload。不要删除其他用户的授权，也不要将旧全量配置覆盖到已包含后续更新的文件。上述两份备份供差异核对和必要恢复。

参考：[OpenSSH sshd_config](https://man.openbsd.org/sshd_config)、[Nginx auth_request](https://nginx.org/en/docs/http/ngx_http_auth_request_module.html)。
