(() => {
  const root = document.documentElement;
  const prefersDarkScheme = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  let userThemeOverride = false;
  const getSystemTheme = () => prefersDarkScheme?.matches ? 'dark' : 'light';
  root.dataset.theme = getSystemTheme();

  document.addEventListener("DOMContentLoaded", () => {
    const toolbar = document.getElementById("configBar");
    const buttons = [...toolbar.querySelectorAll("[data-editor]")];

    const popovers = ['sheetsMenu'].map(id => ({
      menu: document.getElementById(id), button: buttons.find(button => button.dataset.editor === id),
    }));
    function positionPopovers() {
      for (const { menu, button } of popovers) {
        if (menu.hidden) continue;
        const anchor = button.getBoundingClientRect();
        const bar = toolbar.getBoundingClientRect();
        menu.style.left = `${Math.max(10, Math.min(anchor.left, window.innerWidth - menu.offsetWidth - 10))}px`;
        menu.style.bottom = `${window.innerHeight - bar.top + 10}px`;
      }
    }

    function showEditor(id) {
      buttons.forEach(button => {
        const selected = button.dataset.editor === id;
        button.classList.toggle("selected", selected);
        button.setAttribute("aria-expanded", String(selected));
        document.getElementById(button.dataset.editor).hidden = !selected;
      });
      positionPopovers();
    }

    buttons.forEach(button => {
      button.addEventListener("click", () => {
        showEditor(button.getAttribute("aria-expanded") === "true" ? null : button.dataset.editor);
      });
    });

    document.addEventListener("click", event => {
      if (popovers.some(({ menu, button }) => !menu.hidden && !menu.contains(event.target) && !button.contains(event.target))) {
        showEditor(null);
      }
    });
    document.addEventListener("keydown", event => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      const activeButton = buttons.find(button => button.getAttribute("aria-expanded") === "true");
      showEditor(null);
      activeButton?.focus();
    });
    window.addEventListener("resize", positionPopovers);
    toolbar.addEventListener("scroll", positionPopovers);

    const darkMode = document.getElementById("darkMode");
    function updateDarkMode() {
      const dark = root.dataset.theme === "dark";
      darkMode.setAttribute("aria-pressed", String(dark));
      darkMode.title = dark ? "Light mode" : "Dark mode";
      darkMode.querySelector("span").textContent = dark ? "light_mode" : "dark_mode";
    }
    function applyTheme(theme) {
      root.dataset.theme = theme;
      updateDarkMode();
    }
    function syncThemeWithSystem() {
      const systemTheme = getSystemTheme();
      if (!userThemeOverride) applyTheme(systemTheme);
      else if (root.dataset.theme === systemTheme) userThemeOverride = false;
    }
    darkMode.addEventListener("click", () => {
      const nextTheme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      applyTheme(nextTheme);
      userThemeOverride = nextTheme !== getSystemTheme();
    });
    syncThemeWithSystem();
    if (typeof prefersDarkScheme?.addEventListener === 'function') {
      prefersDarkScheme.addEventListener('change', syncThemeWithSystem);
    } else if (typeof prefersDarkScheme?.addListener === 'function') {
      prefersDarkScheme.addListener(syncThemeWithSystem);
    }

    window.StripeMaker = { showEditor };

    // Copy, Download, and Clear all are placeholders until their features are requested.
  });
})();
