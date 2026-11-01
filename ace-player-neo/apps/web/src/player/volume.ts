/* El volumen de ESTE aparato en el ordenador (reproductor de casa y «Ver
   juntos»): las cuentas y lo que se recuerda.

   - Se recuerda el nivel (no el silencio): al volver, suena como lo dejaste.
     El silencio no se guarda porque el arranque solo del navegador ya lo
     decide (y un «silenciado» recordado parecería una avería).
   - Un 0 tampoco se guarda: bajar del todo es silenciar, y al volver no se
     oiría nada.
   - En el móvil no se usa: allí mandan los botones del teléfono (y Safari de
     iOS ni deja cambiar `video.volume`). */

import { readItem, STORAGE_KEYS, writeItem } from '../lib/storage.ts';

/** Lo que mueve cada pulsación de ↑ ↓ (o de ← →) y cada paso de la rueda. */
export const VOLUME_STEP = 0.05;
/** Re Pág / Av Pág: un salto más grande. */
export const VOLUME_PAGE = 0.1;

/** Entre 0 y 1, redondeado al paso (sin colas de coma flotante: 0.30000000000000004). */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(clamped * 100) / 100;
}

/** «40 %» para el lector de pantalla (aria-valuetext). */
export function volumeText(value: number): string {
  return `${Math.round(clampVolume(value) * 100)} %`;
}

/** El volumen que pide esta tecla sobre el deslizador, o null si no es suya. */
export function volumeForKey(key: string, current: number): number | null {
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return clampVolume(current + VOLUME_STEP);
    case 'ArrowDown':
    case 'ArrowLeft':
      return clampVolume(current - VOLUME_STEP);
    case 'PageUp':
      return clampVolume(current + VOLUME_PAGE);
    case 'PageDown':
      return clampVolume(current - VOLUME_PAGE);
    case 'Home':
      return 0;
    case 'End':
      return 1;
    default:
      return null;
  }
}

/** Lo que hay que desplazar para un paso: un clic de la rueda de siempre (unos 100 px). */
export const WHEEL_STEP_PX = 100;
/** Entre dos pasos de la rueda pasa al menos esto (la inercia del trackpad no lo lleva al tope). */
export const WHEEL_STEP_MS = 50;
/** `deltaMode` en líneas y en páginas, en píxeles. */
const WHEEL_LINE_PX = 40;
const WHEEL_PAGE_PX = 800;

/** Lo desplazado que aún no ha dado un paso y cuándo se dio el último. */
export interface WheelState {
  readonly rest: number;
  readonly at: number;
}

export const WHEEL_IDLE: WheelState = { rest: 0, at: Number.NEGATIVE_INFINITY };

/**
 * La rueda, por lo desplazado y no por evento: un trackpad o un Magic Mouse mandan decenas de
 * eventos de 1 a 10 px por gesto (más la inercia), y a un paso por evento iba de 0 a 100 % de un
 * golpe. Se suma hasta `WHEEL_STEP_PX` (la rueda de siempre, ~100 por clic, sigue dando un paso
 * por clic) y como mucho un paso cada `WHEEL_STEP_MS`. Cambiar de sentido empieza de cero.
 * `step`: +1 sube, −1 baja, 0 nada.
 */
export function wheelStep(
  state: WheelState,
  deltaY: number,
  deltaMode: number,
  now: number,
): { step: -1 | 0 | 1; state: WheelState } {
  if (deltaY === 0 || !Number.isFinite(deltaY)) return { step: 0, state };
  const px = deltaY * (deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1);
  const base = Math.sign(state.rest) === Math.sign(px) ? state.rest : 0;
  const rest = Math.max(-WHEEL_STEP_PX, Math.min(WHEEL_STEP_PX, base + px));
  if (Math.abs(rest) < WHEEL_STEP_PX || now - state.at < WHEEL_STEP_MS) {
    return { step: 0, state: { rest, at: state.at } };
  }
  return { step: rest < 0 ? 1 : -1, state: { rest: 0, at: now } };
}

/** El volumen guardado en este navegador, o null si no hay (o no vale). */
export function readSavedVolume(): number | null {
  const raw = readItem(STORAGE_KEYS.volume);
  if (raw === null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > 1) return null;
  return clampVolume(value);
}

/** Guarda el nivel elegido (un 0 no: eso es silenciar). */
export function saveVolume(value: number): void {
  const level = clampVolume(value);
  if (level <= 0) return;
  writeItem(STORAGE_KEYS.volume, String(level));
}

/** Pone en el <video> el volumen guardado (si lo hay). Devuelve si lo cambió. */
export function applySavedVolume(video: HTMLVideoElement): boolean {
  const saved = readSavedVolume();
  if (saved === null || Math.abs(video.volume - saved) < 0.001) return false;
  try {
    video.volume = saved;
    return true;
  } catch {
    return false;
  }
}
