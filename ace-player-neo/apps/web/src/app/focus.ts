/* Enfocar algo de otra vista sin acoplarse a ella. El atajo «/» abre la
   biblioteca y enfoca su buscador: el armazón navega y pide el foco para
   `buscar-biblioteca`; la biblioteca solo tiene que marcar su campo con
   data-focus-target="buscar-biblioteca" (TextField tiene la prop
   `focusTarget`). Se reintenta en cada fotograma durante 1,5 s por si la
   vista aún se está descargando. */

export function requestFocus(
  target: string,
  { timeoutMs = 1500, doc = document }: { timeoutMs?: number; doc?: Document } = {},
): Promise<boolean> {
  const started = performance.now();
  return new Promise((resolve) => {
    const attempt = () => {
      const el = doc.querySelector<HTMLElement>(`[data-focus-target="${CSS.escape(target)}"]`);
      // Solo si se ve (una vista oculta por Activity está en display: none).
      if (el && el.getClientRects().length > 0) {
        el.focus({ preventScroll: false });
        resolve(true);
        return;
      }
      if (performance.now() - started > timeoutMs) {
        resolve(false);
        return;
      }
      requestAnimationFrame(attempt);
    };
    attempt();
  });
}
