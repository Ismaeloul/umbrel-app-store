/* Módulo `iptv`: la IPTV de Isma (lista M3U o Xtream Codes) con puente a
   AceStream (docs/iptv.md).

   Se crea justo después de `net` (depende de state, net y el bus). scanner
   (carril IPTV), remux (redactor y reinicio), playback y football lo
   recibirán cuando la parte «servidor» lo conecte; los informes a
   diagnostics van por el bus, porque diagnostics se crea después.

   ESQUELETO del contrato: por ahora solo atiende las 5 rutas de Ajustes →
   IPTV sin proveedor guardado. Lo demás (crypto, redact, ids, m3u,
   json-array, xtream, names, match, xmltv, guide-match, relay, probe,
   service, store) es de la parte «servidor» (docs/iptv.md §11.2). */

import type { IptvSaveBody, IptvUpdateBody, IptvView } from '@ace/shared';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { NetClient } from '../net/index.js';
import type { StateService } from '../state/index.js';

export interface IptvDeps extends CoreDeps {
  readonly state: StateService;
  readonly net: NetClient;
}

export interface IptvService extends Lifecycle {
  /** GET /api/v1/iptv. Nunca devuelve la URL, el usuario ni la contraseña. */
  view(): Promise<IptvView>;
  /** PUT /api/v1/iptv: prueba rápida, cifra, guarda (`revision` + 1) y sincroniza de fondo. */
  save(body: IptvSaveBody, signal: AbortSignal): Promise<IptvView>;
  /** PATCH /api/v1/iptv: pausar, reanudar o renombrar (`iptv_not_configured` sin IPTV). */
  update(body: IptvUpdateBody): Promise<IptvView>;
  /** POST /api/v1/iptv/sync: responde `syncing`; el recuento llega por `iptv.status`. */
  sync(): Promise<IptvView>;
  /** DELETE /api/v1/iptv: borra todo (también `.bak` y copias apartadas) y cierra las sesiones IPTV. */
  remove(): Promise<IptvView>;
  /** `bootstrap.features.iptv`: hay IPTV activa con catálogo cargado. */
  active(): boolean;
}
