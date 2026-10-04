/* Cuentas y textos puros del reproductor de películas y episodios
   (docs/vod.md §12.7 y §12.9): el reloj «12:34 / 1:45:20», lo que queda, dónde
   sale la tarjeta del siguiente episodio, lo cargado por delante y la línea
   de «Formato» de Datos técnicos. Sin DOM: se prueban solas. */

import type { TimeRangesLike, VodGrant } from '@ace/shared';

/** Un salto con ← → / J L / los botones (§12.7). */
export const VOD_SEEK_STEP_S = 10;
/** Varias pulsaciones seguidas se juntan en un salto (§12.7). */
export const VOD_SEEK_COALESCE_MS = 300;
/** Un salto fuera de lo cargado: el servidor prepara el trozo (hasta 15 s, §9.7). */
export const VOD_SEEK_TIMEOUT_MS = 20_000;
/** Progreso: un `tick` cada 15 s reproduciendo, si la posición ha cambiado ≥ 1 s (§10.2). */
export const VOD_PROGRESS_TICK_MS = 15_000;
/** Progreso: el `seek`, 2 s después del último salto (§12.7). */
export const VOD_PROGRESS_SEEK_DELAY_MS = 2_000;
/** La cuenta atrás de la tarjeta «Siguiente episodio» (§12.9). */
export const VOD_NEXT_UP_COUNTDOWN_MS = 10_000;
/** Episodios seguidos que han saltado solos antes de «¿Sigues viendo?» (§12.9). */
export const VOD_STILL_WATCHING_AFTER = 3;
/** Sin respuesta a «¿Sigues viendo?»: se pausa y se suelta la sesión (§12.9). */
export const VOD_STILL_WATCHING_TIMEOUT_MS = 60_000;
/** «Reanudado en 43:12» con «Desde el principio» (§12.7). */
export const VOD_RESUMED_NOTICE_MS = 5_000;
/** Media Session: `setPositionState` cada 2 s (§12.7). */
export const VOD_POSITION_STATE_MS = 2_000;

/** «4:05», «12:34» o «1:45:20». */
export function clockText(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** «1 h 12 min», «12 min», «menos de 1 min». */
export function durationWords(seconds: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.round(total / 60);
  if (minutes < 1) return 'menos de 1 min';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** «Quedan 1 h 12 min» (o «Queda menos de 1 min»). */
export function remainingText(positionS: number, durationS: number): string {
  const left = Math.max(0, durationS - positionS);
  const words = durationWords(left);
  return words === 'menos de 1 min' ? 'Queda menos de 1 min' : `Quedan ${words}`;
}

/** Dónde sale «Siguiente episodio»: a `duración − max(20 s, 2 %)` (§12.9). */
export function nextUpAtS(durationS: number): number {
  return Math.max(0, durationS - Math.max(20, durationS * 0.02));
}

/** Un destino de salto dentro de la película (un poco antes del final, para no acabarla de golpe). */
export function clampPosition(target: number, durationS: number): number {
  if (!Number.isFinite(target)) return 0;
  const end = durationS > 1 ? durationS - 0.5 : Math.max(0, durationS);
  return Math.min(Math.max(0, target), end);
}

/** Hasta dónde hay vídeo cargado sin cortes desde `time` (el propio `time` si nada). */
export function bufferedEndAt(ranges: TimeRangesLike | null | undefined, time: number): number {
  if (!ranges || !Number.isFinite(time)) return Number.isFinite(time) ? time : 0;
  try {
    for (let i = 0; i < ranges.length; i += 1) {
      const start = ranges.start(i);
      const end = ranges.end(i);
      if (time >= start - 0.25 && time <= end) return end;
    }
  } catch {}
  return time;
}

const CODEC_NAMES: Record<string, string> = {
  h264: 'H.264',
  hevc: 'HEVC',
  aac: 'AAC',
  ac3: 'AC-3',
  eac3: 'E-AC-3',
  'e-ac-3': 'E-AC-3',
  'ac-3': 'AC-3',
  dts: 'DTS',
  mp3: 'MP3',
  opus: 'Opus',
  flac: 'FLAC',
  truehd: 'TrueHD',
};

function codecName(codec: string): string {
  return CODEC_NAMES[codec.toLowerCase()] ?? codec.toUpperCase();
}

/** «H.264 · AC-3 → AAC» (la pista que suena; «→ AAC» si se convierte, §9.9). */
export function formatText(vod: Pick<VodGrant['vod'], 'video' | 'audio' | 'audioIndex'>): string {
  const parts = [codecName(vod.video.codec)];
  const track = vod.audio.find((entry) => entry.index === vod.audioIndex) ?? vod.audio[0];
  if (track)
    parts.push(
      track.converted && track.codec.toLowerCase() !== 'aac'
        ? `${codecName(track.codec)} → AAC`
        : codecName(track.codec),
    );
  return parts.join(' · ');
}

/** «Calidad»: «1920×1080» si el índice la sabe. */
export function resolutionText(vod: Pick<VodGrant['vod'], 'video'>): string | null {
  const { width, height } = vod.video;
  return width && height ? `${width}×${height}` : null;
}
