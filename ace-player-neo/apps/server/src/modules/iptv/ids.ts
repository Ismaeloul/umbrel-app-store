/* Ids de los canales IPTV (docs/iptv.md §4.1).

     h   = hex(HMAC-SHA256(k_iptvIds,   provider.id + '\n' + clave)).slice(0, 32)
     tag = hex(HMAC-SHA256(k_iptvIdTag, h)).slice(0, 8)
     id  = h + tag            // 40 hex: cumple HashSchema y HASH_RE

   `clave`:
   - Xtream: `x:<stream_id>`.
   - M3U: `m:<tvg-id>:<normalizeChannelKey(título)>:<n>`, con `<n>` el orden
     entre repetidos de la misma pareja. La URL NO entra (rota tokens).

   El id es estable entre sincronizaciones, no se puede invertir ni lleva
   credenciales, cambia con otro `provider.id` y SE RECONOCE SOLO:
   `isIptvId` recalcula la etiqueta con los 32 primeros hex. Un hash de
   AceStream la tiene válida por casualidad con probabilidad 2⁻³². Por eso no
   hay lista de ids retirados. */

import { createHmac } from 'node:crypto';
import { HASH_RE } from '@ace/shared';
import type { IptvKeys } from '../../config/keys.js';

const HEAD_HEX = 32;
const TAG_HEX = 8;

/** Etiqueta de 8 hex de una cabeza de 32 hex (también la de los ids VOD, docs/vod.md §5). */
export function tagOf(keys: Pick<IptvKeys, 'idTag'>, head: string): string {
  return createHmac('sha256', keys.idTag).update(head).digest('hex').slice(0, TAG_HEX);
}

/** Id de 40 hex de un canal IPTV de un proveedor. */
export function iptvChannelId(keys: IptvKeys, providerId: string, key: string): string {
  const head = createHmac('sha256', keys.ids)
    .update(`${providerId}\n${key}`)
    .digest('hex')
    .slice(0, HEAD_HEX);
  return head + tagOf(keys, head);
}

/**
 * ¿Es un id IPTV de este Umbrel (de cualquier proveedor, pasado o presente)?
 * Pura: solo mira la etiqueta.
 */
export function isIptvId(keys: Pick<IptvKeys, 'idTag'>, id: unknown): boolean {
  if (typeof id !== 'string' || !HASH_RE.test(id)) return false;
  const lower = id.toLowerCase();
  return tagOf(keys, lower.slice(0, HEAD_HEX)) === lower.slice(HEAD_HEX);
}

/** Clave de un canal Xtream. */
export function xtreamKey(streamId: string | number): string {
  return `x:${String(streamId)}`;
}

/** Clave de un canal M3U (`n` = orden entre repetidos con la misma pareja). */
export function m3uKey(tvgId: string, normalizedTitle: string, n: number): string {
  return `m:${tvgId}:${normalizedTitle}:${n}`;
}

/**
 * Id IPTV de ESTE Umbrel para un id IPTV de otro (copia de seguridad,
 * decisiones.md D25). Con otro APP_SEED los ids de la copia no llevan una
 * etiqueta válida aquí y nadie los reconocería como IPTV: se les pone una
 * cabeza nueva (HMAC del id viejo, estable: restaurar dos veces da lo mismo)
 * con la etiqueta de aquí. No es de ningún catálogo, así que el re-emparejado
 * (§14.6) lo lleva por nombre a su canal tras la primera sincronización; si
 * no hay IPTV, da `iptv_removed` como un id de una IPTV eliminada. Un id que
 * ya es de aquí se queda igual.
 */
export function adoptedIptvId(keys: IptvKeys, foreignId: string): string {
  const id = foreignId.toLowerCase();
  if (isIptvId(keys, id)) return id;
  const head = createHmac('sha256', keys.ids)
    .update(`copia\n${id}`)
    .digest('hex')
    .slice(0, HEAD_HEX);
  return head + tagOf(keys, head);
}
