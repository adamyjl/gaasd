/** @param {import('./data.js').VideoItem[]} videos @param {'en' | 'cn'} [language] */
export function renderVideoCards(videos, language = "en") {
  const grid = document.querySelector("#track-grid");
  const switcher = document.querySelector("#media-switcher");
  if (!(grid instanceof HTMLElement) || !(switcher instanceof HTMLElement))
    return;
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
    grid.append(card);
  }
}
/** @param {string} className @param {string} text */
function textSpan(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}
