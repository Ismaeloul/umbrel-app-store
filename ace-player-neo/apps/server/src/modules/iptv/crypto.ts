/* Cifrado de la IPTV (docs/iptv.md §2.3).

   - Secretos (`secret` de iptv.json): AES-256-GCM sobre JSON, con AAD
     `ace-iptv|<provider.id>|<kind>` para que no se pueda pegar el bloque de
     otro proveedor. Forma `SealedSchema` (base64url).
   - Catálogo y guía (`catalogo.enc`, `guia.enc`): JSON en gzip y AES-256-GCM
     en binario, con su propio AAD (`ace-iptv-catalog|…`, `ace-iptv-guide|…`).
   - Claves: las de `config.security.keys.iptv` si hay semilla (`ACE_SEED` o
     `ENGINE_CONTROL_TOKEN`); si no, se crea `v2/iptv/clave` (32 bytes, 0600,
     carpeta 0700) y se deriva de ella. Nunca las de un solo arranque: las
     credenciales se perderían al reiniciar.

   Si algo no se puede descifrar (se cambió el secreto de la app o se
   restauró una copia de otro Umbrel), `iptv_secret_unreadable`. */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { createGzip, gunzipSync, gzipSync } from 'node:zlib';
import type { IptvKind, Sealed } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { AppConfig } from '../../config/index.js';
import { deriveIptvKeys, type IptvKeys } from '../../config/keys.js';

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
/** Cabecera de los ficheros cifrados (versión del formato). */
const BLOB_MAGIC = Buffer.from('ACEIPTV1', 'ascii');

export const FILE_MODE = 0o600;
export const DIR_MODE = 0o700;

/** AAD de los secretos de un proveedor. */
export function secretAad(providerId: string, kind: IptvKind): string {
  return `ace-iptv|${providerId}|${kind}`;
}

export function catalogAad(providerId: string): string {
  return `ace-iptv-catalog|${providerId}`;
}

export function guideAad(providerId: string): string {
  return `ace-iptv-guide|${providerId}`;
}

function unreadable(detail: string, cause?: unknown): AppError {
  return new AppError('iptv_secret_unreadable', {
    detail,
    ...(cause === undefined ? {} : { cause }),
  });
}

/** Cifra un valor JSON (los secretos). */
export function sealJson(key: Buffer, aad: string, value: unknown): Sealed {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    alg: 'A256GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: data.toString('base64url'),
  };
}

/** Descifra lo de `sealJson`. Con otra clave u otro AAD, `iptv_secret_unreadable`. */
export function openJson(key: Buffer, aad: string, sealed: Sealed): unknown {
  try {
    const iv = Buffer.from(sealed.iv, 'base64url');
    const tag = Buffer.from(sealed.tag, 'base64url');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error('forma');
    const decipher = createDecipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    const text = Buffer.concat([
      decipher.update(Buffer.from(sealed.data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw unreadable('los secretos de la IPTV no se pueden descifrar', error);
  }
}

/** Cifra un JSON grande (catálogo o guía): gzip y AES-GCM en binario. */
export function sealBlob(key: Buffer, aad: string, value: unknown): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const plain = gzipSync(Buffer.from(JSON.stringify(value), 'utf8'));
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([BLOB_MAGIC, iv, cipher.getAuthTag(), data]);
}

/**
 * Lo mismo que `sealBlob` a partir de un JSON que llega a trozos (el
 * catálogo): gzip en streaming, sin montar el texto entero en memoria.
 */
export async function sealBlobChunks(
  key: Buffer,
  aad: string,
  chunks: Iterable<string>,
): Promise<Buffer> {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const gzip = createGzip();
  const out: Buffer[] = [];
  gzip.on('data', (chunk: Buffer) => out.push(cipher.update(chunk)));
  const ended = new Promise<void>((resolve, reject) => {
    gzip.once('end', resolve);
    gzip.once('error', reject);
  });
  for (const chunk of chunks) {
    if (!gzip.write(chunk, 'utf8')) await once(gzip, 'drain');
  }
  gzip.end();
  await ended;
  out.push(cipher.final());
  return Buffer.concat([BLOB_MAGIC, iv, cipher.getAuthTag(), ...out]);
}

/** Descifra lo de `sealBlob`. */
export function openBlob(key: Buffer, aad: string, blob: Buffer): unknown {
  try {
    if (!blob.subarray(0, BLOB_MAGIC.length).equals(BLOB_MAGIC)) throw new Error('cabecera');
    const start = BLOB_MAGIC.length;
    const iv = blob.subarray(start, start + IV_BYTES);
    const tag = blob.subarray(start + IV_BYTES, start + IV_BYTES + TAG_BYTES);
    const data = blob.subarray(start + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(gunzipSync(plain).toString('utf8')) as unknown;
  } catch (error) {
    throw unreadable('un fichero cifrado de la IPTV no se puede leer', error);
  }
}

/** Crea la carpeta de la IPTV con 0700 (si ya existe, le pone esos permisos). */
export function ensureIptvDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  try {
    chmodSync(dir, DIR_MODE);
  } catch {}
}

/**
 * Claves de la IPTV. Con semilla, las derivadas de ella; sin semilla, las
 * de `v2/iptv/clave`, que se crea la primera vez (32 bytes aleatorios, 0600).
 */
export function loadIptvKeys(config: AppConfig): IptvKeys {
  if (config.security.seedSource !== 'ephemeral') return config.security.keys.iptv;
  const file = config.paths.iptvKeyFile;
  let material: Buffer | null = null;
  try {
    const stored = readFileSync(file);
    if (stored.length === KEY_BYTES) material = stored;
  } catch {}
  if (!material) {
    ensureIptvDir(config.paths.iptvDir);
    const fresh = randomBytes(KEY_BYTES);
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, fresh, { mode: FILE_MODE });
    try {
      chmodSync(tmp, FILE_MODE);
    } catch {}
    renameSync(tmp, file);
    material = fresh;
  }
  return deriveIptvKeys(material);
}
