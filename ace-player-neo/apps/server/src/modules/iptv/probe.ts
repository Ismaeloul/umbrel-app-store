/* Sonda de stream de una IPTV (docs/iptv.md §7.3, nivel 2).

   SOLO en trabajos de fondo sin visor (el precalentamiento de la agenda),
   nunca en una resolución interactiva: ahí la reproducción es la prueba, y
   una sonda abriendo a la vez que el reproductor contra `max_connections = 1`
   haría que uno de los dos recibiera 403/458. Las condiciones (Xtream,
   `active_cons == 0`, sin sesión viva ni cierre nuestro en 120 s, un canal
   por partido y no en los últimos 30 min) las mira el servicio.

   La sonda abre UNA sola vez, lee hasta 6 s o 1,5 MiB a un fichero temporal
   en `remuxDir/.sondas/`, pasa ffprobe SOBRE ESE FICHERO (`inspectFile`, sin
   otra conexión al proveedor), cierra en cuanto termina y borra el fichero.
   Se aborta si se abre una sesión IPTV (la sesión espera a que suelte el
   socket). Solo orígenes TS: con HLS no se sondea. */

import { randomBytes } from 'node:crypto';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { IPTV_PROBE, IPTV_RELAY } from '@ace/shared';
import type { Clock } from '../../core/clock.js';
import type { IptvFetchPolicy, NetClient } from '../net/types.js';
import { toIptvError } from './errors.js';
import type { IptvCheckResult, IptvInspectFile } from './types.js';

export interface ProbeInput {
  readonly net: NetClient;
  readonly clock: Clock;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly policy: IptvFetchPolicy;
  readonly dir: string;
  readonly inspectFile: IptvInspectFile;
  readonly signal: AbortSignal;
}

/** `playableOn` por el códec de vídeo (el audio se pasa a AAC en el remux). */
export function playableOnForCodec(videoCodec: string): { web: boolean; ios: boolean } {
  const codec = videoCodec.toLowerCase();
  if (codec === 'hevc' || codec === 'h265') return { web: false, ios: true };
  if (codec === 'mpeg2video' || codec === 'mpeg2' || codec === 'mpeg1video') {
    return { web: false, ios: false };
  }
  return { web: true, ios: true };
}

export async function probeIptvStream(input: ProbeInput): Promise<IptvCheckResult> {
  const { clock } = input;
  const file = path.join(input.dir, `${randomBytes(8).toString('hex')}.ts`);
  const startedAt = clock.now();
  let bytes = 0;
  try {
    const opened = await input.net.openStream(input.url, {
      idleMs: IPTV_RELAY.idleMs,
      headersMs: IPTV_RELAY.headersMs,
      totalMs: IPTV_PROBE.maxMs + IPTV_RELAY.headersMs,
      headers: input.headers,
      accept: '*/*',
      iptv: input.policy,
      signal: input.signal,
    });
    const chunks: Buffer[] = [];
    const deadline = clock.now() + IPTV_PROBE.maxMs;
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        clock.clearTimeout(timer);
        opened.body.destroy();
        resolve();
      };
      const timer = clock.setTimeout(finish, Math.max(0, deadline - clock.now()));
      opened.body.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
        bytes += chunk.length;
        if (bytes >= IPTV_PROBE.maxBytes) finish();
      });
      opened.body.once('end', finish);
      opened.body.once('error', finish);
      opened.body.once('close', finish);
    });
    if (!bytes) return { state: 'failed', reason: 'iptv_timeout' };
    await mkdir(input.dir, { recursive: true });
    await writeFile(file, Buffer.concat(chunks, bytes));
    const media = await input.inspectFile(file, 8000, input.signal);
    const elapsed = Math.max(1, clock.now() - startedAt);
    const rateKbps = Math.round((bytes * 8) / elapsed);
    if (!media.mediaValid) return { state: 'failed', reason: 'iptv_unsupported', rateKbps };
    const playableOn = playableOnForCodec(media.videoCodec);
    if (!playableOn.web && !playableOn.ios) {
      return {
        state: 'failed',
        reason: 'iptv_unsupported',
        videoCodec: media.videoCodec,
        audioCodecs: media.audioCodecs,
        rateKbps,
        playableOn,
      };
    }
    return {
      state: 'working',
      reason: 'playable_media',
      videoCodec: media.videoCodec,
      audioCodecs: media.audioCodecs,
      rateKbps,
      playableOn,
    };
  } catch (error) {
    if (input.signal.aborted) throw input.signal.reason ?? error;
    const code = toIptvError(error, 'stream').code;
    return {
      state: code === 'iptv_busy' ? 'weak' : 'failed',
      reason:
        code === 'iptv_busy' ||
        code === 'iptv_gone' ||
        code === 'iptv_timeout' ||
        code === 'iptv_unsupported'
          ? code
          : 'iptv_unreachable',
    };
  } finally {
    await rm(file, { force: true }).catch(() => undefined);
  }
}
