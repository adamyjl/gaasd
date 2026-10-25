const $ = (id) => document.getElementById(id);
let currentData;
const format = (n, digits = 1) =>
  Number(n).toLocaleString("zh-CN", { maximumFractionDigits: digits });
const date = (stamp) =>
  stamp
    ? new Date(stamp * 1000).toLocaleString("zh-CN", {
        timeZone: "Asia/Shanghai",
        hour12: false,
      })
    : "暂无";
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function bars(target, rows, unit, detail) {
  const container = $(target);
  container.replaceChildren();
  const known = rows
    .filter((r) => Number.isFinite(r.value))
    .sort((a, b) => b.value - a.value);
  const max = Math.max(1, ...known.map((r) => r.value));
  for (const row of known) {
    const group = el("div", undefined, "bar-row");
    const label = el("div", undefined, "bar-label");
    label.append(
      el("span", row.name),
      el("strong", `${format(row.value)} ${unit}`),
    );
    const meter = document.createElement("meter");
    meter.min = 0;
    meter.max = max;
    meter.value = row.value;
    meter.setAttribute(
      "aria-label",
      `${row.name} ${format(row.value)} ${unit}`,
    );
    group.append(label, meter, el("span", detail(row), "bar-detail"));
    container.append(group);
  }
  const missing = rows.filter((r) => !Number.isFinite(r.value));
  if (missing.length)
    container.append(
      el(
        "p",
        `未测 / 无数据：${missing.map((r) => r.name).join("、")}`,
        "missing",
      ),
    );
}
function renderTasks(data) {
  const report = data.report;
  $("tasks").replaceChildren();
  $("report-meta").textContent = report
    ? `分析时间 ${date(report.generated_at)} · ${report.model} · ${$("history").value ? "正在查看历史记录" : `计划下次 ${date(report.next_run_at)}`}`
    : "定时服务尚未生成首轮分析。";
  const warnings = [];
  if (!report) warnings.push("尚无分析结果，硬件对比仍可查看。");
  if (data.report_stale && !$("history").value)
    warnings.push("最新分析已过期，请勿当作当前任务状态。");
  if (report?.error) warnings.push(report.error);
  $("notice").hidden = !warnings.length;
  $("notice").textContent = warnings.join(" ");
  for (const id of ["intranet", "rtx4090", "rtx5090"]) {
    const host = data.hosts.find((h) => h.id === id);
    const row = report?.hosts.find((h) => h.id === id);
    const card = el("article", undefined, "task-card");
    const stale = !row?.collection_ok;
    card.append(
      el(
        "span",
        stale ? "采集失败 / 历史证据" : "本轮采集成功",
        `state${stale ? " stale" : ""}`,
      ),
      el("h3", host?.name || id),
      el(
        "p",
        `证据 ${date(row?.evidence?.sampled_at)} · 分析 ${date(row?.analysis_at)}`,
        "task-time",
      ),
    );
    for (const [title, key] of [
      ["正在运行的任务", "tasks"],
      ["显卡分配", "gpu_mapping"],
      ["判断与可用资源", "assessment"],
    ])
      card.append(
        el("h4", title),
        el("p", row?.analysis?.[key] || "尚无可用分析；请等待下一轮采集。"),
      );
    if (stale && row?.error) card.append(el("p", row.error, "notice"));
    if (row?.evidence) {
      const details = el("details");
      details.append(
        el(
          "summary",
          `查看采样证据 · ${row.evidence.processes?.length || 0} 个进程`,
        ),
      );
      const evidence = {
        采样窗口秒: row.evidence.window_seconds,
        GPU: row.evidence.devices,
        进程: row.evidence.processes,
      };
      details.append(el("pre", JSON.stringify(evidence, null, 2)));
      card.append(details);
    }
    $("tasks").append(card);
  }
}
function renderGpu(data) {
  const total = $("gpu-scope").value === "total";
  $("flops-title").textContent = total
    ? "整机 FP32 理论峰值合计"
    : "单卡 FP32 理论峰值";
  $("vram-title").textContent = total ? "整机标称显存合计" : "单卡标称显存";
  const hosts = data.hosts.filter((h) => h.gpu_count > 0);
  const rows = (key) =>
    hosts.map((h) => ({
      ...h,
      value: h.gpu ? h.gpu[key] * (total ? h.gpu_count : 1) : null,
    }));
  const detail = (r) =>
    `${r.gpu_count} × ${r.gpu?.label || "未知"}${r.stale ? " · 硬件为离线缓存" : ""}`;
  bars("gpu-flops", rows("fp32"), "TFLOPS", detail);
  bars("gpu-vram", rows("vram"), "GB", detail);
}
function render(data) {
  currentData = data;
  renderTasks(data);
  const selected = $("history").value;
  $("history").replaceChildren(new window.Option("最新一轮", ""));
  for (const id of data.history)
    $("history").append(new window.Option(date(Number(id)), id));
  $("history").value = selected;
  bars(
    "cpu-speed",
    data.hosts.map((h) => ({ ...h, value: h.benchmark?.sha256_mib_s ?? null })),
    "MiB/s",
    (h) => `${h.cpu_model} · ${date(h.benchmark?.sampled_at)}`,
  );
  bars(
    "cpu-cores",
    data.hosts.map((h) => ({ ...h, value: h.logical_cpus ?? null })),
    "线程",
    (h) =>
      `${h.cpu_model} · ${h.id === "cloud" ? "虚拟机获配资源" : `${h.physical_cpus ?? "未知"} 物理核心`}`,
  );
  renderGpu(data);
  $("inventory").replaceChildren();
  for (const h of data.hosts) {
    const node = el("article", undefined, "machine");
    const link = el("a", h.name, "machine-title");
    link.href = h.href;
    node.append(
      link,
      el("p", h.cpu_model),
      el(
        "p",
        `${h.logical_cpus ?? "?"} 线程 · 内存 ${format(h.ram_gib)} GiB · ${h.gpu_count ? `${h.gpu_count} × ${h.gpu?.label || "GPU"}` : "无独立 GPU"}`,
      ),
      el("p", `${h.stale ? "离线 / 缓存" : "在线"} · ${date(h.sampled_at)}`),
    );
    if (h.benchmark)
      node.append(el("p", `CPU 微基准环境：${h.benchmark.runtime}`));
    $("inventory").append(node);
  }
  const b = data.billing,
    a = b.actual;
  const inp = b.assumed_input_per_call * b.calls_per_30_days,
    out = b.assumed_output_per_call * b.calls_per_30_days;
  const expected =
    (inp * b.input_cny_per_million + out * b.output_cny_per_million) / 1e6;
  $("cost").replaceChildren(el("p", `${b.model} · 关闭深度思考，限制输出长度`));
  const value = el("div", `¥ ${format(expected, 2)}`, "cost-value");
  value.append(el("small", " / 30 天预算示例"));
  $("cost").append(value);
  $("cost").append(
    el(
      "p",
      `48 次/天 × 30 天 = 1,440 次。假设每轮输入 ${format(b.assumed_input_per_call, 0)}、输出 ${format(b.assumed_output_per_call, 0)} tokens：每月输入 ${format(inp / 1e6, 2)}M + 输出 ${format(out / 1e6, 2)}M。`,
    ),
  );
  const grid = el("div", undefined, "cost-grid");
  for (const [label, text] of [
    [`${b.month} 已记录调用`, `${a.calls} 次`],
    ["本月 token", `${format(a.input_tokens + a.output_tokens, 0)}`],
    ["本月原价估算", `¥ ${format(a.estimated_cny, 4)}`],
    [
      "按当前平均用量推算 30 天",
      a.calls
        ? `¥ ${format((a.estimated_cny / a.calls) * 1440, 2)}`
        : "等待首轮",
    ],
  ]) {
    const cell = el("div", text);
    cell.append(el("span", label));
    grid.append(cell);
  }
  $("cost").append(
    grid,
    el(
      "p",
      `单价：输入 ¥${b.input_cny_per_million}/百万，输出 ¥${b.output_cny_per_million}/百万。${b.note}`,
    ),
  );
  const source = el("a", `阿里云官方价格 · 核对于 ${b.checked_on}`);
  source.href = b.source;
  source.target = "_blank";
  source.rel = "noopener noreferrer";
  $("cost").append(source);
  $("sources").replaceChildren();
  for (const h of data.hosts.filter((h) => h.gpu)) {
    const p = el("p");
    const a = el("a", h.gpu.label);
    a.href = h.gpu.source;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    p.append(a, el("span", ` — ${h.gpu.note}`));
    $("sources").append(p);
  }
}
async function load() {
  $("refresh").disabled = true;
  try {
    const id = $("history").value;
    const response = await fetch(
      `/analysis/api/report${id ? `?id=${encodeURIComponent(id)}` : ""}`,
      { cache: "no-store" },
    );
    if (!response.ok) throw new Error(`读取失败（HTTP ${response.status}）`);
    render(await response.json());
  } catch (error) {
    $("notice").hidden = false;
    $("notice").textContent = `${error.message}，保留当前画面。`;
  } finally {
    $("refresh").disabled = false;
  }
}
const view = location.pathname.endsWith("/cpu")
  ? "cpu"
  : location.pathname.endsWith("/gpu")
    ? "gpu"
    : "all";
document
  .querySelector(`[data-view="${view}"]`)
  .setAttribute("aria-current", "page");
$("cpu-section").hidden = view === "gpu";
$("gpu-section").hidden = view === "cpu";
$("refresh").addEventListener("click", load);
$("history").addEventListener("change", load);
$("gpu-scope").addEventListener(
  "change",
  () => currentData && renderGpu(currentData),
);
async function poll() {
  if (!document.hidden && !$("history").value) await load();
  window.setTimeout(poll, 60000);
}
load();
window.setTimeout(poll, 60000);
