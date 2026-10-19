/* Descarga en segundo plano del iPhone (0.9.8): un tramo de una película o un episodio en una sola
   respuesta.

   El iPhone ya descargaba (app 0.9.6) pidiendo la lista HLS de una sesión normal y pegando `init.mp4` y
   los segmentos; eso solo avanza con la app abierta (la sesión pide latido). Con esta ruta el iPhone deja
   la descarga a iOS (URLSession en segundo plano): pide tramos `from..to` y el servidor abre la sesión,
   manda los ficheros seguidos tal cual salen del productor, late él mismo y la suelta al acabar. Los
   segmentos son los mismos en cualquier sesión (salen del índice del fichero), así que pegar los tramos
   en orden da el mismo fichero que la descarga de siempre.

   Nunca quita la IPTV: si la está usando otro (otro aparato o este mismo iPhone viendo algo), `vod_busy`
   y el iPhone lo reintenta más tarde (un `iptv_*` haría pasar a la web a AceStream). */

import { createReadStream } from 'node:fs';
import type { FastifyReply } from 'fastify';
import { AppError } from '../../core/errors.js';
import type { RemuxService } from '../remux/types.js';
import type { PlaybackService, ViewerIdentity } from './types.js';

/** Un fichero que el productor aún no tiene se vuelve a pedir: como mucho tantas veces (15 s cada una). */
const MAX_NOT_YET = 12;
/** Latido de la sesión mientras se manda (el visor caduca a los 45 s sin él). */
const BEAT_MS = 10_000;

export interface DownloadRequest {
  readonly id: string;
  readonly viewer: string;
  readonly from: number;
  readonly to: number;
  readonly audio?: number | undefined;
  readonly hevc: '0' | '1';
}

/** ¿Hay alguien más en la IPTV? (cualquier visor de una sesión IPTV que no sea esta descarga). */
export function iptvTakenByOther(playback: PlaybackService, viewer: string): boolean {
  return playback
    .status()
    .sessions.some(
      (session) =>
        session.source === 'iptv' && session.viewers.some((other) => other.viewerId !== viewer),
    );
}

export async function sendVodDownload(
  reply: FastifyReply,
  request: DownloadRequest,
  identity: ViewerIdentity,
  signal: AbortSignal,
  deps: { readonly playback: PlaybackService; readonly remux: RemuxService },
): Promise<void> {
  const { playback, remux } = deps;
  if (iptvTakenByOther(playback, request.viewer)) {
    throw new AppError('vod_busy', { detail: 'la IPTV la usa otro: la descarga espera' });
  }
  const grant = await playback.acquireVod(
    request.id,
    {
      client: 'ios',
      viewer: request.viewer,
      hevc: request.hevc,
      ...(request.audio === undefined ? {} : { audio: request.audio }),
    },
    identity,
    signal,
  );
  const sessionId = grant.session.id;
  const beat = setInterval(() => {
    void playback
      .heartbeat(sessionId, { viewer: request.viewer, playing: true }, identity)
      .catch(() => undefined);
  }, BEAT_MS);
  beat.unref?.();
  const release = (): void => {
    clearInterval(beat);
    void playback
      .release(sessionId, { viewer: request.viewer, reason: 'user' }, identity)
      .catch(() => undefined);
  };
  try {
    const total = remux.vodSegments(sessionId);
    const last = Math.min(request.to, total - 1);
    if (total === 0 || request.from > last) throw new AppError('not_found', { detail: 'tramo' });
    const files = [
      ...(request.from === 0 ? ['init.mp4'] : []),
      ...Array.from({ length: last - request.from + 1 }, (_, i) => `index${request.from + i}.m4s`),
    ];
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'video/mp4',
      'cache-control': 'no-store',
      'x-ace-segments': String(total),
      'x-ace-last': String(last),
    });
    for (const file of files) {
      if (signal.aborted || reply.raw.destroyed) return;
      let path: string | null = null;
      for (let tries = 0; tries < MAX_NOT_YET && !path; tries += 1) {
        const result = await remux.vodFile(sessionId, file, signal);
        if (result.kind === 'file') path = result.path;
        else if (result.kind === 'missing') break;
      }
      /* Sin el fichero, la respuesta se corta a medias: el iPhone ve el tramo incompleto y lo repite. */
      if (!path) {
        reply.raw.destroy();
        return;
      }
      await pipeInto(createReadStream(path), reply);
    }
    reply.raw.end();
  } catch (error) {
    if (!reply.sent) throw error;
    reply.raw.destroy();
  } finally {
    release();
  }
}

/** Un fichero detrás de otro en la misma respuesta (sin cerrarla), respetando la contrapresión. */
function pipeInto(stream: NodeJS.ReadableStream, reply: FastifyReply): Promise<void> {
  return new Promise((resolve, reject) => {
    const out = reply.raw;
    const onClose = (): void => {
      (stream as unknown as { destroy(): void }).destroy();
      reject(new Error('cliente cerrado'));
    };
    out.once('close', onClose);
    stream.on('data', (chunk: Buffer) => {
      if (!out.write(chunk)) {
        stream.pause();
        out.once('drain', () => stream.resume());
      }
    });
    stream.once('error', (error) => {
      out.off('close', onClose);
      reject(error);
    });
    stream.once('end', () => {
      out.off('close', onClose);
      resolve();
    });
  });
}
