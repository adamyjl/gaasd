const $ = (id) => document.getElementById(id);
const n = (value, digits = 1) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
const pct = (value) => (Number.isFinite(value) ? `${n(value)}%` : "未提供");
const date = (stamp) =>
  stamp
    ? new Date(stamp * 1000).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "尚无采样";
function bytes(value) {
  if (!Number.isFinite(value)) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  while (value >= 1024 && i < 4) {
    value /= 1024;
    i++;
  }
  return `${n(value)} ${units[i]}`;
}
const speed = (value) =>
  Number.isFinite(value) ? `${bytes(value)}/s` : "未提供";
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function sum(items, field) {
  return items.length && items.every((item) => Number.isFinite(item[field]))
    ? items.reduce((s, item) => s + item[field], 0)
    : null;
}
// Count mounted local volumes once per host, not once per mount point.
function diskSummary(hosts) {
  const volumes = [];
  let covered = 0,
    missing = 0;
  for (const host of hosts) {
    const seen = new Set();
    const before = volumes.length;
    for (const disk of host.filesystems || []) {
      if (
        disk.kind !== "local" ||
        /^(overlay|aufs|squashfs|tmpfs|devtmpfs|ramfs|fuse\.)/.test(
          disk.filesystem || "",
        ) ||
        /^\/dev\/(loop|ram|zram)\d/.test(disk.device || "")
      )
        continue;
      const device = disk.device || disk.mount;
      const key = /^[a-z]:[\\/]?$/i.test(device || "")
        ? device.slice(0, 2).toUpperCase()
        : device;
      if (!key || seen.has(key)) continue;
      seen.add(key);
      if (
        !Number.isFinite(disk.total) ||
        disk.total <= 0 ||
        ![disk.used, disk.free].every(
          (value) =>
            Number.isFinite(value) && value >= 0 && value <= disk.total,
        )
      ) {
        missing++;
        continue;
      }
      volumes.push(disk);
    }
    if (volumes.length > before) covered++;
  }
  const total = sum(volumes, "total"),
    used = sum(volumes, "used");
  return {
    total,
    used,
    free: sum(volumes, "free"),
    percent: total > 0 && used !== null ? (100 * used) / total : null,
    count: volumes.length,
    covered,
    missing,
  };
}
function meter(label, percent, note) {
  const box = el("div", undefined, "fleet-meter");
  const title = el("div", undefined, "resource-title");
  title.append(el("span", label), el("strong", pct(percent)));
  const track = el("div", undefined, "usage-track");
  track.dataset.high = String(percent >= 85);
  const fill = el("span");
  fill.style.width = `${Math.min(100, Math.max(0, percent || 0))}%`;
  track.append(fill);
  box.append(title, track, el("small", note));
  return box;
}
function card(data) {
  const card = el("article", undefined, "panel fleet-card");
  card.dataset.host = data.server.id;
  card.dataset.stale = String(data.stale);
  const title = el("div", undefined, "card-title");
  const name = el("div");
  name.append(el("h3", data.server.name), el("p", data.server.address));
  const badge = el(
    "span",
    data.unavailable ? "未就绪" : data.stale ? "过期 / 断连" : "在线",
    "state-pill",
  );
  badge.dataset.state = data.stale ? "error" : "live";
  title.append(name, badge);
  card.append(title);
  const footer = el("div", undefined, "card-footer");
  const link = el("a", "查看详情 ↗");
  link.href = data.server.href;
  footer.append(link, el("small", date(data.generated_at)));
  if (data.unavailable) {
    card.append(el("p", data.message, "fleet-spec"), footer);
    return card;
  }
  const host = data.host || {},
    cpu = data.cpu || {},
    memory = data.memory || {},
    gpu = data.gpu || {};
  const devices = gpu.devices || [];
  const gpuComplete =
    gpu.available && devices.length === data.server.expected_gpus;
  const gpuUse = gpuComplete ? sum(devices, "utilization_percent") : null;
  const gpuMemory = gpuComplete ? sum(devices, "memory_used") : null;
  const gpuTotal = gpuComplete ? sum(devices, "memory_total") : null;
  const spec = el("div", undefined, "fleet-spec");
  spec.append(
    el(
      "p",
      data.hardware?.cpu_model || `${host.logical_cpus ?? "—"} 个逻辑核心`,
    ),
    el(
      "p",
      `${host.logical_cpus ?? "—"} 线程 · ${bytes(memory.total)} 内存 · ${host.os || "—"}`,
    ),
  );
  if (devices.length)
    spec.append(el("p", `${devices.length} × ${devices[0].name}`));
  card.append(
    spec,
    meter("CPU", cpu.percent, `${data.processes?.total ?? "—"} 个进程`),
    meter(
      "内存",
      memory.percent,
      `${bytes(memory.in_use)} / ${bytes(memory.total)}`,
    ),
  );
  if (data.server.expected_gpus) {
    card.append(
      meter(
        "GPU 计算",
        gpuUse === null ? null : gpuUse / devices.length,
        `${devices.length} / ${data.server.expected_gpus} 张卡 · 当前驱动采样值`,
      ),
      meter(
        "GPU 显存",
        gpuTotal > 0 && gpuMemory !== null
          ? (100 * gpuMemory) / gpuTotal
          : null,
        `${bytes(gpuMemory)} / ${bytes(gpuTotal)}`,
      ),
    );
  }
  const fs = (data.filesystems || []).filter(
    (disk) => disk.kind === "local" && Number.isFinite(disk.percent),
  );
  const mostUsed = [...fs].sort((a, b) => b.percent - a.percent)[0];
  const net = (data.network || []).filter((nic) => nic.name !== "lo");
  const ping = data.latency;
  const pingFresh =
    ping && Date.now() / 1000 - ping.checked_at <= 90 && !data.stale;
  const temps = devices.map((g) => g.temperature_c).filter(Number.isFinite);
  const grid = el("dl", undefined, "detail-grid");
  const metrics = [
    [
      "相对腾讯云 ping",
      data.server.id === "cloud"
        ? "本机基准"
        : pingFresh && Number.isFinite(ping.rtt_ms)
          ? `${n(ping.rtt_ms)} ms`
          : "未响应 / 未提供",
    ],
    [
      "隧道采集响应",
      !data.stale && Number.isFinite(ping?.collection_ms)
        ? `${n(ping.collection_ms)} ms`
        : "—",
    ],
    [
      "最高磁盘占用",
      mostUsed ? `${mostUsed.mount} · ${pct(mostUsed.percent)}` : "未提供",
    ],
    ["该卷可用空间", mostUsed ? bytes(mostUsed.free) : "—"],
    [
      "网络收 / 发",
      `${speed(sum(net, "rx_rate"))} / ${speed(sum(net, "tx_rate"))}`,
    ],
    ["GPU 最高温度", temps.length ? `${n(Math.max(...temps))} °C` : "未提供"],
  ];
  for (const [label, value] of metrics) {
    const item = el("div");
    item.append(el("dt", label), el("dd", value));
    grid.append(item);
  }
  card.append(
    grid,
    el(
      "p",
      data.server.id === "intranet"
        ? "ping 方向：腾讯云 → A100（VPN）"
        : data.server.id === "cloud"
          ? "腾讯云为采集与连接基准"
          : "ping 方向：此机器 → 腾讯云公网；采集耗时含 SSH 握手与采样",
      "fleet-latency-note",
    ),
  );
  const processes = el("div", undefined, "fleet-process");
  processes.append(
    el(
      "p",
      `CPU 占用靠前的软件 · ${data.processes?.visible ?? "—"} 个可读取进程`,
    ),
  );
  for (const p of [...(data.processes?.top || [])]
    .sort((a, b) => (b.cpu_percent || 0) - (a.cpu_percent || 0))
    .slice(0, 3))
    processes.append(
      el(
        "p",
        `${p.name} #${p.pid} · CPU ${pct(p.cpu_percent)} · ${bytes(p.rss)}`,
      ),
    );
  card.append(processes, footer);
  return card;
}
function render(data) {
  const hostCount = data.hosts.length;
  const expectedGpus = data.hosts.reduce(
    (sum, host) => sum + host.server.expected_gpus,
    0,
  );
  const online = data.hosts.filter((host) => !host.stale && !host.unavailable);
  const available = data.hosts.filter((host) => !host.unavailable);
  const cached = available.filter((host) => host.stale);
  const memory = available.map((host) => host.memory).filter(Boolean);
  const cores = available.reduce(
    (s, host) => s + (host.host?.logical_cpus || 0),
    0,
  );
  const knownCpu = available.filter(
    (host) => Number.isFinite(host.cpu?.percent) && host.host?.logical_cpus > 0,
  );
  const coreCount = knownCpu.reduce((s, host) => s + host.host.logical_cpus, 0);
  const cpu = coreCount
    ? knownCpu.reduce(
        (s, host) => s + host.cpu.percent * host.host.logical_cpus,
        0,
      ) / coreCount
    : null;
  const devices = available.flatMap((host) => host.gpu?.devices || []);
  const disk = diskSummary(available);
  const memTotal = sum(memory, "total"),
    memUsed = sum(memory, "in_use");
  const summary = [
    [
      "在线主机",
      `${online.length} / ${hostCount}`,
      "超过 90 秒或连接失败标为过期",
    ],
    ["逻辑 CPU", available.length ? n(cores, 0) : "—", "按最近成功采样合计"],
    ["CPU 整体占用", pct(cpu), "按采样逻辑核心数加权"],
    ["物理内存已用", bytes(memUsed), `采样容量 ${bytes(memTotal)}`],
    [
      "检测到 GPU",
      `${devices.length} / ${expectedGpus}`,
      "按已登记主机配置核对",
    ],
    [
      "GPU 显存已用",
      bytes(sum(devices, "memory_used")),
      `采样容量 ${bytes(sum(devices, "memory_total"))}`,
    ],
    [
      "硬盘总容量",
      bytes(disk.total),
      `${disk.covered} / ${hostCount} 台 · ${disk.count} 个本地卷（去重）${disk.missing ? ` · ${disk.missing} 卷数据缺失` : ""}`,
    ],
    ["硬盘已用空间", bytes(disk.used), `总使用率 ${pct(disk.percent)}`],
    ["硬盘可用空间", bytes(disk.free), "文件系统可用量，不含预留空间"],
  ];
  $("fleet-summary").replaceChildren(
    ...summary.map(([label, value, note]) => {
      const node = el("article", undefined, "status-metric");
      node.append(el("p", label), el("strong", value), el("small", note));
      return node;
    }),
  );
  $("summary-note").dataset.cached = String(cached.length > 0);
  $("summary-note").textContent = [
    `资源汇总采用 ${available.length} / ${hostCount} 台主机最近一次成功采样。`,
    cached.length
      ? `含 ${cached.length} 台离线 / 过期缓存：${cached.map((host) => `${host.server.name}（${date(host.generated_at)}）`).join("；")}。缓存使用量不代表当前实时状态。`
      : "所有已采样主机当前在线。",
    available.length < hostCount
      ? `${hostCount - available.length} 台尚无采样，未计入资源汇总。`
      : "",
  ].join(" ");
  for (const [id, group] of [
    ["gpu-hosts", "GPU 服务器"],
    ["dev-hosts", "开发机器"],
    ["relay-hosts", "中转机器"],
  ]) {
    $(id).replaceChildren(
      ...data.hosts.filter((host) => host.server.group === group).map(card),
    );
  }
  $("updated").textContent = `汇总于 ${date(data.generated_at)}`;
  $("live-state").textContent = paused
    ? "已暂停"
    : online.length === hostCount
      ? "全部在线"
      : `${hostCount - online.length} 台需关注`;
  $("live-state").dataset.state = paused
    ? "paused"
    : online.length === hostCount
      ? "live"
      : "error";
}
let paused = false,
  busy = false,
  timer;
function schedule() {
  clearTimeout(timer);
  if (!paused && !document.hidden)
    timer = setTimeout(refresh, Number($("interval").value) * 1000);
}
async function refresh() {
  if (busy) return;
  busy = true;
  clearTimeout(timer);
  $("refresh").disabled = true;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch("/status1/api/overview", {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "登录已失效，请重新打开页面登录。"
          : "暂时无法读取状态。",
      );
    render(await response.json());
    $("error").hidden = true;
  } catch (error) {
    $("error").hidden = false;
    $("error").textContent =
      `${error.name === "AbortError" ? "请求超时。" : error.message} 以下内容可能已过期，恢复连接后更新。`;
    $("live-state").textContent = "连接异常";
    $("live-state").dataset.state = "error";
  } finally {
    clearTimeout(timeout);
    busy = false;
    $("refresh").disabled = false;
    schedule();
  }
}
$("refresh").addEventListener("click", refresh);
$("interval").addEventListener("change", schedule);
$("pause").addEventListener("click", () => {
  paused = !paused;
  $("pause").textContent = paused ? "继续刷新" : "暂停刷新";
  $("pause").setAttribute("aria-pressed", String(paused));
  if (paused) {
    clearTimeout(timer);
    $("live-state").textContent = "已暂停";
  } else refresh();
});
document.addEventListener("visibilitychange", () => {
  clearTimeout(timer);
  if (!document.hidden && !paused) refresh();
});
refresh();
