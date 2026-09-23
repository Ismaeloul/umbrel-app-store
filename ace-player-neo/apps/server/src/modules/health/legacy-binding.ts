/* Qué servicio de salud usa la fachada de la 0.6.59 (`systemHealth`). En la
   v2 no hay globales: el test que la quiera enlaza antes un servicio. Vive
   aparte para no añadir nombres a la fachada (legacy/exports.ts). */

import { notImplemented } from '../../core/errors.js';
import type { HealthService } from './types.js';

let bound: HealthService | null = null;

/** Enlaza (o suelta, con null) el servicio que usa `systemHealth`. */
export function bindLegacyHealth(service: HealthService | null): void {
  bound = service;
}

export function boundHealthService(what: string): HealthService {
  if (!bound) throw notImplemented(`${what}: falta bindLegacyHealth(servicio)`);
  return bound;
}
