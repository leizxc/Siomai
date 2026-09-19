(function () {
  const root = document.documentElement;
  const btns = document.querySelectorAll("#theme-toggle, [data-theme-toggle]");
  const icons = document.querySelectorAll("#theme-icon, [data-theme-icon]");

  function applyTheme(theme) {
    root.classList.toggle("dark", theme === "dark");
    icons.forEach((icon) => { icon.textContent = theme === "dark" ? "light_mode" : "dark_mode"; });
    localStorage.setItem("theme", theme);
  }

  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));

  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      applyTheme(root.classList.contains("dark") ? "light" : "dark");
    });
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== "theme" || !event.newValue) return;
    root.classList.toggle("dark", event.newValue === "dark");
    icons.forEach((icon) => { icon.textContent = event.newValue === "dark" ? "light_mode" : "dark_mode"; });
  });
})();
