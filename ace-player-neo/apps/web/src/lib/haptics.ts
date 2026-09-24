/* Respuesta háptica mínima de la web (plan Palco fase 2, decisión W13).

   La misma API que el prototipo (`haptic('selection' | 'light' | …)`) pero
   SOLO con `navigator.vibrate` (Android): sin el truco del interruptor de
   Safari ni avisos de escritorio (reglas del brief). En iPhone Safari no hay
   `vibrate`, así que la háptica es un extra y NUNCA la única señal de nada:
   siempre acompaña a algo que ya se ve.

   Reglas:
   - «selección» se silencia con «reducir movimiento»;
   - la misma sensación no se repite en menos de 40 ms (sin ráfagas);
   - nunca lanza: si el navegador no puede, devuelve false y ya. */

import { prefersReducedMotion } from './media.ts';

export type HapticKind =
  'selection' | 'light' | 'medium' | 'heavy' | 'rigid' | 'success' | 'warning' | 'error';

/** Patrones de `navigator.vibrate` (ms; en las listas alternan vibrar y parar). */
export const HAPTIC_PATTERN: Record<HapticKind, number | number[]> = {
  selection: 6,
  light: 10,
  medium: 18,
  heavy: 28,
  rigid: 14,
  success: [12, 60, 18],
  warning: [18, 70, 18],
  error: [24, 60, 24, 60, 24],
};

/**
 * Dónde dispara cada tipo (DESIGN.md › «Respuesta háptica»). Los agentes de
 * pantallas llaman a `haptic(kind)` en el gesto o en el resultado; el mapa
 * es la referencia para no inventar tipos nuevos.
 */
export const HAPTIC_MAP: Record<HapticKind, readonly string[]> = {
  selection: [
    'barra de navegación (cambio de destino)',
    'segmentados y pestañas (Para ti / Todos, Favoritos / Recientes / Listas)',
    'chips de gustos',
    'interruptores y radios de Ajustes',
    'cambio de día en la tira de días',
  ],
  light: [
    'destapar el marcador',
    'minimizar el reproductor',
    'abrir el mini (deslizar arriba)',
    'botones del vídeo (pausa, silencio)',
    'abrir un cartel de partido o de canal',
  ],
  medium: ['pantalla completa', 'cerrar una hoja', 'pulsación larga (menú contextual)'],
  rigid: ['elegir una fuente', 'detener la reproducción', 'cambio de fuente (zapping)'],
  heavy: ['umbral de descartar el mini (deslizar abajo)'],
  success: [
    'gol',
    'dispositivo emparejado',
    'fuente reportada',
    'Content ID pegado',
    'favorito guardado',
  ],
  warning: ['cambio automático de fuente'],
  error: ['código de emparejamiento inválido', 'fuente que falla al elegirla'],
};

const BURST_MS = 40;
let lastAt = -Infinity;
let lastKind: HapticKind | null = null;

/** Solo para los tests: olvida la última vibración. */
export function resetHaptics(): void {
  lastAt = -Infinity;
  lastKind = null;
}

/**
 * Dispara una respuesta háptica. Devuelve true solo si el dispositivo vibró
 * (o al menos aceptó el patrón).
 */
export function haptic(kind: HapticKind = 'selection'): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
  if (typeof nav.vibrate !== 'function') return false;
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (kind === lastKind && now - lastAt < BURST_MS) return false;
  if (kind === 'selection' && prefersReducedMotion()) return false;
  lastAt = now;
  lastKind = kind;
  try {
    return nav.vibrate(HAPTIC_PATTERN[kind]) !== false;
  } catch {
    return false;
  }
}
