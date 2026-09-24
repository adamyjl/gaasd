/**
 * @typedef {{ id: string, number: string, title: string, duration: string,
 * desktopDescription: string, mobileDescription: string,
 * src: string, poster: string }} VideoItem
 */
/** @type {VideoItem[]} */
const templates = [
  {
    id: "overview",
    number: "00",
    title: "GAASD 总览",
    duration: "00:28",
    desktopDescription: "",
    mobileDescription: "",
    src: "media/overview.mp4",
    poster: "images/overview.webp",
  },
  {
    id: "platform",
    number: "01",
    title: "平台与功能软件",
    duration: "03:27",
    desktopDescription: "Graphical Modeling & Component Reuse",
    mobileDescription: "图形化建模与功能软件复用",
    src: "media/platform.mp4",
    poster: "images/platform.webp",
  },
  {
    id: "ai-assist",
    number: "02",
    title: "AI 辅助开发",
    duration: "03:14",
    desktopDescription: "Context-Aware Generation & Validation",
    mobileDescription: "图模型理解与生成修改",
    src: "media/ai-assist.mp4",
    poster: "images/ai-assist.webp",
  },
  {
    id: "nnide",
    number: "03",
    title: "神经网络开发",
    duration: "04:56",
    desktopDescription: "Model Architecture & Deployment",
    mobileDescription: "模型结构与开发流程",
    src: "media/nnide.mp4",
    poster: "images/nnide.webp",
  },
  {
    id: "vla",
    number: "04",
    title: "VLM / VLA 开发",
    duration: "04:35",
    desktopDescription: "Workflow & Closed-Loop Evaluation",
    mobileDescription: "工作流与闭环验证",
    src: "media/vla.mp4",
    poster: "images/vla.webp",
  },
];

/** @type {Record<string, {title: string, mobileDescription: string}>} */
const englishCopy = {
  overview: { title: "GAASD Overview", mobileDescription: "" },
  platform: {
    title: "Graphical Development Platform Base",
    mobileDescription: "Visual modeling & software reuse",
  },
  "ai-assist": {
    title: "LLM-Assisted Graphical Development Platform",
    mobileDescription: "Understand, generate & refine models",
  },
  nnide: {
    title: "Graphic Neural Network IDE",
    mobileDescription: "Model architecture & development",
  },
  vla: {
    title: "Multimodal Model Development Platform",
    mobileDescription: "Workflows & closed-loop validation",
  },
};

/** @param {'en' | 'cn'} [language] @param {string} [prefix] @returns {VideoItem[]} */
export function getVideos(language = "en", prefix = "") {
  return templates.map((item) => ({
    ...item,
    ...(language === "en" ? englishCopy[item.id] : {}),
    src:
      item.id === "overview"
        ? language === "cn"
          ? `${prefix}media/overview.mp4`
          : `${prefix}media/present2/en/overview-en-ja-20260914.mp4`
        : item.id === "platform"
          ? `${prefix}media/present2/${language}/platform-20260915.mp4`
          : item.id === "nnide" || item.id === "vla"
            ? `${prefix}media/present2/${language}/${item.id}-20260916.mp4`
            : `${prefix}media/present2/${language}/${item.id}.mp4`,
    poster:
      language === "en"
        ? `${prefix}images/en/${item.id}-20260922.webp`
        : `${prefix}${item.poster}`,
    duration:
      language === "cn" && item.id === "nnide" ? "04:43" : item.duration,
  }));
}

export const videos = getVideos();
