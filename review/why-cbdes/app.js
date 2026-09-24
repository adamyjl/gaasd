import { initNavigation } from "./navigation.js";
import { initAnalytics } from "./analytics.js";

// Share the entry version across modules whose translated copy can change.
/** @param {string} filename */
function moduleUrl(filename) {
  const url = new URL(filename, import.meta.url);
  url.search = new URL(import.meta.url).search;
  return url.href;
}
/** @type {Promise<typeof import('./cards.js')>} */
const cardsModule = import(moduleUrl("./cards.js"));
/** @type {Promise<typeof import('./player.js')>} */
const playerModule = import(moduleUrl("./player.js"));
/** @type {Promise<typeof import('./video-catalog.js')>} */
const catalogModule = import(moduleUrl("./video-catalog.js"));
const [{ renderVideoCards }, { initMediaPlayer }, { getVideos }] =
  await Promise.all([cardsModule, playerModule, catalogModule]);

const language =
  document.documentElement.dataset.videoLanguage === "cn" ? "cn" : "en";
const mediaBase = document.documentElement.dataset.mediaBase;
const videos = getVideos(language, mediaBase || (language === "cn" ? "/" : ""));
renderVideoCards(videos, language);
initNavigation();
initAnalytics();
initMediaPlayer(videos, language);
