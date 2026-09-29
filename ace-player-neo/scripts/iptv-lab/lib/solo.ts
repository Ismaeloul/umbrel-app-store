/* Modo `sola` del laboratorio: SOLO hls.js, sin la web.

   - Abre la sesión IPTV por la API (GET /api/v1/channels/:id/stream con
     client=web, como runtime.ts) y manda el latido cada 15 s.
   - La página se sirve (con page.route) DESDE EL ORIGEN DEL BACKEND, así que
     /api/v1/video/<sid>/… va a la red de verdad y es del mismo origen (el
     <canvas> puede leer la tira de código).
   - hls.js es el mismo fichero de apps/web/node_modules (hls.mjs), parcheado
     como en la web (instrument.ts), con la MISMA configuración que
     `hlsConfig(profile)` de apps/web/src/player/engines/hls.ts: 20 s de plazo,
     los reintentos de la lista y el bloque `hls` del perfil.
   - Sin runtime.ts: nada de vigilante, rebuffer ni «ir al directo». Se llama a
     play() una vez y, si hls.js da un error fatal, se hace lo mismo que el
     adaptador (startLoad / recoverMediaError); nada más. */

import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { PLAYBACK_PROFILES } from '../../../packages/shared/src/constants/playback.ts';
import { HLS_PLAYLIST_RETRY } from '../../../apps/web/src/player/engines/hls.ts';
import { hlsPatch } from './instrument.ts';

export interface SoloOptions {
  readonly page: Page;
  readonly backend: string;
  readonly channelId: string;
  readonly profile: 'balanced' | 'stable' | 'low';
  readonly hlsFile: string;
  readonly log: (line: string) => void;
}

const VIEWER = 'lab-viewer-1';
const DEVICE = 'lab-device-1';

export async function soloPage(options: SoloOptions): Promise<{ sessionId: string; stop(): Promise<void> }> {
  const { page, backend, channelId, profile, log } = options;
  const query = new URLSearchParams({
    client: 'web',
    kind: 'auto',
    mode: profile,
    viewer: VIEWER,
    device: DEVICE,
    title: 'Laboratorio',
  });
  const started = Date.now();
  const res = await fetch(`${backend}/api/v1/channels/${channelId}/stream?${query}`);
  const grant = (await res.json()) as {
    url: string;
    protocol: string;
    session: { id: string; heartbeatMs: number };
    source?: string;
  };
  if (!res.ok) throw new Error(`channelStream → ${res.status}: ${JSON.stringify(grant)}`);
  log(`sesión ${grant.session.id} (${grant.protocol}, ${grant.source}) en ${Date.now() - started} ms: ${grant.url}`);
  const beat = setInterval(() => {
    void fetch(`${backend}/api/v1/sessions/${grant.session.id}/heartbeat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ viewer: VIEWER, playing: true }),
    }).catch(() => undefined);
  }, grant.session.heartbeatMs || 15_000);

  const config = {
    manifestLoadingTimeOut: 20_000,
    fragLoadingTimeOut: 20_000,
    ...HLS_PLAYLIST_RETRY,
    ...PLAYBACK_PROFILES[profile].hls,
  };
  const hlsSource = hlsPatch(readFileSync(options.hlsFile, 'utf8'));
  const html = `<!doctype html><meta charset="utf-8"><title>lab sola</title>
<body style="margin:0;background:#000"><video id="v" muted playsinline style="width:960px;height:540px"></video>
<script type="module">
import Hls from '/__lab_hls.mjs';
const video = document.getElementById('v');
const config = ${JSON.stringify(config)};
const hls = new Hls(config);
window.__soloHls = hls;
let net = 0, media = 0;
hls.on(Hls.Events.FRAG_LOADED, () => { net = 0; });
hls.on(Hls.Events.ERROR, (_e, d) => {
  if (!d.fatal) return;
  if (d.type === Hls.ErrorTypes.NETWORK_ERROR && net < 3) { const delay = 750 * 2 ** net; net += 1; setTimeout(() => hls.startLoad(), delay); return; }
  if (d.type === Hls.ErrorTypes.MEDIA_ERROR && media < 2) { media += 1; if (media === 2) hls.swapAudioCodec(); hls.recoverMediaError(); return; }
  window.__lab && window.__lab.push('solo.fatal', { details: d.details });
});
hls.loadSource(${JSON.stringify(grant.url)});
hls.attachMedia(video);
hls.on(Hls.Events.MANIFEST_PARSED, () => { video.play().catch((e) => window.__lab && window.__lab.push('solo.playError', { e: String(e) })); });
</script>`;
  await page.route(`${backend}/__lab_solo.html`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: html }),
  );
  await page.route(`${backend}/__lab_hls.mjs`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: hlsSource }),
  );
  await page.goto(`${backend}/__lab_solo.html`);
  return {
    sessionId: grant.session.id,
    async stop() {
      clearInterval(beat);
      await fetch(`${backend}/api/v1/sessions/${grant.session.id}/release`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ viewer: VIEWER, reason: 'user' }),
      }).catch(() => undefined);
    },
  };
}
