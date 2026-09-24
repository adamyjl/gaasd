const $ = (id) => document.getElementById(id);
const number = (value, digits = 1) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
const percent = (value) =>
  Number.isFinite(value) ? `${number(value)}%` : "采样中";
function bytes(value) {
  if (!Number.isFinite(value)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${number(value, index ? 1 : 0)} ${units[index]}`;
}
const speed = (value) =>
  Number.isFinite(value) ? `${bytes(value)}/s` : "采样中";
const date = (value) =>
  Number.isFinite(value)
    ? new Date(value * 1000).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "未提供";
const clock = (value) =>
  new Date(value * 1000).toLocaleTimeString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  });
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function details(entries) {
  const grid = el("dl", undefined, "detail-grid");
  for (const [name, value] of entries) {
    const item = el("div", undefined, "detail-item");
    item.append(el("dt", name), el("dd", value));
    grid.append(item);
  }
  return grid;
}
function replace(id, nodes) {
  $(id).replaceChildren(...nodes);
}
function bar(value, label) {
  const track = el("div", undefined, "usage-track");
  const fill = el("span");
  fill.style.width = `${Math.min(100, Math.max(0, value || 0))}%`;
  track.dataset.high = String(value >= 85);
  track.setAttribute("role", "meter");
  track.setAttribute("aria-label", label);
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", "100");
  if (Number.isFinite(value))
    track.setAttribute("aria-valuenow", String(value));
  track.append(fill);
  return track;
}
let latest,
  historyData,
  timer,
  busy = false,
  paused = false,
  hours = 1,
  historyFetched = 0;
function setLive(text, state) {
  $("live-state").textContent = text;
  $("live-state").dataset.state = state;
}
function metric(label, value, note) {
  const card = el("article", undefined, "status-metric");
  card.append(el("p", label), el("strong", value), el("small", note));
  return card;
}
function resource(title, value, entries) {
  const box = el("div", undefined, "memory-block");
  const heading = el("div", undefined, "resource-title");
  heading.append(el("span", title), el("strong", percent(value)));
  box.append(heading, bar(value, title), details(entries));
  return box;
}
function render(data) {
  latest = data;
  const { host, cpu, memory, swap } = data;
  $("host-summary").textContent =
    `${host.name} · ${host.os} · ${host.logical_cpus} 个逻辑核心 · ${bytes(memory.total)} 内存`;
  $("status-updated").textContent = `采样于 ${date(data.generated_at)}`;
  const root = data.filesystems.find((item) => item.mount === "/");
  const net = data.network.filter((n) => n.name !== "lo");
  const rx = net.every((n) => n.rx_rate !== null)
    ? net.reduce((s, n) => s + n.rx_rate, 0)
    : null;
  const tx = net.every((n) => n.tx_rate !== null)
    ? net.reduce((s, n) => s + n.tx_rate, 0)
    : null;
  replace("summary-metrics", [
    metric("整机 CPU", percent(cpu.percent), `${host.logical_cpus} 个逻辑核心`),
    metric(
      "内存占用",
      percent(memory.percent),
      `${bytes(memory.available)} 可用`,
    ),
    metric(
      "Swap",
      swap.total ? percent(swap.percent) : "未启用",
      `${bytes(swap.free)} 可用`,
    ),
    metric(
      "系统盘",
      root ? percent(root.percent) : "未提供",
      `${bytes(root?.free)} 可用`,
    ),
    metric("网络接收", speed(rx), "非回环接口合计"),
    metric("网络发送", speed(tx), "非回环接口合计"),
  ]);
  $("cpu-detail").textContent = host.frequency_mhz
    ? `${number(host.frequency_mhz)} MHz`
    : "当前频率未提供";
  replace(
    "cpu-cores",
    cpu.cores.map((core) => {
      const card = el("article", undefined, "core-card");
      const title = el("div", undefined, "core-title");
      title.append(
        el("span", `CPU ${core.index}`),
        el("strong", percent(core.percent)),
      );
      card.append(
        title,
        bar(core.percent, `CPU ${core.index}`),
        el(
          "small",
          `I/O 等待 ${percent(core.iowait)} · 资源等待 ${percent(core.steal)}`,
        ),
      );
      return card;
    }),
  );
  $("cpu-load").replaceWith(
    Object.assign(
      details(
        (cpu.load || []).map((n, i) => [
          `${[1, 5, 15][i]} 分钟负载`,
          number(n, 2),
        ]),
      ),
      { id: "cpu-load" },
    ),
  );
  replace("memory-detail", [
    resource("物理内存", memory.percent, [
      ["总内存", bytes(memory.total)],
      ["使用中（总量 − 可用）", bytes(memory.in_use)],
      ["可用", bytes(memory.available)],
      ["完全空闲", bytes(memory.free)],
      ["缓存", bytes(memory.cached)],
      ["缓冲区", bytes(memory.buffers)],
    ]),
    resource(
      swap.total ? "Swap 交换空间" : "Swap · 未启用",
      swap.total ? swap.percent : 0,
      [
        ["总空间", bytes(swap.total)],
        ["已使用", bytes(swap.used)],
        ["可用", bytes(swap.free)],
        ["换入 / 换出", `${speed(swap.in_rate)} / ${speed(swap.out_rate)}`],
      ],
    ),
  ]);
  replace(
    "filesystems",
    data.filesystems.map((fs) => {
      const card = el("article", undefined, "filesystem-card");
      card.append(
        el("h3", fs.mount),
        el(
          "p",
          `${{ local: "本机磁盘", memory: "内存文件系统", remote: "远程挂载" }[fs.kind]} · ${fs.device} · ${fs.filesystem}`,
        ),
      );
      if (fs.total !== undefined)
        card.append(
          bar(fs.percent, `${fs.mount} 空间使用率`),
          details([
            ["已用 / 总量", `${bytes(fs.used)} / ${bytes(fs.total)}`],
            ["可用", bytes(fs.free)],
            ["空间使用率", percent(fs.percent)],
            [
              "inode 使用率",
              fs.inode_percent === null ? "未提供" : percent(fs.inode_percent),
            ],
          ]),
        );
      else card.append(el("p", fs.note));
      return card;
    }),
  );
  rows(
    "disk-io",
    data.disk_io.map((item) => [
      item.name,
      speed(item.read_rate),
      speed(item.write_rate),
      `${number(item.read_iops)} / ${number(item.write_iops)}`,
      percent(item.busy_percent),
    ]),
    5,
  );
  replace(
    "network",
    data.network.map((n) => {
      const item = el("article", undefined, "network-item");
      const title = el("div", undefined, "network-title");
      title.append(
        el("strong", n.name),
        el(
          "span",
          `${n.is_up ? "已连接" : "未连接"}${n.name === "lo" ? " · 回环" : ""} · MTU ${n.mtu ?? "—"}`,
        ),
      );
      item.append(
        title,
        details([
          ["接收 / 发送", `${speed(n.rx_rate)} / ${speed(n.tx_rate)}`],
          [
            "累计接收 / 发送",
            `${bytes(n.bytes_recv)} / ${bytes(n.bytes_sent)}`,
          ],
          ["错误 / 丢包", `${n.errin + n.errout} / ${n.dropin + n.dropout}`],
          ["地址", n.addresses.join(" · ") || "未提供"],
        ]),
      );
      return item;
    }),
  );
  const names = {
    "nginx.service": "网站服务 Nginx",
    "ssh.service": "SSH 登录",
    "gaasd-analytics.service": "统计与状态接口",
    "gaasd-status-collector.service": "服务器状态采集",
    "gaasd-analytics-backup.timer": "每日统计备份",
    "certbot.timer": "HTTPS 证书续期",
  };
  replace(
    "services",
    data.services.length
      ? data.services.map((s) => {
          const row = el("div", undefined, "service-row");
          const label = el("div");
          label.append(
            el("span", names[s.Id] || s.Id),
            el("small", `${s.Id} · ${s.UnitFileState || "未知启动策略"}`),
          );
          const badge = el(
            "span",
            s.ActiveState === "active"
              ? s.SubState === "waiting"
                ? "已启用 · 等待执行"
                : "运行中"
              : `${s.ActiveState || "未知"} / ${s.SubState || "—"}`,
            "service-badge",
          );
          badge.dataset.ok = String(s.ActiveState === "active");
          row.append(label, badge);
          return row;
        })
      : [el("p", "服务状态未提供")],
  );
  $("service-updated").textContent = `检查于 ${clock(data.checked_at)}`;
  $("maintenance").replaceWith(
    Object.assign(
      details([
        [
          "HTTPS 证书",
          data.certificate.valid
            ? `有效 · 剩余 ${data.certificate.days_left} 天`
            : "校验未通过",
        ],
        ["证书到期", date(data.certificate.expires_at)],
        [
          "最近数据备份",
          data.backup ? date(data.backup.updated_at) : "未发现备份",
        ],
        [
          "备份文件",
          data.backup
            ? `${bytes(data.backup.bytes)} · ${data.backup.copies} 个日期副本`
            : "未提供",
        ],
      ]),
      { id: "maintenance" },
    ),
  );
  renderProcesses();
  const uptime = host.uptime_seconds;
  const temps = Object.entries(data.temperatures)
    .flatMap(([name, values]) =>
      values.map((t) => `${t.label || name}: ${number(t.current)} °C`),
    )
    .join(" · ");
  $("system-details").replaceWith(
    Object.assign(
      details([
        [
          "运行时间",
          `${Math.floor(uptime / 86400)} 天 ${Math.floor((uptime % 86400) / 3600)} 小时 ${Math.floor((uptime % 3600) / 60)} 分钟`,
        ],
        ["开机时间", date(host.boot_time)],
        ["内核 / 架构", `${host.kernel} · ${host.architecture}`],
        [
          "TCP 连接",
          data.tcp
            ? Object.entries(data.tcp.states)
                .map(([k, v]) => `${k}: ${v}`)
                .join(" · ")
            : "未提供",
        ],
        ["监听 TCP 端口", data.tcp?.listen_ports.join(" · ") || "未提供"],
        [
          "系统文件句柄",
          data.files
            ? `${number(data.files.open, 0)} / ${number(data.files.limit, 0)}`
            : "未提供",
        ],
        ["硬件温度", temps || "云服务器未提供"],
        [
          "进程状态",
          Object.entries(data.processes.states)
            .map(([k, v]) => `${k}: ${v}`)
            .join(" · "),
        ],
      ]),
      { id: "system-details", className: "detail-grid system-details" },
    ),
  );
  replace(
    "pressure",
    Object.entries(data.pressure).map(([key, p]) => {
      const item = el("div", undefined, "pressure-item");
      item.append(
        el(
          "strong",
          { cpu: "CPU 调度压力", memory: "内存压力", io: "I/O 压力" }[key],
        ),
        el(
          "p",
          p?.some
            ? `10 秒 / 60 秒 / 300 秒：${percent(p.some.avg10)} / ${percent(p.some.avg60)} / ${percent(p.some.avg300)}`
            : "当前系统未提供",
        ),
      );
      return item;
    }),
  );
  const alerts = [];
  if (memory.percent >= 85)
    alerts.push(
      `内存使用率 ${percent(memory.percent)}，可用 ${bytes(memory.available)}。`,
    );
  for (const fs of data.filesystems.filter((f) => f.kind === "local")) {
    if (fs.percent >= 85)
      alerts.push(`${fs.mount} 磁盘空间使用率 ${percent(fs.percent)}。`);
    if (fs.inode_percent >= 85)
      alerts.push(`${fs.mount} inode 使用率 ${percent(fs.inode_percent)}。`);
  }
  if (cpu.percent >= 90)
    alerts.push(`本次采样 CPU 占用 ${percent(cpu.percent)}。`);
  if (swap.total && swap.percent >= 85)
    alerts.push(`Swap 使用率 ${percent(swap.percent)}。`);
  for (const s of data.services)
    if (s.ActiveState !== "active")
      alerts.push(`${names[s.Id] || s.Id}：${s.ActiveState || "未知状态"}。`);
  if (!data.certificate.valid) alerts.push("服务器本机 HTTPS 证书校验未通过。");
  else if (data.certificate.days_left < 14)
    alerts.push(`HTTPS 证书将在 ${data.certificate.days_left} 天内到期。`);
  if (!data.backup || data.generated_at - data.backup.updated_at > 36 * 3600)
    alerts.push("最近 36 小时内未发现统计数据库备份。");
  replace(
    "alerts",
    alerts.map((text) => el("p", text)),
  );
  $("alerts").hidden = !alerts.length;
}
function rows(id, values, cols) {
  replace(
    id,
    values.length
      ? values.map((values) => {
          const row = el("tr");
          for (const value of values) row.append(el("td", value));
          return row;
        })
      : [Object.assign(el("tr"), {})],
  );
  if (!values.length) {
    const cell = el("td", "暂无可用数据");
    cell.colSpan = cols;
    $(id).firstChild.append(cell);
  }
}
function renderProcesses() {
  if (!latest) return;
  const list = [...latest.processes.top].sort((a, b) =>
    $("process-sort").value === "memory"
      ? b.rss - a.rss
      : (b.cpu_percent || 0) - (a.cpu_percent || 0),
  );
  rows(
    "processes",
    list.map((p) => [
      p.pid,
      p.name,
      p.state,
      percent(p.cpu_percent),
      bytes(p.rss),
    ]),
    5,
  );
  $("process-count").textContent =
    `共 ${latest.processes.total} 个进程 · 可读取资源信息 ${latest.processes.visible} 个`;
}
function svg(tag, attrs) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attrs))
    node.setAttribute(name, String(value));
  return node;
}
function renderHistory() {
  const end = Date.now() / 1000,
    start = end - hours * 3600;
  const points = (historyData?.points || []).filter(
    (p) => p.timestamp >= start && p.timestamp <= end,
  );
  $("history-note").textContent = points.length
    ? `每分钟采样均值 · ${points.length} 个点 · 更新于 ${date(points[points.length - 1].timestamp)}`
    : "正在积累采样，稍后出现趋势";
  replace(
    "history-charts",
    [
      ["CPU", ["cpu"], "绿色：CPU 占用率"],
      ["内存 / Swap", ["memory", "swap"], "绿色：内存 · 蓝色：Swap"],
      ["网络接收 / 发送", ["rx", "tx"], "绿色：接收 · 蓝色：发送"],
    ].map(([title, keys, keyText]) => {
      const card = el("div", undefined, "chart");
      card.append(el("h3", title), el("p", keyText, "chart-key"));
      if (!points.length) {
        card.append(el("div", "采样中…", "chart-empty"));
        return card;
      }
      const maximum =
        keys[0] === "rx"
          ? Math.max(1024, ...points.flatMap((p) => keys.map((k) => p[k])))
          : 100;
      const chart = svg("svg", {
        viewBox: "0 0 400 145",
        preserveAspectRatio: "none",
        role: "img",
        "aria-label": `${title}最近 ${hours} 小时趋势`,
      });
      for (const y of [5, 70, 140])
        chart.append(
          svg("line", {
            x1: 0,
            y1: y,
            x2: 400,
            y2: y,
            class: "chart-gridline",
          }),
        );
      keys.forEach((key, index) => {
        let segment = [];
        const draw = () => {
          if (segment.length)
            chart.append(
              svg("polyline", {
                points: segment.join(" "),
                class: `chart-series${index ? " secondary" : ""}`,
              }),
            );
        };
        points.forEach((p, i) => {
          if (i && p.timestamp - points[i - 1].timestamp > 180) {
            draw();
            segment = [];
          }
          const x = ((p.timestamp - start) / (end - start)) * 400,
            y = 140 - (p[key] / maximum) * 135;
          segment.push(`${x.toFixed(2)},${y.toFixed(2)}`);
          if (i === points.length - 1)
            chart.append(
              svg("circle", {
                cx: x,
                cy: y,
                r: 2,
                fill: index ? "#8bb9dd" : "#c9f34a",
              }),
            );
        });
        draw();
      });
      const labels = el("div", undefined, "chart-labels");
      labels.append(
        el("span", clock(start)),
        el("span", keys[0] === "rx" ? `上限 ${speed(maximum)}` : "0–100%"),
        el("span", clock(end)),
      );
      card.append(chart, labels);
      return card;
    }),
  );
}
function schedule() {
  clearTimeout(timer);
  if (!paused && !document.hidden)
    timer = setTimeout(refresh, Number($("interval").value) * 1000);
}
async function refresh() {
  if (busy) return;
  busy = true;
  clearTimeout(timer);
  $("refresh-status").disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("/status/api/snapshot", {
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (response.status === 401)
      throw new Error("登录已失效，请重新打开状态页登录。");
    if (!response.ok) throw new Error("采集暂未就绪，请稍后重试。");
    const data = await response.json();
    render(data);
    $("status-error").hidden = !data.stale;
    if (data.stale) {
      $("status-error").textContent =
        `数据已 ${number(data.age_seconds, 0)} 秒未更新，以下为最后一次采样；请检查采集服务。`;
      setLive("采样已过期", "error");
    } else setLive(paused ? "已暂停" : "实时更新", paused ? "paused" : "live");
    if (Date.now() - historyFetched > 60000) {
      const report = await fetch("/status/api/history", {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      });
      if (report.ok) {
        historyData = await report.json();
        historyFetched = Date.now();
      }
    }
    renderHistory();
  } catch (error) {
    setLive("连接异常", "error");
    $("status-error").hidden = false;
    $("status-error").textContent =
      `${error.name === "AbortError" ? "请求超时。" : error.message} ${latest ? "保留最后一次采样，恢复连接后继续更新。" : "尚未取得服务器数据。"}`;
  } finally {
    clearTimeout(timeout);
    busy = false;
    $("refresh-status").disabled = false;
    schedule();
  }
}
$("refresh-status").addEventListener("click", refresh);
$("interval").addEventListener("change", schedule);
$("process-sort").addEventListener("change", renderProcesses);
$("pause").addEventListener("click", () => {
  paused = !paused;
  $("pause").textContent = paused ? "继续刷新" : "暂停刷新";
  $("pause").setAttribute("aria-pressed", String(paused));
  if (paused) {
    clearTimeout(timer);
    setLive("已暂停", "paused");
  } else refresh();
});
document.addEventListener("visibilitychange", () => {
  clearTimeout(timer);
  if (!document.hidden && !paused) refresh();
});
document.querySelectorAll("[data-hours]").forEach((button) =>
  button.addEventListener("click", () => {
    hours = Number(button.dataset.hours);
    document
      .querySelectorAll("[data-hours]")
      .forEach((item) =>
        item.setAttribute("aria-pressed", String(item === button)),
      );
    renderHistory();
  }),
);
renderHistory();
refresh();
