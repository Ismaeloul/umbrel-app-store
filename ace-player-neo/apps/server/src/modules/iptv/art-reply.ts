/* Mandar un cartel de Películas y series (docs/vod.md §8): lo comparten
   `vodArt` (iptv/routes.ts) y `partyArt` (party/routes.ts, docs/ver-juntos.md
   §9), con las mismas cabeceras y el mismo 304. */

import type { FastifyReply } from 'fastify';
import type { RequestContext } from '../../core/module.js';
import { settleReply } from '../../core/reply.js';
import type { ArtReply } from './vod/art.js';

/** `If-None-Match` de la petición (la primera si viniera repetida). */
export function ifNoneMatchOf(ctx: RequestContext): string | undefined {
  const value = ctx.request.headers['if-none-match'];
  return Array.isArray(value) ? value[0] : value;
}

/** Manda una imagen de `vodArt` (o su 304) con las cabeceras de §8. */
export async function sendArt(reply: FastifyReply, art: ArtReply): Promise<void> {
  if (art.status === 304) void reply.code(304).headers(art.headers).send();
  else void reply.code(200).headers(art.headers).send(art.body);
  await settleReply(reply);
}
