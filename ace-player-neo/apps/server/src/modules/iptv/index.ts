/* Fábrica del módulo `iptv` (docs/iptv.md).

   ESQUELETO del contrato: sin proveedor guardado ni lógica. `view()` y
   `remove()` responden «sin IPTV»; `update()` y `sync()` dicen
   `iptv_not_configured` (que es lo correcto sin IPTV) y `save()`
   `not_implemented` hasta que la parte «servidor» ponga store, crypto,
   prueba rápida y sincronización (docs/iptv.md §11.2). */

import { IPTV_REFRESH_HOURS, type IptvView } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { IptvDeps, IptvService } from './types.js';

export type * from './types.js';

const NO_IPTV: IptvView = { provider: null, refreshHours: IPTV_REFRESH_HOURS };

export function createIptvService(_deps: IptvDeps): IptvService {
  return {
    async start() {},
    async stop() {},
    async view() {
      return NO_IPTV;
    },
    async save() {
      throw new AppError('not_implemented', { detail: 'iptv: guardar todavía no existe' });
    },
    async update() {
      throw new AppError('iptv_not_configured');
    },
    async sync() {
      throw new AppError('iptv_not_configured');
    },
    async remove() {
      return NO_IPTV;
    },
    active() {
      return false;
    },
  };
}
