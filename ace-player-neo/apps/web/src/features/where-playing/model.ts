/* «Dónde se está reproduciendo» (Ajustes y el mini-reproductor): lo que se
   enseña de cada sesión de GET /api/v1/playback y del evento SSE
   `playback.sessions`. Funciones puras (sin React): las prueba model.test.ts.

   Solo tipos de @ace/shared: importar sus valores arrastraría zod al trozo. */

import type { ClientKind, SessionSummary, SessionViewer, StreamProtocol } from '@ace/shared';
import type { IconName } from '../../ui/icons.ts';

/** Qué tipo de aparato es, para el icono. */
export type DeviceKind = 'ordenador' | 'movil' | 'tele';

export const KIND_ICON: Record<DeviceKind, IconName> = {
  ordenador: 'pantalla',
  movil: 'movil',
  tele: 'tv',
};

export const KIND_LABEL: Record<DeviceKind, string> = {
  ordenador: 'Ordenador',
  movil: 'Móvil',
  tele: 'Tele',
};

export const PLATFORM_LABEL: Record<ClientKind, string> = {
  web: 'Web',
  ios: 'App Ace Neo',
  legacy: 'App antigua',
};

export const PROTOCOL_LABEL: Record<StreamProtocol, string> = {
  mpegts: 'MPEG-TS',
  hls: 'HLS compartido',
  'hls-fmp4': 'HLS para iPhone',
};

/**
 * Ordenador, móvil o tele. La app (iOS) es un móvil salvo que su nombre diga
 * Mac; en la web lo dice el nombre sacado del User-Agent ("Safari · iPhone",
 * "Chrome · Windows", "Navegador · Smart TV").
 */
export function deviceKind(viewer: Pick<SessionViewer, 'platform' | 'deviceName'>): DeviceKind {
  const name = viewer.deviceName;
  if (/\bSmart TV\b/i.test(name)) return 'tele';
  if (viewer.platform === 'ios')
    return /\b(?:Mac|MacBook|iMac)\b/i.test(name) ? 'ordenador' : 'movil';
  if (/\b(?:iPhone|iPad|iPod|Android)\b/i.test(name)) return 'movil';
  if (viewer.platform === 'legacy') return 'movil';
  return 'ordenador';
}

export type PlayState = 'reproduciendo' | 'pausa' | 'conectado';

/** Del último latido; sin él todavía (o en las apps 0.6.x), «Conectado». */
export function playState(viewer: Pick<SessionViewer, 'playing'>): PlayState {
  if (viewer.playing === true) return 'reproduciendo';
  if (viewer.playing === false) return 'pausa';
  return 'conectado';
}

export const PLAY_TEXT: Record<PlayState, string> = {
  reproduciendo: 'Reproduciendo',
  pausa: 'En pausa',
  conectado: 'Conectado',
};

export const PLAY_ICON: Record<PlayState, IconName> = {
  reproduciendo: 'play',
  pausa: 'pause',
  conectado: 'senal',
};

/** El título que manda el servidor o, si no lo sabe, uno con el principio del id. */
export function sessionTitle(session: Pick<SessionSummary, 'title' | 'hash'>): string {
  return session.title.trim() || `Canal ${session.hash.slice(0, 8)}`;
}

export function countText(count: number): string {
  return count === 1 ? '1 dispositivo' : `${count} dispositivos`;
}

/** "21:04" en la hora de este dispositivo; "" si la fecha no vale. */
export function openedClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
}

export function isMine(viewer: Pick<SessionViewer, 'deviceId'>, deviceId: string): boolean {
  return viewer.deviceId !== null && viewer.deviceId === deviceId;
}

/**
 * Las sesiones que se enseñan: solo las que tienen a alguien viendo (una recién
 * abierta puede estar un instante sin visores), primero la de este
 * dispositivo y luego la más reciente; y en cada una, este dispositivo el
 * primero.
 */
export function visibleSessions(
  sessions: readonly SessionSummary[] | undefined,
  deviceId: string,
): SessionSummary[] {
  const mine = (session: SessionSummary) =>
    session.viewers.some((viewer) => isMine(viewer, deviceId)) ? 1 : 0;
  return (sessions ?? [])
    .filter((session) => session.viewers.length > 0)
    .map((session) => ({
      ...session,
      viewers: [...session.viewers].sort(
        (a, b) => Number(isMine(b, deviceId)) - Number(isMine(a, deviceId)),
      ),
    }))
    .sort((a, b) => mine(b) - mine(a) || b.openedAt.localeCompare(a.openedAt));
}

/** Frase para lectores de pantalla (se anuncia al cambiar). */
export function summaryText(sessions: readonly SessionSummary[]): string {
  if (!sessions.length) return 'No se está reproduciendo nada.';
  return sessions
    .map((session) => `«${sessionTitle(session)}» en ${countText(session.viewers.length)}`)
    .join('; ')
    .concat('.');
}

/**
 * Otros dispositivos (distintos de este) que ven la misma sesión que este
 * visor. El mini-reproductor lo usa para enseñar su acceso en el móvil.
 */
export function otherDevicesWatching(
  sessions: readonly SessionSummary[] | undefined,
  viewerId: string,
  deviceId: string,
): number {
  const session = (sessions ?? []).find((candidate) =>
    candidate.viewers.some((viewer) => viewer.viewerId === viewerId),
  );
  if (!session) return 0;
  const others = new Set(
    session.viewers
      .filter((viewer) => viewer.viewerId !== viewerId && !isMine(viewer, deviceId))
      .map((viewer) => viewer.deviceId ?? viewer.viewerId),
  );
  return others.size;
}
