/* Respuesta háptica del prototipo.

   En la app real (SwiftUI) cada tipo se traduce a `.sensoryFeedback`:
     selection → .selection · light/medium/heavy → .impact(weight:) ·
     success/warning/error → .success / .warning / .error · rigid → .impact(flexibility: .rigid).

   Aquí: Android usa `navigator.vibrate`; en iPhone (Safari 17.4+) se aprovecha que
   un `<input type="checkbox" switch>` nativo vibra al cambiar dentro de un gesto del
   usuario; en escritorio no hay motor, así que se emite un evento para que el marco
   del prototipo enseñe un aviso discreto («⌁ impacto suave») y se vea dónde dispara. */

export type HapticKind = 'selection' | 'light' | 'medium' | 'heavy' | 'rigid' | 'success' | 'warning' | 'error';

const PATTERN: Record<HapticKind, number | number[]> = {
  selection: 6,
  light: 10,
  medium: 18,
  heavy: 28,
  rigid: 14,
  success: [12, 60, 18],
  warning: [18, 70, 18],
  error: [24, 60, 24, 60, 24],
};

export const HAPTIC_LABEL: Record<HapticKind, string> = {
  selection: 'selección',
  light: 'impacto suave',
  medium: 'impacto medio',
  heavy: 'impacto fuerte',
  rigid: 'impacto rígido',
  success: 'éxito',
  warning: 'aviso',
  error: 'error',
};

let switchEl: HTMLInputElement | null = null;
let lastAt = 0;
let lastKind: HapticKind | null = null;

function iosSwitch() {
  if (!switchEl) {
    switchEl = document.createElement('input');
    switchEl.type = 'checkbox';
    switchEl.setAttribute('switch', '');
    switchEl.setAttribute('aria-hidden', 'true');
    switchEl.tabIndex = -1;
    Object.assign(switchEl.style, { position: 'fixed', left: '-40px', top: '0', width: '1px', height: '1px', opacity: '0', pointerEvents: 'none' });
    document.body.appendChild(switchEl);
  }
  try {
    switchEl.click();
  } catch {
    /* sin soporte */
  }
}

/** Dispara una respuesta háptica. Se ignora si «reducir movimiento» está activo en el simulador. */
export function haptic(kind: HapticKind = 'selection') {
  if (typeof window === 'undefined') return;
  const now = performance.now();
  // Evita ráfagas: la misma sensación no se repite en menos de 40 ms.
  if (kind === lastKind && now - lastAt < 40) return;
  lastAt = now;
  lastKind = kind;
  if (document.documentElement.dataset.motion === 'reduced' && kind === 'selection') return;
  const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
  if (typeof nav.vibrate === 'function') {
    try {
      nav.vibrate(PATTERN[kind]);
    } catch {
      /* nada */
    }
  } else if (/iPhone|iPad|iPod/.test(navigator.userAgent)) {
    iosSwitch();
    if (kind === 'success' || kind === 'error' || kind === 'heavy') setTimeout(iosSwitch, 70);
  }
  window.dispatchEvent(new CustomEvent<HapticKind>('aceneo:haptic', { detail: kind }));
}
