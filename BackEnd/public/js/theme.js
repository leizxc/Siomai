(function () {
  const root = document.documentElement;
  const btn = document.getElementById("theme-toggle");
  const icon = document.getElementById("theme-icon");

  function applyTheme(theme) {
    root.classList.toggle("dark", theme === "dark");
    if (icon) icon.textContent = theme === "dark" ? "light_mode" : "dark_mode";
    localStorage.setItem("theme", theme);
  }

  const saved = localStorage.getItem("theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(saved || (prefersDark ? "dark" : "light"));

  if (btn) {
    btn.addEventListener("click", () => {
      applyTheme(root.classList.contains("dark") ? "light" : "dark");
    });
  }
})();
