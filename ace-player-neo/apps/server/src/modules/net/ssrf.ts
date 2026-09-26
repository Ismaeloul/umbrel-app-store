/* Filtro anti-SSRF del cliente saliente (server.js:1276-1335, B-227).

   Porta `normalizedIp`, `isPrivateAddress`, `isPrivateHostname`,
   `resolveFetchAddresses` y `pinnedLookup` con la lista EXACTA de la 0.6.59,
   ampliada donde se quedaba corta (cada ampliación, marcada «0.7.0», va a
   docs/compat.md):

   - IPv4: también 192.88.99.0/24 (relé 6to4, RFC 7526).
   - IPv6: todo lo que no sea unicast global (fuera de 2000::/3) es privado,
     y dentro de 2000::/3 también 2001::/23 (Teredo, benchmarking, ORCHID),
     2002::/16 (6to4, lleva una IPv4 dentro) y 3fff::/20 (documentación).
     Así caen, por ejemplo, las IPv4 «compatibles» `::7f00:1` (la 0.6.59 solo
     bloqueaba `::`), 100::/64 y 5f00::/16.
   - Nombres: también `.lan`, `.localdomain`, `.home`, `.corp`, `.intranet`,
     `.private` y los nombres de una sola etiqueta que no son una IP
     (`http://acestream:6878/` es un contenedor de la red de Docker).
   - Una respuesta DNS que no es una IP se rechaza (`dns_failed`) en vez de
     dejarla pasar. */

import { BlockList, isIP } from 'node:net';
import type { LookupAddress } from 'node:dns';
import { AppError } from '../../core/errors.js';
import type { NetResolver, ResolvedAddress } from './types.js';

/** `normalizedIp` (server.js:1276-1278): sin corchetes ni zona, en minúsculas. */
export function normalizedIp(value: unknown): string {
  return String(value || '')
    .replace(/^\[|\]$/g, '')
    .split('%')[0]!
    .toLowerCase();
}

/* PRIVATE_IPV6 (server.js:148-154), tal cual. */
const PRIVATE_IPV6_0659: readonly (readonly [string, number])[] = [
  ['::', 128],
  ['::1', 128],
  ['::ffff:0:0', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
];

/* 0.7.0: bloques de uso especial que no son alcanzables desde internet
   (registro de IANA «IPv6 Special-Purpose Address Space»). Los que caen
   fuera de 2000::/3 ya los cubre la regla del unicast global; se listan
   igual para que se vea qué se bloquea. */
const PRIVATE_IPV6_0700: readonly (readonly [string, number])[] = [
  ['::', 96],
  ['100::', 64],
  ['2001::', 23],
  ['2002::', 16],
  ['3fff::', 20],
  ['5f00::', 16],
];

const PRIVATE_IPV6 = new BlockList();
for (const [address, prefix] of [...PRIVATE_IPV6_0659, ...PRIVATE_IPV6_0700]) {
  PRIVATE_IPV6.addSubnet(address, prefix, 'ipv6');
}

/* Unicast global: lo único que IANA reparte para internet. */
const GLOBAL_UNICAST_IPV6 = new BlockList();
GLOBAL_UNICAST_IPV6.addSubnet('2000::', 3, 'ipv6');

/** `isPrivateAddress` (server.js:1280-1301), ampliada. `false` si no es una IP. */
export function isPrivateAddress(value: unknown): boolean {
  const address = normalizedIp(value);
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113) ||
      // 0.7.0: relé 6to4 (RFC 7526)
      (a === 192 && b === 88 && c === 99)
    );
  }
  if (isIP(address) === 6) {
    return PRIVATE_IPV6.check(address, 'ipv6') || !GLOBAL_UNICAST_IPV6.check(address, 'ipv6');
  }
  return false;
}

/* 0.7.0: dominios de uso privado habituales además de los de la 0.6.59. */
const PRIVATE_SUFFIXES_0700 = ['lan', 'localdomain', 'home', 'corp', 'intranet', 'private'];

/** `isPrivateHostname` (server.js:1303-1308), ampliada. */
export function isPrivateHostname(hostname: unknown): boolean {
  const value = normalizedIp(hostname).replace(/\.$/, '');
  if (
    value === 'localhost' ||
    value.endsWith('.localhost') ||
    value.endsWith('.local') ||
    value.endsWith('.internal') ||
    value === 'home.arpa' ||
    value.endsWith('.home.arpa')
  ) {
    return true;
  }
  if (PRIVATE_SUFFIXES_0700.some((suffix) => value === suffix || value.endsWith(`.${suffix}`))) {
    return true;
  }
  /* Una sola etiqueta y no es una IP: un nombre de la red local o de Docker. */
  return value !== '' && !value.includes('.') && isIP(value) === 0;
}

function familyOf(address: string): 4 | 6 | 0 {
  const family = isIP(address);
  return family === 4 || family === 6 ? family : 0;
}

/**
 * `resolveFetchAddresses` (server.js:1310-1324): IP literal o resolución DNS,
 * rechazando destinos privados. Con `allowPrivate` (ALLOW_PRIVATE_SYNC_URLS)
 * no se filtra nada, pero se sigue resolviendo aquí y fijando la IP (la
 * 0.6.59 dejaba entonces la resolución a Node).
 */
export async function resolveFetchAddresses(
  parsed: URL,
  resolver: NetResolver,
  allowPrivate: boolean,
): Promise<ResolvedAddress[]> {
  const hostname = normalizedIp(parsed.hostname);
  if (!allowPrivate && (isPrivateHostname(hostname) || isPrivateAddress(hostname))) {
    throw new AppError('private_url', { detail: hostname });
  }
  const literal = familyOf(hostname);
  if (literal) return [{ address: hostname, family: literal }];
  let entries: readonly ResolvedAddress[];
  try {
    entries = await resolver.lookup(hostname);
  } catch (error) {
    throw new AppError('dns_failed', { detail: hostname, cause: error });
  }
  if (!entries.length) throw new AppError('dns_failed', { detail: hostname });
  const addresses: ResolvedAddress[] = [];
  for (const entry of entries) {
    const address = normalizedIp(entry.address);
    const family = familyOf(address);
    // 0.7.0: una respuesta que no es una IP no se deja pasar
    if (!family) throw new AppError('dns_failed', { detail: `${hostname}: ${entry.address}` });
    addresses.push({ address, family });
  }
  if (!allowPrivate && addresses.some((entry) => isPrivateAddress(entry.address))) {
    throw new AppError('private_url', {
      detail: `${hostname} → ${addresses.map((entry) => entry.address).join(', ')}`,
    });
  }
  return addresses;
}

// --- Filtro de la IPTV (docs/iptv.md §3.1) ---

/* Redes de casa que se pueden permitir con ALLOW_PRIVATE_SYNC_URLS: solo
   RFC1918 y las ULA de IPv6. Nunca loopback, enlace local, metadatos,
   multicast, 0.0.0.0/8, CGNAT ni nada reservado. */
const LAN_NETWORKS = new BlockList();
LAN_NETWORKS.addSubnet('10.0.0.0', 8, 'ipv4');
LAN_NETWORKS.addSubnet('172.16.0.0', 12, 'ipv4');
LAN_NETWORKS.addSubnet('192.168.0.0', 16, 'ipv4');
LAN_NETWORKS.addSubnet('fc00::', 7, 'ipv6');
/* Las redes de Docker del propio Umbrel (umbrel_main_network 10.21.0.0/16 y
   docker0 172.17.0.0/16) nunca cuentan como casa: una lista hostil haría que
   el relé o ffmpeg pidieran cosas a los otros contenedores. */
const DOCKER_NETWORKS = new BlockList();
DOCKER_NETWORKS.addSubnet('10.21.0.0', 16, 'ipv4');
DOCKER_NETWORKS.addSubnet('172.17.0.0', 16, 'ipv4');

/**
 * ¿Es una dirección de la red de casa (RFC1918 o ULA, sin las redes de Docker
 * del Umbrel)? Las v4 mapeadas en v6 cuentan como v4.
 */
export function isLanAddress(value: unknown): boolean {
  const address = normalizedIp(value);
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isLanAddress(mapped[1]);
  const family = isIP(address);
  if (family === 4)
    return LAN_NETWORKS.check(address, 'ipv4') && !DOCKER_NETWORKS.check(address, 'ipv4');
  if (family === 6) return LAN_NETWORKS.check(address, 'ipv6');
  return false;
}

/** Cómo se filtra una URL que decide el proveedor de IPTV. */
export interface IptvAddressPolicy {
  /** ALLOW_PRIVATE_SYNC_URLS. */
  readonly allowPrivate: boolean;
  /**
   * El host que escribió Isma ya es de su red local: solo entonces, y solo
   * con `allowPrivate`, se permiten además RFC1918 y ULA.
   */
  readonly lan: boolean;
  /** Puertos que nunca se abren (el del relé local). */
  readonly blockedPorts?: readonly number[];
}

function effectivePort(parsed: URL): number {
  if (parsed.port) return Number(parsed.port);
  return parsed.protocol === 'https:' ? 443 : 80;
}

/**
 * Resolución y filtro de una URL de la IPTV (lista, guía, stream, segmento,
 * clave o redirección). Más duro que `resolveFetchAddresses`: aunque
 * ALLOW_PRIVATE_SYNC_URLS esté activado se bloquean siempre loopback, enlace
 * local, metadatos, multicast, 0.0.0.0/8, los nombres de una sola etiqueta
 * (los de Docker) y el puerto del relé. Con el interruptor solo se permiten
 * además RFC1918 y ULA, y solo si el host configurado ya es de casa. El
 * `detail` de los errores lleva solo el host.
 */
export async function resolveIptvAddresses(
  parsed: URL,
  resolver: NetResolver,
  policy: IptvAddressPolicy,
): Promise<ResolvedAddress[]> {
  const hostname = normalizedIp(parsed.hostname).replace(/\.$/, '');
  const lanOk = policy.allowPrivate && policy.lan;
  if (policy.blockedPorts?.includes(effectivePort(parsed))) {
    throw new AppError('private_url', { detail: hostname });
  }
  const literal = familyOf(hostname);
  const singleLabel = !literal && hostname !== '' && !hostname.includes('.');
  const loopbackName = hostname === 'localhost' || hostname.endsWith('.localhost');
  if (singleLabel || loopbackName) throw new AppError('private_url', { detail: hostname });
  const allowed = (address: string): boolean =>
    !isPrivateAddress(address) || (lanOk && isLanAddress(address));
  if (literal) {
    if (!allowed(hostname)) throw new AppError('private_url', { detail: hostname });
    return [{ address: hostname, family: literal }];
  }
  /* Nombres de uso privado (.local, .lan…): solo si la red de casa vale; lo
     que manda después es la IP a la que resuelven. */
  if (!lanOk && isPrivateHostname(hostname)) {
    throw new AppError('private_url', { detail: hostname });
  }
  let entries: readonly ResolvedAddress[];
  try {
    entries = await resolver.lookup(hostname);
  } catch (error) {
    throw new AppError('dns_failed', { detail: hostname, cause: error });
  }
  if (!entries.length) throw new AppError('dns_failed', { detail: hostname });
  const addresses: ResolvedAddress[] = [];
  for (const entry of entries) {
    const address = normalizedIp(entry.address);
    const family = familyOf(address);
    if (!family) throw new AppError('dns_failed', { detail: hostname });
    addresses.push({ address, family });
  }
  if (addresses.some((entry) => !allowed(entry.address))) {
    throw new AppError('private_url', { detail: hostname });
  }
  return addresses;
}

/**
 * ¿El host que escribió Isma es de su red local? Una IP de casa escrita tal
 * cual, o un nombre que resuelve SOLO a direcciones de casa. Sirve para
 * decidir `IptvAddressPolicy.lan`; con cualquier fallo, `false`.
 */
export async function hostIsLan(hostname: string, resolver: NetResolver): Promise<boolean> {
  const host = normalizedIp(hostname).replace(/\.$/, '');
  if (!host) return false;
  if (familyOf(host)) return isLanAddress(host);
  if (!host.includes('.') || host === 'localhost' || host.endsWith('.localhost')) return false;
  try {
    const entries = await resolver.lookup(host);
    return entries.length > 0 && entries.every((entry) => isLanAddress(entry.address));
  } catch {
    return false;
  }
}

type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

/**
 * `pinnedLookup` (server.js:1326-1335): el `lookup` que se da a la conexión.
 * Solo devuelve las direcciones ya comprobadas; nunca vuelve a preguntar al
 * DNS, así que un cambio de respuesta entre la comprobación y la conexión
 * (DNS rebinding) no tiene efecto.
 */
export function pinnedLookup(addresses: readonly ResolvedAddress[]) {
  return (_hostname: string, options: unknown, callback: LookupCallback): void => {
    const config =
      options !== null && typeof options === 'object'
        ? (options as { family?: unknown; all?: unknown })
        : { family: options };
    const family = Number(config.family) || 0;
    const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
    const first = candidates[0];
    if (!first) {
      callback(new AppError('dns_failed', { detail: `sin direcciones IPv${family}` }), '');
      return;
    }
    if (config.all) {
      callback(
        null,
        candidates.map((entry) => ({ address: entry.address, family: entry.family })),
      );
      return;
    }
    callback(null, first.address, first.family);
  };
}
