/* Descarga de un directorio (server.js:1426-1436 y 1719-1798, B-196, B-197).

   - URL de IPFS (ipfsUrlParts): primero IPFS directo, sin pasarela pública
     (fetchIpfsDirectory). Si falla, la URL tal cual en la pasarela; si
     también falla, se lanza el error DEL CAMINO IPFS (server.js:1780-1781).
   - Cualquier otra URL, o la de respaldo: `net.fetchText`. Si una pasarela
     pública se satura (429) o cae (5xx), se prueba una vez la otra con la
     misma ruta (ipfs.io ↔ dweb.link); si tampoco, se conserva el error
     original. */

import { MAX_BODY_BYTES, motivoDeFallo, TIMEOUTS } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import type { NetClient } from '../net/types.js';
import {
  ipfsCarBlocks,
  ipfsCidFromText,
  ipfsReadFile,
  ipfsUrlParts,
  ipfsWalk,
  ipnsRecordValue,
} from './ipfs.js';

/** Pasarelas IPFS públicas intercambiables (server.js:59). */
export const IPFS_GATEWAYS = ['ipfs.io', 'dweb.link'] as const;

/** Tope del registro IPNS (server.js:1730). */
export const IPNS_RECORD_MAX_BYTES = 64 * 1024;

/** Saltos IPNS → IPNS como mucho (server.js:1753). */
export const IPNS_MAX_HOPS = 3;

/** `alternateGatewayUrl` (server.js:1426-1434): misma ruta en la otra pasarela, o null. */
export function alternateGatewayUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const index = (IPFS_GATEWAYS as readonly string[]).indexOf(parsed.hostname.toLowerCase());
  if (index < 0 || !/^\/(ipfs|ipns)\//.test(parsed.pathname)) return null;
  parsed.hostname = IPFS_GATEWAYS[(index + 1) % IPFS_GATEWAYS.length]!;
  return parsed.toString();
}

/** `esFalloDePasarela` (server.js:1436-1438): 429 o 5xx. */
export function esFalloDePasarela(error: unknown): boolean {
  const message = error instanceof Error ? error.message : '';
  return /^http_(429|5\d\d)$/.test(message);
}

export interface DirectoryFetcherDeps {
  readonly net: NetClient;
  readonly logger: Pick<Logger, 'warn'>;
  /** DNSLink: registros TXT (`dns.promises.resolveTxt`). */
  readonly resolveTxt: (hostname: string) => Promise<string[][]>;
  /** IPFS_DELEGATED_ROUTING e IPFS_TRUSTLESS_GATEWAY. */
  readonly delegatedRouting: string;
  readonly trustlessGateway: string;
}

export interface DirectoryFetcher {
  fetchDirectoryText(url: string, signal?: AbortSignal): Promise<string>;
  fetchIpfsDirectory(url: string, signal?: AbortSignal): Promise<string>;
}

export function createDirectoryFetcher(deps: DirectoryFetcherDeps): DirectoryFetcher {
  const signalOption = (signal?: AbortSignal) => (signal ? { signal } : {});

  /* `ipfsResolveName` (server.js:1719-1746): valor de un nombre IPNS
     (/ipfs/<cid>[/ruta] o /ipns/<otro>). Un nombre con punto es un dominio
     con DNSLink y va por su registro TXT. */
  async function ipfsResolveName(name: string, signal?: AbortSignal): Promise<string> {
    if (name.includes('.')) {
      let records: string[][];
      try {
        records = await deps.resolveTxt(`_dnslink.${name}`);
      } catch (error) {
        throw new AppError('dns_failed', { detail: `_dnslink.${name}`, cause: error });
      }
      const link = records
        .map((parts) => parts.join(''))
        .find((text) => text.startsWith('dnslink='));
      if (!link) throw new AppError('ipfs_bad_record', { detail: `sin dnslink en ${name}` });
      return link.slice('dnslink='.length);
    }
    const record = await deps.net.fetchBuffer(
      `${deps.delegatedRouting}/routing/v1/ipns/${encodeURIComponent(name)}`,
      {
        maxBytes: IPNS_RECORD_MAX_BYTES,
        totalTimeoutMs: TIMEOUTS.directoryTotalMs,
        accept: 'application/vnd.ipfs.ipns-record',
        ...signalOption(signal),
      },
    );
    return ipnsRecordValue(record.body);
  }

  /* `fetchIpfsDirectory` (server.js:1748-1770). */
  async function fetchIpfsDirectory(url: string, signal?: AbortSignal): Promise<string> {
    const parts = ipfsUrlParts(url);
    if (!parts) throw new AppError('bad_url');
    let { kind, name, segments } = parts;
    // Un nombre IPNS puede apuntar a otro: se siguen como mucho tres saltos
    for (let hops = 0; kind === 'ipns'; hops += 1) {
      if (hops >= IPNS_MAX_HOPS)
        throw new AppError('ipfs_bad_record', { detail: 'demasiados saltos' });
      const target = (await ipfsResolveName(name, signal)).match(/^\/(ipfs|ipns)\/([^/]+)(\/.*)?$/);
      if (!target) throw new AppError('ipfs_bad_record');
      kind = target[1] as 'ipfs' | 'ipns';
      name = target[2]!;
      segments = [...(target[3] || '').split('/').filter(Boolean), ...segments];
    }
    const root = ipfsCidFromText(name);
    const route = segments.map(encodeURIComponent).join('/');
    const car = await deps.net.fetchBuffer(
      `${deps.trustlessGateway}/ipfs/${encodeURIComponent(name)}${route ? `/${route}` : ''}?format=car&dag-scope=entity`,
      {
        maxBytes: MAX_BODY_BYTES * 2,
        totalTimeoutMs: TIMEOUTS.directoryTotalMs,
        accept: 'application/vnd.ipld.car',
        ...signalOption(signal),
      },
    );
    const blocks = ipfsCarBlocks(car.body);
    return ipfsReadFile(blocks, ipfsWalk(blocks, root, segments), MAX_BODY_BYTES).toString('utf8');
  }

  /* `fetchDirectoryFromGateway` (server.js:1788-1798). */
  async function fetchDirectoryFromGateway(url: string, signal?: AbortSignal): Promise<string> {
    try {
      return (await deps.net.fetchText(url, signalOption(signal))).body;
    } catch (error) {
      const alternativa = esFalloDePasarela(error) ? alternateGatewayUrl(url) : null;
      if (!alternativa) throw error;
      deps.logger.warn(
        {
          errorCode: motivoDeFallo(error),
          from: new URL(url).hostname,
          to: new URL(alternativa).hostname,
        },
        '[directorio] pasarela saturada; probando la otra',
      );
      try {
        return (await deps.net.fetchText(alternativa, signalOption(signal))).body;
      } catch {
        throw error;
      }
    }
  }

  return {
    fetchIpfsDirectory,
    /* `fetchDirectoryText` (server.js:1774-1786). */
    async fetchDirectoryText(url, signal) {
      if (!ipfsUrlParts(url)) return fetchDirectoryFromGateway(url, signal);
      try {
        return await fetchIpfsDirectory(url, signal);
      } catch (error) {
        if (signal?.aborted) throw error;
        deps.logger.warn(
          { errorCode: motivoDeFallo(error) },
          '[directorio] IPFS sin pasarela falló; probando la pasarela pública',
        );
        try {
          return await fetchDirectoryFromGateway(url, signal);
        } catch {
          throw error;
        }
      }
    },
  };
}
