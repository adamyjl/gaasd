const toggle = document.querySelector("#privacy-toggle");
const privacyStatus = document.querySelector("#privacy-status");
const messages =
  document.documentElement.lang === "zh-CN"
    ? {
        enable: "开启本浏览器的事件统计",
        disable: "关闭本浏览器的事件统计",
        disabled: "本浏览器的后续事件统计已关闭。",
        enabled: "本浏览器的事件统计已开启。",
        unavailable:
          "浏览器不允许保存此偏好；可通过浏览器的 Do Not Track 设置关闭事件上报。",
      }
    : {
        enable: "Enable analytics in this browser",
        disable: "Disable analytics in this browser",
        disabled: "Future analytics events are disabled in this browser.",
        enabled: "Analytics events are enabled in this browser.",
        unavailable:
          "Your browser cannot save this preference. Enable Do Not Track in your browser to disable event reporting.",
      };
if (
  toggle instanceof HTMLButtonElement &&
  privacyStatus instanceof HTMLElement
) {
  const render = () => {
    try {
      const disabled =
        window.localStorage.getItem("gaasd-analytics-disabled") === "1";
      toggle.textContent = disabled ? messages.enable : messages.disable;
      privacyStatus.textContent = disabled
        ? messages.disabled
        : messages.enabled;
    } catch {
      toggle.disabled = true;
      privacyStatus.textContent = messages.unavailable;
    }
  };
  toggle.addEventListener("click", () => {
    try {
      window.localStorage.setItem(
        "gaasd-analytics-disabled",
        window.localStorage.getItem("gaasd-analytics-disabled") === "1"
          ? "0"
          : "1",
      );
    } catch {
      /* render supplies a clear fallback. */
    }
    render();
  });
  render();
}
