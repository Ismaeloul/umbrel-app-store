/* El reproductor de la sala con las dos calidades del invitado (docs/ver-juntos.md §17): quién pide
   `abr=1`, el filtro de códecs con `variants`, la configuración de hls.js con la maestra, la regla
   del atasco (bajar a la ligera aunque la sala tenga el vídeo en pausa), el paso de Safari a
   `lo.m3u8` tras un atasco repetido y «Calidad», que nunca es una orden de la sala. Con hls.js, el
   vídeo, la API y el reloj simulados. */

import type { PartyRoom, PartyStreamGrant } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import grantFixture from '@fixtures/v1/vodStream.json';
import channelFixture from '@fixtures/v1/channelStream.json';
import { removeItem } from '../../lib/storage.ts';
import type * as Engines from '../../player/engines/index.ts';
import { setHevcSupport } from '../cine/play.ts';
import type { PartyClient, PartyState } from './client.ts';
import { RoomPlayer, savedQuality, variantUrl, type HlsStatic, type PlayerEnv } from './player.ts';
import { DRIFT_RATE_NATIVE } from './sync.ts';
import { JUNTOS_TEXT } from './texts.ts';

const api = vi.hoisted(() => vi.fn());
const platform = vi.hoisted(() => ({ ios: false, mse: true, nativeHls: false }));

vi.mock('../../api/index.ts', () => ({
  api,
  getDeviceId: () => 'd_prueba',
  getViewerId: () => 'v_prueba',
  isApiError: () => false,
}));
vi.mock('../../player/engines/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof Engines>()),
  detectPlatform: () => ({ ...platform }),
}));

const HOST = 'm_IsmaAnfitrion';
const ANA = 'm_AnaInvitada01';
const BASE = `/api/v1/party/${joined.room.code}/v/${'k'.repeat(32)}`;
const H264 = 'avc1.640033';
const LITE = 'avc1.640028';
const HEVC = 'hvc1.2.4.L150.90';

/** Un `<video>` de mentira: lo justo que mira el reproductor. */
class FakeVideo extends EventTarget {
  currentTime = 0;
  paused = true;
  seeking = false;
  ended = false;
  readyState = 4;
  duration = Number.NaN;
  playbackRate = 1;
  muted = false;
  webkitDisplayingFullscreen = false;
  ranges: [number, number][] = [];
  private source: string | null = null;
  get buffered() {
    const ranges = this.ranges;
    return {
      length: ranges.length,
      start: (i: number) => ranges[i]![0],
      end: (i: number) => ranges[i]![1],
    };
  }
  get src(): string {
    return this.source ?? '';
  }
  set src(value: string) {
    this.source = value;
  }
  getAttribute(name: string): string | null {
    return name === 'src' ? this.source : null;
  }
  removeAttribute(name: string): void {
    if (name === 'src') this.source = null;
  }
  load(): void {}
  play(): Promise<void> {
    this.paused = false;
    return Promise.resolve();
  }
  pause(): void {
    this.paused = true;
  }
  canPlayType(): string {
    return '';
  }
}

/** hls.js de mentira: guarda la configuración, la URL y lo que se toca de los niveles. */
class FakeHls {
  static last: FakeHls | null = null;
  static Events = {
    ERROR: 'hlsError',
    MANIFEST_PARSED: 'hlsManifestParsed',
    LEVEL_SWITCHED: 'hlsLevelSwitched',
  };
  static ErrorTypes = { NETWORK_ERROR: 'networkError', MEDIA_ERROR: 'mediaError' };
  static isSupported(): boolean {
    return true;
  }
  source: string | null = null;
  levels: { uri: string }[] = [];
  autoLevelEnabled = true;
  loadLevel = -1;
  /** Lo que se puso en cada propiedad, en orden. */
  readonly writes: [string, number][] = [];
  private readonly handlers = new Map<string, ((event: string, data: object) => void)[]>();
  constructor(readonly config: Record<string, unknown>) {
    FakeHls.last = this;
    return new Proxy(this, {
      set: (target, key, value) => {
        if (key === 'loadLevel' || key === 'nextLevel' || key === 'nextLoadLevel') {
          target.writes.push([key, value as number]);
        }
        (target as unknown as Record<string | symbol, unknown>)[key] = value;
        return true;
      },
    });
  }
  loadSource(url: string): void {
    this.source = url;
  }
  attachMedia(): void {}
  on(event: string, listener: (event: string, data: object) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), listener]);
  }
  emit(event: string, data: object = {}): void {
    for (const listener of this.handlers.get(event) ?? []) listener(event, data);
  }
  /** Las posiciones de cada `startLoad` (undefined: donde iba). */
  readonly starts: (number | undefined)[] = [];
  recoveries = 0;
  startLoad(position?: number): void {
    this.starts.push(position);
  }
  recoverMediaError(): void {
    this.recoveries += 1;
  }
  destroy(): void {}
}

let now = 1_000_000;
let ticker: (() => void) | null = null;
let supported = new Set<string>();
/** Lo que dice `clockStale` del cliente simulado (el aparato acaba de dormir). */
const stale = { value: false };

function fakeEnv(over: Partial<PlayerEnv> = {}): PlayerEnv {
  return {
    now: () => now,
    setInterval: (fn) => {
      ticker = fn;
      return 1;
    },
    clearInterval: () => undefined,
    setTimeout: () => 0,
    clearTimeout: () => undefined,
    loadHls: async () => FakeHls as unknown as HlsStatic,
    supportsType: (type) => {
      const video = /codecs="([^,"]+)/.exec(type)?.[1] ?? '';
      return supported.has(video);
    },
    ...over,
  };
}

function makeRoom(): PartyRoom {
  const room = joined.room as PartyRoom;
  return {
    ...room,
    title: { ...room.title, durationS: 9360 },
    playback: { playing: true, positionS: 600, at: now, rev: 3, waitingFor: [], lobby: false },
    live: null,
    interrupted: null,
  };
}

function fakeClient(selfId: string, room: PartyRoom) {
  const state = {
    room,
    chat: [],
    connection: 'open',
    closed: null,
    offsetMs: 0,
    stream: 'ok',
    typing: [],
    unvoted: [],
  } as unknown as PartyState;
  const control = vi.fn(async () => undefined);
  const resetStream = vi.fn();
  const client = {
    code: room.code,
    credential: { id: selfId, token: `${selfId}.secreto0123456789abcdef` },
    getState: () => state,
    subscribe: () => () => undefined,
    serverNow: () => now,
    report: () => undefined,
    resetStream,
    control,
    getOrders: () => [],
    clockInfo: () => ({ offsetMs: 0, rttMs: null }),
    clockStale: () => stale.value,
  } as unknown as PartyClient;
  return { client, control, resetStream };
}

/** La concesión de la sala: la de siempre, la maestra o solo la ligera. */
function grantFor(kind: 'index' | 'master' | 'lite', hd: string | null = H264): PartyStreamGrant {
  const base = structuredClone(grantFixture) as unknown as PartyStreamGrant & {
    vod: { video: { codecs: string } };
  };
  const file = kind === 'index' ? 'index.m3u8' : kind === 'master' ? 'master.m3u8' : 'lo.m3u8';
  const grant = { ...base, url: `${BASE}/${file}` } as PartyStreamGrant & {
    vod: { video: { codecs: string } };
  };
  if (kind === 'index') {
    grant.vod.video.codecs = hd ?? H264;
    return grant;
  }
  if (kind === 'lite') grant.vod.video.codecs = LITE;
  else grant.vod.video.codecs = hd ?? H264;
  return { ...grant, variants: { hd: kind === 'lite' ? null : hd, lite: LITE } };
}

async function open(
  grant: PartyStreamGrant,
  { guest = true, selfId = ANA }: { guest?: boolean; selfId?: string } = {},
) {
  api.mockResolvedValue(grant);
  const video = new FakeVideo();
  const { client, control, resetStream } = fakeClient(selfId, makeRoom());
  const player = new RoomPlayer(video as unknown as HTMLVideoElement, client, { guest }, fakeEnv());
  player.start();
  await vi.waitFor(() => expect(['ready', 'error']).toContain(player.getView().phase));
  return { player, video, control, resetStream, hls: FakeHls.last };
}

/** Con hls.js, la lista maestra ya leída: la ligera es el nivel 0 (hls.js ordena por altura). */
function parsed(hls: FakeHls | null): FakeHls {
  if (!hls) throw new Error('sin hls.js');
  hls.levels = [{ uri: `${BASE}/lo.m3u8` }, { uri: `${BASE}/index.m3u8` }];
  hls.emit(FakeHls.Events.MANIFEST_PARSED);
  return hls;
}

const tick = () => ticker?.();
const queryOf = () => (api.mock.calls.at(-1)?.[1] as { query: Record<string, string> }).query;

beforeEach(() => {
  now = 1_000_000;
  ticker = null;
  stale.value = false;
  FakeHls.last = null;
  supported = new Set([H264, LITE]);
  Object.assign(platform, { ios: false, mse: true, nativeHls: false });
  setHevcSupport(false);
  /* `lib/storage` guarda también en memoria: se borra por ahí, no solo en localStorage. */
  removeItem('aceneo-juntos-calidad');
  api.mockReset();
});
afterEach(() => {
  setHevcSupport(null);
  removeItem('aceneo-juntos-calidad');
});

describe('«Ver juntos», dos calidades (§17): quién las pide y qué se acepta', () => {
  it('solo la página del invitado manda abr=1; la de casa, la consulta de siempre', async () => {
    const home = await open(grantFor('index'), { guest: false, selfId: HOST });
    expect(queryOf()).not.toHaveProperty('abr');
    expect(queryOf()).toMatchObject({ hevc: '0', client: 'web' });
    home.player.destroy();
    const guest = await open(grantFor('index'));
    expect(queryOf()).toMatchObject({ abr: '1', hevc: '0' });
    /* Sin oferta del servidor: `index.m3u8` y nada nuevo (ni menú ni ABR del invitado). */
    expect(guest.hls?.source).toMatch(/\/index\.m3u8$/);
    expect(guest.hls?.config).not.toHaveProperty('startLevel');
    expect(guest.player.getView().quality).toBeNull();
  });

  it('sin `variants`, como siempre: si el vídeo no decodifica, no se puede ver', async () => {
    const { player } = await open(grantFor('index', HEVC));
    expect(player.getView()).toMatchObject({
      phase: 'error',
      error: JUNTOS_TEXT.codecUnsupported,
    });
  });

  it('solo la ligera (HEVC sin decodificador, hevc=0): se acepta por la ligera, sin menú', async () => {
    const { player, hls } = await open(grantFor('lite'));
    expect(player.getView().phase).toBe('ready');
    expect(hls?.source).toMatch(/\/lo\.m3u8$/);
    expect(player.getView().quality).toBeNull();
    /* Sin decodificar ni la ligera: tampoco. */
    supported = new Set();
    const none = await open(grantFor('lite'));
    expect(none.player.getView().error).toBe(JUNTOS_TEXT.codecUnsupported);
  });

  it('una maestra cuya original no decodifica: la ligera sola, sin menú', async () => {
    const { player, hls } = await open(grantFor('master', HEVC));
    expect(hls?.source).toMatch(/\/lo\.m3u8$/);
    expect(hls?.config).not.toHaveProperty('startLevel');
    expect(player.getView().quality).toBeNull();
  });

  it('la maestra con hls.js: la ligera primero, adaptación prudente y «Calidad» en automática', async () => {
    const { player, hls } = await open(grantFor('master'));
    expect(hls?.source).toMatch(/\/master\.m3u8$/);
    expect(hls?.config).toMatchObject({
      startLevel: 0,
      abrEwmaDefaultEstimate: 1_500_000,
      abrEwmaSlowVoD: 12,
      abrBandWidthFactor: 0.85,
      abrBandWidthUpFactor: 0.7,
      capLevelToPlayerSize: false,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      backBufferLength: 60,
    });
    expect(hls?.config).not.toHaveProperty('abrSwitchInterval');
    expect(player.getView().quality).toEqual({ choice: 'auto', current: 'lite' });
    parsed(hls).emit(FakeHls.Events.LEVEL_SWITCHED, { level: 1 });
    expect(player.getView().quality).toEqual({ choice: 'auto', current: 'hd' });
    /* En automática no se toca el nivel al leer la maestra. */
    expect(hls?.writes).toEqual([]);
  });

  it('las URLs de cada versión salen de la de la sala', () => {
    expect(variantUrl(`${BASE}/master.m3u8`, 'lo.m3u8')).toBe(`${BASE}/lo.m3u8`);
    expect(variantUrl(`${BASE}/master.m3u8?t=abc`, 'index.m3u8')).toBe(`${BASE}/index.m3u8?t=abc`);
  });
});

describe('«Ver juntos», la regla del atasco con hls.js (§17)', () => {
  async function stalledGuest(loadLevel: number, auto = true) {
    const opened = await open(grantFor('master'));
    const hls = parsed(opened.hls);
    hls.loadLevel = loadLevel;
    hls.autoLevelEnabled = auto;
    hls.writes.length = 0;
    opened.player.unlock();
    tick();
    opened.video.dispatchEvent(new Event('waiting'));
    tick();
    return { ...opened, hls };
  }

  it('al entrar en un atasco en la original, la siguiente carga es la ligera (sin vaciar ni salir de la automática)', async () => {
    const { hls, player, control } = await stalledGuest(1);
    expect(player.getView().buffering).toBe(true);
    expect(hls.writes).toEqual([['nextLoadLevel', 0]]);
    /* Una sola vez por atasco, y nunca `currentLevel` ni una orden a la sala. */
    tick();
    expect(hls.writes).toEqual([['nextLoadLevel', 0]]);
    expect(control).not.toHaveBeenCalled();
  });

  it('ya en la ligera, o con la calidad elegida a mano, no se toca', async () => {
    expect((await stalledGuest(0)).hls.writes).toEqual([]);
    expect((await stalledGuest(1, false)).hls.writes).toEqual([]);
  });

  it('en casa (sin maestra) tampoco', async () => {
    const opened = await open(grantFor('index'), { guest: false, selfId: HOST });
    const hls = parsed(opened.hls);
    hls.loadLevel = 1;
    opened.player.unlock();
    tick();
    opened.video.dispatchEvent(new Event('waiting'));
    tick();
    expect(hls.writes).toEqual([]);
  });
});

describe('«Ver juntos», «Calidad» (§17): de cada uno, nunca de la sala', () => {
  it('con hls.js: Ligera al siguiente fragmento, Alta sin vaciar, Automática devuelve la elección', async () => {
    const { player, hls, control } = await open(grantFor('master'), { selfId: HOST });
    const levels = parsed(hls);
    player.setQuality('lite');
    player.setQuality('hd');
    player.setQuality('auto');
    expect(levels.writes).toEqual([
      ['nextLevel', 0],
      ['loadLevel', 1],
      ['loadLevel', -1],
    ]);
    expect(control).not.toHaveBeenCalled();
    expect(player.getView().quality?.choice).toBe('auto');
  });

  it('se recuerda en este navegador y se vuelve a poner al abrir otra vez', async () => {
    const first = await open(grantFor('master'));
    first.player.setQuality('hd');
    expect(savedQuality()).toBe('hd');
    first.player.destroy();
    const again = await open(grantFor('master'));
    expect(again.player.getView().quality).toEqual({ choice: 'hd', current: 'hd' });
    expect(parsed(again.hls).writes).toEqual([['loadLevel', 1]]);
  });

  it('elegida antes de leer la maestra (un enlace lento): la pone MANIFEST_PARSED, la de ahora', async () => {
    /* Guardada «Alta» y, mientras carga, «Automática»: hls.js se queda en automático. */
    localStorage.setItem('aceneo-juntos-calidad', 'hd');
    const first = await open(grantFor('master'));
    first.player.setQuality('auto');
    expect(first.hls?.writes).toEqual([]);
    expect(parsed(first.hls).writes).toEqual([]);
    expect(first.player.getView().quality?.choice).toBe('auto');
    first.player.destroy();
    /* Guardada «Automática» y, mientras carga, «Alta»: el nivel de la original, no el 0 (la
       ligera) de una lista de niveles aún vacía. */
    const again = await open(grantFor('master'));
    again.player.setQuality('hd');
    expect(again.hls?.writes).toEqual([]);
    expect(parsed(again.hls).writes).toEqual([['loadLevel', 1]]);
    expect(again.player.getView().quality?.choice).toBe('hd');
  });

  it('lo guardado que no vale es «Automática»; sin dos versiones, elegir no hace nada', async () => {
    localStorage.setItem('aceneo-juntos-calidad', 'ultra');
    expect(savedQuality()).toBe('auto');
    const { player, hls } = await open(grantFor('index'));
    player.setQuality('lite');
    expect(hls?.writes).toEqual([]);
    expect(player.getView().quality).toBeNull();
  });
});

describe('«Ver juntos», Safari con la maestra (§17)', () => {
  beforeEach(() => {
    Object.assign(platform, { ios: true, mse: false, nativeHls: true });
  });

  /** Un atasco, la recuperación con colchón y otro a los 10 s: el repetido. */
  function repeatStall(video: FakeVideo) {
    video.currentTime = 600;
    video.dispatchEvent(new Event('waiting'));
    tick();
    video.ranges = [[0, 700]];
    now += 1_000;
    tick();
    video.ranges = [];
    now += 10_000;
    video.dispatchEvent(new Event('waiting'));
    tick();
  }

  it('la maestra va en src; tras un atasco repetido pasa a lo.m3u8 en «preparing», sin órdenes a la sala', async () => {
    const { player, video, control } = await open(grantFor('master'), { selfId: HOST });
    expect(video.src).toMatch(/\/master\.m3u8$/);
    expect(player.getView().quality).toEqual({ choice: 'auto', current: null });
    player.unlock();
    tick();
    repeatStall(video);
    expect(video.src).toMatch(/\/lo\.m3u8$/);
    expect(player.getView()).toMatchObject({
      phase: 'preparing',
      buffering: true,
      quality: { choice: 'auto', current: 'lite' },
    });
    /* Lo que hace el vídeo al cambiar de lista (pausa, salto) no es una orden, aunque acabe de tocar. */
    document.dispatchEvent(new Event('pointerdown'));
    video.paused = true;
    video.dispatchEvent(new Event('pause'));
    video.currentTime = 0;
    video.dispatchEvent(new Event('seeking'));
    expect(control).not.toHaveBeenCalled();
    /* Con los datos, a la posición de la sala y a seguir. */
    now += 500;
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(player.getView().phase).toBe('ready');
    expect(video.currentTime).toBeGreaterThan(600);
    /* No vuelve a subir sola: otro atasco repetido no cambia la lista. */
    repeatStall(video);
    expect(video.src).toMatch(/\/lo\.m3u8$/);
    expect(control).not.toHaveBeenCalled();
  });

  it('con la pantalla completa del iPhone no cambia (la cerraría)', async () => {
    const { player, video } = await open(grantFor('master'));
    player.unlock();
    tick();
    video.webkitDisplayingFullscreen = true;
    repeatStall(video);
    expect(video.src).toMatch(/\/master\.m3u8$/);
    expect(player.getView().phase).toBe('ready');
  });

  it('«Calidad» cambia la lista en «preparing» y sin orden: Alta es index.m3u8', async () => {
    const { player, video, control } = await open(grantFor('master'), { selfId: HOST });
    player.unlock();
    player.setQuality('hd');
    expect(video.src).toMatch(/\/index\.m3u8$/);
    expect(player.getView().phase).toBe('preparing');
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(player.getView().phase).toBe('ready');
    player.setQuality('auto');
    expect(video.src).toMatch(/\/master\.m3u8$/);
    expect(control).not.toHaveBeenCalled();
  });

  it('sin maestra (en casa), el src de siempre', async () => {
    const { video, player } = await open(grantFor('index'), { guest: false, selfId: HOST });
    expect(video.src).toMatch(/\/index\.m3u8$/);
    expect(player.getView().quality).toBeNull();
  });
});

describe('«Ver juntos», una sesión nueva', () => {
  it('borra el «lost» de la anterior al recibir la concesión', async () => {
    const { resetStream, player } = await open(grantFor('index'), { guest: false, selfId: HOST });
    expect(resetStream).toHaveBeenCalledTimes(1);
    player.destroy();
  });

  it('«sounded» solo cuando el vídeo ha avanzado de verdad, no con la concesión', async () => {
    const { player, video } = await open(grantFor('index'), { guest: false, selfId: HOST });
    video.ranges = [[0, 9360]];
    video.currentTime = 600;
    player.unlock();
    await vi.waitFor(() => expect(video.paused).toBe(false));
    expect(player.getView()).toMatchObject({ phase: 'ready', sounded: false });
    tick();
    expect(player.getView().sounded).toBe(false);
    video.currentTime = 601.5;
    tick();
    expect(player.getView().sounded).toBe(false);
    video.currentTime = 603.2;
    tick();
    expect(player.getView().sounded).toBe(true);
    /* Otra sesión (reintento): vuelve a no haber sonado. */
    api.mockResolvedValue(grantFor('index'));
    player.retry();
    expect(player.getView().sounded).toBe(false);
    player.destroy();
  });
});

/**
 * Safari del iPhone (HLS nativo, AVPlayer), lo justo para el atasco de §16: un salto pone
 * `seeking`, tira lo cargado y vuelve a pedir el trozo entero (`fetches`); a los 200 ms llega
 * 'seeked' y el vídeo queda donde diga `land` (el fotograma clave, unas décimas al lado o justo
 * donde se pidió). En pausa, sin saltos, lo cargado crece 1 s cada 500 ms; reproduciendo con datos,
 * el vídeo avanza a su `playbackRate`.
 */
class FakeSafariVideo extends FakeVideo {
  fetches = 0;
  private time = 0;
  private pending: { to: number; at: number } | null = null;
  private loadedAt = 0;
  constructor(private readonly land: (to: number) => number) {
    super();
    /* `currentTime` es un campo de FakeVideo: se cambia por un accesor en la propia instancia. */
    Object.defineProperty(this, 'currentTime', {
      configurable: true,
      get: () => this.time,
      set: (to: number) => {
        this.fetches += 1;
        this.seeking = true;
        this.readyState = 1;
        this.ranges = [];
        this.pending = { to, at: now + 200 };
        this.dispatchEvent(new Event('seeking'));
      },
    });
  }
  /** Lo que pasa en el vídeo hasta `now` (el reloj falso). */
  advance(): void {
    const pending = this.pending;
    if (pending && now >= pending.at) {
      this.pending = null;
      this.time = this.land(pending.to);
      this.seeking = false;
      this.loadedAt = now;
      this.dispatchEvent(new Event('seeked'));
    }
    if (this.seeking) return;
    if (!this.paused && this.readyState >= 3) this.time += 0.05 * this.playbackRate;
    const ahead = Math.floor((now - this.loadedAt) / 500);
    this.ranges = [[this.time, this.time + ahead]];
    this.readyState = ahead >= 2 ? 4 : 2;
  }
  /** Coloca el vídeo sin que cuente como salto (la carga de partida). */
  place(at: number): void {
    this.time = at;
    this.loadedAt = now;
  }
}

describe('«Ver juntos», Safari con la sala esperando (§16): el salto en pausa, una vez', () => {
  const IDR = 145.033;

  beforeEach(() => {
    Object.assign(platform, { ios: true, mse: false, nativeHls: true });
  });

  /** La sala de la captura del 1-11-2026: «reproduciendo», esperando a Ana, parada en 147,5 s. */
  async function waitingRoom(land: (to: number) => number, waitingFor: string[] = [ANA]) {
    api.mockResolvedValue(grantFor('index'));
    const video = new FakeSafariVideo(land);
    video.place(145.2);
    const room = makeRoom();
    const playback = { playing: true, positionS: 147.5, at: now, rev: 9, waitingFor, lobby: false };
    const { client } = fakeClient(ANA, { ...room, playback });
    const player = new RoomPlayer(
      video as unknown as HTMLVideoElement,
      client,
      { guest: true },
      fakeEnv(),
    );
    player.start();
    await vi.waitFor(() => expect(player.getView().phase).toBe('ready'));
    player.unlock();
    await vi.waitFor(() => expect(video.paused).toBe(true));
    const run = (ms: number) => {
      for (let t = 50; t <= ms; t += 50) {
        now += 50;
        video.advance();
        if (t % 500 === 0) tick();
      }
    };
    return { player, video, playback, run, client };
  }

  it('cayendo siempre en el fotograma clave: como mucho un reintento en 20 s (antes, uno por tic)', async () => {
    const { video, run, player } = await waitingRoom(() => IDR);
    run(20_000);
    expect(video.fetches).toBeLessThanOrEqual(2);
    expect(video.fetches).toBeGreaterThanOrEqual(1);
    /* El registro de saltos dice dónde cayó cada uno. */
    expect(player.getSeeks().map((seek) => [seek.to, seek.landed])).toEqual(
      Array.from({ length: video.fetches }, () => [147.5, IDR]),
    );
    /* Y, sin saltos, el colchón se llena: deja de estar atascado. */
    expect(player.getView().bufferedS - video.currentTime).toBeGreaterThanOrEqual(4);
  });

  it('cayendo unas décimas al lado (+0,4 s): un salto y nada más', async () => {
    const { video, run } = await waitingRoom((to) => to + 0.4);
    run(20_000);
    expect(video.fetches).toBe(1);
  });

  it('cayendo justo donde se pide: un salto y nada más', async () => {
    const { video, run } = await waitingRoom((to) => to);
    run(20_000);
    expect(video.fetches).toBe(1);
    expect(video.currentTime).toBe(147.5);
  });

  it('la sala espera a este aparato y está a 1,2 s: no se mueve en pausa', async () => {
    const { video, run, playback } = await waitingRoom(() => IDR);
    playback.positionS = 146.4;
    run(20_000);
    expect(video.fetches).toBe(0);
    expect(video.currentTime).toBe(145.2);
  });

  it('esperando a otro, a 1,2 s: se coloca una vez (la regla de 0,3 s en pausa)', async () => {
    const { video, run, playback } = await waitingRoom((to) => to + 0.4, [HOST]);
    playback.positionS = 146.4;
    run(20_000);
    expect(video.fetches).toBe(1);
  });

  it('una orden nueva (el líder salta a otro sitio) salta enseguida aunque el anterior sea reciente', async () => {
    const { video, run, playback } = await waitingRoom(() => IDR, [HOST]);
    run(1_000);
    expect(video.fetches).toBe(1);
    Object.assign(playback, { playing: false, positionS: 600, rev: 10, waitingFor: [] });
    tick();
    expect(video.fetches).toBe(2);
    run(300);
    expect(video.currentTime).toBe(IDR);
  });

  it('en pausa, otro `rev` en el mismo sitio («entra…», «esperando a…») no vuelve a saltar', async () => {
    const { video, run, playback } = await waitingRoom((to) => to + 0.4, [HOST]);
    run(1_000);
    expect(video.fetches).toBe(1);
    Object.assign(playback, { rev: 10 });
    tick();
    run(5_000);
    Object.assign(playback, { rev: 11, waitingFor: [HOST, ANA] });
    tick();
    run(5_000);
    expect(video.fetches).toBe(1);
  });

  it('cae a 1,5 s, pasa a ser esperado y la sala sigue: no salta en 20 s, lo absorbe la velocidad', async () => {
    const { video, run, playback } = await waitingRoom((to) => to - 1.5, [HOST]);
    run(1_000);
    expect(video.fetches).toBe(1);
    expect(video.currentTime).toBe(146);
    /* Atascado ahí, entra como segundo que espera (`rev` + 1, la sala no se mueve). */
    Object.assign(playback, { rev: 10, waitingFor: [HOST, ANA] });
    tick();
    run(4_000);
    expect(video.fetches).toBe(1);
    /* «Sigue»: `rev` + 1, mismo `positionS`, y la sala echa a andar. */
    Object.assign(playback, { rev: 11, waitingFor: [], at: now });
    tick();
    run(500);
    expect(video.paused).toBe(false);
    /* Safari, 1,5 s: la velocidad fija de Safari (5 %). */
    expect(video.playbackRate).toBe(1 + DRIFT_RATE_NATIVE);
    run(20_000);
    /* Antes: un salto en el primer tic (la «orden» de 'resume'), que tiraba el colchón recién lleno. */
    expect(video.fetches).toBe(1);
  });

  it('por delante de la sala al atascarse (1,6 s), esperado: ni salta en pausa ni al seguir', async () => {
    const { video, run, playback } = await waitingRoom(() => IDR);
    playback.positionS = 143.6;
    run(5_000);
    expect(video.fetches).toBe(0);
    Object.assign(playback, { rev: 10, waitingFor: [], at: now });
    tick();
    run(20_000);
    expect(video.fetches).toBe(0);
  });

  it('pasado lo que se absorbe, una deriva de más de driftSeekS vuelve a saltar', async () => {
    const { video, run, playback } = await waitingRoom((to) => to, [HOST]);
    run(1_000);
    Object.assign(playback, { waitingFor: [], at: now });
    tick();
    run(1_000);
    expect(video.fetches).toBe(1);
    /* A 1,5 s mientras se absorbe: con la velocidad. */
    const ahead = (s: number) =>
      Object.assign(playback, { at: now - (video.currentTime + s - playback.positionS) * 1000 });
    ahead(1.5);
    tick();
    expect(video.fetches).toBe(1);
    /* 61 s después, la sala 1,5 s por delante (p. ej., el reloj): salta como siempre. */
    now += 61_000;
    ahead(1.5);
    tick();
    expect(video.fetches).toBe(2);
  });
});

// --- 1.1.2: arranque para todos, órdenes, colocación, compensación y recuperación ---

const notAllowed = () => Object.assign(new Error('sin permiso'), { name: 'NotAllowedError' });

/**
 * Un `<video>` con la regla de los navegadores: sin un toque no suena (`play()` con sonido da
 * NotAllowedError); en silencio sí, salvo que `mutedBlocked`. `gesture` simula estar dentro de un
 * toque. `pending` deja el play() sin contestar (para ver el freno).
 */
class PickyVideo extends FakeVideo {
  mutedBlocked = false;
  gesture = false;
  pending = false;
  volume = 1;
  plays = 0;
  override play(): Promise<void> {
    this.plays += 1;
    if (this.pending) return new Promise<void>(() => undefined);
    if (!this.gesture && (!this.muted || this.mutedBlocked)) return Promise.reject(notAllowed());
    this.paused = false;
    return Promise.resolve();
  }
}

/**
 * Un `<video>` cuyo play() espera datos (`pending`) y al que una pausa corta con AbortError, como
 * hacen los navegadores.
 */
class AbortableVideo extends PickyVideo {
  private abort: ((error: Error) => void) | null = null;
  constructor() {
    super();
    this.pending = true;
  }
  override play(): Promise<void> {
    if (!this.pending) return super.play();
    this.plays += 1;
    /* Como en los navegadores: deja de estar en pausa al pedirlo, aunque aún no suene. */
    this.paused = false;
    return new Promise<void>((_resolve, reject) => {
      this.abort = reject;
    });
  }
  override pause(): void {
    super.pause();
    const abort = this.abort;
    this.abort = null;
    abort?.(Object.assign(new Error('cortado'), { name: 'AbortError' }));
  }
}

/** Media Session de mentira: los handlers, los metadatos, el estado y la barra. */
function fakeMediaSession() {
  const handlers = new Map<string, MediaSessionActionHandler | null>();
  const positions: (MediaPositionState | undefined)[] = [];
  const ms = {
    metadata: null as unknown,
    playbackState: 'none',
    setActionHandler: (action: string, handler: MediaSessionActionHandler | null) => {
      handlers.set(action, handler);
    },
    setPositionState: (state?: MediaPositionState) => {
      positions.push(state);
    },
  };
  return { ms: ms as unknown as MediaSession, handlers, raw: ms, positions };
}

interface Timers {
  run(): void;
  pending(): number;
}

/** `setTimeout` que se ejecuta a mano (`run`). */
function manualTimers(): { env: Partial<PlayerEnv>; timers: Timers } {
  let queue: (() => void)[] = [];
  return {
    env: {
      setTimeout: (fn) => {
        queue.push(fn);
        return queue.length;
      },
      clearTimeout: () => undefined,
    },
    timers: {
      run: () => {
        const due = queue;
        queue = [];
        for (const fn of due) fn();
      },
      pending: () => queue.length,
    },
  };
}

async function openWith(options: {
  grant?: PartyStreamGrant;
  video?: FakeVideo;
  env?: Partial<PlayerEnv>;
  room?: PartyRoom;
  selfId?: string;
  guest?: boolean;
  phases?: string[];
}) {
  api.mockResolvedValue(options.grant ?? grantFor('index'));
  const video = options.video ?? new FakeVideo();
  const { client, control, resetStream } = fakeClient(
    options.selfId ?? HOST,
    options.room ?? makeRoom(),
  );
  const player = new RoomPlayer(
    video as unknown as HTMLVideoElement,
    client,
    { guest: options.guest ?? false },
    fakeEnv(options.env),
  );
  player.start();
  const phases = options.phases ?? ['ready', 'error'];
  await vi.waitFor(() => expect(phases).toContain(player.getView().phase));
  return { player, video, control, resetStream, client, hls: FakeHls.last };
}

/** Deja que acaben las promesas de play() (varias vueltas de microtareas). */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** Una sala en directo (§14) con su concesión de canal, para lo del sonido. */
const SOUND_LIVE = {
  hash: 'a'.repeat(40),
  channel: 'DAZN 1',
  source: 'iptv' as const,
  matchId: null,
  match: null,
  auto: false,
};
const soundLiveRoom = (): PartyRoom => ({ ...makeRoom(), live: SOUND_LIVE });
const soundLiveGrant = () =>
  ({
    ...structuredClone(channelFixture),
    codec: { ...channelFixture.codec, video: 'h264' },
  }) as unknown as PartyStreamGrant;
const openLive = (options: Parameters<typeof openWith>[0] = {}) =>
  openWith({ grant: soundLiveGrant(), room: soundLiveRoom(), ...options });

describe('«Ver juntos»: el sonido en pelis y series (§13: «Estoy listo», nunca en silencio)', () => {
  it('sin toque, «Toca para empezar»: no arranca en silencio ni ofrece «Activar sonido»', async () => {
    const video = new PickyVideo();
    const { player } = await openWith({ video });
    tick();
    await vi.waitFor(() => expect(player.getView().phase).toBe('blocked'));
    expect(player.getView().soundBlocked).toBe(false);
    expect(video.muted).toBe(false);
    expect(video.paused).toBe(true);
    /* El toque (de quien entra con la peli en marcha) lo arranca con sonido y cuenta como su voto. */
    video.gesture = true;
    player.unlock();
    await settle();
    expect(video.paused).toBe(false);
    expect(video.muted).toBe(false);
    expect(player.getView()).toMatchObject({ phase: 'ready', voted: true });
    player.destroy();
  });

  it('«Estoy listo» (vote) en la espera: el play del toque y se vuelve a parar; el voto va en el latido', async () => {
    const room = makeRoom();
    const lobby: PartyRoom = {
      ...room,
      playback: { ...room.playback, playing: false, positionS: 0, lobby: true },
    };
    const video = new PickyVideo();
    const { player, client } = await openWith({ video, room: lobby });
    const reports: unknown[][] = [];
    (client as unknown as { report: (...args: unknown[]) => void }).report = (...args) =>
      reports.push(args);
    tick();
    expect(reports.at(-1)?.[3]).toBe(false);
    expect(player.getView().voted).toBe(false);
    video.gesture = true;
    player.vote();
    /* La interfaz lo sabe ya; el servidor, con el tic siguiente (un cambio sale al momento). */
    expect(player.getView().voted).toBe(true);
    expect(video.plays).toBe(1);
    await settle();
    tick();
    expect(reports.at(-1)?.[3]).toBe(true);
    /* La sala sigue parada: el vídeo, también. */
    expect(video.paused).toBe(true);
    expect(video.muted).toBe(false);
    player.destroy();
  });

  it('un play() que corta nuestra propia pausa (AbortError) no hace esperar 2 s al siguiente', async () => {
    const room = makeRoom();
    const video = new AbortableVideo();
    const { player, client } = await openWith({ video, room });
    video.gesture = true;
    tick();
    expect(video.plays).toBe(1);
    /* La sala se para (espera a alguien): la pausa corta el play() pendiente. */
    const state = client.getState() as { room: PartyRoom };
    state.room = {
      ...state.room,
      playback: { ...state.room.playback, playing: false, positionS: 600, at: now, rev: 4 },
    };
    tick();
    await settle();
    /* La sala sigue a los 500 ms: el siguiente tic vuelve a pedir play(). */
    now += 500;
    state.room = {
      ...state.room,
      playback: { ...state.room.playback, playing: true, at: now, rev: 5 },
    };
    video.pending = false;
    tick();
    expect(video.plays).toBe(2);
    player.destroy();
  });
});

describe('«Ver juntos»: el sonido en directo (con que uno le dé, arranca; los demás, en silencio)', () => {
  it('sin toque, arranca en silencio: «ready» con soundBlocked, y unmute() lo quita', async () => {
    const video = new PickyVideo();
    const { player } = await openLive({ video });
    tick();
    await vi.waitFor(() => expect(player.getView().soundBlocked).toBe(true));
    expect(player.getView().phase).toBe('ready');
    expect(video.muted).toBe(true);
    expect(video.paused).toBe(false);
    /* «Activar sonido», dentro del toque. */
    video.gesture = true;
    player.unmute();
    expect(video.muted).toBe(false);
    expect(player.getView().soundBlocked).toBe(false);
    /* Con el volumen a 0, el guardado (o 1). */
    video.volume = 0;
    video.muted = true;
    player.unmute();
    expect(video.volume).toBeGreaterThan(0);
    player.destroy();
  });

  it('el invitado de fuera en el iPhone (HLS nativo, sin hls.js): también en silencio', async () => {
    Object.assign(platform, { ios: true, mse: false, nativeHls: true });
    const video = new PickyVideo();
    video.canPlayType = () => 'maybe';
    const { player } = await openLive({ video, guest: true, selfId: ANA });
    tick();
    await vi.waitFor(() => expect(player.getView().soundBlocked).toBe(true));
    expect(video.muted).toBe(true);
    expect(video.paused).toBe(false);
    expect(FakeHls.last).toBeNull();
    video.gesture = true;
    player.unmute();
    expect(video.muted).toBe(false);
    player.destroy();
  });

  it('si tampoco deja en silencio, «Toca para empezar» (blocked); unlock() lo arranca', async () => {
    const video = new PickyVideo();
    video.mutedBlocked = true;
    const { player } = await openLive({ video });
    tick();
    await vi.waitFor(() => expect(player.getView().phase).toBe('blocked'));
    expect(player.getView().soundBlocked).toBe(false);
    /* En «blocked» el tic no insiste. */
    const plays = video.plays;
    tick();
    expect(video.plays).toBe(plays);
    video.gesture = true;
    player.unlock();
    expect(player.getView().phase).toBe('ready');
    /* El silencio era nuestro: el toque lo quita. */
    expect(video.muted).toBe(false);
    await settle();
    expect(video.paused).toBe(false);
    expect(player.getView().phase).toBe('ready');
    player.destroy();
  });

  it('unlock() que el navegador rechaza vuelve a «blocked»', async () => {
    const video = new PickyVideo();
    video.mutedBlocked = true;
    const { player } = await openLive({ video });
    tick();
    await vi.waitFor(() => expect(player.getView().phase).toBe('blocked'));
    player.unlock();
    expect(player.getView().phase).toBe('ready');
    await vi.waitFor(() => expect(player.getView().phase).toBe('blocked'));
    player.destroy();
  });

  it('subir el volumen desde la sala quita el aviso; quitar el vídeo no toca `muted`', async () => {
    const video = new PickyVideo();
    const { player } = await openLive({ video });
    tick();
    await vi.waitFor(() => expect(player.getView().soundBlocked).toBe(true));
    api.mockResolvedValue(soundLiveGrant());
    player.retry();
    expect(video.muted).toBe(true);
    video.muted = false;
    video.dispatchEvent(new Event('volumechange'));
    expect(player.getView().soundBlocked).toBe(false);
    player.destroy();
  });

  it('en silencio y con la página oculta, no se reintenta play() en cada tic', async () => {
    let visible = true;
    const video = new PickyVideo();
    const { player } = await openLive({ video, env: { visible: () => visible } });
    tick();
    await vi.waitFor(() => expect(player.getView().soundBlocked).toBe(true));
    visible = false;
    video.paused = true;
    const plays = video.plays;
    tick();
    tick();
    expect(video.plays).toBe(plays);
    visible = true;
    tick();
    expect(video.plays).toBe(plays + 1);
    player.destroy();
  });
});

describe('«Ver juntos» 1.1.2: los eventos del vídeo no son órdenes; Media Session sí', () => {
  it('play, pausa y salto con un toque reciente no llaman a control (solo se apuntan)', async () => {
    const { player, video, control } = await openWith({ selfId: HOST });
    player.unlock();
    await settle();
    tick();
    document.dispatchEvent(new Event('pointerdown'));
    video.paused = true;
    video.dispatchEvent(new Event('pause'));
    video.paused = false;
    video.dispatchEvent(new Event('play'));
    video.currentTime = 1_200;
    video.dispatchEvent(new Event('seeking'));
    expect(control).not.toHaveBeenCalled();
    expect(player.debug().native.map((entry) => entry.type)).toEqual(['pause', 'play', 'seeking']);
    player.destroy();
  });

  it('el «pausa» del sistema manda la pausa con la posición de la sala; «adelante», +10 s', async () => {
    const session = fakeMediaSession();
    const { player, control } = await openWith({
      selfId: HOST,
      env: { mediaSession: () => session.ms },
    });
    now += 4_000;
    session.handlers.get('pause')?.({ action: 'pause' });
    expect(control).toHaveBeenLastCalledWith({ action: 'pause', positionS: 604 }, 'mediaSession');
    session.handlers.get('seekforward')?.({ action: 'seekforward' });
    expect(control).toHaveBeenLastCalledWith({ action: 'seek', positionS: 614 }, 'mediaSession');
    session.handlers.get('seekto')?.({ action: 'seekto', seekTime: 30 });
    expect(control).toHaveBeenLastCalledWith({ action: 'seek', positionS: 30 }, 'mediaSession');
    tick();
    expect(session.raw.playbackState).toBe('playing');
    player.destroy();
    for (const action of ['play', 'pause', 'seekto', 'seekbackward', 'seekforward']) {
      expect(session.handlers.get(action)).toBeNull();
    }
    expect(session.raw.metadata).toBeNull();
  });

  it('quien no controla: los botones del sistema no mandan nada', async () => {
    const session = fakeMediaSession();
    const { player, control } = await openWith({
      selfId: ANA,
      env: { mediaSession: () => session.ms },
    });
    session.handlers.get('pause')?.({ action: 'pause' });
    expect(control).not.toHaveBeenCalled();
    player.destroy();
  });

  it('«reproducir» en la pantalla de bloqueo con la sala en marcha reanuda el vídeo de aquí', async () => {
    const session = fakeMediaSession();
    for (const selfId of [HOST, ANA]) {
      const { player, video, control } = await openWith({
        selfId,
        env: { mediaSession: () => session.ms, visible: () => false },
      });
      /* iOS pausó el vídeo en segundo plano; el tic está congelado. */
      video.paused = true;
      session.handlers.get('play')?.({ action: 'play' });
      expect(video.paused).toBe(false);
      /* La sala ya reproduce: no hay orden que mandar. */
      expect(control).not.toHaveBeenCalled();
      player.destroy();
    }
  });

  it('con la sala esperando a alguien, el sistema ve «en pausa» si no reproduce… y «reproducir» no manda nada', async () => {
    const session = fakeMediaSession();
    const room = makeRoom();
    const { player, control } = await openWith({
      selfId: HOST,
      room: { ...room, playback: { ...room.playback, waitingFor: [ANA] } },
      env: { mediaSession: () => session.ms },
    });
    tick();
    /* La sala quiere reproducir: la tecla de alternar del sistema debe mandar «pausa». */
    expect(session.raw.playbackState).toBe('playing');
    session.handlers.get('play')?.({ action: 'play' });
    expect(control).not.toHaveBeenCalled();
    session.handlers.get('pause')?.({ action: 'pause' });
    expect(control).toHaveBeenLastCalledWith({ action: 'pause', positionS: 600 }, 'mediaSession');
    player.destroy();
  });

  it('una «pausa» del sistema con la página oculta (AirPods) es solo de este aparato', async () => {
    const session = fakeMediaSession();
    let visible = false;
    const { player, video, control } = await openWith({
      selfId: HOST,
      env: { mediaSession: () => session.ms, visible: () => visible },
    });
    video.paused = false;
    session.handlers.get('pause')?.({ action: 'pause' });
    expect(control).not.toHaveBeenCalled();
    expect(video.paused).toBe(true);
    /* El tic no lo vuelve a poner en marcha mientras siga oculta… */
    tick();
    expect(video.paused).toBe(true);
    expect(session.raw.playbackState).toBe('paused');
    /* …y al volver a la página, sigue con la sala. */
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    expect(video.paused).toBe(false);
    player.destroy();
  });

  it('la barra de la pantalla de bloqueo es la de la sala; al irse, se quita', async () => {
    const session = fakeMediaSession();
    const { player } = await openWith({
      selfId: HOST,
      env: { mediaSession: () => session.ms },
    });
    expect(session.positions.at(-1)).toEqual({ duration: 9360, position: 600, playbackRate: 1 });
    now += 3_000;
    tick();
    expect(session.positions.at(-1)).toEqual({ duration: 9360, position: 603, playbackRate: 1 });
    /* Cada 2 s como mucho. */
    const count = session.positions.length;
    now += 500;
    tick();
    expect(session.positions).toHaveLength(count);
    player.destroy();
    expect(session.positions.at(-1)).toBeUndefined();
  });
});

describe('«Ver juntos» 1.1.2: colocarse con la hora de ahora', () => {
  it('Safari: el loadedmetadata de 3 s después coloca en la posición de entonces, no en la de antes', async () => {
    Object.assign(platform, { ios: true, mse: false, nativeHls: true });
    const { player, video } = await openWith({ selfId: HOST });
    now += 3_000;
    video.dispatchEvent(new Event('loadedmetadata'));
    /* 600 + 3 s, más lo que tarda en arrancar sin nada cargado (como mucho 0,3 s). */
    expect(video.currentTime).toBeCloseTo(603.3, 3);
    /* Y no se queda escuchando: otro loadedmetadata no lo mueve. */
    video.currentTime = 10;
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(10);
    player.destroy();
  });

  it('hls.js: la carga empieza al leer la lista, con la posición de ese momento', async () => {
    const { player, hls } = await openWith({ selfId: HOST });
    expect(hls?.config).toMatchObject({ autoStartLoad: false });
    expect(hls?.config).not.toHaveProperty('startPosition');
    now += 2_000;
    hls?.emit(FakeHls.Events.MANIFEST_PARSED);
    expect(hls?.starts.at(-1)).toBeCloseTo(602.15, 3);
    player.destroy();
  });

  it('quitar el vídeo antes del loadedmetadata no deja la apertura vieja escuchando', async () => {
    Object.assign(platform, { ios: true, mse: false, nativeHls: true });
    const { player, video } = await openWith({ selfId: HOST });
    player.destroy();
    video.currentTime = 5;
    video.dispatchEvent(new Event('loadedmetadata'));
    expect(video.currentTime).toBe(5);
  });
});

describe('«Ver juntos» 1.1.2: el salto compensa lo que tarda, y la corrección proporcional', () => {
  it('hls.js reproduciendo: salta a la sala más lo medido; la medida sale del primer avance', async () => {
    const { player, video } = await openWith({ selfId: HOST });
    player.unlock();
    await settle();
    video.ranges = [[0, 9360]];
    video.currentTime = 590;
    tick();
    /* 150 ms de partida con hls.js. */
    expect(video.currentTime).toBeCloseTo(600.15, 3);
    expect(player.getSeeks().at(-1)).toMatchObject({ lead: 150, running: true });
    /* Cae en 600,15 y el `timeupdate` llega 400 ms después con 50 ms ya avanzados: arrancó a
       los 350 ms (no a los 400: ese evento llega cada ~250 ms). La media se mueve hacia ahí. */
    video.dispatchEvent(new Event('seeked'));
    now += 400;
    video.currentTime = 600.2;
    video.dispatchEvent(new Event('timeupdate'));
    expect(player.debug().lead).toBeCloseTo(150 + 0.3 * 200, 6);
    expect(player.debug().engine).toBe('mse');
    player.destroy();
  });

  it('un salto sin datos se mide aparte: no infla la compensación de los saltos con datos', async () => {
    const { player, video } = await openWith({ selfId: HOST });
    player.unlock();
    await settle();
    /* Nada cargado donde va la sala: el salto es sin datos (tope de 0,3 s sin medidas). */
    video.ranges = [[0, 100]];
    video.currentTime = 590;
    tick();
    expect(video.currentTime).toBeCloseTo(600.15, 3);
    video.dispatchEvent(new Event('seeked'));
    now += 1_500;
    video.currentTime = 600.15;
    video.dispatchEvent(new Event('playing'));
    expect(player.debug().lead).toBe(150);
    expect(player.debug().coldLead).toBeCloseTo(1_500, 6);
    /* El siguiente salto con datos usa los 150 ms, no una media inflada (antes, ~555 ms). */
    video.ranges = [[0, 9360]];
    now += 5_000;
    video.currentTime = 590;
    tick();
    const target = 600 + 6.5;
    expect(video.currentTime).toBeCloseTo(target + 0.15, 3);
    /* Y uno sin datos compensa con lo medido sin datos (1,5 s), no con el tope de 0,3 s. */
    video.dispatchEvent(new Event('seeked'));
    now += 150;
    video.currentTime += 0.0001;
    video.dispatchEvent(new Event('timeupdate'));
    video.ranges = [[0, 100]];
    now += 5_000;
    video.currentTime = 590;
    tick();
    expect(video.currentTime).toBeCloseTo(600 + (6_500 + 5_150) / 1000 + 1.5, 2);
    player.destroy();
  });

  it('con el aparato recién despierto (reloj sin muestra nueva), reproduciendo no salta', async () => {
    const { player, video } = await openWith({ selfId: HOST });
    player.unlock();
    await settle();
    video.ranges = [[0, 9360]];
    video.currentTime = 10;
    stale.value = true;
    tick();
    expect(video.currentTime).toBe(10);
    expect(video.playbackRate).toBe(1);
    /* Con la muestra nueva, sí. */
    stale.value = false;
    tick();
    expect(video.currentTime).toBeCloseTo(600.15, 3);
    player.destroy();
  });

  it('hls.js con 1,5 s de retraso al seguir la sala: salta (no se absorbe como en Safari)', async () => {
    const room = makeRoom();
    const { player, video, client } = await openWith({
      selfId: HOST,
      room: { ...room, playback: { ...room.playback, playing: false } },
    });
    player.unlock();
    await settle();
    video.ranges = [[0, 9360]];
    video.currentTime = 600;
    tick();
    /* La sala sigue: `rev` + 1, mismo sitio; el vídeo quedó 1,5 s por detrás. */
    const state = client.getState() as { room: PartyRoom };
    state.room = {
      ...state.room,
      playback: { ...state.room.playback, playing: true, at: now - 1_500, rev: 4 },
    };
    video.currentTime = 600;
    tick();
    expect(video.currentTime).toBeGreaterThan(601.5);
    player.destroy();
  });

  it('hls.js con 0,8 s de retraso: velocidad proporcional (tope 10 %), sin salto, y la deja al llegar', async () => {
    const { player, video } = await openWith({ selfId: HOST });
    player.unlock();
    await settle();
    video.ranges = [[0, 9360]];
    video.currentTime = 599.2;
    tick();
    expect(video.currentTime).toBe(599.2);
    expect(video.playbackRate).toBe(1.1);
    video.currentTime = 599.99;
    tick();
    expect(video.playbackRate).toBe(1);
    expect(player.debug().ticks.at(-1)).toMatchObject({ engine: 'mse', rate: 1 });
    player.destroy();
  });
});

describe('«Ver juntos» 1.1.2: abrir y recuperar el vídeo', () => {
  it('un fallo pasajero al abrir no es un error: «preparing» y se reabre solo', async () => {
    const { env, timers } = manualTimers();
    api.mockRejectedValue(new Error('red'));
    const video = new FakeVideo();
    const { client } = fakeClient(HOST, makeRoom());
    const player = new RoomPlayer(video as unknown as HTMLVideoElement, client, {}, fakeEnv(env));
    player.start();
    await vi.waitFor(() => expect(timers.pending()).toBe(1));
    expect(player.getView().phase).toBe('preparing');
    api.mockResolvedValue(grantFor('index'));
    timers.run();
    await vi.waitFor(() => expect(player.getView().phase).toBe('ready'));
    player.destroy();
  });

  it('Safari: un `error` del vídeo es la sesión perdida; el de quitar el vídeo, no', async () => {
    Object.assign(platform, { ios: true, mse: false, nativeHls: true });
    const { env, timers } = manualTimers();
    const { player, video } = await openWith({ selfId: HOST, env });
    video.dispatchEvent(new Event('error'));
    expect(player.getView().phase).toBe('preparing');
    expect(timers.pending()).toBe(1);
    player.destroy();
    video.dispatchEvent(new Event('error'));
    expect(timers.pending()).toBe(1);
  });

  it('hls.js: dos errores fatales de red por minuto se recuperan; el tercero, `lost()`', async () => {
    const { player, hls } = await openWith({ selfId: HOST });
    const fatal = { fatal: true, type: FakeHls.ErrorTypes.NETWORK_ERROR, details: 'fragLoadError' };
    hls?.emit(FakeHls.Events.ERROR, fatal);
    hls?.emit(FakeHls.Events.ERROR, fatal);
    expect(hls?.starts.filter((at) => at === undefined)).toHaveLength(2);
    expect(player.getView().phase).toBe('ready');
    hls?.emit(FakeHls.Events.ERROR, fatal);
    expect(player.getView().phase).toBe('preparing');
    player.destroy();
  });

  it('hls.js: una lista que da 404 es la sesión perdida al momento', async () => {
    const { player, hls } = await openWith({ selfId: HOST });
    hls?.emit(FakeHls.Events.ERROR, {
      fatal: true,
      type: FakeHls.ErrorTypes.NETWORK_ERROR,
      details: 'levelLoadError',
      response: { code: 404 },
    });
    expect(player.getView().phase).toBe('preparing');
    expect(hls?.starts).toEqual([]);
    player.destroy();
  });

  it('hls.js: los errores de medio también tienen tope', async () => {
    const { player, hls } = await openWith({ selfId: HOST });
    const fatal = { fatal: true, type: FakeHls.ErrorTypes.MEDIA_ERROR };
    hls?.emit(FakeHls.Events.ERROR, fatal);
    hls?.emit(FakeHls.Events.ERROR, fatal);
    expect(hls?.recoveries).toBe(2);
    hls?.emit(FakeHls.Events.ERROR, fatal);
    expect(player.getView().phase).toBe('preparing');
    player.destroy();
  });
});

describe('«Ver juntos» 1.1.2: en directo', () => {
  const LIVE = {
    hash: 'a'.repeat(40),
    channel: 'DAZN 1',
    source: 'iptv' as const,
    matchId: null,
    match: null,
    auto: false,
  };
  const liveRoom = (): PartyRoom => ({ ...makeRoom(), live: LIVE });
  const liveGrant = (video: string) =>
    ({
      ...structuredClone(channelFixture),
      codec: { ...channelFixture.codec, video },
    }) as unknown as PartyStreamGrant;

  it('un canal HEVC que este navegador no decodifica: no se puede ver (no carga para siempre)', async () => {
    const { player } = await openWith({ grant: liveGrant('hevc'), room: liveRoom() });
    expect(player.getView()).toMatchObject({ phase: 'error', error: JUNTOS_TEXT.codecUnsupported });
  });

  it('no pide otro play() mientras uno está en curso', async () => {
    const video = new PickyVideo();
    video.pending = true;
    const { player } = await openWith({ grant: liveGrant('h264'), room: liveRoom(), video });
    tick();
    tick();
    tick();
    expect(video.plays).toBe(1);
    player.destroy();
  });

  it('si no avanza en 25 s, sesión perdida (y se reabre)', async () => {
    const { env, timers } = manualTimers();
    const { player, video } = await openWith({
      grant: liveGrant('h264'),
      room: liveRoom(),
      env,
    });
    player.unlock();
    await settle();
    video.currentTime = 10;
    tick();
    now += 10_000;
    video.currentTime = 12;
    tick();
    for (let i = 0; i < 49; i += 1) {
      now += 500;
      tick();
    }
    expect(player.getView().phase).toBe('ready');
    now += 500;
    tick();
    expect(player.getView().phase).toBe('preparing');
    expect(timers.pending()).toBe(1);
    player.destroy();
  });
});
