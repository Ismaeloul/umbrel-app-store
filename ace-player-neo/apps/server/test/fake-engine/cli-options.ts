/* Opciones y arranque de la línea de órdenes del motor falso.

   Está separado de cli.ts para poder probarlo sin lanzar un proceso: cli.ts
   solo llama a `runCli` y engancha las señales. El perfil "falso" de
   deploy/local/compose.local.yml lo lanza empaquetado con esbuild y le pasa
   el puerto por variables de entorno (FAKE_ENGINE_HOST/FAKE_ENGINE_PORT, y
   HOST/PORT como respaldo); los argumentos, si vienen, mandan sobre ellas. */

import { readFileSync } from 'node:fs';

import { parseCatalog, type FakeContent } from './catalog.js';
import { createFakeEngine, type FakeEngine, type FakeEngineOptions } from './engine.js';
import { parseMode, type FakeMode } from './modes.js';

export const USAGE = `Motor AceStream falso (Ace Player Neo)

Uso: tsx apps/server/test/fake-engine/cli.ts [opciones]

  --port <n>            puerto del motor (6878; env FAKE_ENGINE_PORT o PORT)
  --host <dirección>    dirección de escucha (127.0.0.1; env FAKE_ENGINE_HOST o HOST)
  --catalog <fichero>   catálogo JSON: [{ "id": "<40 hex>", "title": "...", ... }]
                        o { "contents": [...] }; sin él, 8 canales inventados
  --public-url <url>    base de las URL absolutas (http://host:puerto); sin ella,
                        el Host de cada petición, como el motor real
  --control-port <n>    puerto aparte solo con /__fake/* (sigue vivo con el motor caído)
  --idle-timeout-ms <n> caducidad de las sesiones sin lectores (60000)
  --unknown <play|fail> qué hacer con un id fuera del catálogo (play)
  --mode <modo>         modo global al arrancar (normal, slowStart, silence, cut,
                        noPeers, stall, down, failedContent, redirectHttp)
  --help                esta ayuda
`;

export interface CliOptions {
  help: boolean;
  host: string;
  port: number;
  catalogPath: string | null;
  publicUrl: string | null;
  controlPort: number | null;
  idleTimeoutMs: number | null;
  unknownContent: 'play' | 'fail';
  mode: FakeMode | null;
}

const VALUE_FLAGS = new Set([
  'port',
  'host',
  'catalog',
  'public-url',
  'control-port',
  'idle-timeout-ms',
  'unknown',
  'mode',
]);

function parsePort(value: string, name: string): number {
  if (!/^\d{1,5}$/.test(value) || Number(value) > 65535) {
    throw new Error(`${name} no válido: ${value} (0-65535)`);
  }
  return Number(value);
}

function parsePositive(value: string, name: string): number {
  const n = Number(value);
  if (!/^\d+$/.test(value) || !(n >= 1)) throw new Error(`${name} no válido: ${value}`);
  return n;
}

function envValue(env: Record<string, string | undefined>, ...names: string[]): string | undefined {
  for (const name of names) {
    const value = env[name]?.trim();
    if (value) return value;
  }
  return undefined;
}

/* Admite `--flag valor` y `--flag=valor`. Cualquier cosa desconocida es un
   error: mejor fallar al arrancar que ignorar una opción mal escrita. */
export function parseCliArgs(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): CliOptions {
  const values = new Map<string, string>();
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === '--help' || arg === '-h') {
      help = true;
      continue;
    }
    const match = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    const name = match?.[1];
    if (!name || !VALUE_FLAGS.has(name)) throw new Error(`opción desconocida: ${arg}`);
    let value = match[2];
    if (value === undefined) {
      value = argv[i + 1];
      i += 1;
    }
    if (value === undefined || value === '') throw new Error(`falta el valor de --${name}`);
    values.set(name, value);
  }

  const portText = values.get('port') ?? envValue(env, 'FAKE_ENGINE_PORT', 'PORT') ?? '6878';
  const host = values.get('host') ?? envValue(env, 'FAKE_ENGINE_HOST', 'HOST') ?? '127.0.0.1';
  const controlPort = values.get('control-port');
  const idle = values.get('idle-timeout-ms');
  const unknown = values.get('unknown') ?? 'play';
  if (unknown !== 'play' && unknown !== 'fail')
    throw new Error(`--unknown no válido: ${unknown} (play o fail)`);
  const modeText = values.get('mode');
  return {
    help,
    host,
    port: parsePort(portText, 'puerto'),
    catalogPath: values.get('catalog') ?? null,
    publicUrl: values.get('public-url') ?? null,
    controlPort: controlPort === undefined ? null : parsePort(controlPort, '--control-port'),
    idleTimeoutMs: idle === undefined ? null : parsePositive(idle, '--idle-timeout-ms'),
    unknownContent: unknown,
    mode: modeText === undefined ? null : parseMode(modeText),
  };
}

export function loadCatalogFile(file: string): FakeContent[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `no se pudo leer el catálogo ${file}: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  return parseCatalog(raw);
}

export interface CliRun {
  engine: FakeEngine | null;
}

/* Arranca el motor con las opciones de la línea de órdenes y cuenta por
   `log` dónde escucha y qué canales tiene (para copiar ids a mano). */
export async function runCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  log: (line: string) => void,
): Promise<CliRun> {
  const options = parseCliArgs(argv, env);
  if (options.help) {
    log(USAGE);
    return { engine: null };
  }
  const engineOptions: FakeEngineOptions = {
    host: options.host,
    port: options.port,
    unknownContent: options.unknownContent,
  };
  if (options.catalogPath) engineOptions.catalog = loadCatalogFile(options.catalogPath);
  if (options.publicUrl) engineOptions.publicUrl = options.publicUrl;
  if (options.controlPort !== null) engineOptions.controlPort = options.controlPort;
  if (options.idleTimeoutMs !== null) engineOptions.idleTimeoutMs = options.idleTimeoutMs;

  const engine = await createFakeEngine(engineOptions);
  if (options.mode) await engine.control.setMode('*', options.mode);
  log(`motor falso escuchando en ${engine.url} (host ${engine.host})`);
  if (engine.controlUrl) log(`control aparte en ${engine.controlUrl}/__fake/status`);
  if (options.mode) log(`modo global: ${JSON.stringify(options.mode)}`);
  for (const content of engine.control.catalog()) {
    log(
      `  ${content.id}  ${content.title}  [${content.video}/${content.audio.join('+')}, ${content.bitrateKbps} kbit/s, ${content.peers} pares]`,
    );
  }
  return { engine };
}
