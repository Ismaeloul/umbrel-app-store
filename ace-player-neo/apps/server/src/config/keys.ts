/* Claves derivadas del secreto de la app (arquitectura §5.3 y §5.12).

   De un solo material (`ACE_SEED`, que Compose rellena con `${APP_SEED}`, o
   en su defecto `ENGINE_CONTROL_TOKEN`, que ya es `${APP_SEED}`) se sacan
   claves independientes con HKDF-SHA256, una por uso, con su etiqueta:

   - `ace-video-v1`: firma de las URLs de vídeo de la app iOS (`?t=`).
   - `ace-pair-v1`: lo que haga falta firmar en el emparejamiento.
   - `ace-iptv-v1`, `ace-iptv-id-v1` y `ace-iptv-tag-v1`: cifrado de los
     secretos, del catálogo y de la guía de la IPTV, HMAC de los ids de canal
     y la etiqueta que los hace reconocibles (docs/iptv.md §2.3 y §4.1). Sin
     semilla NO valen las de un solo arranque (se perderían las credenciales
     al reiniciar): la IPTV guarda su propia clave en `v2/iptv/clave` (0600) y
     deriva de ella con `deriveIptvKeys`.

   Así una clave filtrada de un uso no sirve para el otro, y rotar un uso es
   cambiar su etiqueta (`-v2`) sin tocar el secreto de Umbrel. El token de
   cada dispositivo NO se deriva de aquí: es aleatorio y solo se guarda su
   sha256 (arquitectura §5.12). */

import { hkdfSync, randomBytes } from 'node:crypto';

export const KEY_LABELS = {
  video: 'ace-video-v1',
  pairing: 'ace-pair-v1',
  iptvSecrets: 'ace-iptv-v1',
  iptvIds: 'ace-iptv-id-v1',
  iptvIdTag: 'ace-iptv-tag-v1',
} as const;

/* Sal fija y pública: HKDF no la necesita secreta; solo separa este uso del
   secreto de cualquier otro que use el mismo APP_SEED en Umbrel. */
const HKDF_SALT = 'ace-player-neo';
const KEY_BYTES = 32;

/** Longitud mínima razonable del material: por debajo, las firmas se pueden adivinar. */
export const MIN_SEED_LENGTH = 16;

/** Claves de la IPTV (docs/iptv.md §2.3 y §4.1). */
export interface IptvKeys {
  /** AES-256-GCM de los secretos, del catálogo y de la guía. */
  readonly secrets: Buffer;
  /** HMAC de los ids de canal. */
  readonly ids: Buffer;
  /** HMAC de la etiqueta que hace reconocible un id IPTV. */
  readonly idTag: Buffer;
}

export interface DerivedKeys {
  readonly video: Buffer;
  readonly pairing: Buffer;
  readonly iptv: IptvKeys;
}

export function deriveKey(seed: string | Buffer, label: string): Buffer {
  return Buffer.from(hkdfSync('sha256', seed, HKDF_SALT, label, KEY_BYTES));
}

export function deriveIptvKeys(seed: string | Buffer): IptvKeys {
  return {
    secrets: deriveKey(seed, KEY_LABELS.iptvSecrets),
    ids: deriveKey(seed, KEY_LABELS.iptvIds),
    idTag: deriveKey(seed, KEY_LABELS.iptvIdTag),
  };
}

export function deriveKeys(seed: string | Buffer): DerivedKeys {
  return {
    video: deriveKey(seed, KEY_LABELS.video),
    pairing: deriveKey(seed, KEY_LABELS.pairing),
    iptv: deriveIptvKeys(seed),
  };
}

/** Material de un solo arranque cuando no hay secreto configurado (las URLs firmadas caducan al reiniciar). */
export function ephemeralSeed(): Buffer {
  return randomBytes(KEY_BYTES);
}
