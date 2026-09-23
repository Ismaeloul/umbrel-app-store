/* Ace Player Neo v2 · Opción B «Rótulo» · sprite de iconos y microinteracciones comunes.
   Se carga al principio de <body>: así los <use href="#i-…"> ya encuentran sus símbolos. */
(function () {
  var S = function (id, cuerpo) { return '<symbol id="i-' + id + '" viewBox="0 0 24 24">' + cuerpo + '</symbol>'; };
  var relleno = ' fill="currentColor" stroke="none"';
  var sprite =
    '<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">' +
    S('agenda', '<rect x="3.5" y="5" width="17" height="15"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M7 13.5h3v3H7z"' + relleno + '/>') +
    S('biblioteca', '<rect x="3.5" y="4" width="17" height="4"/><rect x="3.5" y="10" width="17" height="4"/><rect x="3.5" y="16" width="11" height="4"/>') +
    S('buscar', '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5"/>') +
    S('ajustes', '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><rect x="13" y="5" width="4" height="4"/><rect x="7" y="15" width="4" height="4"/>') +
    S('play', '<path d="M7 4.5v15l12.5-7.5z"' + relleno + '/>') +
    S('pausa', '<path d="M6.5 5h4v14h-4zM13.5 5h4v14h-4z"' + relleno + '/>') +
    S('vol', '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M15.5 9a4.5 4.5 0 0 1 0 6M18 6.5a8 8 0 0 1 0 11"/>') +
    S('mudo', '<path d="M4 9.5h3.5L12 6v12l-4.5-3.5H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>') +
    S('pip', '<rect x="3" y="5" width="18" height="14"/><path d="M12.5 12h6.5v5h-6.5z"' + relleno + '/>') +
    S('completa', '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>') +
    S('mas', '<path d="M4.5 10.5h3v3h-3zM10.5 10.5h3v3h-3zM16.5 10.5h3v3h-3z"' + relleno + '/>') +
    S('estrella', '<path d="M12 3.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6-5.4-3-5.4 3 1.2-6L3.3 9.8l6.1-.7z"/>') +
    S('copiar', '<rect x="8.5" y="8.5" width="11.5" height="11.5"/><path d="M15.5 8.5V4H4v11.5h4.5"/>') +
    S('hash', '<path d="M9.5 4L7.5 20M16.5 4l-2 16M4.5 9h16M3.5 15h16"/>') +
    S('rebuscar', '<path d="M19.5 13a7.5 7.5 0 1 1-2.2-6.3"/><path d="M19.5 3.5v5h-5"/>') +
    S('reportar', '<path d="M5 21V4M5 4.5h12.5L15 9l2.5 4.5H5"/>') +
    S('check', '<path d="M4.5 12.5l5 5 10-11"/>') +
    S('ojo', '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>') +
    S('ojo-no', '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><path d="M4 4l16 16"/>') +
    S('salud', '<path d="M3 12h4l2.5-6 5 12 2.5-6H21"/>') +
    S('mas-uno', '<path d="M12 5v14M5 12h14"/>') +
    S('atras', '<path d="M15 5l-7 7 7 7"/>') +
    S('sigue', '<path d="M9 5l7 7-7 7"/>') +
    S('cerrar', '<path d="M6 6l12 12M18 6L6 18"/>') +
    S('refrescar', '<path d="M19.5 13a7.5 7.5 0 1 1-2.2-6.3"/><path d="M19.5 3.5v5h-5"/>') +
    S('nerd', '<path d="M4 20v-5M9.3 20V9M14.6 20v-8M20 20V4"/>') +
    S('enlace', '<path d="M10 14l4-4M8.5 11.5l-2 2a3.5 3.5 0 0 0 5 5l2-2M15.5 12.5l2-2a3.5 3.5 0 0 0-5-5l-2 2"/>') +
    S('lista', '<path d="M8.5 6h12M8.5 12h12M8.5 18h12M3.5 6h2M3.5 12h2M3.5 18h2"/>') +
    S('marca', '<path d="M2 4.75h2.4v6.5H2zM5.3 4.75h5.1l10.4 6.5H5.3zM2 12.75h2.4v6.5H2zM5.3 12.75h15.5l-10.4 6.5H5.3z"' + relleno + '/>') +
    '</svg>';
  document.body.insertAdjacentHTML('afterbegin', sprite);

  /* Grupos exclusivos: pestañas, conmutadores, tira de días. */
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('[data-grupo] > [data-opcion], [data-grupo] [data-opcion]');
    if (b) {
      var g = b.closest('[data-grupo]');
      var attr = g.getAttribute('data-grupo') === 'tabs' ? 'aria-selected' : 'aria-pressed';
      g.querySelectorAll('[data-opcion]').forEach(function (o) { o.setAttribute(attr, String(o === b)); });
      g.dispatchEvent(new CustomEvent('elegido', { detail: b.getAttribute('data-opcion'), bubbles: true }));
    }
    var t = ev.target.closest('[data-conmuta]');
    if (t) {
      var on = t.getAttribute('aria-pressed') !== 'true';
      t.setAttribute('aria-pressed', String(on));
      var l = t.getAttribute(on ? 'data-l-on' : 'data-l-off');
      if (l) t.setAttribute('aria-label', l);
      t.dispatchEvent(new CustomEvent('conmutado', { detail: on, bubbles: true }));
    }
  });

  /* Split-flap: las cifras que cambian giran una vez, como una paleta. */
  window.paleta = function (el, valor) {
    if (!el) return;
    el.textContent = valor;
    el.classList.remove('gira');
    void el.offsetWidth;
    el.classList.add('gira');
  };
})();
