// This module is injected only into the independent review build.
const sectionIds = ["overview", "why-cbdes", "tracks", "about"];
for (const link of document.querySelectorAll("[data-review-language]")) {
  link.addEventListener("click", () => {
    const sections = sectionIds
      .map((id) => document.getElementById(id))
      .filter(
        (section) =>
          section &&
          section.getBoundingClientRect().top < window.innerHeight / 2,
      );
    const current = sections.at(-1)?.id || "overview";
    const href = link.getAttribute("href");
    if (href) link.setAttribute("href", `${href.split("#")[0]}#${current}`);
  });
}
