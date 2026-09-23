/* Piezas de test del módulo `directories` (no las importa el código de
   producto): un `StateService` en memoria que normaliza los directorios como
   `writeState` de la 0.6.59, el servicio montado con el cliente saliente de
   verdad sobre DNS y transporte falsos, y los constructores de CAR, nodos
   dag-pb, CID y registros IPNS de T-121 (tests/server.test.js:2102-2170). */

import { createHash } from 'node:crypto';
import {
  DEFAULT_WEB_SOURCE_ID,
  MAX_WEB_SOURCES,
  type LegacyDirectoryResponse,
  type StateV1,
  type WebSource,
} from '@ace/shared';
import { notImplementedService } from '../../core/stub.js';
import { createTestCore, type TestCore } from '../../../test/helpers/index.js';
import { createNetClient } from '../net/index.js';
import { fakeTransport, tableResolver, type FakeHandler, type FakeReply } from '../net/testing.js';
import type { ResolvedAddress } from '../net/types.js';
import type { StateService } from '../state/types.js';
import { createDirectoriesService } from './index.js';
import { normalizeWebSource } from './normalize.js';
import type { DirectoriesService } from './types.js';

export const ID_A = 'a'.repeat(40);
export const ID_B = 'b'.repeat(40);
export const ID_C = 'c'.repeat(40);

// --- Estado en memoria ---

export interface FakeState extends StateService {
  /** Número de escrituras (mutaciones que llegaron a la cola). */
  writes(): number;
  /** Sustituye el estado (como `writeState` de los tests antiguos). */
  seed(partial: Partial<StateV1>): StateV1;
}

function emptyState(): StateV1 {
  return {
    favorites: [],
    history: [],
    web: [],
    webSyncedAt: null,
    webSources: [],
    activeWebSourceId: DEFAULT_WEB_SOURCE_ID,
    preferences: {
      onboardingComplete: false,
      country: 'Spain',
      leagues: [],
      teams: [],
      nationalities: [],
    },
    channelBindings: [],
    sourceReports: [],
    channelFeedback: [],
    sourceStats: { hashes: {}, proveedores: {} },
    nowPlaying: null,
  } as StateV1;
}

export function createFakeState(core: Pick<TestCore, 'clock' | 'config'>): FakeState {
  const context = () => ({
    defaultUrl: core.config.sync.defaultWebSyncUrl,
    now: core.clock.date(),
  });
  /* La parte de `writeState` que toca a los directorios (server.js:1068-1086). */
  const normalize = (draft: StateV1): StateV1 => {
    let webSources = (Array.isArray(draft.webSources) ? draft.webSources : [])
      .map((source, index) => normalizeWebSource(source as never, index, context()))
      .filter((source): source is WebSource => source !== null)
      .slice(0, MAX_WEB_SOURCES);
    if (!webSources.length) {
      webSources = [
        normalizeWebSource(
          { id: DEFAULT_WEB_SOURCE_ID, name: 'Directorio principal', type: 'm3u' },
          0,
          context(),
        )!,
      ];
    }
    const ids = new Set<string>();
    webSources = webSources.filter((source) => {
      if (ids.has(source.id)) return false;
      ids.add(source.id);
      return true;
    });
    const active =
      webSources.find((source) => source.id === draft.activeWebSourceId) ?? webSources[0]!;
    return {
      ...draft,
      webSources,
      activeWebSourceId: active.id,
      web: active.streams,
      webSyncedAt: active.syncedAt,
    };
  };

  let current = normalize(emptyState());
  let writes = 0;
  let tail: Promise<unknown> = Promise.resolve();

  const own: Partial<FakeState> = {
    get: () => current,
    enqueue(mutator) {
      const run = tail.then(async () => {
        const draft = structuredClone(current);
        const result = await mutator(draft);
        current = normalize(draft);
        writes += 1;
        return result;
      });
      tail = run.catch(() => undefined);
      return run;
    },
    directoryResponse(): LegacyDirectoryResponse {
      return {
        success: true,
        web: current.web,
        streams: current.web,
        webSyncedAt: current.webSyncedAt,
        webSources: current.webSources.map(
          ({ id, name, url, type, streams, syncedAt, lastErrorAt, lastError }) => ({
            id,
            name,
            url,
            type,
            count: streams.length,
            syncedAt,
            lastErrorAt,
            lastError: lastErrorAt ? lastError : null,
          }),
        ),
        activeWebSourceId: current.activeWebSourceId,
      };
    },
    flush: () => tail.then(() => undefined),
    writes: () => writes,
    seed(partial) {
      current = normalize({ ...emptyState(), ...partial } as StateV1);
      return current;
    },
  };
  const stub = notImplementedService<FakeState>('state (falso)');
  return new Proxy(own as FakeState, {
    get(target, property, receiver) {
      if (property in target) return Reflect.get(target, property, receiver);
      return Reflect.get(stub, property, receiver);
    },
  });
}

/** El estado de siempre de los tests de la 0.6.59 (`seedState`, tests/server.test.js:31-49). */
export function seedPrincipal(state: FakeState, extra: Partial<WebSource> = {}): StateV1 {
  return state.seed({
    webSources: [
      {
        id: 'principal',
        name: 'Principal',
        url: 'https://example.com/list.m3u',
        type: 'm3u',
        streams: [
          { id: ID_A, title: 'Canal original', type: 'web', category: 'TV' },
          { id: ID_C, title: 'Otro canal', type: 'web', category: 'TV' },
        ],
        ...extra,
      } as unknown as WebSource,
    ],
    activeWebSourceId: 'principal',
  });
}

// --- Servicio con red falsa ---

/** IPs públicas inventadas para los hosts de los tests. */
export const PUBLIC_HOSTS: Record<string, readonly ResolvedAddress[]> = {
  'example.com': [{ address: '93.184.216.34', family: 4 }],
  'lista.example': [{ address: '93.184.216.35', family: 4 }],
  'otra.example': [{ address: '93.184.216.36', family: 4 }],
  'ipfs.io': [{ address: '209.94.90.1', family: 4 }],
  'dweb.link': [{ address: '209.94.90.2', family: 4 }],
  'k51abc.ipns.dweb.link': [{ address: '209.94.90.2', family: 4 }],
  'delegated-ipfs.dev': [{ address: '104.18.1.1', family: 4 }],
  'trustless-gateway.link': [{ address: '104.18.1.2', family: 4 }],
};

export interface DirectoriesHarness {
  readonly core: TestCore;
  readonly state: FakeState;
  readonly service: DirectoriesService;
  readonly transport: ReturnType<typeof fakeTransport>;
  /** URLs pedidas, en orden. */
  requested(): string[];
}

export function createHarness(
  options: {
    readonly routes?: Record<string, FakeReply | FakeHandler> | FakeHandler;
    readonly env?: Record<string, string>;
    readonly resolveTxt?: (hostname: string) => Promise<string[][]>;
    readonly random?: () => number;
  } = {},
): DirectoriesHarness {
  const core = createTestCore({ env: options.env ?? {} });
  const state = createFakeState(core);
  const transport = fakeTransport(options.routes ?? {});
  const net = createNetClient({ ...core, resolver: tableResolver(PUBLIC_HOSTS), transport });
  const service = createDirectoriesService({
    ...core,
    net,
    state,
    resolveTxt:
      options.resolveTxt ??
      (async (hostname) => {
        throw Object.assign(new Error(`queryTxt ENOTFOUND ${hostname}`), { code: 'ENOTFOUND' });
      }),
    random: options.random ?? (() => 0.123456789),
  });
  return {
    core,
    state,
    service,
    transport,
    requested: () => transport.requests.map((request) => request.url.href),
  };
}

/**
 * Deja correr lo pendiente (promesas, `nextTick` y los eventos de los flujos)
 * sin mover el reloj: unas vueltas del bucle de eventos con `setImmediate`,
 * que no depende de la hora.
 */
export async function settle(turns = 5): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

/** Promesa que el test resuelve cuando quiere (para ordenar descargas). */
export function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// --- Constructores de IPFS (T-121) ---

export function varintDe(numero: number): Buffer {
  const out: number[] = [];
  let n = numero;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return Buffer.from(out);
}

export function campoPb(numero: number, valor: number | Buffer): Buffer {
  if (typeof valor === 'number') return Buffer.concat([varintDe(numero * 8), varintDe(valor)]);
  return Buffer.concat([varintDe(numero * 8 + 2), varintDe(valor.length), valor]);
}

export function cidDe(codec: number, bloque: Buffer): Buffer {
  const digest = createHash('sha256').update(bloque).digest();
  return Buffer.concat([varintDe(1), varintDe(codec), varintDe(0x12), varintDe(32), digest]);
}

export function nodoPb(
  enlaces: { cid: Buffer; name?: string }[],
  tipo: number,
  datos?: Buffer,
): Buffer {
  const unixfs = datos ? Buffer.concat([campoPb(1, tipo), campoPb(2, datos)]) : campoPb(1, tipo);
  return Buffer.concat([
    ...enlaces.map((e) =>
      campoPb(2, Buffer.concat([campoPb(1, e.cid), campoPb(2, Buffer.from(e.name || ''))])),
    ),
    campoPb(1, unixfs),
  ]);
}

export function carDe(bloques: { cid: Buffer; bloque: Buffer }[]): Buffer {
  // la cabecera CBOR solo se salta: basta con que ocupe lo que dice
  const cabecera = Buffer.from([0xa0]);
  return Buffer.concat([
    varintDe(cabecera.length),
    cabecera,
    ...bloques.map(({ cid, bloque }) =>
      Buffer.concat([varintDe(cid.length + bloque.length), cid, bloque]),
    ),
  ]);
}

export function base32De(bytes: Buffer): string {
  const alfabeto = 'abcdefghijklmnopqrstuvwxyz234567';
  let bits = 0;
  let valor = 0;
  let out = '';
  for (const byte of bytes) {
    valor = (valor << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += alfabeto[(valor >>> (bits - 5)) & 31];
      bits -= 5;
    }
    valor &= (1 << bits) - 1;
  }
  if (bits > 0) out += alfabeto[(valor << (5 - bits)) & 31];
  return out;
}

export function base58De(bytes: Buffer): string {
  const alfabeto = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let n = BigInt(`0x${bytes.toString('hex') || '0'}`);
  let out = '';
  while (n > 0n) {
    out = alfabeto[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Un fichero en dos trozos, dentro de data/, como las listas de NEW ERA (tests/server.test.js:2153-2170). */
export function directorioIpfsDePrueba() {
  const trozoA = Buffer.from('#EXTM3U\n#EXTINF:-1,Canal A\nacestream://');
  const trozoB = Buffer.from(`${'a'.repeat(40)}\n`);
  const cidA = cidDe(0x55, trozoA);
  const cidB = cidDe(0x55, trozoB);
  const fichero = nodoPb([{ cid: cidA }, { cid: cidB }], 2);
  const cidFichero = cidDe(0x70, fichero);
  const carpeta = nodoPb([{ cid: cidFichero, name: 'lista.m3u' }], 1);
  const cidCarpeta = cidDe(0x70, carpeta);
  const raiz = nodoPb([{ cid: cidCarpeta, name: 'data' }], 1);
  const cidRaiz = cidDe(0x70, raiz);
  return {
    esperado: Buffer.concat([trozoA, trozoB]).toString('utf8'),
    raiz: cidRaiz,
    raizTexto: `b${base32De(cidRaiz)}`,
    bloques: [
      { cid: cidRaiz, bloque: raiz },
      { cid: cidCarpeta, bloque: carpeta },
      { cid: cidFichero, bloque: fichero },
      { cid: cidA, bloque: trozoA },
      { cid: cidB, bloque: trozoB },
    ],
  };
}

/** Registro IPNS v2: el valor viaja en el campo 9, un mapa CBOR (`Value`, `Sequence`). */
export function registroIpnsV2(valor: string, secuencia = 5): Buffer {
  const bytes = Buffer.from(valor);
  if (bytes.length > 255) throw new Error('valor demasiado largo para el test');
  const cbor = Buffer.concat([
    Buffer.from([0xa2, 0x65]),
    Buffer.from('Value'),
    Buffer.from([0x58, bytes.length]),
    bytes,
    Buffer.from([0x68]),
    Buffer.from('Sequence'),
    Buffer.from([secuencia]),
  ]);
  return Buffer.concat([campoPb(1, Buffer.from('/ipfs/valor-v1-que-no-manda')), campoPb(9, cbor)]);
}

/** Registro IPNS v1: el valor en el campo 1. */
export function registroIpnsV1(valor: string): Buffer {
  return Buffer.concat([campoPb(1, Buffer.from(valor)), campoPb(3, 0)]);
}
