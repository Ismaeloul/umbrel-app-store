/* engine_control 0.7.0: el único programa con el socket de Docker montado.
   Solo sabe reiniciar UN contenedor, el del motor AceStream principal.

   Mismo protocolo que releases/0.6.59/engine-control.js (T-118, B-229):
   - `POST /restart` con la cabecera `x-engine-token`; cualquier otra cosa,
     404 `{"error":"not_found"}` (engine-control.js:61-68);
   - token que no coincide → 401 `{"error":"unauthorized"}`;
   - 15 s de enfriamiento, marcado ANTES de llamar a Docker (27-28) → 429
     `{"error":"restart_cooldown"}`;
   - API de Docker por el socket unix: `POST /containers/<ACESTREAM_CONTAINER>/restart?t=2`
     con 7 s de plazo (35-53); 2xx → 200 `{"restarted":true}`, cualquier otra
     cosa → 502 `{"error":"restart_failed"}`.

   Cambios de la 0.7.0 (arquitectura §5.5 y §13, empaquetado §4):
   - el token se compara en tiempo constante (`timingSafeEqual` sobre los
     SHA-256, así tampoco se filtra la longitud);
   - token vacío = se rechaza TODO con 401 (falla cerrado). En la 0.6.59 un
     token vacío dejaba pasar cualquier petición (56-59).

   Solo módulos nativos de Node: se empaqueta aparte a CommonJS (build.mjs)
   y corre en un contenedor `read_only` sin node_modules. Por eso no importa
   nada de @ace/shared; los valores que comparte con el backend llevan al
   lado la constante de la que salen, y un test comprueba que coinciden. */

import { createHash, timingSafeEqual } from 'node:crypto';
import http, { type IncomingMessage, type Server, type ServerResponse } from 'node:http';

export const DOCKER_SOCKET = '/var/run/docker.sock';
export const DEFAULT_ACESTREAM_CONTAINER = 'ismaeloul-ace-player-neo_acestream_1';
/** = ENGINE_WATCHDOG.manualRestartCooldownMs de @ace/shared (engine-control.js:8). */
export const RESTART_COOLDOWN_MS = 15_000;
/** Plazo de la API de Docker (engine-control.js:39). */
export const DOCKER_TIMEOUT_MS = 7_000;
/** Puerto de siempre (engine-control.js:76) = ENGINE_CONTROL_PORT del backend. */
export const ENGINE_CONTROL_PORT = 3001;
/** Salida forzada si el cierre limpio no termina (engine-control.js:80). */
export const FORCE_EXIT_MS = 5_000;

/** Lo mínimo de un reloj: el real o el FakeClock de los tests. */
export interface ControlClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: never): void;
}

const systemClock: ControlClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as unknown as ReturnType<typeof setTimeout>),
};

export interface EngineControlOptions {
  /** Secreto compartido con el backend. Vacío = se rechaza todo. */
  readonly token: string;
  readonly container: string;
  /** Socket de Docker (en los tests, un pipe o socket temporal). */
  readonly dockerSocket?: string;
  readonly clock?: ControlClock;
  readonly dockerTimeoutMs?: number;
  /** Mensajes para el log del contenedor (nunca el token). */
  readonly log?: (line: string) => void;
}

/** Variables de entorno que lee engine_control (las pone el Compose). */
export interface EngineControlEnv {
  readonly ACESTREAM_CONTAINER?: string | undefined;
  readonly ENGINE_CONTROL_TOKEN?: string | undefined;
}

/** engine-control.js:6-7: solo `[a-zA-Z0-9_.-]`, 128 como mucho; vacío → el de siempre. */
export function sanitizeContainer(value: unknown): string {
  return (
    String(value || '')
      .trim()
      .replace(/[^a-zA-Z0-9_.-]/g, '')
      .slice(0, 128) || DEFAULT_ACESTREAM_CONTAINER
  );
}

/** engine-control.js:13 (y server.js:24): recortado y 200 caracteres como mucho. */
export function normalizeToken(value: unknown): string {
  return String(value || '')
    .trim()
    .slice(0, 200);
}

export function optionsFromEnv(env: EngineControlEnv): EngineControlOptions {
  return {
    token: normalizeToken(env.ENGINE_CONTROL_TOKEN),
    container: sanitizeContainer(env.ACESTREAM_CONTAINER),
  };
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/**
 * `tokenValido` (engine-control.js:56-59) en tiempo constante y fallando
 * cerrado: con el token vacío, nada es válido.
 */
export function tokenValido(req: Pick<IncomingMessage, 'headers'>, token: string): boolean {
  if (!token) return false;
  const header = req.headers['x-engine-token'];
  const given = typeof header === 'string' ? header : '';
  return timingSafeEqual(digest(given), digest(token));
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  if (res.writableEnded) return;
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(payload));
}

/** `handleRequest` (engine-control.js:61-68) con su estado (el enfriamiento) dentro. */
export function createRequestHandler(
  options: EngineControlOptions,
): (req: IncomingMessage, res: ServerResponse) => void {
  const clock = options.clock ?? systemClock;
  const socketPath = options.dockerSocket ?? DOCKER_SOCKET;
  const timeoutMs = options.dockerTimeoutMs ?? DOCKER_TIMEOUT_MS;
  const container = sanitizeContainer(options.container);
  const log = options.log ?? (() => undefined);
  let lastRestartAt: number | null = null;

  function restartEngine(res: ServerResponse): void {
    const now = clock.now();
    if (lastRestartAt !== null && now - lastRestartAt < RESTART_COOLDOWN_MS) {
      send(res, 429, { error: 'restart_cooldown' });
      return;
    }
    lastRestartAt = now;
    let answered = false;
    let timer: unknown = null;
    const answer = (status: number, payload: unknown): void => {
      if (answered) return;
      answered = true;
      if (timer !== null) clock.clearTimeout(timer as never);
      if (status !== 200) log(`reinicio fallido (${status})`);
      else log(`contenedor ${container} reiniciado`);
      send(res, status, payload);
    };
    const dockerRequest = http.request(
      {
        socketPath,
        path: `/containers/${encodeURIComponent(container)}/restart?t=2`,
        method: 'POST',
      },
      (dockerResponse) => {
        dockerResponse.resume();
        dockerResponse.on('end', () => {
          const code = dockerResponse.statusCode ?? 0;
          if (code >= 200 && code < 300) answer(200, { restarted: true });
          else answer(502, { error: 'restart_failed' });
        });
        dockerResponse.on('error', () => answer(502, { error: 'restart_failed' }));
      },
    );
    /* Plazo total (en la 0.6.59, de inactividad del socket: `timeout: 7000`). */
    timer = clock.setTimeout(() => dockerRequest.destroy(new Error('docker_timeout')), timeoutMs);
    dockerRequest.on('error', () => answer(502, { error: 'restart_failed' }));
    dockerRequest.end();
  }

  return (req, res) => {
    if (req.method === 'POST' && req.url === '/restart') {
      req.resume();
      if (!tokenValido(req, options.token)) {
        send(res, 401, { error: 'unauthorized' });
        return;
      }
      restartEngine(res);
      return;
    }
    req.resume();
    send(res, 404, { error: 'not_found' });
  };
}

/** `createServer` (engine-control.js:70-72). */
export function createServer(options: EngineControlOptions): Server {
  return http.createServer(createRequestHandler(options));
}

export interface StartOptions {
  readonly port?: number;
  readonly host?: string;
  /** Dónde se escuchan SIGTERM y SIGINT (el proceso; un emisor falso en los tests). */
  readonly signals?: Pick<NodeJS.Process, 'once'>;
  readonly exit?: (code: number) => void;
  readonly log?: (line: string) => void;
  readonly dockerSocket?: string;
  readonly clock?: ControlClock;
}

export interface RunningControl {
  readonly server: Server;
  /** Resuelve cuando ya escucha (el puerto real, útil con `port: 0`). */
  readonly listening: Promise<number>;
}

/**
 * Arranque (engine-control.js:74-84): escucha en `0.0.0.0:3001` y se cierra
 * limpio con SIGTERM o SIGINT, con salida forzada a los 5 s.
 */
export function startEngineControl(
  env: EngineControlEnv,
  start: StartOptions = {},
): RunningControl {
  const log = start.log ?? ((line: string) => console.log(`engine-control: ${line}`));
  const base = optionsFromEnv(env);
  if (!base.token) {
    log('ENGINE_CONTROL_TOKEN vacío: se rechazarán todos los reinicios (401)');
  }
  const server = createServer({
    ...base,
    log,
    ...(start.dockerSocket ? { dockerSocket: start.dockerSocket } : {}),
    ...(start.clock ? { clock: start.clock } : {}),
  });
  const exit = start.exit ?? ((code: number) => process.exit(code));
  const signals = start.signals ?? process;
  const clock = start.clock ?? systemClock;
  let closing = false;
  const shutdown = (): void => {
    if (closing) return;
    closing = true;
    server.close(() => exit(0));
    const force = clock.setTimeout(() => exit(1), FORCE_EXIT_MS);
    (force as { unref?: () => void } | null)?.unref?.();
  };
  signals.once('SIGTERM', shutdown);
  signals.once('SIGINT', shutdown);
  const listening = new Promise<number>((resolve, reject) => {
    server.once('error', reject);
    server.listen(start.port ?? ENGINE_CONTROL_PORT, start.host ?? '0.0.0.0', () => {
      const address = server.address();
      resolve(typeof address === 'object' && address ? address.port : (start.port ?? 0));
    });
  });
  return { server, listening };
}
