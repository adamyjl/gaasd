// This panel only reads the authenticated, cloud-local aggregate database.
const $ = (id) => document.getElementById(id);
const number = (value, digits = 1) =>
  Number.isFinite(value)
    ? value.toLocaleString("zh-CN", { maximumFractionDigits: digits })
    : "—";
const pct = (value) => (Number.isFinite(value) ? `${number(value)}%` : "—");
const gib = (value) =>
  Number.isFinite(value) ? `${number(value / 1024 ** 3)} GiB` : "—";
const dateTime = (value) =>
  new Date(value * 1000).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
function el(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function metric(label, value, note) {
  const node = el("article", undefined, "status-metric");
  node.append(el("p", label), el("strong", value), el("small", note));
  return node;
}

export function gpuUsagePanel() {
  let active = false,
    fetched = 0,
    version = 0,
    controller;
  function render(data) {
    const summary = data.summary;
    $("gpu-usage-summary").replaceChildren(
      metric(
        "计算利用率 · 均值",
        pct(summary.avg_compute),
        "8 卡均值，按有效采样加权",
      ),
      metric(
        "计算利用率 · 峰值",
        pct(summary.peak_compute),
        "已采样的整机最高值",
      ),
      metric(
        "显存占用 · 均值",
        gib(summary.avg_memory_used_bytes),
        `合计占用率 ${pct(summary.avg_memory_percent)}`,
      ),
      metric(
        "显存占用 · 峰值",
        gib(summary.peak_memory_used_bytes),
        "8 卡合计已采样最高值",
      ),
    );
    const first = data.periods[0].label;
    const last = new Date((summary.end - 1) * 1000).toLocaleDateString(
      "sv-SE",
      { timeZone: "Asia/Shanghai" },
    );
    $("gpu-usage-coverage").textContent =
      `${first} — ${last}${summary.ongoing ? "（含本期，截至当前采样）" : ""} · 采样覆盖率 ${pct(summary.coverage_percent)} · ${number(summary.sample_count, 0)} / ${number(summary.expected_count, 0)} 个预期采样点`;
    $("gpu-usage-caption").textContent =
      data.group === "week"
        ? "每周统计 · 周一开始 · 最新在前"
        : "每日统计 · 最新在前";
    $("gpu-usage-rows").replaceChildren(
      ...[...data.periods].reverse().map((row) => {
        const node = el("tr");
        for (const value of [
          row.label + (row.ongoing ? " · 本期" : ""),
          pct(row.avg_compute),
          pct(row.peak_compute),
          gib(row.avg_memory_used_bytes),
          gib(row.peak_memory_used_bytes),
          `${pct(row.coverage_percent)} · ${number(row.sample_count, 0)} 点`,
        ])
          node.append(el("td", value));
        if (!row.sample_count) node.cells[1].textContent = "无数据";
        return node;
      }),
    );
    $("gpu-usage-chart").replaceChildren(
      ...data.periods.map((row) => {
        const column = el("div", undefined, "usage-column");
        const bars = el("div", undefined, "usage-bars");
        if (!row.sample_count) bars.append(el("small", "无数据"));
        else
          for (const [kind, value] of [
            ["compute", row.avg_compute],
            ["memory", row.avg_memory_percent],
          ]) {
            const fill = el("span", undefined, `usage-bar usage-${kind}`);
            fill.style.height = `${Math.min(100, Math.max(0, value))}%`;
            fill.title = `${row.label} ${kind === "compute" ? "计算" : "显存"}均值 ${pct(value)}`;
            bars.append(fill);
          }
        column.append(
          bars,
          el("span", row.label.slice(5)),
          el("small", row.ongoing ? "本期" : row.label.slice(0, 4)),
        );
        return column;
      }),
    );
    $("gpu-usage-recording").textContent = data.ready
      ? `当前保留的最早采样：${dateTime(data.first_sample_at)} · 最近采样：${dateTime(data.last_sample_at)}。更早未采集的历史无法追溯。`
      : "统计从部署后的首次完整 8 卡采样开始积累，更早未采集的历史无法追溯。";
    $("gpu-usage-message").hidden =
      data.ready && !data.stale && summary.sample_count > 0;
    $("gpu-usage-message").textContent = !data.ready
      ? "尚未积累完整的 8 卡采样，首次成功采集后自动显示。"
      : data.stale
        ? "GPU 统计采样已超过 90 秒未更新；以下为已保存的历史，请检查采集服务。"
        : "所选时间范围暂无有效采样，请选择其他日期。";
    $("gpu-usage-results").hidden = false;
    const chart = $("gpu-usage-chart").parentElement;
    chart.scrollLeft = chart.scrollWidth;
  }
  async function load(force = false) {
    if (!active || (!force && Date.now() - fetched < 60000)) return;
    fetched = Date.now();
    const current = ++version;
    controller?.abort();
    const pending = new AbortController();
    controller = pending;
    const timeout = setTimeout(() => pending.abort(), 10000);
    $("gpu-usage-query").disabled = true;
    $("gpu-usage-results").hidden = true;
    $("gpu-usage-message").hidden = false;
    $("gpu-usage-message").textContent = "正在读取统计…";
    const query = new URLSearchParams({
      group: $("gpu-usage-group").value,
      count: $("gpu-usage-count").value,
    });
    if ($("gpu-usage-through").value)
      query.set("through", $("gpu-usage-through").value);
    $("gpu-usage-through").max = new Date().toLocaleDateString("sv-SE", {
      timeZone: "Asia/Shanghai",
    });
    try {
      const response = await fetch(`/status/api/gpu-usage?${query}`, {
        credentials: "same-origin",
        cache: "no-store",
        signal: pending.signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "登录已失效，请重新登录状态页。"
            : response.status === 400
              ? "日期或范围无效，请检查后重新查询。"
              : "GPU 使用统计暂时无法读取，请稍后重试。",
        );
      const data = await response.json();
      if (current === version && active) render(data);
    } catch (error) {
      if (current === version && active)
        $("gpu-usage-message").textContent =
          error.name === "AbortError"
            ? "统计请求超时，请重试。"
            : error.message;
    } finally {
      clearTimeout(timeout);
      if (current === version) $("gpu-usage-query").disabled = false;
    }
  }
  $("gpu-usage-group").addEventListener("change", () => {
    const week = $("gpu-usage-group").value === "week";
    $("gpu-usage-count").replaceChildren(
      ...(week ? [4, 12, 26] : [14, 30, 90]).map((n) => {
        const option = el("option", `最近 ${n} ${week ? "周" : "天"}`);
        option.value = n;
        return option;
      }),
    );
    $("gpu-usage-count").value = week ? "12" : "14";
    load(true);
  });
  for (const id of ["gpu-usage-count", "gpu-usage-through"])
    $(id).addEventListener("change", () => load(true));
  $("gpu-usage-form").addEventListener("submit", (event) => {
    event.preventDefault();
    load(true);
  });
  return {
    update(server) {
      active = server === "intranet";
      $("gpu-usage-panel").hidden = !active;
      if (active) load();
    },
    reset() {
      active = false;
      ++version;
      controller?.abort();
      fetched = 0;
      $("gpu-usage-panel").hidden = true;
      $("gpu-usage-results").hidden = true;
      $("gpu-usage-query").disabled = false;
    },
  };
}
