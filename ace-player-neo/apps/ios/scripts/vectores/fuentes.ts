/* Vectores de las reglas del selector de fuentes (b-arquitectura §3.4, M3): apps/web/src/features/sources/model.ts
   (estado efectivo, medidor, frase, presentación, calidad, descripción, qué se ve, arranque automático, salto de
   entrada, veredicto del reproductor, progreso del comprobador, seguimiento de reportes, hermanas de la
   biblioteca y etiquetas de «Encontrar canal») y normalizeHash de @ace/shared. Ejecuta el TypeScript DE VERDAD
   con una batería de entradas; `VectoresFuentesTests` exige que ReglasFuentes (Core/Reglas/Fuentes) dé
   exactamente lo mismo. Las entradas salen en la forma de la web (`SourceEntry`) y la prueba las convierte. */

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Area } from '../generar-vectores.ts';
import { SHARED, web } from './_cargador.ts';

type Fn = (...args: never[]) => unknown;
type Modulo = Record<string, Fn>;

const AHORA = Date.parse('2026-09-23T18:30:00.000Z');
const MIN = 60_000;

function hash(n: number): string {
  return n.toString(16).padStart(40, '0');
}

interface Sonda {
  state: string;
  reason?: string;
  peers?: number;
  speedDown?: number;
  rateKbps?: number | null;
  intakeKbps?: number | null;
  streamKbps?: number;
  videoCodec?: string;
  attempts?: number;
  retryAt?: string | null;
  playableOnWeb?: boolean | null;
}

function sonda(s: Sonda) {
  return {
    state: s.state,
    reason: s.reason ?? '',
    peers: s.peers ?? 0,
    speedDown: s.speedDown ?? 0,
    rateKbps: s.rateKbps ?? null,
    intakeKbps: s.intakeKbps ?? null,
    streamKbps: s.streamKbps ?? 0,
    videoCodec: s.videoCodec ?? '',
    attempts: s.attempts ?? 0,
    retryAt: s.retryAt ?? null,
    playableOnWeb: s.playableOnWeb ?? null,
  };
}

interface Entrada {
  n: number;
  title?: string;
  alias?: string | null;
  ih?: boolean | null;
  origin?: string;
  listaId?: string | null;
  matchedChannel?: string;
  availability?: number | null;
  learned?: string | null;
  reported?: { reason: string; until: number } | null;
  probe?: Sonda | null;
  initial?: boolean;
  playerVerdict?: { state: string; reason: string; at: number } | null;
  autoTried?: boolean;
}

function entrada(e: Entrada) {
  return {
    id: hash(e.n),
    title: e.title ?? `M+ Liga de Campeones --> Prov${e.n}`,
    alias: e.alias ?? null,
    ih: e.ih === undefined ? false : e.ih,
    origin: e.origin ?? 'm3u',
    listaId: e.listaId === undefined ? 'principal' : e.listaId,
    matchedChannel: e.matchedChannel ?? 'M+ Liga de Campeones',
    availability: e.availability ?? null,
    learned: e.learned ?? null,
    reported: e.reported ?? null,
    probe: e.probe ? sonda(e.probe) : null,
    initial: e.initial ?? false,
    playerVerdict: e.playerVerdict ?? null,
    autoTried: e.autoTried ?? false,
  };
}

const RETRY = '2026-09-23T18:36:00.000Z';

/** Una batería con todos los estados, orígenes, títulos y medidas que distinguen las reglas. */
const BATERIA = [
  entrada({ n: 1 }),
  entrada({ n: 2, availability: 0.75 }),
  entrada({ n: 3, availability: 45 }),
  entrada({ n: 4, availability: 0 }),
  entrada({ n: 5, availability: 1 }),
  entrada({ n: 6, probe: { state: 'working', reason: 'playable_media', peers: 31, rateKbps: 4200, intakeKbps: 5100, streamKbps: 4800, videoCodec: 'h264' } }),
  entrada({ n: 7, probe: { state: 'working', reason: 'playable_media', streamKbps: 1800, videoCodec: 'hevc' } }),
  entrada({ n: 8, probe: { state: 'weak', reason: 'starved', peers: 9, intakeKbps: 2100, streamKbps: 2600 } }),
  entrada({ n: 9, probe: { state: 'checking' }, initial: true }),
  entrada({ n: 10, probe: { state: 'queued' }, initial: true }),
  entrada({ n: 11, probe: { state: 'queued', attempts: 2 }, initial: true }),
  entrada({ n: 12, probe: { state: 'failed', reason: 'timeout', retryAt: RETRY } }),
  entrada({ n: 13, probe: { state: 'failed', reason: 'no_video' } }),
  entrada({ n: 14, reported: { reason: 'wrong_channel', until: AHORA + 10 * MIN }, probe: { state: 'working' } }),
  entrada({ n: 15, reported: { reason: 'audio', until: AHORA - 1 }, probe: { state: 'working', reason: 'playable_media' } }),
  entrada({ n: 16, playerVerdict: { state: 'failed', reason: 'player_failed', at: AHORA - MIN }, probe: { state: 'working', retryAt: RETRY } }),
  entrada({ n: 17, playerVerdict: { state: 'working', reason: 'player_ok', at: AHORA - 4 * MIN }, probe: { state: 'failed', reason: 'no_media', retryAt: RETRY } }),
  entrada({ n: 18, playerVerdict: { state: 'weak', reason: 'player_dropped', at: AHORA - 2 * MIN } }),
  entrada({ n: 19, title: '  Stream pegado  ', origin: 'manual', ih: null, listaId: null, matchedChannel: 'DAZN 1' }),
  entrada({ n: 20, title: 'Zapping HD', origin: 'acestream', ih: true, listaId: null, availability: 0.91 }),
  entrada({ n: 21, title: 'DAZN 1 ==> Faro', origin: 'saved', listaId: 'l2' }),
  entrada({ n: 22, title: 'DAZN 1 → Norte', origin: 'favorites', listaId: null }),
  entrada({ n: 23, title: 'DAZN 1', origin: 'history', listaId: null }),
  entrada({ n: 24, title: 'Canal IPTV -> Sur', origin: 'iptv', ih: false, listaId: 'l3' }),
  entrada({ n: 25, title: 'Otra cosa', origin: 'iptv', ih: true, listaId: 'nada' }),
  entrada({ n: 26, title: 'A -> B --> C', listaId: null }),
  entrada({ n: 27, title: 'Liga ===> Vega', listaId: null }),
  entrada({ n: 28, title: 'Solo el canal -->', matchedChannel: '' }),
  entrada({ n: 29, title: '--> Proveedor', matchedChannel: 'Canal casado' }),
  entrada({ n: 30, title: 'DAZN ⟶ Tarifa ⇒ X' }),
  entrada({ n: 31, probe: { state: 'failed', reason: 'unsupported_codec', playableOnWeb: false } }),
  entrada({ n: 32, probe: { state: 'weak', reason: 'intermittent' } }),
  entrada({ n: 33, probe: { state: 'failed', reason: 'delayed_retry', retryAt: '2026-09-23T23:05:00.000Z' } }),
  entrada({ n: 34, probe: { state: 'weak', reason: 'unverified_media', rateKbps: 900 } }),
  entrada({ n: 35, probe: { state: 'working', rateKbps: 1700, videoCodec: 'H.265' } }),
  entrada({ n: 36, probe: { state: 'working', rateKbps: 3799, videoCodec: 'hvc1' } }),
  entrada({ n: 37, probe: { state: 'working', rateKbps: 0, streamKbps: 0, videoCodec: 'hev1' } }),
  entrada({ n: 38, probe: { state: 'working', rateKbps: 0, streamKbps: 0 } }),
  entrada({ n: 39, probe: { state: 'failed', reason: 'player_failed', retryAt: RETRY } }),
  entrada({ n: 40, reported: { reason: 'not_starting', until: AHORA + MIN }, availability: 0.8 }),
  entrada({ n: 41, probe: { state: 'working', peers: 12, intakeKbps: 950, streamKbps: 0 } }),
  entrada({ n: 42, availability: 0.595 }),
  entrada({ n: 43, availability: 0.005 }),
  entrada({ n: 44, availability: 150 }),
  entrada({ n: 45, availability: -3 }),
  entrada({ n: 46, learned: 'correct', probe: { state: 'working' } }),
  entrada({ n: 47, alias: 'dazn1.es', title: 'DAZN 1 FHD --> NEW ERA', probe: { state: 'queued' }, initial: true, autoTried: true }),
];

const LISTAS = [
  { id: 'principal', name: 'Directorio de Isma' },
  { id: 'l2', name: 'directorio   Deportes' },
  { id: 'l3', name: 'Mi lista' },
  { id: 'l4', name: 'Directorio  ' },
];

const TITULOS = [
  '', 'M+ Liga de Campeones --> Elcano', 'DAZN -> Faro', 'DAZN => Faro', 'DAZN ==> Faro', 'DAZN → Faro',
  'DAZN ⇒ Faro', 'DAZN ➜ Faro', 'DAZN ➝ Faro', 'DAZN ⟶ Faro', 'DAZN ⟹ Faro', 'A -> B --> C', 'Liga ===> Vega',
  'Sin flecha', '  espacios  ', 'Canal -->', 'Canal -->   ', '--> Solo proveedor', 'a-b', 'a->b', 'a>b', 'x = > y',
  'M+ #2 → Elcano → Norte',
];

const LISTA_IDS = [null, '', 'principal', 'l2', 'l3', 'l4', 'nada'];

const PORCENTAJES = [0, 0.5, 1, 1.5, 45, 100, 150, -3, 0.333, 0.005, 0.995, 0.0049, 99.5, 0.125, 12.5];

const MOTIVOS = ['not_starting', 'stuttering', 'wrong_channel', 'bad_quality', 'audio'];

const ORIGENES = ['saved', 'm3u', 'favorites', 'history', 'acestream', 'manual', 'library', 'ai', 'ai-programming', 'otro', ''];

const HASHES = [
  '', '   ', 'acestream://' + 'A'.repeat(40), 'acestream://' + 'a1b2'.repeat(10) + '?x=1',
  'http://127.0.0.1:6878/ace/getstream?id=' + 'ABCDEF0123'.repeat(4),
  'https://x.test/p?content_id=' + '0123456789'.repeat(4), 'https://x.test/p?id=corto',
  'texto ' + 'f'.repeat(40) + ' más', 'f'.repeat(39), 'F'.repeat(41), 'acestream://' + 'g'.repeat(40),
  '０'.repeat(40), 'id=' + '9'.repeat(40), '  ' + 'e'.repeat(40) + '\n',
];

async function generar(): Promise<unknown> {
  const m = await web<Modulo>('features/sources/model.ts');
  const h = (await import(pathToFileURL(path.join(SHARED, 'src/domain/hash.ts')).href)) as Modulo;
  const f = <T>(nombre: string) => m[nombre] as unknown as T;
  type E = ReturnType<typeof entrada>;
  type Pantalla = { hash: string | null; playing: boolean; connecting: boolean };
  type Efectivo = { state: string; reason: string; reported: boolean };
  const effectiveOf = f<(e: E, p: Pantalla, now: number) => Efectivo>('effectiveOf');
  const signalOf = f<(ef: Efectivo, e: E) => unknown>('signalOf');
  const detailOf = f<(ef: Efectivo, e: E) => string>('detailOf');
  const isShown = f<(e: E, ef: Efectivo, active: string | null) => boolean>('isShownWhileScanning');
  const presentationOf = f<(e: E, l: typeof LISTAS) => unknown>('presentationOf');
  const describeSource = f<(e: E, n: number, ef: Efectivo, p: unknown, scan: boolean) => string>('describeSource');
  const nada: Pantalla = { hash: null, playing: false, connecting: false };

  const entradas = BATERIA.map((e, i) => {
    const pantallas: Pantalla[] = [nada, { hash: e.id, playing: true, connecting: false }, { hash: e.id, playing: false, connecting: true }];
    const presentacion = presentationOf(e, LISTAS);
    return {
      entrada: e,
      presentacion,
      calidad: f<(e: E) => string | null>('qualityLabel')(e),
      nombreCanal: f<(e: E) => string>('channelNameOf')(e),
      mbit: f<(e: E) => string | null>('swarmMbit')(e),
      pantallas: pantallas.map((p) => {
        const ef = effectiveOf(e, p, AHORA);
        return {
          pantalla: p,
          efectivo: ef,
          senal: signalOf(ef, e),
          detalle: detailOf(ef, e),
          visibleSinActiva: isShown(e, ef, null),
          visibleActiva: isShown(e, ef, e.id),
          descripcionConComprobador: describeSource(e, i + 1, ef, presentacion, true),
          descripcionSinComprobador: describeSource(e, i + 1, ef, presentacion, false),
        };
      }),
    };
  });

  // ---- Arranque automático y salto de entrada ----
  const mapa = (lista: E[], p: Pantalla) => new Map(lista.map((e) => [e.id, effectiveOf(e, p, AHORA)]));
  const pick = f<(l: E[], m: Map<string, Efectivo>, fin: boolean) => E | null>('pickAutoSource');
  const salto = f<(l: E[], a: string | null, p: Pantalla, now: number) => E | null>('pickInitialSwitch');
  const conjuntos: number[][] = [
    [0, 1, 2], [9, 10, 5, 6], [7, 8, 9], [15, 5], [13, 5, 6], [46, 5], [7, 11, 12], [11, 12, 17], [16, 7],
    [12, 13, 7, 5], [39, 7], [14, 7], [],
  ];
  const arranques: unknown[] = [];
  const saltos: unknown[] = [];
  for (const indices of conjuntos) {
    const lista = indices.map((i) => BATERIA[i] as E);
    for (const p of [nada, lista[0] ? { hash: lista[0].id, playing: true, connecting: false } : nada]) {
      for (const terminado of [false, true]) {
        arranques.push({ indices, pantalla: p, terminado, elegida: pick(lista, mapa(lista, p), terminado)?.id ?? null });
      }
      for (const activa of [null, lista[0]?.id ?? null, lista[1]?.id ?? null]) {
        saltos.push({ indices, pantalla: p, activa, elegida: salto(lista, activa, p, AHORA)?.id ?? null });
      }
    }
  }

  // ---- Progreso del comprobador ----
  const vistas = [
    null,
    { status: 'queued', total: 0, checked: 0, playable: 0, retryAt: null },
    { status: 'running', total: 6, checked: 2, playable: 1, retryAt: null },
    { status: 'running', total: 2, checked: 0, playable: 0, retryAt: null },
    { status: 'waiting', total: 6, checked: 6, playable: 2, retryAt: RETRY },
    { status: 'complete', total: 6, checked: 6, playable: 3, retryAt: null },
    { status: 'complete', total: 1, checked: 1, playable: 1, retryAt: null },
    { status: 'running', total: 100, checked: 1, playable: 0, retryAt: null },
  ];
  const precalentados = [
    null,
    { matchId: 'm1', stage: 'scan', status: 'ready', updatedAt: null, candidateCount: 7, checked: 0, playable: 0, total: 7, error: '' },
    { matchId: 'm1', stage: 'scan', status: 'failed', updatedAt: null, candidateCount: 7, checked: 0, playable: 0, total: 7, error: 'x' },
    { matchId: 'm1', stage: 'discovery', status: 'scanning', updatedAt: null, candidateCount: 0, checked: 0, playable: 0, total: 0, error: '' },
  ];
  const progreso = f<(s: unknown, l: E[]) => number>('scanProgress');
  const textoProgreso = f<(s: unknown, l: E[], m: Map<string, Efectivo>, p: unknown) => string>('scanProgressText');
  const progresos: unknown[] = [];
  for (const indices of [[], [0], [5, 6, 7, 12], [13, 5], [5], [0, 1, 2, 3]]) {
    const lista = indices.map((i) => BATERIA[i] as E);
    for (const vista of vistas) {
      for (const precalentado of precalentados) {
        progresos.push({
          indices, vista, precalentado,
          progreso: progreso(vista, lista),
          texto: textoProgreso(vista, lista, mapa(lista, nada), precalentado),
        });
      }
    }
  }

  // ---- Hermanas de la biblioteca ----
  const item = (id: string, title: string, type: string, alias: string | null = null) => ({
    id, title, alias, type, category: '', date: '', fromWebSync: type === 'web', ih: false,
  });
  const biblioteca = {
    web: [
      item(hash(101), 'DAZN 1 HD', 'web'), item(hash(102), 'Movistar Liga de Campeones', 'web'),
      item(hash(103), 'DAZN 1 FHD --> NEW ERA', 'web'), item(hash(104), 'M+ LaLiga', 'web', 'M+ LaLiga TV'),
      item(hash(105), '***', 'web'), item(hash(106), 'M+ LaLiga 2', 'web'),
    ],
    webSyncedAt: null,
    webSources: [{ id: 'principal', name: 'Directorio de Isma', url: '', type: 'm3u', count: 6 }],
    activeWebSourceId: 'principal',
    favorites: [item(hash(107), 'DAZN 1', 'fav'), item(hash(101), 'DAZN 1 HD', 'fav')],
    history: [item(hash(108), 'dazn 1', 'recent'), item(hash(109), 'M+ Liga TV', 'recent', 'M+ LaLiga')],
  };
  const hermanas = f<(b: unknown, id: string) => Array<{ id: string }>>('librarySiblings');
  const idsBiblioteca = [...Array(9).keys()].map((i) => hash(101 + i)).concat(hash(999));

  return {
    ahora: new Date(AHORA).toISOString(),
    listas: LISTAS,
    entradas,
    titulos: TITULOS.map((t) => ({
      titulo: t,
      proveedor: f<(t: string) => string>('providerOf')(t),
      parteCanal: f<(t: string) => string>('channelPartOf')(t),
    })),
    nombresLista: LISTA_IDS.map((id) => ({ id, nombre: f<(i: string | null, l: typeof LISTAS) => string>('listNameOf')(id, LISTAS) })),
    porcentajes: PORCENTAJES.map((v) => ({ valor: v, porcentaje: f<(v: number) => number | null>('availabilityPercent')(v) })),
    motivos: MOTIVOS.map((motivo) => ({ motivo, etiqueta: f<(r: string) => string>('reportReasonLabel')(motivo) })),
    origenes: ORIGENES.map((o) => ({
      valor: o,
      resolucion: f<(s: string) => string>('resolutionSourceLabel')(o),
      revisado: f<(s: string) => string>('checkedLabel')(o),
    })),
    veredictos: ['fallo', 'cayo'].flatMap((resultado) =>
      [0, 59, 60, 120].map((segundos) => ({
        resultado, segundos, veredicto: f<(o: string, s: number) => unknown>('failureVerdict')(resultado, segundos),
      })),
    ),
    seguimientos: MOTIVOS.flatMap((motivo) =>
      ['working', 'weak', 'failed', 'queued', 'checking', null].map((estado) => ({
        motivo, estado, seguimiento: f<(r: string, s: string | undefined) => unknown>('reportFollowUp')(motivo, estado ?? undefined),
      })),
    ),
    arranques,
    saltos,
    progresos,
    biblioteca,
    hermanas: idsBiblioteca.map((id) => ({ id, hermanas: hermanas(biblioteca, id).map((i) => i.id) })),
    hashes: HASHES.map((texto) => ({ texto, hash: h.normalizeHash?.(texto as never) as string })),
    textoHashNoValido: m.INVALID_HASH_TEXT as unknown as string,
  };
}

const area: Area = { destino: 'vectores-fuentes.json', generar };
export default area;
