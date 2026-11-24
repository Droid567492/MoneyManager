(function () {
  try {
    if (localStorage.getItem('mm_theme_sync_v2') !== '1') {
      localStorage.removeItem('mm_theme');
      if (!localStorage.getItem('mm_theme_mode')) localStorage.setItem('mm_theme_mode', 'auto');
      localStorage.setItem('mm_theme_sync_v2', '1');
    }
    var mode = localStorage.getItem('mm_theme_mode');
    var sys = 'dark';
    if (window.matchMedia) {
      if (window.matchMedia('(prefers-color-scheme: light)').matches) sys = 'light';
      else if (window.matchMedia('(prefers-color-scheme: dark)').matches) sys = 'dark';
    }
    var theme = mode === 'light' || mode === 'dark' ? mode : sys;
    document.documentElement.setAttribute('data-theme', theme);
    var bg = theme === 'light' ? '#f1f5f9' : '#0b1120';
    document.documentElement.style.backgroundColor = bg;
    var mc = document.getElementById('meta-theme-color');
    if (mc) mc.setAttribute('content', bg);
  } catch (e) {}
})();
