/* Lógica pura de Ajustes → Dispositivos (arquitectura §5.12 y §7.3): textos,
   orden de la lista, cuenta atrás del código y si la dirección de esta página
   le sirve a un iPhone. Sin React ni red. */

import type { Device, DevicePlatform } from '@ace/shared';
import type { IconName } from '../../ui/icons.ts';
import { formatWhen } from '../health/model.ts';

export const PLATFORM_LABEL: Record<DevicePlatform, string> = {
  ios: 'iPhone',
  ipados: 'iPad',
  macos: 'Mac',
  other: 'Otro dispositivo',
};

export const PLATFORM_ICON: Record<DevicePlatform, IconName> = {
  ios: 'movil',
  ipados: 'movil',
  macos: 'pantalla',
  other: 'link',
};

/** «Conectado hace 5 min», «Aún no se ha conectado». */
export function lastSeenText(device: Pick<Device, 'lastSeenAt'>, now: number = Date.now()): string {
  if (!device.lastSeenAt) return 'Aún no se ha conectado';
  const at = Date.parse(device.lastSeenAt);
  // El backend la apunta como mucho una vez por minuto: por debajo de 2 min es «ahora».
  if (Number.isFinite(at) && now - at < 2 * 60_000) return 'Conectado ahora mismo';
  const when = formatWhen(device.lastSeenAt, now);
  if (when.relative === 'ayer') return `Visto ayer, a las ${when.time}`;
  if (/^\d/.test(when.relative)) return `Visto el ${when.relative}, a las ${when.time}`;
  return `Visto ${when.relative}`;
}

const DATE = (() => {
  try {
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return null;
  }
})();

/** «Emparejado el 23 sept 2026». */
export function pairedText(device: Pick<Device, 'createdAt'>): string {
  const at = new Date(device.createdAt);
  if (Number.isNaN(at.getTime())) return 'Emparejado';
  return `Emparejado el ${DATE ? DATE.format(at).replace('.', '') : at.toLocaleDateString('es-ES')}`;
}

export function revokedText(device: Pick<Device, 'revokedAt'>): string {
  if (!device.revokedAt) return '';
  const at = new Date(device.revokedAt);
  return `Revocado el ${DATE ? DATE.format(at).replace('.', '') : at.toLocaleDateString('es-ES')}`;
}

export interface SplitDevices {
  active: Device[];
  revoked: Device[];
}

/**
 * Activos primero, del último que se conectó al que menos (los que nunca se
 * conectaron, por fecha de emparejado); los revocados aparte, del más reciente.
 */
export function splitDevices(devices: readonly Device[]): SplitDevices {
  const seen = (d: Device) => Date.parse(d.lastSeenAt ?? d.createdAt) || 0;
  const active = devices.filter((d) => !d.revokedAt).sort((a, b) => seen(b) - seen(a));
  const revoked = devices
    .filter((d) => d.revokedAt)
    .sort((a, b) => (Date.parse(b.revokedAt ?? '') || 0) - (Date.parse(a.revokedAt ?? '') || 0));
  return { active, revoked };
}

/** «482913» → «482 913» (se lee y se teclea mejor en dos grupos de 3). */
export function groupCode(code: string): string {
  return code.length === 6 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

/** Para lectores de pantalla: cifra a cifra («4 8 2 9 1 3»). */
export function spellCode(code: string): string {
  return code.split('').join(' ');
}

/** 299 000 ms → «4:59». */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, '0')}`;
}

export type OriginKind = 'local' | 'tailscale' | 'lan' | 'other';

/**
 * Qué dirección irá en el QR (la de esta página) y si le sirve a un iPhone:
 * - `local`: localhost o 127.0.0.1 / ::1. NO sirve: en el iPhone «localhost»
 *   es el propio iPhone.
 * - `tailscale`: *.ts.net o 100.64.0.0/10. Sirve dentro y fuera de casa (con
 *   Tailscale activo en el iPhone).
 * - `lan`: *.local o IP privada. Solo sirve en tu red.
 */
export function originKind(hostname: string): OriginKind {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host === '::1' || /^127\./.test(host) || host.endsWith('.localhost'))
    return 'local';
  if (host.endsWith('.ts.net')) return 'tailscale';
  const v4 = /^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    if (a === 100 && b >= 64 && b <= 127) return 'tailscale';
    if (a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)) return 'lan';
    return 'other';
  }
  if (
    host.endsWith('.local') ||
    host.endsWith('.lan') ||
    host.endsWith('.home') ||
    !host.includes('.')
  )
    return 'lan';
  return 'other';
}

/** La imagen del QR: el SVG del backend como imagen (una <img> no ejecuta nada de lo que traiga). */
export function qrImageSrc(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
