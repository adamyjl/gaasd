import { updateScrollLock } from "./navigation.js";
/** @param {import('./data.js').VideoItem[]} videos @param {'en' | 'cn'} [language] */
export function initMediaPlayer(videos, language = "en") {
  const messages =
    language === "cn"
      ? {
          failed: "视频加载失败，请重试",
          start: "点击按钮开始播放",
          loading: "正在加载视频…",
          buffering: "正在缓冲…",
        }
      : {
          failed: "Unable to load the video. Please try again.",
          start: "Press the button to start playback",
          loading: "Loading video…",
          buffering: "Buffering…",
        };
  const dialog = document.querySelector("#media-dialog");
  const video = document.querySelector("#media-video");
  const title = document.querySelector("#media-title");
  const close = document.querySelector(".media-close");
  const state = document.querySelector(".media-state");
  const message = document.querySelector(".media-message");
  const retry = document.querySelector(".retry-button");
  if (
    !(dialog instanceof HTMLDialogElement) ||
    !(video instanceof HTMLVideoElement) ||
    !(title instanceof HTMLElement) ||
    !(close instanceof HTMLButtonElement) ||
    !(state instanceof HTMLElement) ||
    !(message instanceof HTMLElement) ||
    !(retry instanceof HTMLButtonElement)
  )
    return;
  /** @type {Map<string, number>} */
  const positions = new Map();
  /** @type {import('./data.js').VideoItem | null} */
  let active = null;
  /** @type {HTMLElement | null} */
  let previousTrigger = null;
  let generation = 0;
  let needsReload = false;
  const savePosition = () => {
    if (active && Number.isFinite(video.currentTime))
      positions.set(active.id, video.ended ? 0 : video.currentTime);
  };
  /** @param {string} text @param {boolean} [canRetry] */
  const showMessage = (text, canRetry = false) => {
    message.textContent = text;
    state.hidden = false;
    retry.hidden = !canRetry;
  };
  const play = () => {
    const request = generation;
    void video.play().catch((error) => {
      if (generation !== request || !dialog.open || error.name === "AbortError")
        return;
      needsReload = Boolean(video.error);
      showMessage(needsReload ? messages.failed : messages.start, true);
    });
  };
  /** @param {import('./data.js').VideoItem} item @param {HTMLElement} trigger */
  const open = (item, trigger) => {
    savePosition();
    generation += 1;
    video.pause();
    document.dispatchEvent(
      new CustomEvent("gaasd:video-selected", { detail: item.id }),
    );
    if (!dialog.open) {
      previousTrigger = trigger;
      const menu = document.querySelector("#mobile-menu");
      if (menu instanceof HTMLDialogElement && menu.open) menu.close();
      dialog.showModal();
      close.focus({ preventScroll: true });
    }
    active = item;
    needsReload = false;
    title.textContent = item.title;
    video.setAttribute("aria-label", item.title);
    video.poster = item.poster;
    video.src = item.src;
    video.load();
    for (const button of document.querySelectorAll(".media-switcher button"))
      button.setAttribute(
        "aria-pressed",
        String(button.getAttribute("data-video-id") === item.id),
      );
    showMessage(messages.loading);
    updateScrollLock();
    play();
  };
  document.addEventListener("click", (event) => {
    if (
      !(event.target instanceof HTMLElement) &&
      !(event.target instanceof SVGElement)
    )
      return;
    const trigger = event.target.closest("[data-video-id]");
    if (!(trigger instanceof HTMLElement)) return;
    const item = videos.find((entry) => entry.id === trigger.dataset.videoId);
    if (item) open(item, trigger);
  });
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener("close", () => {
    savePosition();
    generation += 1;
    video.pause();
    document.dispatchEvent(new CustomEvent("gaasd:video-closed"));
    video.removeAttribute("src");
    video.load();
    active = null;
    state.hidden = true;
    updateScrollLock();
    previousTrigger?.focus({ preventScroll: true });
  });
  video.addEventListener("loadedmetadata", () => {
    const position = active ? positions.get(active.id) : 0;
    if (
      position &&
      Number.isFinite(video.duration) &&
      position < video.duration - 0.5
    )
      video.currentTime = position;
  });
  video.addEventListener("playing", () => {
    state.hidden = true;
  });
  video.addEventListener("waiting", () => {
    if (dialog.open) showMessage(messages.buffering);
  });
  video.addEventListener("error", () => {
    if (!dialog.open || !active) return;
    needsReload = true;
    showMessage(messages.failed, true);
  });
  retry.addEventListener("click", () => {
    if (needsReload) video.load();
    showMessage(messages.loading);
    play();
  });
}
