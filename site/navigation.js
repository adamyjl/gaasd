export function updateScrollLock() {
  document.body.classList.toggle(
    "scroll-locked",
    Boolean(document.querySelector("dialog[open]")),
  );
}
export function initNavigation() {
  const menu = document.querySelector("#mobile-menu");
  const toggle = document.querySelector(".menu-toggle");
  const close = document.querySelector(".menu-close");
  if (
    !(menu instanceof HTMLDialogElement) ||
    !(toggle instanceof HTMLButtonElement) ||
    !(close instanceof HTMLButtonElement)
  )
    return;
  toggle.addEventListener("click", () => {
    menu.showModal();
    toggle.setAttribute("aria-expanded", "true");
    updateScrollLock();
  });
  close.addEventListener("click", () => menu.close());
  menu.addEventListener("click", (event) => {
    if (event.target === menu) menu.close();
  });
  menu.addEventListener("close", () => {
    toggle.setAttribute("aria-expanded", "false");
    updateScrollLock();
  });
  window
    .matchMedia("(min-width: 768px)")
    .addEventListener("change", (event) => {
      if (event.matches && menu.open) menu.close();
    });
  for (const anchor of document.querySelectorAll('a[href^="#"]')) {
    anchor.addEventListener("click", (event) => {
      const hash = anchor.getAttribute("href");
      if (!hash) return;
      const target = document.querySelector(hash);
      if (!(target instanceof HTMLElement)) return;
      event.preventDefault();
      if (menu.open) menu.close();
      updateScrollLock();
      history.replaceState(null, "", hash);
      target.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "start",
      });
      for (const link of document.querySelectorAll(".desktop-nav a")) {
        if (link.getAttribute("href") === hash)
          link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      }
    });
  }
}
