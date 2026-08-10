/**
 * S.A.V.I.A — NAV → WINDOW
 * Re-instrada ogni navigazione web (nav rail, "BACK TO CHAT", bottoni)
 * verso una nuova finestra desktop dedicata, così il centro di comando
 * (index.html) resta sempre visibile.
 *
 * - 'index.html' → mette in primo piano la finestra principale
 * - altre pagine  → nuova finestra (o focus se già aperta)
 * - senza electronAPI (browser) → fallback su navigazione classica
 */
(function () {
  function isElectron() {
    return !!(window.electronAPI && window.electronAPI.openToolPage);
  }

  function openTool(page) {
    page = String(page || '');
    if (/^[a-z0-9-]+\.html$/.test(page) && isElectron()) {
      window.electronAPI.openToolPage(page); // main decide: focus-index | nuova finestra | focus-esistente
    } else {
      window.location.href = page;
    }
  }

  window.saviaOpen = openTool;

  function intercept() {
    var items = document.querySelectorAll('[onclick]');
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var oc = el.getAttribute('onclick') || '';
      var m = oc.match(/window\.location\.href='([a-zA-Z0-9-]+\.html)'/);
      if (!m) continue;
      var page = m[1];
      el.removeAttribute('onclick');
      el.onclick = function (ev) {
        if (ev) ev.preventDefault();
        openTool(page);
      };
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', intercept);
  } else {
    intercept();
  }
})();