/* El reproductor de la sala con las dos calidades del invitado (docs/ver-juntos.md §17): quién pide
   `abr=1`, el filtro de códecs con `variants`, la configuración de hls.js con la maestra, la regla
   del atasco (bajar a la ligera aunque la sala tenga el vídeo en pausa), el paso de Safari a
   `lo.m3u8` tras un atasco repetido y «Calidad», que nunca es una orden de la sala. Con hls.js, el
   vídeo, la API y el reloj simulados. */

import { PARTY, type PartyRoom, type PartyStreamGrant } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import grantFixture from '@fixtures/v1/vodStream.json';
import { removeItem } from '../../lib/storage.ts';
import type * as Engines from '../../player/engines/index.ts';
import { setHevcSupport } from '../cine/play.ts';
import type { PartyClient, PartyState } from './client.ts';
import { RoomPlayer, savedQuality, variantUrl, type HlsStatic, type PlayerEnv } from './player.ts';
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
  startLoad(): void {}
  recoverMediaError(): void {}
  destroy(): void {}
}

let now = 1_000_000;
let ticker: (() => void) | null = null;
let supported = new Set<string>();

function fakeEnv(): PlayerEnv {
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
  await vi.waitFor(() => expect(['blocked', 'error']).toContain(player.getView().phase));
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
    expect(player.getView().phase).toBe('blocked');
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
    await vi.waitFor(() => expect(player.getView().phase).toBe('blocked'));
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
    expect(video.playbackRate).toBe(1 + PARTY.driftRate);
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
