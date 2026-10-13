// Runs before first paint to avoid a light flash in dark mode.
(function () {
  try {
    var pref = localStorage.getItem('taptim.theme');
    var dark =
      pref === 'dark' || ((pref === null || pref === 'system') && matchMedia('(prefers-color-scheme: dark)').matches);
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) {
    /* storage unavailable — system default stays */
  }
})();
