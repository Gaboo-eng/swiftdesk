const THEME_KEY = "swiftdesk-theme";

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  document.querySelectorAll(".theme-toggle").forEach((button) => {
    const label = isDark ? "Cambiar a modo claro" : "Cambiar a modo oscuro";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(isDark));
    button.title = label;
    button.querySelector(".theme-toggle-icon").textContent = isDark ? "☀" : "☾";
  });
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", isDark ? "#111827" : "#174ea6");
}

export function initializeThemeToggle() {
  let theme = "light";
  try {
    theme = localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch (error) {
    console.warn("No se pudo leer la preferencia del tema:", error);
  }
  applyTheme(theme);

  document.querySelectorAll(".theme-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      theme = theme === "dark" ? "light" : "dark";
      applyTheme(theme);
      try {
        localStorage.setItem(THEME_KEY, theme);
      } catch (error) {
        console.warn("No se pudo guardar la preferencia del tema:", error);
      }
    });
  });
}
