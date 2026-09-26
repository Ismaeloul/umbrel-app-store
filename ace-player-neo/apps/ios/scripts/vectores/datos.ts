/* Vectores del núcleo de datos de la app (b-arquitectura §3.2, M1): lo que la web decide al hablar con el
   servidor, sacado de su TypeScript de verdad.
   - api/sse.ts: `SCOPE_ROUTES`, lo que cada evento hace en la caché (`applyToCache` con un cliente que apunta
     cada llamada), el filtro de los eventos dirigidos (`TARGETED` + `isForThisViewer`), las esperas entre
     reconexiones, el respaldo a los 10 s y lo que se vuelve a pedir al abrir tras un corte (esto último con
     `startRealtime`, un EventSource falso y los temporizadores apuntados, sin esperar de verdad).
   - api/query.ts: reintentos (`retry`, `retryDelay`), frescura con y sin tiempo real y `gcTime`.
   - api/errors.ts: `errorFromResponse` (cuerpo v1, forma antigua o nada), `retryable` y `CLIENT_ERRORS`.
   Los eventos son los ejemplos de packages/shared/fixtures/events. Las pruebas de Swift de
   Tests/AceNeoTests/Puros/Nucleo (y Nucleo/, las de las piezas que no compilan en Linux) exigen lo mismo. */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { Area } from '../generar-vectores.ts';
import { SHARED, web } from './_cargador.ts';

type Fn = (...args: never[]) => unknown;
const f = <T extends Fn>(modulo: Record<string, unknown>, nombre: string): T => modulo[nombre] as T;

interface EventoFixture {
  type: string;
  data: Record<string, unknown>;
}

const CARPETA_EVENTOS = path.join(SHARED, 'fixtures/events');
/** El visor de esta pestaña (el de verdad es aleatorio): en los vectores sale siempre así. */
const PROPIO = 'v_propio';
const OTRO = 'v_otro';

function eventos(): Array<{ fixture: string; evento: EventoFixture }> {
  return readdirSync(CARPETA_EVENTOS)
    .filter((nombre) => nombre.endsWith('.json'))
    .sort()
    .map((nombre) => ({
      fixture: nombre.slice(0, -5),
      evento: JSON.parse(readFileSync(path.join(CARPETA_EVENTOS, nombre), 'utf8')) as EventoFixture,
    }));
}

// ---- Un QueryClient que solo apunta lo que se le pide --------------------------------------------

/** `['v1']` → «*»; `['v1', ruta, …]` → ruta; con `{ id }` → «ruta:id». */
function clave(queryKey: readonly unknown[]): string {
  const [, ruta, params] = queryKey;
  if (ruta === undefined) return '*';
  const id = params && typeof params === 'object' ? (params as { id?: unknown }).id : undefined;
  return typeof id === 'string' ? `${String(ruta)}:${id}` : String(ruta);
}

function grabadora() {
  const operaciones: string[] = [];
  const client = {
    invalidateQueries: ({ queryKey }: { queryKey: readonly unknown[] }) => {
      operaciones.push(`invalidar ${clave(queryKey)}`);
      return Promise.resolve();
    },
    setQueryData: (queryKey: readonly unknown[]) => {
      operaciones.push(`escribir ${clave(queryKey)}`);
    },
    refetchQueries: () => Promise.resolve(),
    getQueryData: () => undefined,
  };
  return { operaciones, client };
}

// ---- EventSource y temporizadores falsos --------------------------------------------------------

type Oyente = (evento: { data: string; lastEventId: string }) => void;

class EventSourceFalso {
  static creados: EventSourceFalso[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly oyentes = new Map<string, Oyente>();

  constructor(readonly url: string) {
    EventSourceFalso.creados.push(this);
  }

  addEventListener(tipo: string, oyente: Oyente): void {
    this.oyentes.set(tipo, oyente);
  }

  close(): void {
    this.readyState = 2;
  }

  emitir(evento: EventoFixture): void {
    this.oyentes.get(evento.type)?.({ data: JSON.stringify(evento.data), lastEventId: '' });
  }

  static ultimo(): EventSourceFalso {
    const es = EventSourceFalso.creados.at(-1);
    if (!es) throw new Error('startRealtime no ha abierto ningún EventSource');
    return es;
  }
}

interface Temporizador {
  fn: () => void;
  ms: number;
}

/** Sustituye los temporizadores mientras corre `cuerpo`: se apuntan y no corren solos. */
async function conTemporizadores<T>(cuerpo: (apuntados: Temporizador[]) => Promise<T> | T): Promise<T> {
  const g = globalThis as unknown as Record<string, unknown>;
  const originales = ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'].map((n) => [n, g[n]] as const);
  const apuntados: Temporizador[] = [];
  const apuntar = (fn: () => void, ms: number) => apuntados.push({ fn, ms });
  g.setTimeout = apuntar;
  g.setInterval = apuntar;
  g.clearTimeout = () => undefined;
  g.clearInterval = () => undefined;
  try {
    return await cuerpo(apuntados);
  } finally {
    for (const [nombre, valor] of originales) g[nombre] = valor;
  }
}

// ---- Tiempo real ---------------------------------------------------------------------------------

type Sse = Record<string, unknown> & {
  SCOPE_ROUTES: Record<string, readonly string[]>;
  SSE_TYPES: readonly string[];
  SSE_FALLBACK_AFTER_MS: number;
  FALLBACK_PLAYBACK_MS: number;
  FALLBACK_ENGINE_MS: number;
};

function efectosEnCache(sse: Sse) {
  return eventos().map(({ fixture, evento }) => {
    const { operaciones, client } = grabadora();
    f<(c: unknown, t: string, d: unknown) => void>(sse, 'applyToCache')(client, evento.type, evento.data);
    return { fixture, cache: [...operaciones].sort() };
  });
}

/** Cada evento de los ejemplos por un `startRealtime` de verdad; los dirigidos, a este visor y a otro. */
async function dirigidos(sse: Sse, identidad: Record<string, unknown>) {
  const propioReal = f<() => string>(identidad, 'getViewerId')();
  // `viewerIds` es obligatorio en los dirigidos (@ace/shared, events.ts): la lista vacía es «para todos».
  const variantes = (evento: EventoFixture) =>
    'viewerIds' in evento.data
      ? [[PROPIO], [OTRO], [], [OTRO, PROPIO]].map((ids) => ({
          visores: ids,
          evento: { ...evento, data: { ...evento.data, viewerIds: ids } },
        }))
      : [{ visores: undefined, evento }];
  const real = (ids: string[] | undefined) => ids?.map((id) => (id === PROPIO ? propioReal : id));

  return conTemporizadores(async () => {
    const recibidos: string[] = [];
    const quitar = sse.SSE_TYPES.map((tipo) =>
      f<(t: string, h: () => void) => () => void>(sse, 'onSseEvent')(tipo, () => recibidos.push(tipo)),
    );
    const { client } = grabadora();
    const parar = f<(o: object) => () => void>(sse, 'startRealtime')({ client, EventSourceImpl: EventSourceFalso });
    const salida = eventos().flatMap(({ fixture, evento }) =>
      variantes(evento).map(({ visores, evento: variante }) => {
        recibidos.length = 0;
        const ids = real(visores);
        const cable = ids === undefined ? variante : { ...variante, data: { ...variante.data, viewerIds: ids } };
        EventSourceFalso.ultimo().emitir(cable);
        return { fixture, visores: visores ?? null, evento: variante, llega: recibidos.includes(evento.type) };
      }),
    );
    parar();
    for (const q of quitar) q();
    return salida;
  });
}

/** Reconexiones: el EventSource se rinde (readyState 2) una y otra vez; al final abre tras el corte. */
async function reconexiones(sse: Sse) {
  return conTemporizadores(async (apuntados) => {
    EventSourceFalso.creados = [];
    const { operaciones, client } = grabadora();
    const parar = f<(o: object) => () => void>(sse, 'startRealtime')({ client, EventSourceImpl: EventSourceFalso });
    const respaldoTras = apuntados.at(-1)?.ms ?? null;
    const esperas: number[] = [];
    for (let intento = 1; intento <= 8; intento += 1) {
      const es = EventSourceFalso.ultimo();
      es.readyState = 2;
      es.onerror?.();
      const reconectar = apuntados.at(-1);
      if (!reconectar) throw new Error('Sin temporizador de reconexión');
      esperas.push(reconectar.ms);
      reconectar.fn();
    }
    operaciones.length = 0;
    EventSourceFalso.ultimo().onopen?.();
    const abrirTrasCorte = [...operaciones].sort();
    parar();
    return { respaldoTras, esperas, abrirTrasCorte };
  });
}

// ---- Consultas -------------------------------------------------------------------------------------

/** Los fallos que puede dar el cliente (api/client.ts) y los del servidor, por estado. */
const FALLOS: Array<[string, number]> = [
  ['network', 0],
  ['timeout', 0],
  ['bad_response', 200],
  ['validation_error', 400],
  ['unauthorized', 401],
  ['origin_forbidden', 403],
  ['not_found', 404],
  ['http_429', 429],
  ['internal_error', 500],
  ['http_502', 502],
  ['engine_unavailable', 503],
];

async function consultas() {
  const query = await web('api/query.ts');
  const errores = await web('api/errors.ts');
  const almacen = (await web('api/realtime-store.ts')).realtimeStore as {
    set(fn: (s: Record<string, unknown>) => Record<string, unknown>): void;
  };
  const ApiError = errores.ApiError as new (o: { code: string; status?: number }) => { retryable: boolean };
  const opciones = f<() => { getDefaultOptions(): { queries: Record<string, unknown> } }>(query, 'createQueryClient')()
    .getDefaultOptions().queries;
  const retry = opciones.retry as (n: number, e: unknown) => boolean;
  const retryDelay = opciones.retryDelay as (n: number) => number;
  const conEstado = <T>(estado: string, leer: () => T): T => {
    almacen.set((s) => ({ ...s, status: estado }));
    const valor = leer();
    almacen.set((s) => ({ ...s, status: 'idle' }));
    return valor;
  };
  const frescura = (estado: string) =>
    conEstado(estado, () => {
      const ms = (opciones.staleTime as () => number)();
      return Number.isFinite(ms) ? ms : null;
    });
  return {
    reintentos: FALLOS.flatMap(([codigo, estado]) =>
      [0, 1, 2, 3].map((fallos) => ({
        codigo,
        estado,
        fallos,
        reintenta: retry(fallos, new ApiError({ code: codigo, status: estado })),
      })),
    ),
    esperasReintento: [0, 1, 2, 3, 4, 5].map((intento) => ({ intento, ms: retryDelay(intento) })),
    frescura: { conTiempoReal: frescura('open'), sinTiempoReal: frescura('fallback') },
    alVolver: {
      conTiempoReal: conEstado('open', () => (opciones.refetchOnWindowFocus as () => boolean)()),
      sinTiempoReal: conEstado('fallback', () => (opciones.refetchOnWindowFocus as () => boolean)()),
    },
    gcTime: opciones.gcTime as number,
  };
}

// ---- Errores -------------------------------------------------------------------------------------

const CUERPOS: Array<[number, string]> = [
  [404, JSON.stringify({ error: { code: 'not_found', message: 'Esa dirección no existe.', requestId: 'req_01' } })],
  [403, JSON.stringify({ error: { code: 'origin_forbidden', message: 'Mensaje propio del servidor.' } })],
  [500, JSON.stringify({ error: { code: 'internal_error' } })],
  [502, JSON.stringify({ error: { message: 'Sin código.' } })],
  [400, JSON.stringify({ error: { code: 'validation_error', message: '' } })],
  [500, JSON.stringify({ error: { code: 12, message: 7, requestId: 3 } })],
  [401, JSON.stringify({ error: 'unauthorized' })],
  [401, JSON.stringify({ error: 'device_revoked' })],
  [400, JSON.stringify({ error: 'http_404' })],
  [400, JSON.stringify({ error: 'no_existe' })],
  [429, JSON.stringify({ error: { code: 'http_429' } })],
  [404, JSON.stringify({ otro: true })],
  [500, JSON.stringify({ error: null })],
  [502, '<html><body>Bad Gateway</body></html>'],
  [503, ''],
];

async function respuestasDeError() {
  const errores = await web('api/errors.ts');
  const desde = f<(r: Response, ruta: string) => Promise<Record<string, unknown>>>(errores, 'errorFromResponse');
  const salida = [];
  for (const [estado, cuerpo] of CUERPOS) {
    const error = await desde(new Response(cuerpo, { status: estado }), 'health');
    salida.push({
      estado,
      cuerpo,
      codigo: error.code,
      mensaje: error.message,
      requestId: error.requestId,
      reintentable: error.retryable,
    });
  }
  return { respuestas: salida, textosCliente: errores.CLIENT_ERRORS };
}

// ---- Todo ---------------------------------------------------------------------------------------

async function generar() {
  const sse = (await web('api/sse.ts')) as Sse;
  const identidad = await web('api/identity.ts');
  const errorOriginal = console.error;
  // validateInDev (solo desarrollo) se queja de las variantes con visores inventados: aquí no importa.
  console.error = (...args: unknown[]) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[sse]')) return;
    errorOriginal(...args);
  };
  try {
    return {
      ambitos: sse.SCOPE_ROUTES,
      eventos: efectosEnCache(sse),
      dirigidos: await dirigidos(sse, identidad),
      tiempoReal: {
        ...(await reconexiones(sse)),
        sondeoReproduccion: sse.FALLBACK_PLAYBACK_MS,
        sondeoMotor: sse.FALLBACK_ENGINE_MS,
        respaldo: sse.SSE_FALLBACK_AFTER_MS,
      },
      consultas: await consultas(),
      errores: await respuestasDeError(),
    };
  } finally {
    await new Promise((listo) => setImmediate(listo));
    console.error = errorOriginal;
  }
}

const area: Area = { destino: 'vectores-datos.json', generar };
export default area;
