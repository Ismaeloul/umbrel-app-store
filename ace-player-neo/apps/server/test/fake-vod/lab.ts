/* Laboratorio VOD de punta a punta (docs/vod.md §9.1), sin el servidor de
   la app:

     proveedor falso (1 conexión) → relé VOD (relay-vod.ts) → índice por Range
     → ffmpeg de verdad → troceador fMP4 → productor → lista HLS VOD

   - `runLabChecks`: hace de reproductor (pide el init y los segmentos con
     saltos hacia delante, hacia atrás y al final) y comprueba cada segmento:
     empieza en su fotograma clave (±35 ms), se decodifica sin errores y el
     proveedor nunca ve dos conexiones.
   - `serveLab`: sirve una página con hls.js para verlo y saltar a mano; con
     `browserCheck` (Playwright y el Chrome del sistema) hace los saltos en el
     navegador y mide cuánto tarda la imagen.

   Lo lanza a mano apps/server/scripts/vod-lab.ts; lab.test.ts lo prueba. */

import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSystemClock } from '../../src/core/clock.js';
import { createSilentLogger } from '../../src/core/logger.js';
import type { VodSession } from '../../src/modules/iptv/relay-vod.js';
import { createSpawnLauncher } from '../../src/modules/remux/process.js';
import { readVodIndex } from '../../src/modules/remux/vod/index.js';
import { segmentAt } from '../../src/modules/remux/vod/plan.js';
import { VodProducer, type VodProducerLimits } from '../../src/modules/remux/vod/producer.js';
import { createHttpRangeReader } from '../../src/modules/remux/vod/reader.js';
import type { VodIndex } from '../../src/modules/remux/vod/types.js';
import { loopbackHost } from '../fake-engine/test-utils.js';
import { fragmentStartS, readFmp4 } from './boxes.js';
import { createFakeVodOrigin, type FakeVodOrigin, type FakeVodOriginOptions } from './origin.js';
import { VOD_SAMPLES, decodeCheckAsync, ensureVodSample, type VodSampleName } from './samples.js';
import { createVodHost, type VodHost } from './vod-host.js';

export interface LabOptions {
  /** Loopback donde escuchan el proveedor falso y el relé. */
  readonly host?: string;
  /** El proveedor lento del experimento: 400 ms al primer byte y 40 Mb/s. */
  readonly slow?: boolean;
  /** El proveedor corta cada respuesta tras estos bytes. */
  readonly dropAtBytes?: number;
  readonly limits?: Partial<VodProducerLimits>;
  readonly log?: (line: string) => void;
}

export interface LabSession {
  readonly name: VodSampleName;
  readonly origin: FakeVodOrigin;
  readonly relay: VodHost;
  readonly session: VodSession;
  readonly index: VodIndex;
  readonly producer: VodProducer;
  /** Peticiones al relé y ms que costó leer el índice. */
  readonly indexMs: number;
  readonly indexOpens: number;
  close(): Promise<void>;
}

/** Abre una película de muestra de punta a punta (proveedor, relé, índice y productor). */
export async function openLabSession(
  name: VodSampleName,
  options: LabOptions = {},
): Promise<LabSession> {
  /* ::1 si se puede: en el PC de Isma el 127.0.0.1 corta conexiones al azar
     (los filtros de red; ver test/fake-engine/test-utils.ts). */
  const host = options.host ?? (await loopbackHost());
  const file = ensureVodSample(name);
  const ext = VOD_SAMPLES[name].ext;
  const originOptions: FakeVodOriginOptions = {
    ...(options.slow ? { firstByteMs: 400, rateMbps: 40 } : {}),
    ...(options.dropAtBytes ? { dropAtBytes: options.dropAtBytes } : {}),
  };
  const origin = await createFakeVodOrigin(host, { [`1.${ext}`]: file }, originOptions);
  const relay = await createVodHost(host);
  const session = relay.session(origin.url(`1.${ext}`), ext);
  const work = mkdtempSync(path.join(os.tmpdir(), 'ace-vod-lab-'));
  const started = Date.now();
  let index: VodIndex;
  let producer: VodProducer;
  try {
    index = await readVodIndex(createHttpRangeReader(session.inputUrl));
    producer = await VodProducer.open(
      {
        clock: createSystemClock(),
        logger: createSilentLogger(),
        /* En Windows, «nice 10» (BELOW_NORMAL) se queda sin turno con la CPU llena. */
        launcher: createSpawnLauncher({
          stdout: 'pipe',
          ...(process.platform === 'win32' ? { niceness: 0 } : {}),
        }),
        onDropped: (error) =>
          options.log?.(`  ! la sesión se cierra: ${error.code} ${error.detail ?? ''}`),
      },
      {
        sessionId: `s_lab${Date.now().toString(36)}`,
        dir: path.join(work, 'vod-lab'),
        inputUrl: session.inputUrl,
        index,
        audio: index.audio[0] ?? null,
        hevc: index.video.codec === 'hevc',
        ...(options.limits ? { limits: options.limits } : {}),
      },
    );
  } catch (error) {
    await relay.close();
    await origin.close();
    rmSync(work, { recursive: true, force: true });
    throw error;
  }
  return {
    name,
    origin,
    relay,
    session,
    index,
    producer,
    indexMs: Date.now() - started,
    indexOpens: relay.opens.length,
    async close() {
      await producer.close();
      await relay.close();
      await origin.close();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

export interface LabJump {
  readonly label: string;
  readonly targetS: number;
  readonly segment: number;
  readonly ms: number;
  /** Dónde empieza de verdad el segmento servido (su primer fragmento). */
  readonly startS: number | null;
  readonly expectedS: number;
  readonly frames: number;
  readonly problem: string | null;
}

export interface LabReport {
  readonly name: VodSampleName;
  readonly container: string;
  readonly video: string;
  readonly audio: string;
  readonly durationS: number;
  readonly keyframes: number;
  readonly segments: number;
  readonly indexMs: number;
  readonly indexOpens: number;
  readonly jumps: LabJump[];
  readonly restarts: number;
  readonly providerOpens: number;
  readonly providerMaxOpen: number;
  readonly providerRejected: number;
  readonly problems: string[];
}

/** Los saltos de un reproductor: empezar, mitad, seguir, atrás, casi al final, el último, otra vez atrás. */
function jumpPlan(durationS: number): { label: string; t: number }[] {
  return [
    { label: 'arranque', t: 0 },
    { label: 'salto a la mitad', t: durationS * 0.5 },
    { label: 'sigue viendo', t: durationS * 0.5 + 8 },
    { label: 'atrás al 10 %', t: durationS * 0.1 },
    { label: 'casi al final', t: durationS * 0.9 },
    { label: 'el último segmento', t: Math.max(0, durationS - 2) },
    { label: 'atrás al 30 %', t: durationS * 0.3 },
  ];
}

/** Hace de reproductor sobre una sesión abierta y comprueba cada segmento. */
export async function checkLabSession(
  lab: LabSession,
  log?: (line: string) => void,
): Promise<LabReport> {
  const { producer, index, origin, relay } = lab;
  const problems: string[] = [];
  const work = mkdtempSync(path.join(os.tmpdir(), 'ace-vod-lab-check-'));
  const jumps: LabJump[] = [];
  try {
    const init = await producer.file('init.mp4');
    if (init.kind !== 'file') throw new Error(`init.mp4: ${init.kind}`);
    const initBytes = readFileSync(init.path);
    for (const { label, t } of jumpPlan(index.durationS)) {
      const segment = segmentAt(producer.plan, t);
      for (const n of [segment, segment + 1]) {
        if (n >= producer.plan.segments.length) continue;
        const started = Date.now();
        const result = await producer.file(`index${n}.m4s`);
        const ms = Date.now() - started;
        const expectedS = producer.plan.segments[n]?.keyframeS ?? NaN;
        let startS: number | null = null;
        let frames = 0;
        let problem: string | null = null;
        if (result.kind !== 'file') {
          problem = `no llegó (${result.kind})`;
        } else {
          const joined = Buffer.concat([initBytes, readFileSync(result.path)]);
          const summary = readFmp4(joined);
          const video = summary.tracks.find((track) => track.handler === 'vide');
          startS =
            video && summary.fragments[0] ? fragmentStartS(summary.fragments[0], video) : null;
          const probe = path.join(work, `s${n}.mp4`);
          writeFileSync(probe, joined);
          const decoded = await decodeCheckAsync(probe);
          frames = decoded.frames;
          if (startS === null || Math.abs(startS - expectedS) > 0.035) {
            problem = `empieza en ${startS?.toFixed(3)} y no en ${expectedS.toFixed(3)}`;
          } else if (decoded.errors)
            problem = `errores al decodificar: ${decoded.errors.slice(0, 120)}`;
          else if (frames === 0) problem = 'sin imagen';
        }
        const jump: LabJump = {
          label: n === segment ? label : `  … y el siguiente`,
          targetS: n === segment ? t : (producer.plan.segments[n]?.startS ?? t),
          segment: n,
          ms,
          startS,
          expectedS,
          frames,
          problem,
        };
        jumps.push(jump);
        if (problem) problems.push(`segmento ${n}: ${problem}`);
        log?.(
          `  ${jump.label.padEnd(20)} ${jump.targetS.toFixed(1).padStart(6)} s → segmento ${String(n).padStart(3)} ` +
            `listo en ${String(ms).padStart(5)} ms, empieza en ${startS === null ? '—' : startS.toFixed(3)} s ` +
            `(${frames} imágenes) ${problem ? `✗ ${problem}` : '✓'}`,
        );
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  if (origin.stats.maxOpen > 1)
    problems.push(`el proveedor vio ${origin.stats.maxOpen} conexiones a la vez`);
  const audio = index.audio
    .map((a) => `${a.codec}${a.channels ? ` ${a.channels}ch` : ''}${a.lang ? ` ${a.lang}` : ''}`)
    .join(', ');
  return {
    name: lab.name,
    container: index.container,
    video: `${index.video.codec} ${index.video.codecs}`,
    audio,
    durationS: index.durationS,
    keyframes: index.keyframes.length,
    segments: producer.plan.segments.length,
    indexMs: lab.indexMs,
    indexOpens: lab.indexOpens,
    jumps,
    restarts: producer.stats().restarts,
    providerOpens: relay.opens.length,
    providerMaxOpen: origin.stats.maxOpen,
    providerRejected: origin.stats.rejected,
    problems,
  };
}

function failedReport(name: VodSampleName, problem: string): LabReport {
  return {
    name,
    container: '—',
    video: '—',
    audio: '—',
    durationS: 0,
    keyframes: 0,
    segments: 0,
    indexMs: 0,
    indexOpens: 0,
    jumps: [],
    restarts: 0,
    providerOpens: 0,
    providerMaxOpen: 0,
    providerRejected: 0,
    problems: [problem],
  };
}

/** Abre cada muestra, la comprueba y la cierra. */
export async function runLabChecks(
  names: readonly VodSampleName[],
  options: LabOptions = {},
): Promise<LabReport[]> {
  const reports: LabReport[] = [];
  for (const name of names) {
    options.log?.(`\n▶ ${name}`);
    let lab: LabSession;
    try {
      lab = await openLabSession(name, options);
    } catch (error) {
      /* Una muestra que no abre no tumba las demás: se apunta y se sigue. */
      const code = (error as { code?: string }).code ?? String(error);
      options.log?.(`  ✗ no se pudo abrir: ${code}`);
      reports.push(failedReport(name, `no se pudo abrir: ${code}`));
      continue;
    }
    try {
      const report = await checkLabSession(lab, options.log);
      options.log?.(
        `  índice: ${report.container}, ${report.video}, audio ${report.audio}; ` +
          `${report.keyframes} fotogramas clave, ${report.segments} segmentos, ${report.durationS.toFixed(1)} s; ` +
          `leído en ${report.indexMs} ms con ${report.indexOpens} peticiones al proveedor`,
      );
      options.log?.(
        `  reinicios de ffmpeg: ${report.restarts}; conexiones con el proveedor: ${report.providerOpens} ` +
          `(como mucho ${report.providerMaxOpen} a la vez, ${report.providerRejected} «ocupado»)`,
      );
      options.log?.(report.problems.length ? `  ✗ ${report.problems.join('; ')}` : '  ✓ todo bien');
      reports.push(report);
    } finally {
      await lab.close();
    }
  }
  return reports;
}

// --- La página para verlo ---

const here = path.dirname(fileURLToPath(import.meta.url));
const HLS_JS = path.resolve(here, '../../../web/node_modules/hls.js/dist/hls.min.js');

const PAGE = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Laboratorio VOD</title>
<style>
  :root { color-scheme: dark; --fondo:#0e1116; --panel:#171b22; --texto:#e8ebf0; --suave:#9aa3b2; --acento:#4f8cff; --bien:#3ecf8e; --mal:#ff6b6b; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--fondo); color:var(--texto); font:15px/1.45 system-ui, sans-serif; }
  main { max-width: 980px; margin: 0 auto; padding: 16px; }
  h1 { font-size: 20px; margin: 4px 0 2px; } p.sub { color: var(--suave); margin: 0 0 14px; }
  .fila { display:flex; flex-wrap:wrap; gap:8px; margin: 10px 0; }
  button { background: var(--panel); color: var(--texto); border: 1px solid #2a313c; border-radius: 10px; padding: 9px 13px; font: inherit; cursor: pointer; min-height: 44px; }
  button:hover { border-color: var(--acento); } button.activa { background: var(--acento); border-color: var(--acento); color: #fff; }
  video { width: 100%; aspect-ratio: 16/9; background: #000; border-radius: 12px; display: block; }
  .datos { display:grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 8px; margin-top: 12px; }
  .dato { background: var(--panel); border-radius: 10px; padding: 9px 12px; } .dato b { display:block; font-size: 18px; } .dato span { color: var(--suave); font-size: 13px; }
  ol { background: var(--panel); border-radius: 10px; padding: 10px 10px 10px 34px; margin-top: 12px; max-height: 240px; overflow: auto; font-variant-numeric: tabular-nums; }
  .ok { color: var(--bien); } .ko { color: var(--mal); }
</style></head><body><main>
<h1>Laboratorio de Pelis y series</h1>
<p class="sub">Proveedor falso de una sola conexión → relé VOD → índice → ffmpeg → lista HLS. Salta y mira que la imagen aparece donde toca.</p>
<div class="fila" id="muestras"></div>
<video id="v" controls playsinline muted></video>
<div class="fila">
  <button data-mas="-10">−10 s</button><button data-mas="10">+10 s</button>
  <button data-a="0.25">Ir al 25 %</button><button data-a="0.5">Ir al 50 %</button><button data-a="0.75">Ir al 75 %</button><button data-a="0.97">Casi al final</button>
</div>
<div class="datos">
  <div class="dato"><span>Tiempo</span><b id="tiempo">—</b></div>
  <div class="dato"><span>Reinicios de ffmpeg</span><b id="reinicios">—</b></div>
  <div class="dato"><span>Segmentos en disco</span><b id="disco">—</b></div>
  <div class="dato"><span>Conexiones a la vez (máx.)</span><b id="conexiones">—</b></div>
  <div class="dato"><span>Rechazos «ocupado»</span><b id="rechazos">—</b></div>
</div>
<ol id="saltos"></ol>
</main>
<script src="/hls.js"></script>
<script>
const v = document.getElementById('v');
let hls = null; let fatal = null; let frames = 0;
const tick = () => { frames += 1; v.requestVideoFrameCallback(tick); };
v.requestVideoFrameCallback(tick);
async function abrir(nombre) {
  document.querySelectorAll('#muestras button').forEach((b) => b.classList.toggle('activa', b.dataset.muestra === nombre));
  const info = await (await fetch('/api/abrir?muestra=' + nombre)).json();
  if (hls) hls.destroy();
  fatal = null; frames = 0;
  hls = new Hls({ startPosition: 0, maxBufferLength: 20 });
  hls.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) fatal = d.type + ': ' + d.details; });
  hls.loadSource('/video/index.m3u8?v=' + info.version);
  hls.attachMedia(v);
  await v.play().catch(() => undefined);
  return info;
}
function ir(t) {
  return new Promise((resolve) => {
    const desde = performance.now(); const antes = frames;
    v.currentTime = Math.max(0, Math.min(v.duration - 0.5, t));
    const mira = () => {
      if (fatal) return resolve({ t, ms: performance.now() - desde, actual: v.currentTime, fatal });
      if (frames > antes + 1 && !v.seeking) {
        const ms = Math.round(performance.now() - desde);
        const li = document.createElement('li');
        const bien = Math.abs(v.currentTime - t) < 0.5;
        li.innerHTML = 'Salto a ' + t.toFixed(1) + ' s → imagen en ' + ms + ' ms (en ' + v.currentTime.toFixed(2) + ' s) <span class="' + (bien ? 'ok">✓' : 'ko">✗') + '</span>';
        document.getElementById('saltos').prepend(li);
        return resolve({ t, ms, actual: v.currentTime, fatal: null });
      }
      setTimeout(mira, 20);
    };
    mira();
  });
}
window.lab = { abrir, ir, estado: () => ({ frames, fatal, t: v.currentTime, d: v.duration }) };
document.querySelectorAll('[data-mas]').forEach((b) => b.onclick = () => ir(v.currentTime + Number(b.dataset.mas)));
document.querySelectorAll('[data-a]').forEach((b) => b.onclick = () => ir(v.duration * Number(b.dataset.a)));
(async () => {
  const muestras = await (await fetch('/api/muestras')).json();
  const caja = document.getElementById('muestras');
  for (const m of muestras) { const b = document.createElement('button'); b.textContent = m; b.dataset.muestra = m; b.onclick = () => abrir(m); caja.append(b); }
  setInterval(async () => {
    const e = await (await fetch('/api/estado')).json();
    document.getElementById('tiempo').textContent = v.currentTime.toFixed(1) + ' / ' + (v.duration || 0).toFixed(0) + ' s';
    if (!e.abierta) return;
    document.getElementById('reinicios').textContent = e.reinicios;
    document.getElementById('disco').textContent = e.segmentos;
    document.getElementById('conexiones').textContent = e.maxConexiones;
    document.getElementById('rechazos').textContent = e.rechazos;
  }, 700);
  if (!new URLSearchParams(location.search).has('sin-abrir')) abrir(muestras[0]);
})();
</script></body></html>`;

export interface LabServer {
  readonly url: string;
  close(): Promise<void>;
}

/** Sirve la página del laboratorio y la película abierta. Una sesión a la vez (como en la app). */
export async function serveLab(
  port: number,
  names: readonly VodSampleName[],
  options: LabOptions = {},
): Promise<LabServer> {
  let lab: LabSession | null = null;
  let version = 0;
  let opening: Promise<LabSession> | null = null;
  const open = async (name: VodSampleName): Promise<LabSession> => {
    const previous = lab;
    lab = null;
    if (previous) await previous.close();
    version += 1;
    lab = await openLabSession(name, options);
    return lab;
  };
  const server = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://lab');
      if (url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(PAGE);
        return;
      }
      if (url.pathname === '/hls.js') {
        if (!existsSync(HLS_JS)) {
          res.writeHead(404).end('falta hls.js: corepack pnpm install');
          return;
        }
        res.writeHead(200, { 'content-type': 'text/javascript' }).end(readFileSync(HLS_JS));
        return;
      }
      if (url.pathname === '/api/muestras') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(names));
        return;
      }
      if (url.pathname === '/api/abrir') {
        const name = url.searchParams.get('muestra') as VodSampleName;
        if (!names.includes(name)) {
          res.writeHead(404).end();
          return;
        }
        opening = open(name);
        const opened = await opening;
        res.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            version,
            muestra: name,
            durationS: opened.index.durationS,
            segmentos: opened.producer.plan.segments.length,
          }),
        );
        return;
      }
      if (url.pathname === '/api/estado') {
        const current = lab;
        const body = current
          ? {
              abierta: true,
              reinicios: current.producer.stats().restarts,
              segmentos: current.producer.stats().segmentsOnDisk,
              maxConexiones: current.origin.stats.maxOpen,
              rechazos: current.origin.stats.rejected,
            }
          : { abierta: false };
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
        return;
      }
      const video = /^\/video\/([^/]+)$/.exec(url.pathname);
      if (video) {
        if (opening) await opening.catch(() => undefined);
        const current = lab;
        if (!current) {
          res.writeHead(404).end();
          return;
        }
        const file = video[1] as string;
        if (file === 'index.m3u8') {
          res
            .writeHead(200, {
              'content-type': 'application/vnd.apple.mpegurl',
              'cache-control': 'no-store',
            })
            .end(current.producer.playlist());
          return;
        }
        const controller = new AbortController();
        req.once('close', () => controller.abort());
        const result = await current.producer.file(file, controller.signal);
        if (result.kind === 'file') {
          res.writeHead(200, {
            'content-type': 'video/mp4',
            'content-length': String(result.size),
          });
          res.end(readFileSync(result.path));
        } else if (result.kind === 'not_yet') res.writeHead(503, { 'retry-after': '1' }).end();
        else res.writeHead(404).end();
        return;
      }
      res.writeHead(404).end();
    })().catch((error: unknown) => {
      options.log?.(`  ! ${String(error)}`);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${port}/`,
    async close() {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      if (lab) await lab.close();
    },
  };
}

export interface BrowserReport {
  readonly name: VodSampleName;
  readonly firstFrameMs: number;
  readonly seeks: { readonly t: number; readonly ms: number; readonly actual: number }[];
  readonly problems: string[];
}

/** Saltos en un Chrome de verdad con hls.js (la página de `serveLab`). */
export async function browserCheck(
  url: string,
  names: readonly VodSampleName[],
  log?: (line: string) => void,
): Promise<BrowserReport[]> {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const reports: BrowserReport[] = [];
  try {
    const page = await browser.newPage();
    await page.goto(`${url}?sin-abrir`);
    await page.waitForFunction(() => 'lab' in globalThis);
    for (const name of names) {
      log?.(`\n▶ ${name} en Chrome (hls.js)`);
      const problems: string[] = [];
      const started = Date.now();
      const info = await page.evaluate(
        (n) =>
          (
            globalThis as unknown as { lab: { abrir(n: string): Promise<{ durationS: number }> } }
          ).lab.abrir(n),
        name,
      );
      await page.waitForFunction(
        () =>
          (globalThis as unknown as { lab: { estado(): { frames: number } } }).lab.estado().frames >
          2,
        undefined,
        { timeout: 30_000 },
      );
      const firstFrameMs = Date.now() - started;
      log?.(`  primera imagen en ${firstFrameMs} ms`);
      const seeks: BrowserReport['seeks'][number][] = [];
      const d = info.durationS;
      for (const t of [d * 0.5, d * 0.15, d * 0.85, d * 0.4, 3]) {
        const result = await page.evaluate(
          (target) =>
            (
              globalThis as unknown as {
                lab: {
                  ir(t: number): Promise<{ ms: number; actual: number; fatal: string | null }>;
                };
              }
            ).lab.ir(target),
          t,
        );
        if (result.fatal) problems.push(`error de hls.js: ${result.fatal}`);
        if (Math.abs(result.actual - t) > 0.5)
          problems.push(`salto a ${t.toFixed(1)} cayó en ${result.actual.toFixed(2)}`);
        seeks.push({ t, ms: Math.round(result.ms), actual: result.actual });
        log?.(
          `  salto a ${t.toFixed(1).padStart(6)} s → imagen en ${String(Math.round(result.ms)).padStart(5)} ms, ` +
            `en ${result.actual.toFixed(2)} s ${Math.abs(result.actual - t) <= 0.5 && !result.fatal ? '✓' : '✗'}`,
        );
      }
      reports.push({ name, firstFrameMs, seeks, problems });
    }
  } finally {
    await browser.close();
  }
  return reports;
}
