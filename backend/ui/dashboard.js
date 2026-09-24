const form = document.querySelector("#filters");
const message = document.querySelector("#message");
const formatNumber = new Intl.NumberFormat("zh-CN");
const videoNames = new Map();
let page = 1;
let requestSequence = 0;
let currentRequest;

function node(tag, text = "", className = "") {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}
function text(id, value) {
  document.getElementById(id).textContent = value;
}
function duration(ms) {
  const seconds = Math.floor((ms || 0) / 1000);
  if (seconds >= 3600)
    return `${Math.floor(seconds / 3600)}时 ${Math.floor((seconds % 3600) / 60)}分`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}分 ${seconds % 60}秒`;
  return `${seconds}秒`;
}
function timestamp(value) {
  return new Date(value * 1000).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });
}
function dateString(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}
function setRange(days) {
  const today = new Date();
  form.elements.from.value = dateString(
    new Date(today.getTime() - (days - 1) * 86400000),
  );
  form.elements.to.value = dateString(today);
  for (const button of document.querySelectorAll("[data-days]"))
    button.setAttribute(
      "aria-pressed",
      String(Number(button.dataset.days) === days),
    );
}
function parameters() {
  const params = new URLSearchParams(new FormData(form));
  params.set("page", String(page));
  return params;
}
function ranks(id, items) {
  const container = document.getElementById(id);
  container.replaceChildren();
  if (!items.length) {
    container.append(node("p", "所选范围暂无访问记录", "empty"));
    return;
  }
  const max = Math.max(...items.map((item) => item.count), 1);
  for (const item of items) {
    const row = node("div", "", "rank-item");
    const bar = document.createElement("progress");
    bar.max = max;
    bar.value = item.count;
    bar.setAttribute("aria-label", `${item.name}：${item.count} 次访问`);
    row.append(
      node("span", item.name),
      node("strong", formatNumber.format(item.count)),
      bar,
    );
    container.append(row);
  }
}
function trend(items) {
  const container = document.getElementById("trend");
  container.replaceChildren();
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 600 190");
  svg.setAttribute("preserveAspectRatio", "none");
  svg.setAttribute("aria-hidden", "true");
  const maximum = Math.max(1, ...items.map((item) => item.page_views));
  for (const y of [20, 90, 160]) {
    const line = document.createElementNS(svg.namespaceURI, "line");
    line.setAttribute("x1", "0");
    line.setAttribute("x2", "600");
    line.setAttribute("y1", String(y));
    line.setAttribute("y2", String(y));
    line.setAttribute("class", "chart-grid");
    svg.append(line);
  }
  const step = 600 / Math.max(1, items.length);
  for (const [index, item] of items.entries()) {
    const bar = document.createElementNS(svg.namespaceURI, "rect");
    const height = item.page_views
      ? Math.max(2, (item.page_views / maximum) * 135)
      : 1;
    bar.setAttribute("x", String(index * step + step * 0.15));
    bar.setAttribute("y", String(160 - height));
    bar.setAttribute("width", String(step * 0.7));
    bar.setAttribute("height", String(height));
    bar.setAttribute("class", "chart-bar");
    const label = document.createElementNS(svg.namespaceURI, "title");
    label.textContent = `${item.day}：${item.page_views} 次访问，${item.ips} 个 IP`;
    bar.append(label);
    svg.append(bar);
    if (items.length <= 31) {
      const value = document.createElementNS(svg.namespaceURI, "text");
      value.setAttribute("x", String(index * step + step * 0.5));
      value.setAttribute("y", String(153 - height));
      value.setAttribute("text-anchor", "middle");
      value.setAttribute("class", "chart-label");
      value.textContent = item.page_views;
      svg.append(value);
    }
  }
  container.append(svg);
  container.setAttribute(
    "aria-label",
    items.map((item) => `${item.day}：${item.page_views} 次访问`).join("；"),
  );
  text("trend-start", items[0]?.day || "");
  text("trend-end", items.at(-1)?.day || "");
}
function videos(items) {
  const videoTime = (seconds) =>
    `${Math.floor(Math.round(seconds) / 60)
      .toString()
      .padStart(
        2,
        "0",
      )}:${(Math.round(seconds) % 60).toString().padStart(2, "0")}`;
  const table = document.getElementById("video-rows");
  table.replaceChildren();
  for (const [index, item] of items.entries()) {
    videoNames.set(item.id, item.title);
    const row = document.createElement("tr");
    const titleCell = document.createElement("td");
    const title = node("div", "", "video-name");
    const copy = document.createElement("span");
    copy.append(
      node("strong", item.title),
      node(
        "small",
        item.id === "overview"
          ? videoTime(item.duration)
          : `英文 ${videoTime(item.duration)} / 中文 ${videoTime(item.duration_cn)}`,
      ),
    );
    title.append(
      node("span", String(index).padStart(2, "0"), "video-index"),
      copy,
    );
    titleCell.append(title);
    row.append(titleCell);
    for (const value of [
      formatNumber.format(item.plays),
      formatNumber.format(item.ips),
      duration(item.watched_ms),
      `${item.completed} / ${item.plays}`,
      formatNumber.format(item.legacy_requests),
    ])
      row.append(node("td", value, "numeric"));
    table.append(row);
  }
}
function visitors(items) {
  const table = document.getElementById("visit-rows");
  table.replaceChildren();
  if (!items.length) {
    const row = document.createElement("tr");
    const cell = node(
      "td",
      "所选条件下暂无访问记录。可调整日期、搜索或数据来源。",
      "empty",
    );
    cell.colSpan = 6;
    row.append(cell);
    table.append(row);
    return;
  }
  for (const item of items) {
    const row = document.createElement("tr");
    const time = document.createElement("td");
    time.append(
      node("span", timestamp(item.started_at), "cell-primary"),
      node(
        "span",
        item.source === "client" ? "页面事件" : "历史日志",
        `source ${item.source}`,
      ),
    );
    if (item.is_bot) time.append(node("span", "自动流量", "cell-secondary"));
    const address = document.createElement("td");
    address.append(
      node("span", item.ip, "ip-address"),
      node("span", item.region, "cell-secondary"),
    );
    const browser = document.createElement("td");
    browser.append(
      node("span", `${item.browser} ${item.browser_version}`, "cell-primary"),
      node("span", `${item.os} · ${item.device}`, "cell-secondary"),
    );
    const viewed = document.createElement("td");
    for (const video of item.videos)
      viewed.append(
        node(
          "span",
          `${videoNames.get(video.video_id)} × ${video.plays}`,
          "video-tag",
        ),
      );
    for (const video of item.legacy_videos)
      viewed.append(
        node(
          "span",
          `${videoNames.get(video.video_id)} · 资源请求 ${video.requests} 次`,
          "video-tag legacy",
        ),
      );
    if (!item.videos.length && !item.legacy_videos.length)
      viewed.append(node("span", "暂无视频记录", "cell-secondary"));
    const watch = node(
      "td",
      item.source === "nginx"
        ? "不可推断"
        : duration(
            item.videos.reduce((sum, video) => sum + video.watched_ms, 0),
          ),
      "numeric",
    );
    const action = document.createElement("td");
    const button = node("button", "展开", "detail-button");
    button.type = "button";
    button.setAttribute("aria-expanded", "false");
    action.append(button);
    row.append(time, address, browser, viewed, watch, action);
    table.append(row);
    const detailRow = document.createElement("tr");
    detailRow.hidden = true;
    const cell = node("td", "", "detail-cell");
    cell.colSpan = 6;
    const list = document.createElement("dl");
    const fields = [
      ["最近活动", timestamp(item.last_seen)],
      ["运营商", item.isp || "未知"],
      ["来源页面", item.referrer || "直接访问 / 未提供"],
      ["访问路径", item.path],
      ["User-Agent", item.user_agent],
      [
        "视频明细",
        item.videos
          .map(
            (video) =>
              `${videoNames.get(video.video_id)}：${video.plays} 次播放，${duration(video.watched_ms)}，覆盖 ${Math.round(video.coverage * 100)}%，完整播放 ${video.completed} 次`,
          )
          .join("；") ||
          (item.source === "nginx"
            ? "历史日志只记录资源请求，不能还原实际观看时长。"
            : "尚未记录实际播放。"),
      ],
    ];
    for (const [label, value] of fields)
      list.append(node("dt", label), node("dd", value));
    cell.append(list);
    detailRow.append(cell);
    table.append(detailRow);
    button.addEventListener("click", () => {
      detailRow.hidden = !detailRow.hidden;
      button.textContent = detailRow.hidden ? "展开" : "收起";
      button.setAttribute("aria-expanded", String(!detailRow.hidden));
    });
  }
}
async function load() {
  const sequence = ++requestSequence;
  currentRequest?.abort();
  currentRequest = new AbortController();
  message.hidden = true;
  text("updated", "正在更新…");
  const params = parameters();
  document.getElementById("export").href =
    `/statistics/api/export.csv?${params}`;
  try {
    const response = await fetch(`/statistics/api/report?${params}`, {
      credentials: "same-origin",
      signal: currentRequest.signal,
      cache: "no-store",
    });
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "登录已失效，请重新打开统计页面并登录。"
          : response.status === 400
            ? "日期或筛选条件无效。日期范围最多 366 天。"
            : "暂时无法获取统计数据，请稍后刷新。",
      );
    const data = await response.json();
    if (sequence !== requestSequence) return;
    text("metric-pv", formatNumber.format(data.totals.page_views));
    text("metric-sessions", formatNumber.format(data.totals.sessions));
    text("metric-ips", formatNumber.format(data.totals.ips));
    text("metric-plays", formatNumber.format(data.totals.plays));
    text("metric-watch", duration(data.totals.watched_ms));
    trend(data.timeline);
    ranks("regions", data.regions);
    ranks("browsers", data.browsers);
    videos(data.videos);
    visitors(data.visits);
    text("updated", `更新于 ${timestamp(data.generated_at)} · 北京时间`);
    text(
      "visit-count",
      `共 ${formatNumber.format(data.totals.page_views)} 条 · 每页 ${data.size} 条`,
    );
    const pages = Math.max(1, Math.ceil(data.totals.page_views / data.size));
    text("page-info", `${page} / ${pages}`);
    document.getElementById("previous-page").disabled = page <= 1;
    document.getElementById("next-page").disabled = page >= pages;
    text(
      "historical-note",
      data.meta.tracking_started
        ? `播放事件自 ${timestamp(Number(data.meta.tracking_started))} 起采集。当前范围含 ${data.totals.historical_visits || 0} 条历史访问，${data.totals.legacy_requests} 次关联的视频资源请求；这些请求不计作实际播放。`
        : "播放数据来自实际事件上报；历史日志数据会单独标注。",
    );
  } catch (error) {
    if (error.name === "AbortError" || sequence !== requestSequence) return;
    message.textContent = error.message;
    message.hidden = false;
    text("updated", "更新失败 · 已展示的数据可能较旧");
  }
}
setRange(7);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  page = 1;
  void load();
});
for (const button of document.querySelectorAll("[data-days]"))
  button.addEventListener("click", () => {
    setRange(Number(button.dataset.days));
    page = 1;
    void load();
  });
for (const date of form.querySelectorAll("input[type=date]"))
  date.addEventListener("change", () => {
    for (const button of document.querySelectorAll("[data-days]"))
      button.setAttribute("aria-pressed", "false");
  });
document.getElementById("refresh").addEventListener("click", () => void load());
document.getElementById("previous-page").addEventListener("click", () => {
  page -= 1;
  void load();
});
document.getElementById("next-page").addEventListener("click", () => {
  page += 1;
  void load();
});
void load();
