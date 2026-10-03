/* Cifrado de la contraseña de la IPTV dentro de la copia de seguridad
   (decisiones.md D24; docs/seguridad.md §8).

   La copia tiene que abrirse en una instalación NUEVA (otro APP_SEED), así
   que no se puede usar la clave de este Umbrel: se cifra con una clave que
   escribe Isma.
   - Derivación: scrypt (N = 2^15, r = 8, p = 1; ~32 MiB y unas décimas de
     segundo en el N300), sal aleatoria de 16 bytes, 32 bytes de clave.
   - Cifrado: AES-256-GCM, IV de 12 bytes, etiqueta de 16, con AAD
     `ace-copia|<versión del esquema>|<tipo>`: el bloque no se puede pegar en
     otra copia de otro tipo sin que falle.
   - Al abrir solo se aceptan los N de BackupSealedSchema (hasta 2^17): un
     fichero ajeno no puede pedir gigas de memoria.
   La clave no se guarda en ningún sitio ni pasa por el registro. scrypt va
   en el pool de libuv (asíncrono): no bloquea el bucle. */

import { createCipheriv, createDecipheriv, randomBytes, scrypt } from 'node:crypto';
import type { BackupSealed } from '@ace/shared';

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;
const SALT_BYTES = 16;
const KEY_BYTES = 32;

/** Parámetros con los que se cifra hoy. */
export const BACKUP_SCRYPT = { n: 32768, r: 8, p: 1 } as const;

export function backupAad(schemaVersion: number, kind: string): string {
  return `ace-copia|${schemaVersion}|${kind}`;
}

function deriveKey(
  passphrase: string,
  salt: Buffer,
  params: { n: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      passphrase.normalize('NFC'),
      salt,
      KEY_BYTES,
      /* maxmem: 128 · N · r con holgura (el de Node, 32 MiB, se queda corto con N = 2^15). */
      { N: params.n, r: params.r, p: params.p, maxmem: 256 * params.n * params.r },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

/** Cifra `value` (JSON) con la clave de Isma. */
export async function sealWithPassphrase(
  passphrase: string,
  aad: string,
  value: unknown,
): Promise<BackupSealed> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveKey(passphrase, salt, BACKUP_SCRYPT);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const data = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    kdf: 'scrypt',
    ...BACKUP_SCRYPT,
    salt: salt.toString('base64url'),
    alg: 'A256GCM',
    iv: iv.toString('base64url'),
    tag: cipher.getAuthTag().toString('base64url'),
    data: data.toString('base64url'),
  };
}

/**
 * Descifra lo de `sealWithPassphrase`. Con otra clave, otro AAD o el bloque
 * tocado devuelve null (GCM no deja pasar nada a medias).
 */
export async function openWithPassphrase(
  passphrase: string,
  aad: string,
  sealed: BackupSealed,
): Promise<unknown> {
  try {
    const salt = Buffer.from(sealed.salt, 'base64url');
    const iv = Buffer.from(sealed.iv, 'base64url');
    const tag = Buffer.from(sealed.tag, 'base64url');
    if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      return null;
    }
    const key = await deriveKey(passphrase, salt, sealed);
    const decipher = createDecipheriv(ALG, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(tag);
    const text = Buffer.concat([
      decipher.update(Buffer.from(sealed.data, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
