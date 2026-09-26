/* Fábrica del módulo `iptv` (docs/iptv.md).

   La implementación vive en service.ts (guardado, sincronización, guía,
   emparejado, apertura y comprobación), con las piezas puras de al lado:
   crypto, redact, ids, names, m3u, json-array, xtream, catalog, match,
   xmltv, guide, guide-match, hls, relay, probe y store. */

import { IptvServiceImpl } from './service.js';
import type { IptvDeps, IptvService } from './types.js';

export type * from './types.js';
export { isIptvId } from './ids.js';

export function createIptvService(deps: IptvDeps): IptvService {
  return new IptvServiceImpl(deps);
}
