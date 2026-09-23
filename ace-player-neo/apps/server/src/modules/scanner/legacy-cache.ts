/* La `scannerCache` global de server.js:161, solo para la fachada de
   exportaciones antiguas (legacy-exports.ts de scanner y de sources). El
   código nuevo no la usa: cada comprobador tiene la suya.

   Vive aparte porque todo lo que exporta un legacy-exports.ts acaba en la
   fachada, que tiene que tener exactamente los nombres de la 0.6.59. */

import { createSystemClock } from '../../core/clock.js';
import { LEGACY_SCANNER_DEFAULTS } from './constants.js';
import { VerdictCache, verdictPolicy } from './verdicts.js';

export const legacySystemClock = createSystemClock();

let legacyCache: VerdictCache | null = null;

/** Con el retraso de reintento por defecto (10 min), como la 0.6.59 sin variables. */
export function legacyVerdictCache(): VerdictCache {
  legacyCache ??= new VerdictCache(verdictPolicy(LEGACY_SCANNER_DEFAULTS.retryDelayMs));
  return legacyCache;
}
