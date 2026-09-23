/* Teclado en pantalla y zona visible (requisito: «teclado que no tape campos»).

   - Chrome de Android redimensiona el contenido con el teclado gracias a
     `interactive-widget=resizes-content` en el viewport (index.html).
   - Safari de iOS no: el teclado tapa la parte de abajo de la «layout
     viewport». Aquí se mide con visualViewport cuánto tapa y se publica en la
     variable CSS --kb, que usan las hojas y los campos fijos abajo. Además, al
     enfocar un campo se lleva a la vista si el teclado lo tapa. */

let installed = false;

export function keyboardInset(win: Pick<Window, 'innerHeight' | 'visualViewport'>): number {
  const vv = win.visualViewport;
  if (!vv) return 0;
  const hidden = win.innerHeight - vv.height - vv.offsetTop;
  // Menos de 60 px es la barra del navegador que aparece y desaparece, no un teclado.
  return hidden > 60 ? Math.round(hidden) : 0;
}

export function installViewportWatcher(win: Window = window): () => void {
  if (installed || !win.visualViewport) return () => {};
  installed = true;
  const root = win.document.documentElement;
  let frame = 0;
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      root.style.setProperty('--kb', `${keyboardInset(win)}px`);
    });
  };
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !target.matches('input, textarea, select, [contenteditable="true"]')
    )
      return;
    // Espera a que el teclado termine de subir antes de mirar si tapa el campo.
    window.setTimeout(() => {
      const rect = target.getBoundingClientRect();
      const vv = win.visualViewport;
      if (vv && rect.bottom > vv.height + vv.offsetTop - 12) {
        target.scrollIntoView({ block: 'center', inline: 'nearest' });
      }
    }, 320);
  };
  win.visualViewport.addEventListener('resize', update);
  win.visualViewport.addEventListener('scroll', update);
  win.document.addEventListener('focusin', onFocusIn);
  update();
  return () => {
    installed = false;
    win.visualViewport?.removeEventListener('resize', update);
    win.visualViewport?.removeEventListener('scroll', update);
    win.document.removeEventListener('focusin', onFocusIn);
    root.style.removeProperty('--kb');
  };
}
