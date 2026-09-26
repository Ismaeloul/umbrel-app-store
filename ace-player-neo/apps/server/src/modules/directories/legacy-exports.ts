/* Exportaciones de server.js (0.6.59) que corresponden al módulo
   `directories`, con los mismos nombres (comportamientos-tests.md §3.1-3.2).

   Para qué: los tests portados y el contraste con la 0.6.59 (plan E1.4)
   llaman a estas funciones por su nombre de siempre, con sus mismas entradas
   y salidas. Las puras son las del módulo; las que descargan
   (`fetchDirectoryText`, `fetchIpfsDirectory`) usan el cliente saliente con
   el filtro anti-SSRF siempre puesto y los extremos IPFS por defecto (la v2
   no lee el entorno fuera de config/). `autoSyncWeb` necesita el servicio:
   sin estado global, se le pasa. */

import { promises as dns } from 'node:dns';
import { DEFAULTS } from '../../config/index.js';
import { createSilentLogger } from '../../core/logger.js';
import { notImplemented } from '../../core/errors.js';
import { fetchText as legacyFetchText } from '../net/legacy-exports.js';
import type { FetchedResponse, NetClient } from '../net/types.js';
import { createDirectoryFetcher, type DirectoryFetcher } from './fetcher.js';
import type { DirectoriesService } from './types.js';

export { parseHtml, parseM3u } from './parsers.js';
export { alternateGatewayUrl } from './fetcher.js';
export {
  ipfsCarBlocks,
  ipfsCbor,
  ipfsCidFromText,
  ipfsProtobuf,
  ipfsReadFile,
  ipfsUrlParts,
  ipfsWalk,
} from './ipfs.js';

/* El `fetchText` antiguo con la forma del NetClient (solo lo que usa el descargador). */
function legacyNet(): NetClient {
  const wrap = async <T extends string | Buffer>(
    url: string,
    maxBytes: number | undefined,
    options: { binary?: boolean; accept?: string },
  ): Promise<FetchedResponse<T>> => {
    const body = (await legacyFetchText(url, 0, new Set(), undefined, maxBytes, options)) as T;
    return { body, url, status: 200, contentType: null };
  };
  return {
    fetchText: (url, options) =>
      wrap<string>(url, options?.maxBytes, options?.accept ? { accept: options.accept } : {}),
    fetchBuffer: (url, options) =>
      wrap<Buffer>(url, options?.maxBytes, {
        binary: true,
        ...(options?.accept ? { accept: options.accept } : {}),
      }),
    fetchJson: () => Promise.reject(notImplemented('fetchJson antiguo')),
    openStream: () => Promise.reject(notImplemented('openStream antiguo')),
    hostIsLan: () => Promise.reject(notImplemented('hostIsLan antiguo')),
    isPrivateAddress: () => {
      throw notImplemented('isPrivateAddress antiguo');
    },
    isPrivateHostname: () => {
      throw notImplemented('isPrivateHostname antiguo');
    },
  };
}

function legacyFetcher(): DirectoryFetcher {
  return createDirectoryFetcher({
    net: legacyNet(),
    logger: createSilentLogger(),
    resolveTxt: (hostname) => dns.resolveTxt(hostname),
    delegatedRouting: DEFAULTS.ipfsDelegatedRouting,
    trustlessGateway: DEFAULTS.ipfsTrustlessGateway,
  });
}

/** `fetchDirectoryText` (server.js:1774): IPFS directo y, si falla, la pasarela. T-117. */
export function fetchDirectoryText(url: string): Promise<string> {
  return legacyFetcher().fetchDirectoryText(url);
}

/** `fetchIpfsDirectory` (server.js:1748). */
export function fetchIpfsDirectory(url: string): Promise<string> {
  return legacyFetcher().fetchIpfsDirectory(url);
}

/**
 * `autoSyncWeb` (server.js:5091). En la 0.6.59 no recibía nada porque leía
 * globales; aquí se le pasa el servicio (con `AUTO_SYNC=false` no sale a
 * internet, T-119). Sin servicio, `not_implemented`.
 */
export async function autoSyncWeb(service?: Pick<DirectoriesService, 'autoSync'>): Promise<void> {
  if (!service) throw notImplemented('autoSyncWeb sin el servicio de directorios');
  await service.autoSync('periodic');
}
