import { whyResources } from "./why-resources.js";

const descriptions = {
  cn: [
    [
      "应用建模",
      "围绕应用需求选择与组合功能模块，定义接口、参数和数据流，构建可继续迭代的应用图模型。",
      "应用图模型 · 接口与参数配置",
    ],
    [
      "部署下载",
      "基于图模型生成代码与配置，完成编译和目标平台适配，将应用部署到目标控制器。",
      "应用程序 · 部署配置",
    ],
    [
      "上车验证",
      "结合仿真结果开展实车测试，采集运行日志、性能指标与异常信息，形成可回溯的验证反馈。",
      "测试记录 · 性能指标 · 问题清单",
    ],
    [
      "优化迭代",
      "将验证发现的问题回流到模型、模块与参数，完成修改与回归验证，再进入下一轮开发。",
      "更新后的模型与模块 · 回归结果",
    ],
  ],
  en: [
    [
      "Application Modeling",
      "Select and compose functional modules around application requirements. Define interfaces, parameters and data flows to create an application graph that can evolve.",
      "Application graph · Interface and parameter configuration",
    ],
    [
      "Deployment",
      "Generate code and configuration from the application graph. Compile and adapt the application to the target platform, then deploy it to the controller.",
      "Application build · Deployment configuration",
    ],
    [
      "Vehicle Validation",
      "Use simulation results to inform vehicle testing. Capture runtime logs, performance metrics and issues to create traceable validation feedback.",
      "Test records · Performance metrics · Issue list",
    ],
    [
      "Refinement",
      "Feed validation findings back into models, modules and parameters. Make changes and run regression checks before the next development cycle.",
      "Updated models and modules · Regression results",
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
