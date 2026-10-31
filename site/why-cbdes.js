import { whyResources } from "./why-resources.js";

const descriptions = {
  en: [
    [
      "Algorithm Design",
      "Design the algorithm logic of individual functional modules graphically in GAASD. Define module interfaces, parameters, and behavior, using AI-assisted development to decouple algorithm design from code implementation.",
      "Functional Algorithm Modules · Module Interfaces & Parameters",
    ],
    [
      "Application Modeling",
      "Select prefabricated functional modules from CBB to meet application requirements. Use GAASD to connect and reuse modules across domains, configure data flows and parameters, and refactor the application.",
      "Application Model · Module Connections & Configuration",
    ],
    [
      "Deployment & Verification",
      "Use GAASD to generate application code and configuration, compile and deploy to the target platform, and verify application behavior in simulation and on vehicles. Record performance metrics and issues.",
      "Deployed Application · Verification Records · Issue List",
    ],
    [
      "Optimization & Iteration",
      "Bring verification feedback into GAASD to improve module algorithms, composition, and parameters. Return to algorithm design and application modeling, then run regression checks for the next iteration.",
      "Updated Algorithms & Application Models · Regression Results",
    ],
  ],
  cn: [
    [
      "算法设计",
      "在 GAASD 中以图形化方式设计单个功能模块的算法逻辑，定义模块接口、参数与行为，通过 AI 辅助开发将算法设计与代码实现解耦。",
      "功能算法模块 · 模块接口与参数",
    ],
    [
      "应用建模",
      "面向应用需求，从 CBB 选择预制功能模块，在 GAASD 中通过图形化连接和跨域复用组合模块，配置数据流与参数，完成应用重构。",
      "应用模型 · 模块连接与配置",
    ],
    [
      "部署验证",
      "利用 GAASD 生成应用代码与配置，完成编译和目标平台部署，通过仿真与实车测试验证应用行为，记录性能指标与问题。",
      "部署程序 · 验证记录 · 问题清单",
    ],
    [
      "优化迭代",
      "将验证反馈带回 GAASD，改进模块算法、模块组合及参数配置；回到算法设计与应用建模，持续迭代并开展回归验证。",
      "更新的算法与应用模型 · 回归结果",
    ],
  ],
};

function initWhyCbdes() {
  const root = document.getElementById("why-cbdes");
  if (!root) return;
  const steps = root.querySelectorAll(".why-stage");
  const number = root.querySelector(".why-detail-number");
  const title = root.querySelector(".why-detail-name");
  const body = root.querySelector(".why-detail-body");
  const output = root.querySelector(".why-detail-output");
  if (!number || !title || !body || !output) return;
  const language = root.lang === "en" ? "en" : "cn";
  /** @param {number} index */
  function updateStep(index) {
    const item = descriptions[language][index];
    if (!item || !number || !title || !body || !output) return;
    steps.forEach((button, i) =>
      button.setAttribute("aria-pressed", String(i === index)),
    );
    number.textContent = `${String(index + 1).padStart(2, "0")} / 04`;
    title.textContent = item[0];
    body.textContent = item[1];
    output.textContent = item[2];
  }
  steps.forEach((button, index) =>
    button.addEventListener("click", () => updateStep(index)),
  );
  root
    .querySelector(".why-restart")
    ?.addEventListener("click", () => updateStep(0));
  const toggle = root.querySelector(".why-source-toggle");
  const panel = root.querySelector(".why-source-panel");
  const image = panel?.querySelector("img");
  if (!whyResources.sourceImage) image?.remove();
  if (
    whyResources.sourceImage &&
    toggle instanceof HTMLElement &&
    panel instanceof HTMLElement &&
    image
  ) {
    toggle.hidden = false;
    toggle.addEventListener("click", () => {
      const isOpen = toggle.getAttribute("aria-expanded") === "true";
      // No request for the optional illustration until the user opens it.
      if (!isOpen) image.src = whyResources.sourceImage;
      toggle.setAttribute("aria-expanded", String(!isOpen));
      panel.hidden = isOpen;
      const symbol = toggle.querySelector(".why-source-symbol");
      if (symbol) symbol.textContent = isOpen ? "＋" : "−";
    });
  }
  const pdf = root.querySelector(".why-pdf-link");
  if (whyResources.overviewPdf && pdf instanceof HTMLElement) {
    pdf.setAttribute("href", whyResources.overviewPdf);
    pdf.hidden = false;
  }
}
initWhyCbdes();
