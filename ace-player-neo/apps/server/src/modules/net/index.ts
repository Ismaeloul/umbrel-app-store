/* Fábrica del módulo `net` (cliente saliente a internet con protección anti-SSRF).

   ESQUELETO (paso 1.0 de la Fase 1): devuelve un servicio cuyos métodos
   lanzan `AppError('not_implemented')`, para que `createServices()` monte el
   árbol entero y cada ruta responda 501 con el formato correcto. El agente
   del módulo sustituye esto por la implementación real SIN cambiar la firma
   de la fábrica ni la interfaz de types.ts (si hace falta cambiarla, se
   cambia aquí y en docs/contratos.md a la vez). */

import { notImplementedService } from '../../core/stub.js';
import type { NetDeps, NetClient } from './types.js';

export type * from './types.js';

export function createNetClient(_deps: NetDeps): NetClient {
  return notImplementedService<NetClient>('net');
}
