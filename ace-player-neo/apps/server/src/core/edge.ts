/* El puerto del dominio de fuera (`https://tv.ismaeloul.es`, docs/acceso-remoto.md «Por el
   dominio»).

   Caddy (servicio `sala`) llama a un SEGUNDO servidor HTTP del backend, en `ACE_EDGE_PORT` (3002),
   que nginx no conoce y que el Compose no publica. Una petición es «del dominio» porque entró por
   ese servidor, y eso se marca con un símbolo privado en la petición cruda (`req[EDGE]`): ninguna
   cabecera del cliente puede ponerlo. Por el 3000 (nginx, la LAN por el 7792), `X-Ace-Via` y
   `X-Ace-Client-Ip` se ignoran siempre.

   Como cualquier contenedor de la red de Docker del NAS puede conectarse al 3002 (R-1), además
   se exige que el par TCP sea la IP del contenedor de Caddy (`ACE_EDGE_PEER`, resuelta con
   `dns.lookup` y refrescada cada minuto). Si no coincide o el DNS no responde: 403 y un aviso.

   La IP del cliente es la que pone Caddy en `X-Ace-Client-Ip` (el par TCP que ve Caddy, nunca un
   `X-Forwarded-For` del cliente: Caddy los borra y no tiene `trusted_proxies`). Se valida como IPv4
   o IPv6; la clave de bloqueo es la IPv4 entera o el /64 de una IPv6. Si es privada, de bucle
   local, de Docker o CGNAT, no es «fiable»: Caddy no está viendo la IP de verdad (Docker con
   userland-proxy, o el NAT de retorno de la Freebox al usar el dominio desde casa) y bloquear por
   ella bloquearía a todo el mundo. */

import { lookup as dnsLookup } from 'node:dns/promises';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { BlockList, isIP } from 'node:net';
import { REMOTE_LIMITS } from '@ace/shared';
import type { Clock, TimerHandle } from './clock.js';
import type { Logger } from './logger.js';

/** Marca privada de «entró por el puerto del dominio». */
const EDGE = Symbol('ace.edge');

type EdgeMarked = IncomingMessage & { [EDGE]?: true };

export function markEdgeRequest(req: IncomingMessage): void {
  (req as EdgeMarked)[EDGE] = true;
}

/** ¿Entró por el servidor del 3002? (decide el socket, no una cabecera). */
export function isEdgeRequest(req: IncomingMessage): boolean {
  return (req as EdgeMarked)[EDGE] === true;
}

/** Cabecera que pone Caddy con la IP de quien llama. Solo se lee en el 3002. */
export const CLIENT_IP_HEADER = 'x-ace-client-ip';

/** Rangos que no son de internet: con ellos la IP no sirve para bloquear (Caddy no ve la real). */
const UNTRUSTED = new BlockList();
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
] as const) {
  UNTRUSTED.addSubnet(network, prefix, 'ipv4');
}
for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7],
  ['fe80::', 10],
] as const) {
  UNTRUSTED.addSubnet(network, prefix, 'ipv6');
}

export interface ClientIp {
  /** La IP tal cual (IPv4 de una IPv6 mapeada `::ffff:a.b.c.d` ya como IPv4); null si no vale. */
  readonly ip: string | null;
  /** Clave de bloqueo y de límites: IPv4 entera o el /64 (`2a01:e0a:1:2::`). */
  readonly key: string | null;
  /** IP de internet: se puede bloquear y limitar por ella. */
  readonly trusted: boolean;
}

/** Los 8 grupos de una IPv6 ya validada con `isIP` (sin zona), o null. */
function expandIpv6(ip: string): number[] | null {
  let text = (ip.toLowerCase().split('%')[0] ?? '').trim();
  const v4 = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (v4?.[1]) {
    const [a = 0, b = 0, c = 0, d = 0] = v4[1].split('.').map(Number);
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const parse = (part: string | undefined): number[] =>
    part ? part.split(':').map((group) => Number.parseInt(group, 16)) : [];
  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const groups = [...head, ...Array<number>(fill).fill(0), ...tail];
  const valid = (group: number): boolean =>
    Number.isInteger(group) && group >= 0 && group <= 0xffff;
  return groups.length === 8 && groups.every(valid) ? groups : null;
}

/** La IP que manda Caddy (o lo que sea que llegue en la cabecera), validada. */
export function parseClientIp(header: string | string[] | undefined): ClientIp {
  const raw = (Array.isArray(header) ? header[0] : header)?.trim() ?? '';
  const invalid: ClientIp = { ip: null, key: null, trusted: false };
  if (!raw || raw.length > 64) return invalid;
  const version = isIP(raw);
  if (version === 4) {
    return { ip: raw, key: raw, trusted: !UNTRUSTED.check(raw, 'ipv4') };
  }
  if (version !== 6) return invalid;
  const groups = expandIpv6(raw);
  if (!groups) return invalid;
  /* `::ffff:a.b.c.d`: es una IPv4. */
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const v4 = [groups[6] ?? 0, groups[7] ?? 0]
      .flatMap((group) => [group >> 8, group & 0xff])
      .join('.');
    return { ip: v4, key: v4, trusted: !UNTRUSTED.check(v4, 'ipv4') };
  }
  const ip = raw.toLowerCase().split('%')[0] ?? raw.toLowerCase();
  const key = `${groups
    .slice(0, 4)
    .map((group) => group.toString(16))
    .join(':')}::`;
  return { ip, key, trusted: !UNTRUSTED.check(ip, 'ipv6') };
}

/** Para enseñar una clave: la IPv4 o `<4 grupos>::/64`. */
export function blockKeyLabel(key: string): string {
  return key.endsWith('::') ? `${key}/64` : key;
}

/** `::ffff:172.18.0.5` → `172.18.0.5`. */
export function normalizePeer(address: string | undefined): string | null {
  if (!address) return null;
  const lower = address.toLowerCase();
  return lower.startsWith('::ffff:') && isIP(lower.slice(7)) === 4 ? lower.slice(7) : lower;
}

export type EdgeLookup = (host: string) => Promise<readonly string[]>;

const defaultLookup: EdgeLookup = async (host) => {
  const found = await dnsLookup(host, { all: true, verbatim: true });
  return found.map((entry) => entry.address);
};

/** Lo mínimo entre dos resoluciones a destiempo (`check`). */
export const PEER_RECHECK_MS = 5000;

/** La IP del contenedor de Caddy, resuelta al arrancar y cada minuto. */
export interface EdgePeer {
  /** ¿Es esta la IP de Caddy? Sin resolver (o sin `ACE_EDGE_PEER`), siempre no. */
  isPeer(address: string | undefined): boolean;
  resolved(): boolean;
  /** Vuelve a resolver ya (también la llama `start`). */
  refresh(): Promise<void>;
  /**
   * Como `isPeer`, pero si no coincide vuelve a resolver antes de decir que no (como mucho una vez
   * cada 5 s): al arrancar, `storage` sale antes que `sala` (que espera a que esté sano) y la
   * IP de Caddy cambia si se recrea su contenedor.
   */
  check(address: string | undefined): Promise<boolean>;
  start(): Promise<void>;
  stop(): void;
}

export function createEdgePeer(options: {
  readonly host: string | null;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly lookup?: EdgeLookup;
}): EdgePeer {
  const { host, clock, logger } = options;
  const lookup = options.lookup ?? defaultLookup;
  let addresses = new Set<string>();
  let timer: TimerHandle | null = null;
  let failing = false;
  let lastRefresh = Number.NEGATIVE_INFINITY;

  async function refresh(): Promise<void> {
    if (!host) return;
    lastRefresh = clock.now();
    try {
      const found = await lookup(host);
      addresses = new Set(found.map((address) => normalizePeer(address) ?? address));
      if (failing)
        logger.info({ peer: host }, 'dominio: vuelve a resolverse el contenedor de Caddy');
      failing = false;
    } catch (error) {
      /* Falla cerrado: sin la IP de Caddy, el puerto del dominio lo rechaza todo. */
      addresses = new Set();
      if (!failing) {
        logger.warn({ err: error, peer: host }, 'dominio: no se resuelve el contenedor de Caddy');
      }
      failing = true;
    }
  }

  return {
    isPeer(address) {
      const peer = normalizePeer(address);
      return peer !== null && addresses.has(peer);
    },
    resolved: () => addresses.size > 0,
    refresh,
    async check(address) {
      const peer = normalizePeer(address);
      if (peer !== null && addresses.has(peer)) return true;
      if (!host || clock.now() - lastRefresh < PEER_RECHECK_MS) return false;
      await refresh();
      return peer !== null && addresses.has(peer);
    },
    async start() {
      await refresh();
      if (!timer && host) {
        timer = clock.setInterval(() => void refresh(), REMOTE_LIMITS.peerRefreshMs, {
          unref: true,
        });
      }
    },
    stop() {
      clock.clearInterval(timer);
      timer = null;
    },
  };
}

/**
 * El servidor del 3002: plazos cortos para la cabecera y el cuerpo (no para la respuesta, que en
 * el SSE y el vídeo dura horas), cabeceras pequeñas, y cada petición marcada antes de pasársela
 * a Fastify (`app.routing`).
 */
export function createEdgeServer(
  routing: (req: IncomingMessage, res: ServerResponse) => void,
): Server {
  const server = http.createServer({ maxHeaderSize: 16 * 1024 }, (req, res) => {
    markEdgeRequest(req);
    routing(req, res);
  });
  server.headersTimeout = 10_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 65_000;
  return server;
}
