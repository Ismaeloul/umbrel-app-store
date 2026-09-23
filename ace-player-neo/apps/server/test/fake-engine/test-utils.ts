/* Utilidades de los tests del motor falso.

   Se usa node:http a pelo y no fetch: hace falta ver las redirecciones tal
   cual, leer el progresivo trozo a trozo y recibir el error de análisis HTTP
   que da el segundo consumidor.

   Las peticiones sueltas reutilizan conexiones (keep-alive). No es por
   rendimiento: en el PC de Isma abrir y cerrar muchas conexiones seguidas
   tumba a veces el propio proceso de Node (0xC0000409, reproducido con un
   servidor http vacío y sin nada de este código), y reutilizarlas lo evita
   casi siempre. El progresivo y las pruebas de errores de red van en una
   conexión propia (`fresh`). */

import { mkdtempSync, rmSync } from 'node:fs';
import http, { type IncomingHttpHeaders, type IncomingMessage } from 'node:http';
import { createRequire } from 'node:module';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { TS_PACKET_SIZE } from './mpegts.js';

/* Dirección de loopback para los tests. En el PC de Isma el loopback IPv4
   (127.0.0.1) corta al azar ~1 de cada 6 conexiones con ECONNRESET (lo
   provocan los filtros de red instalados: VPN y bloqueador), incluso con un
   servidor http de Node vacío; ::1 no lo sufre. Se usa ::1 si se puede
   escuchar en él y, si no (contenedores sin IPv6), 127.0.0.1.
   FAKE_ENGINE_TEST_HOST lo fuerza. */
let loopback: Promise<string> | null = null;

export function loopbackHost(): Promise<string> {
  const forced = process.env.FAKE_ENGINE_TEST_HOST?.trim();
  if (forced) return Promise.resolve(forced);
  loopback ??= new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve('127.0.0.1'));
    probe.listen(0, '::1', () => probe.close(() => resolve('::1')));
  });
  return loopback;
}

export interface HttpResult {
  status: number;
  headers: IncomingHttpHeaders;
  body: Buffer;
  /* false si la conexión se cortó antes de acabar el cuerpo. */
  complete: boolean;
}

export interface RequestInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  /* Conexión nueva que se cierra al acabar, en vez de una reutilizada. */
  fresh?: boolean;
}

const keepAliveAgent = new http.Agent({ keepAlive: true, maxSockets: 32, keepAliveMsecs: 1000 });

export type NetError = Error & { code?: string };

export function request(url: string, init: RequestInit = {}): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const payload =
      init.body === undefined
        ? undefined
        : Buffer.from(typeof init.body === 'string' ? init.body : JSON.stringify(init.body));
    const req = http.request(url, {
      method: init.method ?? 'GET',
      agent: init.fresh ? false : keepAliveAgent,
      headers: {
        ...(payload
          ? { 'Content-Type': 'application/json', 'Content-Length': String(payload.length) }
          : {}),
        ...init.headers,
      },
    });
    const timer = setTimeout(() => {
      req.destroy(Object.assign(new Error('timeout del test'), { code: 'TEST_TIMEOUT' }));
    }, init.timeoutMs ?? 10_000);
    req.on('error', (error: NetError) => {
      clearTimeout(timer);
      /* Una conexión reutilizada que el motor ya había cerrado (reinicio,
         `down`, fin de otro test) falla al primer byte: se repite una vez por
         una conexión nueva, que es lo que recomienda la documentación de Node
         para keep-alive. Un corte provocado a propósito se repetiría igual. */
      if (req.reusedSocket && error.code === 'ECONNRESET' && !init.fresh) {
        request(url, { ...init, fresh: true }).then(resolve, reject);
        return;
      }
      reject(error);
    });
    req.on('response', (res: IncomingMessage) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      const done = () => {
        clearTimeout(timer);
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks),
          complete: res.complete,
        });
      };
      res.on('end', done);
      res.on('close', done);
      res.on('error', () => undefined);
    });
    req.end(payload);
  });
}

export async function getJson<T = Record<string, unknown>>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await request(url, init);
  return JSON.parse(res.body.toString('utf8')) as T;
}

/* Petición que se espera que falle a nivel de red: devuelve el código. */
export async function netErrorCode(url: string, init: RequestInit = {}): Promise<string> {
  try {
    const res = await request(url, { fresh: true, ...init });
    return `HTTP_${res.status}`;
  } catch (error) {
    return (error as NetError).code ?? (error as Error).message;
  }
}

/* Petición en vuelo que se puede consultar sin esperar a que acabe. */
export interface Pending {
  promise: Promise<HttpResult>;
  settled(): boolean;
}

export function pending(url: string, init: RequestInit = {}): Pending {
  let done = false;
  const promise = request(url, init).finally(() => {
    done = true;
  });
  promise.catch(() => undefined);
  return { promise, settled: () => done };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
  what = 'la condición',
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`no se cumplió ${what} en ${timeoutMs} ms`);
    await delay(5);
  }
}

/* Lectura del progresivo: cuenta bytes y guarda los primeros para analizarlos. */
export interface StreamReader {
  status: number;
  headers: IncomingHttpHeaders;
  bytes(): number;
  data(): Buffer;
  ended: Promise<{ complete: boolean; error: string | null }>;
  close(): void;
}

export function openStream(url: string, keepBytes = 4 * 1024 * 1024): Promise<StreamReader> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent: false });
    req.on('error', reject);
    req.on('response', (res: IncomingMessage) => {
      let bytes = 0;
      let kept = 0;
      const chunks: Buffer[] = [];
      let error: string | null = null;
      res.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (kept < keepBytes) {
          chunks.push(chunk);
          kept += chunk.length;
        }
      });
      res.on('error', (e: NetError) => {
        error = e.code ?? e.message;
      });
      req.on('error', (e: NetError) => {
        error = e.code ?? e.message;
      });
      const ended = new Promise<{ complete: boolean; error: string | null }>((done) => {
        res.on('close', () => done({ complete: res.complete, error }));
      });
      resolve({
        status: res.statusCode ?? 0,
        headers: res.headers,
        bytes: () => bytes,
        data: () => Buffer.concat(chunks),
        ended,
        close: () => req.destroy(),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// Análisis de transport stream para los tests

export interface TsPacket {
  offset: number;
  pid: number;
  pusi: boolean;
  cc: number;
  hasPayload: boolean;
  discontinuity: boolean;
  randomAccess: boolean;
  pcr: number | null;
  payload: Buffer;
}

export function parsePackets(buffer: Buffer): TsPacket[] {
  if (buffer.length % TS_PACKET_SIZE !== 0)
    throw new Error(`longitud no múltiplo de 188: ${buffer.length}`);
  const out: TsPacket[] = [];
  for (let p = 0; p < buffer.length; p += TS_PACKET_SIZE) {
    if (buffer[p] !== 0x47) throw new Error(`sin byte de sincronía en ${p}`);
    const b1 = buffer[p + 1] ?? 0;
    const b3 = buffer[p + 3] ?? 0;
    const afc = (b3 >> 4) & 3;
    let q = p + 4;
    let discontinuity = false;
    let randomAccess = false;
    let pcr: number | null = null;
    if (afc & 2) {
      const length = buffer[q] ?? 0;
      const flags = buffer[q + 1] ?? 0;
      if (length > 0) {
        discontinuity = (flags & 0x80) !== 0;
        randomAccess = (flags & 0x40) !== 0;
        if (flags & 0x10) {
          const base = buffer.readUIntBE(q + 2, 4) * 2 + ((buffer[q + 6] ?? 0) >> 7);
          const ext = (((buffer[q + 6] ?? 0) & 1) << 8) | (buffer[q + 7] ?? 0);
          pcr = base * 300 + ext;
        }
      }
      q += 1 + length;
    }
    out.push({
      offset: p,
      pid: ((b1 & 0x1f) << 8) | (buffer[p + 2] ?? 0),
      pusi: (b1 & 0x40) !== 0,
      cc: b3 & 0x0f,
      hasPayload: (afc & 1) !== 0,
      discontinuity,
      randomAccess,
      pcr,
      payload: afc & 1 ? buffer.subarray(q, p + TS_PACKET_SIZE) : Buffer.alloc(0),
    });
  }
  return out;
}

/* PES completos de un PID (desde cada PUSI hasta el siguiente). */
export function collectPes(packets: readonly TsPacket[], pid: number): Buffer[] {
  const out: Buffer[] = [];
  let current: Buffer[] | null = null;
  for (const packet of packets) {
    if (packet.pid !== pid || !packet.hasPayload) continue;
    if (packet.pusi) {
      if (current) out.push(Buffer.concat(current));
      current = [packet.payload];
    } else if (current) {
      current.push(packet.payload);
    }
  }
  if (current) out.push(Buffer.concat(current));
  return out;
}

export function pesPts(pes: Buffer): number {
  const b = (i: number) => pes[i] ?? 0;
  return (
    ((b(9) >> 1) & 0x07) * 2 ** 30 +
    ((b(10) << 7) | (b(11) >> 1)) * 2 ** 15 +
    ((b(12) << 7) | (b(13) >> 1))
  );
}

export function pesPayload(pes: Buffer): Buffer {
  return pes.subarray(9 + (pes[8] ?? 0));
}

/* Tipos de NAL H.264 de una unidad de acceso (Annex B). */
export function h264NalTypes(data: Buffer): number[] {
  const types: number[] = [];
  for (let i = 0; i + 3 < data.length; i += 1) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      types.push((data[i + 3] ?? 0) & 0x1f);
      i += 3;
    }
  }
  return types;
}

export function hevcNalTypes(data: Buffer): number[] {
  const types: number[] = [];
  for (let i = 0; i + 3 < data.length; i += 1) {
    if (data[i] === 0 && data[i + 1] === 0 && data[i + 2] === 1) {
      types.push(((data[i + 3] ?? 0) >> 1) & 0x3f);
      i += 3;
    }
  }
  return types;
}

// ---------------------------------------------------------------------------
// analyzeTransportStream ORIGINAL de la 0.6.59

export interface LegacyTsAnalysis {
  videoCodec: string;
  audioCodecs: string[];
  streamKbps: number;
  pcrSpanMs: number;
  packets: number;
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const LEGACY_SERVER = path.resolve(
  HERE,
  '../../../../../ismaeloul-ace-player-neo/releases/0.6.59/server.js',
);

/* Carga server.js de la 0.6.59 como lo hacen sus propios tests: con un
   DATA_DIR temporal y sin sincronización automática, así no toca nada real
   ni sale a internet. Al requerirlo no arranca (solo con require.main). */
export function loadLegacyAnalyzer(): {
  analyze: (buffer: Buffer) => LegacyTsAnalysis;
  cleanup: () => void;
} {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'motor-falso-legacy-'));
  process.env.DATA_DIR = dataDir;
  process.env.AUTO_SYNC = 'false';
  const require = createRequire(import.meta.url);
  const legacy = require(LEGACY_SERVER) as {
    analyzeTransportStream: (buffer: Buffer) => LegacyTsAnalysis;
  };
  if (typeof legacy.analyzeTransportStream !== 'function') {
    throw new Error('server.js de la 0.6.59 no exporta analyzeTransportStream');
  }
  return {
    analyze: legacy.analyzeTransportStream,
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}
