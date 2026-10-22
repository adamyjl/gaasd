/** @param {import('./data.js').VideoItem[]} videos @param {'en' | 'cn'} [language] */
export function renderVideoCards(videos, language = "en") {
  const grid = document.querySelector("#track-grid");
  const switcher = document.querySelector("#media-switcher");
  if (!(grid instanceof HTMLElement) || !(switcher instanceof HTMLElement))
    return;
  const groups = [
    {
      id: "rule",
      range: "01 / 02",
      title: language === "cn" ? "规则驱动的代码" : "Rule-Driven Code",
    },
    {
      id: "data",
      range: "03 / 04",
      title: language === "cn" ? "数据驱动的模型" : "Data-Driven Models",
    },
  ].map((group) => {
    const section = document.createElement("section");
    section.className = "track-group";
    section.dataset.trackGroup = group.id;
    const headingId = `track-group-${group.id}`;
    section.setAttribute("aria-labelledby", headingId);
    const header = document.createElement("div");
    header.className = "track-group-heading";
    const title = document.createElement("h3");
    title.id = headingId;
    title.textContent = group.title;
    header.append(textSpan("track-group-range", group.range), title);
    section.append(header);
    grid.append(section);
    return section;
  });
  for (const item of videos) {
    const switchButton = document.createElement("button");
    switchButton.type = "button";
    switchButton.dataset.videoId = item.id;
    switchButton.textContent =
      item.id === "overview" ? item.title : `${item.number} ${item.title}`;
    switchButton.setAttribute("aria-pressed", "false");
    switcher.append(switchButton);
    if (item.id === "overview") continue;
    const card = document.createElement("button");
    card.type = "button";
    card.className = "track-card";
    card.dataset.videoId = item.id;
    card.setAttribute(
      "aria-label",
      language === "cn"
        ? `播放${item.title}，${item.duration}`
        : `Play ${item.title}, ${item.duration}`,
    );
    const image = document.createElement("img");
    image.className = "track-image";
    image.src = item.poster;
    image.alt =
      language === "cn"
        ? `${item.title}真实软件界面`
        : `${item.title} software interface`;
    image.width = 800;
    image.height = 450;
    image.loading = "lazy";
    image.decoding = "async";
    const copy = document.createElement("span");
    copy.className = "track-copy";
    const heading = document.createElement("span");
    heading.className = "track-heading";
    heading.append(
      textSpan("track-number", item.number),
      textSpan("track-title", item.title),
    );
    const actions = document.createElement("span");
    actions.className = "track-actions";
    const play = document.createElement("span");
    play.className = "play-square";
    play.setAttribute("aria-hidden", "true");
    play.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>';
    actions.append(textSpan("time", item.duration), play);
    copy.append(
      heading,
      textSpan("track-description", item.desktopDescription),
      textSpan("track-mobile-description", item.mobileDescription),
      actions,
    );
    card.append(image, copy);
    const group =
      item.id === "platform" || item.id === "ai-assist" ? groups[0] : groups[1];
    group.append(card);
  }
}
/** @param {string} className @param {string} text */
function textSpan(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}
