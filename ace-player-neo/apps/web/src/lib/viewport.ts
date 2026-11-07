/* Teclado en pantalla y zona visible (requisito: «teclado que no tape campos»).

   - Chrome de Android redimensiona el contenido con el teclado gracias a
     `interactive-widget=resizes-content` en el viewport (index.html).
   - Safari de iOS no: el teclado tapa la parte de abajo de la «layout
     viewport». Aquí se mide con visualViewport cuánto tapa y se publica en la
     variable CSS --kb, que usan las hojas y los campos fijos abajo. Además, al
     enfocar un campo se lleva a la vista si el teclado lo tapa.
   - También se publican --vvh (el alto de lo que se ve: sin la barra de Safari
     ni el teclado) y --vvtop (cuánto se ha desplazado lo que se ve): la sala
     de «Ver juntos» en el móvil (la del invitado y la de casa) se pone justo
     ahí (juntos.css), con la caja del chat por encima de la barra flotante de
     Safari y del teclado.
   - Con el teclado abierto, `<html data-kb>`: la sala esconde lo que sobra
     (las caras, «quién controla») y encoge el vídeo para que se vea el chat.
     En el iPhone lo dice --kb; en Android (que encoge la página entera y
     --kb se queda en 0), que lo que se ve ha bajado más de `KB_DROP_PX`
     respecto a lo más alto que se ha visto con este ancho y hay un campo
     de texto con el foco.
   - La sala es una caja fija que no se desplaza: dentro de ella NO se hace
     `scrollIntoView` (Safari movía la página entera y la caja del chat se
     quedaba a medias detrás del teclado). Al cambiar lo que se ve, la caja
     vuelve arriba (`scrollTop = 0`) y, en casa, la página también. */

let installed = false;

/** Lo que tiene que bajar lo que se ve (Android, sin --kb) para contar como teclado. */
export const KB_DROP_PX = 150;

/** La sala de «Ver juntos» en el móvil: una caja fija donde no se hace scroll de la página. */
const ROOM_BOX = '.juntos, .guest--room';

/** Desde este ancho la sala ya no es una caja fija (escritorio: la página se desplaza). */
const MOBILE_MAX = 768;

/** ¿La sala va en su caja fija? En el móvil, de pie o tumbado (juntos.css). */
function fixedRoom(win: Window): boolean {
  if (win.innerWidth < MOBILE_MAX) return true;
  const landscape = win.innerWidth > win.innerHeight && win.innerHeight <= 540;
  return landscape && !!win.matchMedia?.('(pointer: coarse)').matches;
}

export function keyboardInset(win: Pick<Window, 'innerHeight' | 'visualViewport'>): number {
  const vv = win.visualViewport;
  if (!vv) return 0;
  const hidden = win.innerHeight - vv.height - vv.offsetTop;
  // Menos de 60 px es la barra del navegador que aparece y desaparece, no un teclado.
  return hidden > 60 ? Math.round(hidden) : 0;
}

/** ¿El elemento es un campo donde se escribe (y por tanto saca el teclado)? */
function isTextField(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (!(element instanceof HTMLInputElement)) return false;
  return !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(
    element.type,
  );
}

/** ¿Está el teclado en pantalla? (lo último que se ha medido; `<html data-kb>`). */
export function isKeyboardOpen(doc: Document = document): boolean {
  return doc.documentElement.hasAttribute('data-kb');
}

export function installViewportWatcher(win: Window = window): () => void {
  if (installed || !win.visualViewport) return () => {};
  installed = true;
  const doc = win.document;
  const root = doc.documentElement;
  let frame = 0;
  /* Lo más alto que se ha visto con este ancho (al girar, otra medida). */
  let tallest = { width: 0, height: 0 };
  const measure = () => {
    const vv = win.visualViewport;
    if (!vv) return;
    const inset = keyboardInset(win);
    root.style.setProperty('--kb', `${inset}px`);
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
    root.style.setProperty('--vvtop', `${Math.max(0, Math.round(vv.offsetTop))}px`);
    if (tallest.width !== Math.round(vv.width))
      tallest = { width: Math.round(vv.width), height: 0 };
    tallest.height = Math.max(tallest.height, vv.height, inset ? 0 : win.innerHeight);
    const dropped = tallest.height - vv.height > KB_DROP_PX && isTextField(doc.activeElement);
    if (inset > 0 || dropped) root.setAttribute('data-kb', '');
    else root.removeAttribute('data-kb');
    /* La sala no se desplaza: si el navegador la ha movido para enseñar el campo, vuelve. */
    const box = fixedRoom(win)
      ? doc.querySelector<HTMLElement>('.guest--room, .app-main .juntos')
      : null;
    if (box) {
      box.scrollTop = 0;
      if (box.matches('.juntos') && (win.scrollY || win.pageYOffset)) win.scrollTo(0, 0);
    }
  };
  const update = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(measure);
  };
  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (
      !(target instanceof HTMLElement) ||
      !target.matches('input, textarea, select, [contenteditable="true"]')
    )
      return;
    /* Dentro de la sala no: ella ya se pone en lo que se ve (y el chat baja solo). */
    if (target.closest(ROOM_BOX)) return;
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
  doc.addEventListener('focusin', onFocusIn);
  /* Android: el teclado se va al perder el foco aunque el alto tarde en volver. */
  doc.addEventListener('focusout', update);
  update();
  return () => {
    installed = false;
    cancelAnimationFrame(frame);
    win.visualViewport?.removeEventListener('resize', update);
    win.visualViewport?.removeEventListener('scroll', update);
    doc.removeEventListener('focusin', onFocusIn);
    doc.removeEventListener('focusout', update);
    root.style.removeProperty('--kb');
    root.style.removeProperty('--vvh');
    root.style.removeProperty('--vvtop');
    root.removeAttribute('data-kb');
  };
}
