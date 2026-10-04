/* Piezas de respuesta HTTP que comparten los módulos que mandan ficheros con
   ETag por su cuenta (los escudos de `teams` y los carteles de Películas y
   series en `iptv`), para no tener una copia en cada uno. */

import { finished } from 'node:stream';
import type { FastifyReply } from 'fastify';

/**
 * Espera a que la respuesta haya salido del todo (el hook `onSend` es
 * asíncrono: justo después de `send()` `reply.sent` aún es false). Si el
 * cliente cortó a mitad, nadie más debe tocar esta respuesta.
 */
export function settleReply(reply: FastifyReply): Promise<void> {
  return new Promise((resolve) => {
    finished(reply.raw, () => {
      if (!reply.sent) reply.hijack();
      resolve();
    });
  });
}

/** ¿`If-None-Match` casa con el ETag (también `W/`, comillas y listas)? */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .some((part) => part.trim().replace(/^W\//, '').replace(/^"|"$/g, '') === etag);
}
