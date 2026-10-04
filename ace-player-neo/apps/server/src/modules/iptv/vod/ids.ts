/* Ids sellados de películas, series y episodios (docs/vod.md §5, D-VOD3).

     bloque (16 B) = [0]     versión (nibble alto = 1) | tipo (1 película, 2 serie, 3 episodio)
                     [1..3]  huella del proveedor = HMAC-SHA256(k_vod, provider.id)[0..3]
                     [4..7]  padre, uint32 BE: el series_id en los episodios; 0 en el resto
                     [8..15] origen, uint64 BE: stream_id | series_id | episode_id
     cabeza = hex(AES-256(k_vod, bloque))            // 32 hex
     id     = cabeza + tagOf(k_iptvIdTag, cabeza)    // la MISMA etiqueta de 8 hex que los canales

   Con la misma etiqueta que los canales, un id VOD que se cuele por un camino
   de canales se ve como IPTV que ya no está (`iptv_gone`) y NUNCA como un
   hash de AceStream: falla cerrado (§5.2, T1-T3). Dentro va, cifrado, el
   origen: el servidor lo recupera sin índice, también el de un episodio tras
   un reinicio (lleva su `series_id`). */

import { createCipheriv, createDecipheriv, createHmac } from 'node:crypto';
import type { IptvKeys } from '../../../config/keys.js';
import { isIptvId, tagOf } from '../ids.js';

export type VodRefKind = 'movie' | 'series' | 'episode';

export interface VodRef {
  readonly kind: VodRefKind;
  /** El `series_id` en los episodios (≤ 2³² − 1); 0 en el resto. */
  readonly parent: number;
  /** stream_id | series_id | episode_id (entero en [1, 2⁵³)). */
  readonly source: number;
}

const VERSION = 0x10;
const KIND_CODE: Readonly<Record<VodRefKind, number>> = { movie: 1, series: 2, episode: 3 };
const CODE_KIND: Readonly<Record<number, VodRefKind>> = { 1: 'movie', 2: 'series', 3: 'episode' };
const PARENT_MAX = 0xffff_ffff;

type VodKeys = Pick<IptvKeys, 'vod' | 'idTag'>;

/** Huella de 3 bytes del proveedor (va dentro del bloque). */
function providerFingerprint(keys: Pick<IptvKeys, 'vod'>, providerId: string): Buffer {
  return createHmac('sha256', keys.vod).update(providerId).digest().subarray(0, 3);
}

/**
 * Huella de 16 hex del proveedor para `v2/vod.json` (§10.1): con otro
 * proveedor, todos los ids cambian y el documento se vacía.
 */
export function vodProviderFp(keys: Pick<IptvKeys, 'vod'>, providerId: string): string {
  return createHmac('sha256', keys.vod).update(providerId).digest('hex').slice(0, 16);
}

/** ¿Cabe este origen en un id? (entero en [1, 2⁵³), padre ≤ 2³² − 1 solo en episodios). */
export function sealable(ref: VodRef): boolean {
  if (!Number.isSafeInteger(ref.source) || ref.source < 1) return false;
  if (ref.kind !== 'episode') return ref.parent === 0;
  return Number.isInteger(ref.parent) && ref.parent >= 1 && ref.parent <= PARENT_MAX;
}

/* Ids de películas, series y episodios (docs/vod.md §5).
   El bloque de 16 bytes se cifra con AES-256 en modo ECB, y aquí ECB es lo
   correcto: se cifra UN SOLO bloque, así que AES funciona como una
   permutación pseudoaleatoria con clave. No hay varios bloques que puedan
   repetirse y enseñar patrones, que es el problema de ECB con datos largos.
   Es determinista a propósito: el mismo título da el mismo id entre
   sincronizaciones. No se puede invertir ni falsificar sin la clave.
   No lo cambies por GCM o CBC: el id dejaría de ser estable y de medir 32 hex. */
export function vodId(keys: VodKeys, providerId: string, ref: VodRef): string {
  if (!sealable(ref)) throw new RangeError('id VOD fuera de rango');
  const block = Buffer.alloc(16);
  block[0] = VERSION | KIND_CODE[ref.kind];
  providerFingerprint(keys, providerId).copy(block, 1);
  block.writeUInt32BE(ref.parent, 4);
  block.writeBigUInt64BE(BigInt(ref.source), 8);
  const cipher = createCipheriv('aes-256-ecb', keys.vod, null).setAutoPadding(false);
  const head = Buffer.concat([cipher.update(block), cipher.final()]).toString('hex');
  return head + tagOf(keys, head);
}

/**
 * `vodRef(id)` (§5.1): etiqueta IPTV → descifrar → versión, tipo, huella del
 * proveedor ACTUAL y padre 0 fuera de los episodios. null si algo no cuadra
 * (un id de canal descifra a basura y pasa todo con probabilidad ≈ 2⁻³⁰; aun
 * así su fila no existe y da `vod_not_found`).
 */
export function vodRef(keys: VodKeys, providerId: string, id: unknown): VodRef | null {
  if (!isIptvId(keys, id)) return null;
  const head = Buffer.from((id as string).slice(0, 32).toLowerCase(), 'hex');
  const decipher = createDecipheriv('aes-256-ecb', keys.vod, null).setAutoPadding(false);
  const block = Buffer.concat([decipher.update(head), decipher.final()]);
  const first = block[0] as number;
  if ((first & 0xf0) !== VERSION) return null;
  const kind = CODE_KIND[first & 0x0f];
  if (!kind) return null;
  if (!block.subarray(1, 4).equals(providerFingerprint(keys, providerId))) return null;
  const parent = block.readUInt32BE(4);
  const big = block.readBigUInt64BE(8);
  if (big < 1n || big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const ref: VodRef = { kind, parent, source: Number(big) };
  return sealable(ref) ? ref : null;
}
