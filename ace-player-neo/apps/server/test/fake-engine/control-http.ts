/* API HTTP de control del motor falso: /__fake/*.

   Existe para lo que no corre en el mismo proceso que el motor: las pruebas
   E2E (Playwright habla con el motor por HTTP) y el perfil "falso" de
   docker compose. Los tests de Vitest usan `engine.control` directamente.

   Rutas (todas responden JSON):
   - GET    /__fake/status          escuchando, reiniciando, hora del reloj y segmento vivo
   - GET    /__fake/metrics         contadores (sesiones, stops, lectores, peticiones por ruta)
   - GET    /__fake/sessions        sesiones conocidas (?state=active para filtrar)
   - GET    /__fake/catalog         catálogo actual
   - PUT    /__fake/catalog         cambia el catálogo (array o { contents: [...] })
   - POST   /__fake/mode            { target?: '*', mode: 'stall' | { kind, ... }, forMs? }
   - DELETE /__fake/mode?target=... quita el modo de un contenido o el global ('*')
   - POST   /__fake/reset           { sessions?: boolean, metrics?: boolean }
   - POST   /__fake/restart         { downMs?: number }
   - POST   /__fake/sweep           caduca ya las sesiones que toque
   - POST   /__fake/clock/advance   { ms } (solo con el reloj falso inyectado)

   Si la orden deja el puerto del motor sin escuchar (reinicio, o `down` global
   que rechaza conexiones) y llega por ese mismo puerto, primero se responde
   (202) y luego se aplica: si no, cerrar el servidor cortaría la propia
   respuesta. Por el puerto de control aparte (`controlPort`) se aplica, se
   espera y se responde 200. */

import type { IncomingMessage, ServerResponse } from 'node:http';

import type { FakeEngineControl } from './engine.js';
import { parseMode, type FakeMode } from './modes.js';

export interface ControlContext {
  restarting(): boolean;
  listening(): boolean;
  /* La petición llegó por el puerto de control aparte (que nunca se cierra). */
  viaControlPort: boolean;
}

const MAX_BODY_BYTES = 1024 * 1024;
const HASH_OR_ALL = /^(\*|[0-9a-f]{40})$/;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function reply(res: ServerResponse, status: number, value: unknown): void {
  if (res.headersSent || res.destroyed) return;
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/* Lee el cuerpo JSON con tope de tamaño. Vacío equivale a `{}`: así
   `curl -X POST .../__fake/sweep` funciona sin cuerpo. */
function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new HttpError(413, 'cuerpo demasiado grande'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'el cuerpo no es JSON válido'));
      }
    });
    req.on('error', reject);
  });
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function targetFrom(value: unknown): string {
  const target = String(value ?? '*')
    .trim()
    .toLowerCase();
  if (!HASH_OR_ALL.test(target)) {
    throw new HttpError(400, `destino no válido: ${target} (usa '*' o un id/infohash de 40 hex)`);
  }
  return target;
}

function optionalMs(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new HttpError(400, `${name} debe ser un número >= 0`);
  return n;
}

/* ¿Esta orden cierra el puerto del motor? Solo `down` global que rechaza. */
function closesListener(target: string, mode: FakeMode): boolean {
  return target === '*' && mode.kind === 'down' && (mode.how ?? 'refuse') === 'refuse';
}

/* Aplica una orden que puede cerrar el puerto por el que llegó: responde
   primero y la ejecuta cuando la respuesta ya ha salido. */
async function applyMaybeDeferred(
  res: ServerResponse,
  ctx: ControlContext,
  deferred: boolean,
  action: () => Promise<void>,
  body: Record<string, unknown>,
): Promise<void> {
  if (deferred && !ctx.viaControlPort) {
    res.once('finish', () => {
      void action().catch(() => undefined);
    });
    reply(res, 202, { ok: true, deferred: true, ...body });
    return;
  }
  await action();
  reply(res, 200, { ok: true, ...body });
}

async function route(
  control: FakeEngineControl,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ControlContext,
): Promise<void> {
  const method = req.method ?? 'GET';
  const path = url.pathname.replace(/\/+$/, '');
  switch (path) {
    case '/__fake':
    case '/__fake/status': {
      if (method !== 'GET') throw new HttpError(405, 'usa GET');
      reply(res, 200, {
        ok: true,
        listening: ctx.listening(),
        restarting: ctx.restarting(),
        now: control.clock.now(),
        liveSequence: control.liveSequence(),
      });
      return;
    }
    case '/__fake/metrics': {
      if (method !== 'GET') throw new HttpError(405, 'usa GET');
      reply(res, 200, control.metrics());
      return;
    }
    case '/__fake/sessions': {
      if (method !== 'GET') throw new HttpError(405, 'usa GET');
      const state = url.searchParams.get('state');
      const list = control.sessions().filter((s) => !state || s.state === state);
      reply(res, 200, { sessions: list });
      return;
    }
    case '/__fake/catalog': {
      if (method === 'GET') {
        reply(res, 200, { contents: control.catalog() });
        return;
      }
      if (method !== 'PUT' && method !== 'POST') throw new HttpError(405, 'usa GET o PUT');
      const raw = await readJson(req);
      const list = Array.isArray(raw) ? raw : asObject(raw).contents;
      if (!Array.isArray(list))
        throw new HttpError(400, 'el catálogo debe ser un array o { "contents": [...] }');
      try {
        control.setCatalog(list);
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      reply(res, 200, { ok: true, contents: control.catalog().length });
      return;
    }
    case '/__fake/mode': {
      if (method === 'DELETE') {
        const target = targetFrom(url.searchParams.get('target') ?? '*');
        await control.clearMode(target);
        reply(res, 200, { ok: true, target });
        return;
      }
      if (method !== 'POST' && method !== 'PUT') throw new HttpError(405, 'usa POST o DELETE');
      const body = asObject(await readJson(req));
      const target = targetFrom(body.target ?? url.searchParams.get('target') ?? '*');
      let mode: FakeMode;
      try {
        mode = parseMode(body.mode ?? url.searchParams.get('mode'));
      } catch (error) {
        throw new HttpError(400, error instanceof Error ? error.message : String(error));
      }
      const forMs = optionalMs(body.forMs, 'forMs');
      await applyMaybeDeferred(
        res,
        ctx,
        closesListener(target, mode),
        () => control.setMode(target, mode, forMs === undefined ? undefined : { forMs }),
        { target, mode },
      );
      return;
    }
    case '/__fake/reset': {
      if (method !== 'POST') throw new HttpError(405, 'usa POST');
      const body = asObject(await readJson(req));
      await control.reset({ sessions: body.sessions === true, metrics: body.metrics === true });
      reply(res, 200, { ok: true });
      return;
    }
    case '/__fake/restart': {
      if (method !== 'POST') throw new HttpError(405, 'usa POST');
      const body = asObject(await readJson(req));
      const downMs = optionalMs(body.downMs, 'downMs');
      await applyMaybeDeferred(
        res,
        ctx,
        true,
        () => control.restart(downMs === undefined ? undefined : { downMs }),
        { downMs: downMs ?? null },
      );
      return;
    }
    case '/__fake/sweep': {
      if (method !== 'POST') throw new HttpError(405, 'usa POST');
      control.sweep();
      reply(res, 200, { ok: true, sessionsOpen: control.metrics().sessionsOpen });
      return;
    }
    case '/__fake/clock/advance': {
      if (method !== 'POST') throw new HttpError(405, 'usa POST');
      const clock = control.clock as { advance?: (ms: number) => void };
      if (typeof clock.advance !== 'function') {
        throw new HttpError(409, 'el motor usa el reloj real: arráncalo con un FakeClock');
      }
      const body = asObject(await readJson(req));
      const ms = optionalMs(body.ms, 'ms');
      if (ms === undefined) throw new HttpError(400, 'falta ms');
      clock.advance(ms);
      reply(res, 200, { ok: true, now: control.clock.now() });
      return;
    }
    default:
      throw new HttpError(404, `ruta de control desconocida: ${path}`);
  }
}

export async function handleControlRequest(
  control: FakeEngineControl,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ctx: ControlContext,
): Promise<void> {
  try {
    await route(control, req, res, url, ctx);
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    reply(res, status, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
