/* Lógica pura de «Desde fuera de casa» (el dominio de la app de iPhone, tv.ismaeloul.es;
   docs/acceso-remoto.md «Por el dominio»): textos del permiso de cada aparato, del registro y de
   los avisos. Sin React ni red. */

import type {
  Device,
  RemoteDeviceView,
  RemoteEvent,
  RemoteEventKind,
  RemoteExpiresIn,
  RemoteView,
} from '@ace/shared';
import { formatWhen } from '../health/model.ts';

/** Las caducidades del selector, en este orden; la propuesta es 30 días. */
export const EXPIRY_OPTIONS: readonly { value: RemoteExpiresIn; label: string }[] = [
  { value: '24h', label: '24 horas' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
  { value: 'never', label: 'Sin caducidad' },
];
export const DEFAULT_EXPIRY: RemoteExpiresIn = '30d';

const MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sept',
  'oct',
  'nov',
  'dic',
];

/** «1 dic» (y la hora si es hoy o mañana: «hoy a las 21:40»). */
export function shortDate(iso: string, now: number = Date.now()): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '—';
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d.toDateString();
  };
  if (at.toDateString() === day(0)) return `hoy a las ${time}`;
  if (at.toDateString() === day(1)) return `mañana a las ${time}`;
  return `${at.getDate()} ${MONTHS[at.getMonth()] ?? ''}`.trim();
}

/** «Caduca el 1 dic», «Caducó el 1 dic», «Sin caducidad». */
export function expiryText(
  view: Pick<RemoteDeviceView, 'expiresAt' | 'expired'>,
  now = Date.now(),
): string {
  if (!view.expiresAt) return 'Sin caducidad';
  const when = shortDate(view.expiresAt, now);
  const prefix = view.expired ? 'Caducó' : 'Caduca';
  return when.startsWith('hoy') || when.startsWith('mañana')
    ? `${prefix} ${when}`
    : `${prefix} el ${when}`;
}

/** «Último acceso desde fuera: hace 3 min · 92.184.12.7» o «Nunca». */
export function lastAccessText(
  view: Pick<RemoteDeviceView, 'lastAccess'>,
  now = Date.now(),
): string {
  if (!view.lastAccess) return 'Último acceso desde fuera: nunca';
  const when = formatWhen(view.lastAccess.at, now);
  const relative = /^\d/.test(when.relative)
    ? `el ${when.relative}, a las ${when.time}`
    : when.relative;
  return `Último acceso desde fuera: ${relative} · ${view.lastAccess.ip}`;
}

export const EVENT_LABEL: Record<RemoteEventKind, string> = {
  'ok-new-ip': 'Entró desde una IP nueva',
  'denied-device': 'Intentó entrar sin permiso',
  blocked: 'IP bloqueada por demasiados fallos',
  unblocked: 'Desbloqueada',
  'peer-mismatch': 'Llamada al puerto del dominio que no venía de Caddy',
  enabled: 'Acceso encendido',
  disabled: 'Acceso apagado',
  expired: 'Permiso caducado',
};

/** Grupos del filtro del registro. */
export type EventFilter = 'all' | 'access' | 'denied' | 'changes';
export const EVENT_FILTERS: readonly { value: EventFilter; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'access', label: 'Accesos' },
  { value: 'denied', label: 'Rechazos' },
  { value: 'changes', label: 'Cambios' },
];
const FILTER_KINDS: Record<Exclude<EventFilter, 'all'>, readonly RemoteEventKind[]> = {
  access: ['ok-new-ip'],
  denied: ['denied-device', 'blocked', 'peer-mismatch'],
  changes: ['enabled', 'disabled', 'expired', 'unblocked'],
};

export function filterEvents(events: readonly RemoteEvent[], filter: EventFilter): RemoteEvent[] {
  if (filter === 'all') return [...events];
  const kinds = FILTER_KINDS[filter];
  return events.filter((event) => kinds.includes(event.kind));
}

/** «Tu iPhone de Isma: entró desde una IP nueva · 92.184.12.7 · hace 3 min». */
export function eventText(
  event: RemoteEvent,
  names: ReadonlyMap<string, string>,
  now = Date.now(),
): string {
  const who = event.deviceId ? (names.get(event.deviceId) ?? 'Un aparato que ya no está') : null;
  /* Los bloqueos de un mismo minuto pasados los primeros van juntos (sin IP). */
  const what =
    event.kind === 'blocked' && event.count !== undefined
      ? `${event.count === 1 ? 'Otra IP bloqueada' : `${event.count} IPs más bloqueadas`} por demasiados fallos en un minuto`
      : EVENT_LABEL[event.kind];
  const when = formatWhen(event.at, now);
  const time = /^\d/.test(when.relative) ? `${when.relative}, ${when.time}` : when.relative;
  return [who ? `${who}: ${what.charAt(0).toLowerCase()}${what.slice(1)}` : what, event.ip, time]
    .filter(Boolean)
    .join(' · ');
}

export interface RemoteAlerts {
  /** Peticiones bloqueadas por IP en las últimas 24 h. */
  readonly blocked: number;
  /** Aparatos emparejados que intentaron entrar desde fuera en 24 h y siguen sin permiso. */
  readonly denied: readonly { readonly deviceId: string; readonly name: string }[];
  /** En 24 h hubo accesos con una IP que no es de internet: Caddy no ve la IP real. */
  readonly ipUntrusted: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function remoteAlerts(
  view: RemoteView,
  devices: readonly Pick<Device, 'id' | 'name' | 'revokedAt'>[],
  now = Date.now(),
): RemoteAlerts {
  const allowed = new Set(
    view.devices.filter((device) => device.enabled && !device.expired).map((d) => d.deviceId),
  );
  const names = new Map(devices.filter((d) => !d.revokedAt).map((d) => [d.id, d.name]));
  const seen = new Set<string>();
  const denied: { deviceId: string; name: string }[] = [];
  for (const event of view.events) {
    if (event.kind !== 'denied-device' || !event.deviceId) continue;
    if (now - Date.parse(event.at) > DAY_MS) continue;
    if (allowed.has(event.deviceId) || seen.has(event.deviceId)) continue;
    const name = names.get(event.deviceId);
    if (!name) continue;
    seen.add(event.deviceId);
    denied.push({ deviceId: event.deviceId, name });
  }
  return { blocked: view.last24h.blocked, denied, ipUntrusted: view.last24h.ipUntrusted > 0 };
}

/** «12 intentos bloqueados desde fuera en las últimas 24 h». */
export function blockedText(count: number): string {
  return count === 1
    ? '1 intento bloqueado desde fuera en las últimas 24 h'
    : `${count} intentos bloqueados desde fuera en las últimas 24 h`;
}
