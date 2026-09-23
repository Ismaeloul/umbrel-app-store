/* Piezas criptográficas del módulo `auth` (arquitectura §5.12).

   Todo lo que compara un secreto pasa por `timingSafeEqual` con dos buffers
   de la MISMA longitud: se comparan resúmenes (sha256 o HMAC) y no los
   textos, así el tiempo no depende ni de dónde está la primera diferencia
   ni de la longitud de lo que manda el cliente. */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/** Alfabeto base64url sin relleno (tokens, secretos y firmas). */
export const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** sha256 de un texto (UTF-8). */
export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** sha256 en hex: lo único que se guarda del secreto de un dispositivo. */
export function sha256Hex(value: string): string {
  return sha256(value).toString('hex');
}

/** HMAC-SHA256 de un texto con una clave derivada (config/keys.ts). */
export function hmac(key: Buffer, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/** Igualdad de dos buffers de 32 bytes en tiempo constante (false si no miden lo mismo). */
export function equalDigests(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    /* Nunca pasa con resúmenes sha256; se compara igual para no salir antes. */
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/**
 * Igualdad de dos textos en tiempo constante, sea cual sea su longitud: se
 * comparan sus sha256 (siempre 32 bytes) con `timingSafeEqual`.
 */
export function equalStrings(a: string, b: string): boolean {
  return equalDigests(sha256(a), sha256(b));
}
