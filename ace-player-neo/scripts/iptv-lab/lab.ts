/* Laboratorio de reproducción IPTV de punta a punta (scripts/iptv-lab/README.md).

     node scripts/iptv-lab/run.mjs <escenario> [--minutos N] [--modo web|sola]
                                   [--chrome RUTA] [--headed] [--salida DIR]
                                   [--perfil balanced|stable|low] [--lista]

   1. Codifica (una vez) el clip del escenario (lib/clips.ts).
   2. Levanta el proveedor falso de las pruebas (apps/server/test/fake-iptv) y,
      delante, el proveedor del laboratorio (lib/provider.ts) con la emisión de
      verdad y la red del escenario.
   3. Levanta el backend DE VERDAD (lib/backend.ts: el arranque de main.ts, con
      ffmpeg del PATH para el remux) y la web con Vite (modo desarrollo).
   4. Conecta la IPTV (Xtream) por la API y abre el canal «M+ LaLiga TV 2» en
      Chrome (con H.264 y AAC: el Chromium de Playwright no los trae):
      - `--modo web` (por defecto): la web entera, entrando por Canales → IPTV
        y tocando el canal, así que runtime.ts (vigilante, rebuffer, directo)
        está dentro;
      - `--modo sola`: una página con SOLO hls.js (el mismo de node_modules y la
        misma configuración que engines/hls.ts con el perfil) contra la lista
        del remux, abriendo la sesión por la API y con latido. Sirve para
        separar lo que hace hls.js de lo que hace runtime.ts.
   5. Graba durante N minutos (lib/instrument.ts en la página, la lista del
      remux en disco cada 500 ms, el registro del backend y lo que hace el
      proveedor) y escribe el informe (lib/analyze.ts). */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  type WriteStream,
} from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Page } from '@playwright/test';
import { createFakeIptv } from '../../apps/server/test/fake-iptv/provider.js';
import { analyze } from './lib/analyze.ts';
import { describeClip, ensureClip } from './lib/clips.ts';
import { hlsPatch, instrumentSource } from './lib/instrument.ts';
import { startLabProvider, type LabProvider } from './lib/provider.ts';
import { findScenario, SCENARIOS, type Scenario } from './lib/scenarios.ts';
import { soloPage } from './lib/solo.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MONOREPO = path.resolve(HERE, '../..');
const WEB_DIR = path.join(MONOREPO, 'apps/web');
const TSX_CLI = path.join(MONOREPO, 'node_modules/tsx/dist/cli.mjs');
const VITE_CLI = path.join(WEB_DIR, 'node_modules/vite/bin/vite.js');
const VITE_CONFIG = path.join(WEB_DIR, 'e2e/support/vite.e2e.config.ts');
const HLS_MJS = path.join(WEB_DIR, 'node_modules/hls.js/dist/hls.mjs');

const IPTV_SERVER = 'http://iptv.ace-e2e.example:8080';
const IPTV_USER = 'usuario-e2e';
const IPTV_PASS = 'Cl4ve-Secreta-E2E';
/** Canal de una sola variante del proveedor falso (id 104). */
const CHANNEL_QUERY = 'laliga tv 2';
const CHANNEL_TITLE = 'M+ LaLiga TV 2';

// ---------------------------------------------------------------- argumentos

interface Args {
  scenario: string;
  minutes: number | null;
  mode: 'web' | 'sola';
  chrome: string | null;
  headed: boolean;
  out: string | null;
  profile: 'balanced' | 'stable' | 'low';
  cache: string;
  /** Carpeta con OTRO ffmpeg/ffprobe para el remux del backend (el de Alpine del Umbrel). */
  ffmpegDir: string | null;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    scenario: '',
    minutes: null,
    mode: 'web',
    chrome: process.env.IPTV_LAB_CHROME ?? null,
    headed: false,
    out: null,
    profile: 'balanced',
    cache: process.env.IPTV_LAB_CACHE ?? path.join(os.tmpdir(), 'iptv-lab-cache'),
    ffmpegDir: process.env.IPTV_LAB_FFMPEG_DIR ?? null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i] as string;
    const next = (): string => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`Falta el valor de ${a}`);
      i += 1;
      return v;
    };
    if (a === '--minutos') args.minutes = Number(next());
    else if (a === '--modo') args.mode = next() as Args['mode'];
    else if (a === '--chrome') args.chrome = next();
    else if (a === '--headed') args.headed = true;
    else if (a === '--salida') args.out = next();
    else if (a === '--perfil') args.profile = next() as Args['profile'];
    else if (a === '--cache') args.cache = next();
    else if (a === '--ffmpeg-dir') args.ffmpegDir = next();
    else if (a === '--lista') {
      for (const s of SCENARIOS) process.stdout.write(`${s.name.padEnd(20)} ${s.description}\n`);
      process.exit(0);
    } else if (!a.startsWith('--')) args.scenario = a;
    else throw new Error(`Opción desconocida: ${a}`);
  }
  return args;
}

// ---------------------------------------------------------------- utilidades

const T0 = Date.now();
function log(line: string): void {
  process.stderr.write(`[lab ${((Date.now() - T0) / 1000).toFixed(1).padStart(6)}s] ${line}\n`);
}

function freePort(host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, host, () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

/** ::1 si hay IPv6 (en el PC de Isma 127.0.0.1 corta conexiones), si no 127.0.0.1. */
async function pickLoopback(): Promise<string> {
  if (process.env.IPTV_LAB_LOOPBACK) return process.env.IPTV_LAB_LOOPBACK;
  try {
    await freePort('::1');
    return '::1';
  } catch {
    return '127.0.0.1';
  }
}

const urlHost = (host: string): string => (host.includes(':') ? `[${host}]` : host);

function httpGetOk(url: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(url, { agent: false }, (res) => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => req.destroy());
  });
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!(await httpGetOk(url))) {
    if (Date.now() - started > timeoutMs) throw new Error(`${url} no contestó en ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

async function api<T>(base: string, pathname: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${base}${pathname}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${pathname} → ${res.status}: ${text.slice(0, 300)}`);
  return (text ? JSON.parse(text) : null) as T;
}

function findChrome(args: Args): string {
  const candidates = [
    args.chrome,
    path.join(args.cache, 'chrome/opt/google/chrome/chrome'),
    '/opt/google/chrome/chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/google-chrome',
  ].filter((c): c is string => Boolean(c));
  for (const c of candidates) if (existsSync(c)) return c;
  throw new Error(
    `No encuentro un Chrome con H.264/AAC. El Chromium de Playwright no los trae.\n` +
      `Descárgalo una vez (sin instalar nada en el sistema):\n` +
      `  mkdir -p ${args.cache} && cd ${args.cache} && curl -sSo chrome.deb https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb && dpkg-deb -x chrome.deb chrome\n` +
      `o pásalo con --chrome /ruta/a/chrome (o IPTV_LAB_CHROME).`,
  );
}

class Jsonl {
  private readonly stream: WriteStream;
  constructor(file: string) {
    this.stream = createWriteStream(file, { flags: 'w' });
  }
  write(entry: unknown): void {
    this.stream.write(`${JSON.stringify(entry)}\n`);
  }
  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
}

// ---------------------------------------------------------------- procesos

const children: ChildProcess[] = [];
function launch(
  name: string,
  cmd: string,
  argv: string[],
  env: NodeJS.ProcessEnv,
  logFile: string,
  cwd = MONOREPO,
): ChildProcess {
  const out = createWriteStream(logFile, { flags: 'a' });
  const child = spawn(cmd, argv, { cwd, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  child.once('exit', (code, signal) => log(`${name} terminó (${code ?? signal})`));
  children.push(child);
  return child;
}

async function stopChildren(): Promise<void> {
  for (const child of children) {
    if (child.exitCode !== null) continue;
    try {
      if (child.connected) child.send('shutdown');
      else child.kill('SIGTERM');
    } catch {}
  }
  await new Promise((r) => setTimeout(r, 1500));
  for (const child of children) if (child.exitCode === null) child.kill('SIGKILL');
}

// ---------------------------------------------------------------- principal

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const scenario = findScenario(args.scenario);
  if (!scenario) {
    process.stderr.write(
      `Escenario desconocido «${args.scenario}». Hay:\n${SCENARIOS.map((s) => `  ${s.name}`).join('\n')}\n`,
    );
    process.exit(2);
  }
  const minutes = args.minutes ?? scenario.minutes;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const outDir =
    args.out ?? path.join(os.tmpdir(), 'iptv-lab', `${scenario.name}-${args.mode}-${stamp}`);
  mkdirSync(outDir, { recursive: true });
  const work = path.join(outDir, 'trabajo');
  mkdirSync(work, { recursive: true });
  const chrome = findChrome(args);
  log(`escenario ${scenario.name}: ${scenario.description}`);
  log(`clip ${describeClip(scenario.clip)}; ${minutes} min; modo ${args.mode}; salida ${outDir}`);
  const remuxFfmpeg = spawnSync(args.ffmpegDir ? path.join(args.ffmpegDir, 'ffmpeg') : 'ffmpeg', ['-version'], {
    encoding: 'utf8',
  }).stdout?.split('\n')[0];
  log(`ffmpeg del remux: ${remuxFfmpeg ?? '¿?'}`);

  const clip = await ensureClip(args.cache, scenario.clip, log);
  const loop = await pickLoopback();

  // Proveedor falso (panel Xtream) + proveedor del laboratorio (streams).
  const fake = await createFakeIptv({
    host: loop,
    port: 0,
    publicHost: 'iptv.ace-e2e.example:8080',
    maxConnections: 5,
    outputFormats: scenario.kind === 'hls' ? ['m3u8'] : ['ts'],
  });
  const providerLog = new Jsonl(path.join(outDir, 'proveedor.jsonl'));
  const provider: LabProvider = await startLabProvider({
    clip,
    kind: scenario.kind,
    ...(scenario.ts ? { ts: scenario.ts } : {}),
    ...(scenario.hls ? { hls: scenario.hls } : {}),
    upstream: { host: loop, port: fake.port },
    host: loop,
    workDir: work,
    onEvent: (e) => providerLog.write(e),
  });
  log(`proveedor en ${urlHost(loop)}:${provider.port} (${Math.round((provider.bytesPerSecond * 8) / 1000)} kbit/s)`);

  // Backend de verdad.
  const backendPort = await freePort(loop);
  const dataDir = path.join(work, 'data');
  mkdirSync(dataDir, { recursive: true });
  const backendLog = path.join(outDir, 'backend.log');
  launch(
    'backend',
    process.execPath,
    [TSX_CLI, path.join(HERE, 'lib/backend.ts')],
    {
      ...process.env,
      ...(args.ffmpegDir ? { PATH: `${args.ffmpegDir}${path.delimiter}${process.env.PATH ?? ''}` } : {}),
      PORT: String(backendPort),
      DATA_DIR: dataDir,
      AUTO_SYNC: 'false',
      FOOTBALL_DEMO_ONLY: 'true',
      /* Sin motor AceStream: la IPTV se abre igual (docs/iptv.md §6.4). */
      ACESTREAM_HOST: '127.0.0.39',
      ENGINE_CONTROL_HOST: '127.0.0.39',
      ACESTREAM_SCANNER_HOST: 'localhost',
      ACESTREAM_SCANNER_PORT: '9',
      OLLAMA_BASE_URL: '',
      ACE_LOG_LEVEL: process.env.IPTV_LAB_LOG_LEVEL ?? 'debug',
      LAB_PROVIDER_PORT: String(provider.port),
      LAB_LOOPBACK: loop,
    },
    backendLog,
  );
  const backend = `http://${urlHost(loop)}:${backendPort}`;
  await waitFor(`${backend}/api/v1/health/live`, 90_000);
  log(`backend en ${backend}`);

  // IPTV por la API.
  await api(backend, '/api/v1/iptv', {
    method: 'PUT',
    body: JSON.stringify({
      kind: 'xtream',
      name: 'Laboratorio',
      server: IPTV_SERVER,
      username: IPTV_USER,
      password: IPTV_PASS,
    }),
  });
  const syncStarted = Date.now();
  for (;;) {
    const view = await api<{ provider: { status: string; channels: number; error: unknown } | null }>(
      backend,
      '/api/v1/iptv',
    );
    if (view.provider?.status === 'ok' && view.provider.channels > 0) break;
    if (view.provider?.status === 'error') throw new Error(`IPTV en error: ${JSON.stringify(view.provider.error)}`);
    if (Date.now() - syncStarted > 60_000) throw new Error('La IPTV no terminó de sincronizar en 60 s');
    await new Promise((r) => setTimeout(r, 500));
  }
  const found = await api<{ channels: { id: string; title: string }[] }>(
    backend,
    `/api/v1/iptv/channels?q=${encodeURIComponent(CHANNEL_QUERY)}`,
  );
  const channel = found.channels.find((c) => c.title === CHANNEL_TITLE) ?? found.channels[0];
  if (!channel) throw new Error('No aparece el canal del laboratorio en la IPTV');
  log(`IPTV lista; canal «${channel.title}» ${channel.id}`);

  // Web (Vite, desarrollo) si hace falta.
  let webBase = '';
  if (args.mode === 'web') {
    const webPort = await freePort('127.0.0.1');
    launch(
      'web',
      process.execPath,
      [VITE_CLI, '--config', VITE_CONFIG, '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
      { ...process.env, VITE_BACKEND: backend },
      path.join(outDir, 'vite.log'),
      WEB_DIR,
    );
    webBase = `http://127.0.0.1:${webPort}`;
    await waitFor(`${webBase}/`, 90_000);
    log(`web en ${webBase}`);
  }

  // Chrome.
  const browser = await chromium.launch({
    executablePath: chrome,
    headless: !args.headed,
    args: ['--autoplay-policy=no-user-gesture-required', '--disable-background-media-suspend'],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const consoleLog = new Jsonl(path.join(outDir, 'consola.jsonl'));
  page.on('console', (msg) => consoleLog.write({ at: Date.now(), type: msg.type(), text: msg.text().slice(0, 800) }));
  page.on('pageerror', (err) => consoleLog.write({ at: Date.now(), type: 'pageerror', text: String(err).slice(0, 800) }));
  await page.route((url) => /\/(?:hls__js\.js|hls\.mjs|hls\.js)$/.test(url.pathname), async (route) => {
    const url = route.request().url();
    const response = await route.fetch();
    const body = await response.text();
    const patched = hlsPatch(body);
    if (patched !== body) log(`hls.js parcheado (${url.replace(/\?.*/, '')})`);
    await route.fulfill({ response, body: patched });
  });
  await page.addInitScript({ content: instrumentSource() });

  let sessionId: string | null = null;
  let stopSolo: (() => Promise<void>) | null = null;
  const recordStart = Date.now();
  if (args.mode === 'web') {
    await page.goto(`${webBase}/?vista=biblioteca&pestana=iptv`);
    const search = page.getByRole('searchbox', { name: 'Buscar en tu IPTV' });
    await search.waitFor({ timeout: 60_000 });
    await search.fill(CHANNEL_QUERY);
    const link = page.getByRole('link', { name: CHANNEL_TITLE, exact: true }).first();
    await link.waitFor({ timeout: 30_000 });
    await link.click();
    await page.waitForURL(/vista=partido\/canal\//, { timeout: 30_000 });
    log('canal tocado en Canales → IPTV');
  } else {
    const solo = await soloPage({
      page,
      backend,
      channelId: channel.id,
      profile: args.profile,
      hlsFile: HLS_MJS,
      log,
    });
    sessionId = solo.sessionId;
    stopSolo = solo.stop;
  }

  // Grabación.
  const samples = new Jsonl(path.join(outDir, 'muestras.jsonl'));
  const pageEvents = new Jsonl(path.join(outDir, 'eventos.jsonl'));
  const remuxLog = new Jsonl(path.join(outDir, 'remux.jsonl'));
  const remuxRoot = path.join(dataDir, 'remux');
  let lastPlaylist = '';
  let lastDir = '';
  const remuxTimer = setInterval(() => {
    try {
      const dirs = existsSync(remuxRoot) ? readdirSync(remuxRoot) : [];
      const dir = dirs[0];
      if (!dir) {
        if (lastDir) remuxLog.write({ at: Date.now(), type: 'remux.gone' });
        lastDir = '';
        return;
      }
      if (dir !== lastDir) {
        lastDir = dir;
        remuxLog.write({ at: Date.now(), type: 'remux.dir', dir });
      }
      const file = path.join(remuxRoot, dir, 'index.m3u8');
      if (!existsSync(file)) return;
      const text = readFileSync(file, 'utf8');
      if (text === lastPlaylist) return;
      lastPlaylist = text;
      const seq = Number(/#EXT-X-MEDIA-SEQUENCE:(\d+)/.exec(text)?.[1] ?? -1);
      const td = Number(/#EXT-X-TARGETDURATION:(\d+)/.exec(text)?.[1] ?? -1);
      const durs = [...text.matchAll(/#EXTINF:([\d.]+)/g)].map((m) => Number(m[1]));
      const disc = (text.match(/#EXT-X-DISCONTINUITY\b/g) ?? []).length;
      const segs = [...text.matchAll(/^(index\d+\.m4s)$/gm)].map((m) => m[1]);
      remuxLog.write({ at: Date.now(), type: 'remux.playlist', seq, td, n: durs.length, durs, disc, last: segs.at(-1) });
    } catch (error) {
      remuxLog.write({ at: Date.now(), type: 'remux.error', error: String(error) });
    }
  }, 500);

  const pending = [...(scenario.actions ?? [])];
  const endAt = recordStart + minutes * 60_000;
  let lastStatus = 0;
  while (Date.now() < endAt) {
    await new Promise((r) => setTimeout(r, 2000));
    const elapsed = (Date.now() - recordStart) / 1000;
    while (pending.length && (pending[0] as [number, string])[0] <= elapsed) {
      const [, action] = pending.shift() as [number, string];
      if (action === 'cortar') provider.cutNow();
      else if (action.startsWith('parar:')) provider.pauseNow(Number(action.slice(6)));
      log(`acción: ${action}`);
    }
    const drained = await drain(page);
    for (const s of drained.samples) samples.write(s);
    for (const e of drained.events) pageEvents.write(e);
    if (Date.now() - lastStatus > 15_000) {
      lastStatus = Date.now();
      const s = drained.samples.at(-1) as { ct?: number; app?: { phase?: string; msg?: string } } | undefined;
      log(`t=${elapsed.toFixed(0)}s ct=${s?.ct ?? '-'} fase=${s?.app?.phase ?? '-'} ${s?.app?.msg ?? ''}`);
    }
  }
  const last = await drain(page);
  for (const s of last.samples) samples.write(s);
  for (const e of last.events) pageEvents.write(e);
  clearInterval(remuxTimer);
  await Promise.all([samples.close(), pageEvents.close(), remuxLog.close(), providerLog.close(), consoleLog.close()]);
  await page.screenshot({ path: path.join(outDir, 'final.png') }).catch(() => undefined);
  await stopSolo?.();
  await browser.close();
  await provider.close();
  await fake.close();
  await stopChildren();

  const report = analyze({ dir: outDir, scenario, recordStart, sessionId });
  writeFileSync(path.join(outDir, 'informe.txt'), report.text);
  writeFileSync(path.join(outDir, 'resumen.json'), JSON.stringify(report.summary, null, 2));
  process.stdout.write(`${report.text}\n\nSalida: ${outDir}\n`);
}

async function drain(page: Page): Promise<{ samples: unknown[]; events: unknown[] }> {
  try {
    return await page.evaluate(() => {
      const lab = (window as unknown as { __lab?: { drain(): { samples: unknown[]; events: unknown[] } } }).__lab;
      return lab ? lab.drain() : { samples: [], events: [] };
    });
  } catch {
    return { samples: [], events: [] };
  }
}

export type { Scenario };

main().catch(async (error: unknown) => {
  log(`ERROR: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  await stopChildren();
  process.exit(1);
});
