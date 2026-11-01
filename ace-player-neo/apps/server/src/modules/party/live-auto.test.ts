/* El cambio automático del directo, decidido en el servidor (directo §14):

   - cae una IPTV → otra variante del mismo canal y país; si no, la mejor AceStream verificada;
   - cae una AceStream → la IPTV (no el gemelo de otro país); si no, la verificada;
   - nunca una en cuarentena ni una «Sin señal»; freno de saltos y hueco entre saltos;
   - en el servicio: el chat dice «Se ha caído la fuente: ahora, X» y, sin otra, lo avisa;
   - la corona vuelve al anfitrión, el mismo hash no congela y gana el primer cambio. */

import { describe, expect, it } from 'vitest';
import {
  PartyEventSchema,
  type PartyCreateBody,
  type PartyEvent,
  type ResolutionCandidate,
  type EngineState,
  type ScanJob,
  type StreamGrant,
  type VerdictState,
} from '@ace/shared';
import { readFileSync } from 'node:fs';
import { createTestCore } from '../../../test/helpers/index.js';
import type { FakeClock } from '../../core/clock.js';
import { FakeSink } from '../events/test-support.js';
import { createPartyService } from './index.js';
import {
  AUTO_GAP_MS,
  AUTO_IPTV_BUSY_TEXT,
  AUTO_MAX_JUMPS,
  AUTO_SCAN_RETRY_MS,
  AUTO_SOUNDED_MS,
  AUTO_MANUAL_GRACE_MS,
  AUTO_NONE_TEXT,
  decide,
  heardSound,
  manualSwitch,
  newStreak,
  pickLiveFallback,
  refreshStreak,
  soundLost,
  AUTO_STREAK_RESET_MS,
} from './live-auto.js';
import { LIVE_LEADER_GRACE_MS } from './service.js';

const H = (n: number) => n.toString(16).padStart(40, '0');

function candidate(id: string, patch: Partial<ResolutionCandidate> = {}): ResolutionCandidate {
  return {
    id,
    title: 'DAZN 1',
    alias: null,
    ih: true,
    source: 'acestream',
    score: 90,
    matchedChannel: 'DAZN 1',
    soloFamilia: false,
    familyFallbackAllowed: false,
    listaId: null,
    availability: null,
    bitrate: null,
    learned: null,
    reported: null,
    rejectedByLearning: false,
    quarantined: false,
    ...patch,
  };
}

const iptv = (id: string, channel: string, extra: Record<string, unknown> = {}) =>
  candidate(id, {
    source: 'iptv',
    title: channel,
    iptv: { channel, quality: 'fhd', ...extra } as never,
  });

const verdicts =
  (map: Record<string, VerdictState>) =>
  (hash: string): VerdictState | null =>
    map[hash] ?? null;

describe('pickLiveFallback', () => {
  const list = [
    iptv(H(1), 'dazn 1'),
    iptv(H(2), 'dazn 1', { quality: 'hd' }),
    iptv(H(3), 'dazn 1', { country: 'DE' }),
    candidate(H(4)),
    candidate(H(5)),
    candidate(H(6), { quarantined: true }),
  ];

  it('cae la IPTV: otra variante del mismo canal y país', () => {
    const next = pickLiveFallback(list, { hash: H(1), source: 'iptv' }, verdicts({}), new Set(), 0);
    expect(next?.id).toBe(H(2));
  });

  it('sin variante: la AceStream verificada, no la primera ni la de cuarentena', () => {
    const next = pickLiveFallback(
      list,
      { hash: H(1), source: 'iptv' },
      verdicts({ [H(4)]: 'failed', [H(5)]: 'working', [H(6)]: 'working' }),
      new Set([H(2)]),
      0,
    );
    expect(next?.id).toBe(H(5));
  });

  it('cae una AceStream: la IPTV del canal, no el gemelo de otro país', () => {
    const next = pickLiveFallback(
      [iptv(H(3), 'dazn 1', { country: 'DE' }), iptv(H(1), 'dazn 1'), candidate(H(4))],
      { hash: H(4), source: 'engine' },
      verdicts({}),
      new Set(),
      0,
    );
    expect(next?.id).toBe(H(1));
  });

  it('sin verificadas ni flojas: ninguna (nada de «la primera sin probar»)', () => {
    const next = pickLiveFallback(
      [candidate(H(4)), candidate(H(5))],
      { hash: H(4), source: 'engine' },
      verdicts({}),
      new Set(),
      0,
    );
    expect(next).toBeNull();
  });
});

describe('decide: freno y margen', () => {
  const list = [candidate(H(4)), candidate(H(5)), candidate(H(7)), candidate(H(8))];
  const all = verdicts({ [H(4)]: 'working', [H(5)]: 'working', [H(7)]: 'working', [H(8)]: 'weak' });
  const room = { matchId: 'm', match: 'A – B' };

  it('salta, espera el hueco y para tras AUTO_MAX_JUMPS', () => {
    const streak = newStreak();
    let now = 1_000_000;
    let current = { hash: H(9), source: 'engine' as const, ...room };
    const first = decide(streak, list, current, all, now);
    expect(first).toMatchObject({ kind: 'switch', choice: { hash: H(4), matchId: 'm' } });
    expect(decide(streak, list, current, all, now + 1)).toMatchObject({ kind: 'wait' });
    for (let jump = 1; jump < AUTO_MAX_JUMPS; jump += 1) {
      now += AUTO_GAP_MS;
      current = { ...current, hash: H(4) };
      expect(decide(streak, list, current, all, now).kind).toBe('switch');
    }
    now += AUTO_GAP_MS;
    expect(decide(streak, list, current, all, now)).toEqual({ kind: 'none', reason: 'limit' });
    refreshStreak(streak, now + AUTO_STREAK_RESET_MS);
    expect(streak.jumps).toBe(0);
  });

  it('tras un «Poner» a mano, margen', () => {
    const streak = newStreak();
    manualSwitch(streak, 0);
    const current = { hash: H(9), source: 'engine' as const, ...room };
    expect(decide(streak, list, current, all, 1)).toEqual({ kind: 'none', reason: 'grace' });
    expect(decide(streak, list, current, all, AUTO_MANUAL_GRACE_MS).kind).toBe('switch');
  });
});

// --- En el servicio ---

const VOD = JSON.parse(
  readFileSync(
    new URL('../../../../../packages/shared/fixtures/web/v1/partyStream.json', import.meta.url),
    'utf8',
  ),
) as StreamGrant & { vod?: unknown };
const { vod: _vod, ...GRANT } = VOD;

const BODY: PartyCreateBody = {
  live: {
    hash: H(9),
    channel: 'DAZN 1 · 1080p',
    source: 'engine',
    matchId: 'fltv-2026-10-31-aaaa',
    match: 'Real Madrid – Barcelona',
  },
  name: 'Isma',
  control: 'leader',
  coleaders: false,
};

function setup(candidates: ResolutionCandidate[], map: Record<string, VerdictState>) {
  const core = createTestCore({});
  const clock = core.clock as FakeClock;
  const recorded: string[] = [];
  const party = createPartyService({
    ...core,
    playback: {
      acquire: async () => GRANT,
      acquireVod: () => Promise.reject(new Error('vod')),
      heartbeat: async () => ({
        session: GRANT.session,
        url: GRANT.url,
        protocol: GRANT.protocol,
        viewers: 1,
      }),
      release: async () => ({ released: true, sessionClosed: false }),
    },
    football: { resolve: async () => ({ candidates, scan: null }) as never },
    scanner: {
      job: () => {
        throw new Error('no');
      },
      verdict: (hash) => (map[hash] ? ({ hash, state: map[hash] } as never) : null),
      recordVerdict: (hash) => {
        recorded.push(hash);
        return {} as never;
      },
    },
  });
  return { core, clock, party, recorded };
}

function listen(party: ReturnType<typeof setup>['party'], room: string, token: string) {
  const sink = new FakeSink();
  void party.attach(room, token, sink, new AbortController().signal);
  return (): PartyEvent[] =>
    sink.chunks
      .filter((chunk) => chunk.startsWith('event: '))
      .map((chunk) => {
        const [typeLine, dataLine] = chunk.split('\n');
        return PartyEventSchema.parse({
          type: typeLine?.slice('event: '.length),
          data: JSON.parse(dataLine?.slice('data: '.length) ?? 'null'),
        });
      });
}

const chatText = (events: PartyEvent[]) =>
  events.flatMap((event) => (event.type === 'party.chat' ? [event.data.message.text] : []));

async function openVideo(party: ReturnType<typeof setup>['party'], room: string, token: string) {
  await party.stream(
    room,
    { client: 'web', viewer: 'v_isma', t: token, hevc: '0', abr: '0' },
    { viewerId: 'v_isma', deviceId: 'pc', device: null },
    new AbortController().signal,
  );
}

async function flush() {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

function fail(core: ReturnType<typeof setup>['core']) {
  core.bus.emit('stream.closed', {
    sessionId: GRANT.session.id,
    viewerIds: ['v_isma'],
    reason: 'engine_failed',
  } as never);
}

describe('el automático en el servicio', () => {
  it('se cae la fuente: salta a la verificada y el chat dice «Se ha caído la fuente»', async () => {
    const { core, party, recorded } = setup([candidate(H(4)), candidate(H(5))], {
      [H(4)]: 'failed',
      [H(5)]: 'working',
    });
    await party.start();
    const host = party.create(BODY);
    const room = host.room.code;
    const events = listen(party, room, host.member.token);
    await openVideo(party, room, host.member.token);
    fail(core);
    await flush();
    expect(recorded).toEqual([H(9)]);
    expect(party.join(room, 'Leo').room.live?.hash).toBe(H(5));
    expect(chatText(events())).toContain('Se ha caído la fuente: ahora, DAZN 1.');
    await party.stop();
  });

  it('sin otra buena: lo avisa y la sala se queda como estaba', async () => {
    const { core, party } = setup([candidate(H(4))], {});
    await party.start();
    const host = party.create(BODY);
    const room = host.room.code;
    const events = listen(party, room, host.member.token);
    await openVideo(party, room, host.member.token);
    fail(core);
    await flush();
    expect(party.join(room, 'Leo').room.live?.hash).toBe(H(9));
    expect(chatText(events())).toContain(AUTO_NONE_TEXT);
    await party.stop();
  });

  it('un corte de UN aparato (los demás siguen viendo la fuente) no cambia el canal de toda la sala', async () => {
    const { core, party, recorded } = setup([candidate(H(4)), candidate(H(5))], {
      [H(5)]: 'working',
    });
    await party.start();
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    const events = listen(party, room, host.member.token);
    listen(party, room, ana.member.token);
    await openVideo(party, room, host.member.token);
    await party.stream(
      room,
      { client: 'web', viewer: 'v_ana', t: ana.member.token, hevc: '0', abr: '1' },
      { viewerId: 'v_ana', deviceId: 'iphone', device: null },
      new AbortController().signal,
    );
    /* Solo el visor de Ana (su remux, su variante): la sala sigue con la misma fuente. */
    core.bus.emit('stream.closed', {
      sessionId: GRANT.session.id,
      viewerIds: ['v_ana'],
      reason: 'remux_failed',
    } as never);
    await flush();
    const after = party.join(room, 'Leo').room;
    expect(after.live?.hash).toBe(H(9));
    expect(after.interrupted).toBeNull();
    expect(recorded).toEqual([]);
    expect(chatText(events())).not.toContain('Se ha cortado el vídeo. La sala está en pausa.');
    /* Ana vuelve a abrir sola: su `status` dice `lost`. */
    const beat = await party.status(room, {
      token: ana.member.token,
      positionS: 0,
      buffering: false,
    });
    expect(beat.stream).toBe('lost');
    /* Si cae también el de Isma, ya no queda nadie viéndola: es la fuente y salta. */
    fail(core);
    await flush();
    expect(party.join(room, 'Eva').room.live?.hash).toBe(H(5));
    expect(recorded).toEqual([H(9)]);
    await party.stop();
  });

  it('con `from` viejo, el segundo cambio se ignora; el mismo hash no suelta a nadie', async () => {
    const { party } = setup([], {});
    const host = party.create(BODY);
    const room = host.room.code;
    const other = { ...BODY.live, hash: H(5), channel: 'M+' };
    party.control(room, { token: host.member.token, action: 'live', live: other, from: H(9) });
    party.control(room, {
      token: host.member.token,
      action: 'live',
      live: { ...BODY.live, hash: H(6) },
      from: H(9),
    });
    expect(party.join(room, 'Leo').room.live?.hash).toBe(H(5));
    const rev = party.join(room, 'Eva').room.playback.rev;
    party.control(room, {
      token: host.member.token,
      action: 'live',
      live: { ...other, matchId: 'otro', match: 'Betis – Sevilla' },
    });
    const after = party.join(room, 'Max').room;
    expect(after.live).toMatchObject({ hash: H(5), matchId: 'otro', match: 'Betis – Sevilla' });
    expect(after.title.title).toBe('Betis – Sevilla');
    /* Sin `title` para todos: el reloj de la sala no se ha tocado. */
    expect(after.playback.rev).toBe(rev);
  });
});

describe('la corona en directo', () => {
  it('el anfitrión la conserva un rato y, si la pierde por no estar, le vuelve al reconectarse', async () => {
    const { clock, party } = setup([], {});
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    const keepAna = async (ms: number) => {
      for (let left = ms; left > 0; left -= 10_000) {
        clock.advance(Math.min(10_000, left));
        await party.status(room, { token: ana.member.token, positionS: 0, buffering: false });
      }
    };
    await keepAna(60_000);
    expect(party.join(room, 'Leo').room.leaderId).toBe(host.member.id);
    await keepAna(LIVE_LEADER_GRACE_MS);
    expect(party.join(room, 'Eva').room.leaderId).toBe(ana.member.id);
    /* Vuelve: la corona, otra vez suya; Ana sigue pudiendo arreglar el directo. */
    await party.status(room, { token: host.member.token, positionS: 0, buffering: false });
    clock.advance(1_000);
    const back = party.join(room, 'Max').room;
    expect(back.leaderId).toBe(host.member.id);
    expect(back.members.find((member) => member.id === ana.member.id)?.role).toBe('coleader');
    await party.stop();
  });
});

// --- Arreglos del barrido (plaza IPTV, racha, veredictos, comprobador, corona) ---

describe('la plaza IPTV de otro aparato', () => {
  const list = [iptv(H(1), 'dazn 1'), iptv(H(2), 'dazn 1', { quality: 'hd' }), candidate(H(4))];

  it('cae una AceStream y la tele ve otro canal por la IPTV: la AceStream verificada, no la IPTV', () => {
    const next = pickLiveFallback(
      list,
      { hash: H(9), source: 'engine' },
      verdicts({ [H(4)]: 'working' }),
      new Set(),
      0,
      { busyIptv: H(7) },
    );
    expect(next?.id).toBe(H(4));
  });

  it('cae una IPTV y otro aparato ha retomado la plaza: no salta a otra variante IPTV', () => {
    const next = pickLiveFallback(
      list,
      { hash: H(1), source: 'iptv' },
      verdicts({ [H(4)]: 'working' }),
      new Set(),
      0,
      { busyIptv: H(7) },
    );
    expect(next?.id).toBe(H(4));
  });

  it('la tele ve el MISMO canal: se comparte, vale', () => {
    const next = pickLiveFallback(
      list,
      { hash: H(9), source: 'engine' },
      verdicts({}),
      new Set(),
      0,
      { busyIptv: H(1) },
    );
    expect(next?.id).toBe(H(1));
  });

  it('solo quedaba la IPTV ocupada: iptv_busy, no se la quita', () => {
    const streak = newStreak();
    const decision = decide(
      streak,
      list,
      { hash: H(9), source: 'engine', matchId: 'm', match: 'A – B' },
      verdicts({}),
      1_000_000,
      { busyIptv: H(7) },
    );
    expect(decision).toEqual({ kind: 'none', reason: 'iptv_busy' });
    expect(streak.jumps).toBe(0);
  });
});

describe('la racha se acaba cuando la fuente nueva suena', () => {
  it('cuatro cortes con imagen entre ellos: el cuarto también salta', () => {
    const list = [H(4), H(5), H(6), H(7)].map((hash) => candidate(hash));
    const all = verdicts(Object.fromEntries(list.map((item) => [item.id, 'working' as const])));
    const streak = newStreak();
    let now = 1_000_000;
    let current = { hash: H(9), source: 'engine' as const, matchId: 'm', match: 'A – B' };
    for (let fall = 0; fall < AUTO_MAX_JUMPS + 1; fall += 1) {
      const decision = decide(streak, list, current, all, now);
      expect(decision.kind).toBe('switch');
      if (decision.kind !== 'switch') return;
      current = { ...current, hash: decision.choice.hash };
      /* Suena un minuto. */
      heardSound(streak, now + 1_000);
      heardSound(streak, now + 1_000 + AUTO_SOUNDED_MS);
      expect(streak.jumps).toBe(0);
      now += 60_000;
    }
  });

  it('si se vuelve a cortar antes, lo que llevaba sonando no cuenta', () => {
    const streak = newStreak();
    decide(
      streak,
      [candidate(H(4))],
      { hash: H(9), source: 'engine', matchId: null, match: null },
      verdicts({ [H(4)]: 'working' }),
      0,
    );
    heardSound(streak, 1_000);
    soundLost(streak);
    heardSound(streak, 1_000 + AUTO_SOUNDED_MS);
    expect(streak.jumps).toBe(1);
  });
});

interface SetupMore {
  readonly scan?: () => ScanJob;
  readonly engine?: EngineState;
  readonly sessions?: () => unknown[];
}

function setupMore(
  candidates: ResolutionCandidate[],
  map: Record<string, VerdictState>,
  more: SetupMore = {},
) {
  const core = createTestCore({});
  const clock = core.clock as FakeClock;
  const recorded: string[] = [];
  const party = createPartyService({
    ...core,
    playback: {
      /* La sala va por AceStream: lo que dice la concesión. */
      acquire: async () => ({ ...GRANT, source: 'engine' }) as StreamGrant,
      acquireVod: () => Promise.reject(new Error('vod')),
      heartbeat: async () => ({
        session: GRANT.session,
        url: GRANT.url,
        protocol: GRANT.protocol,
        viewers: 1,
      }),
      release: async () => ({ released: true, sessionClosed: false }),
      ...(more.sessions ? { status: () => ({ sessions: more.sessions?.() ?? [] }) as never } : {}),
    },
    football: {
      resolve: async () => ({ candidates, scan: more.scan ? { id: 'job-sala' } : null }) as never,
    },
    scanner: {
      job: () => {
        if (!more.scan) throw new Error('no');
        return more.scan();
      },
      verdict: (hash) => (map[hash] ? ({ hash, state: map[hash] } as never) : null),
      recordVerdict: (hash) => {
        recorded.push(hash);
        return {} as never;
      },
    },
    ...(more.engine ? { engine: { status: () => ({ status: more.engine }) as never } } : {}),
  });
  return { core, clock, party, recorded };
}

const TELE = [{ hash: H(7), source: 'iptv', viewers: [{ viewerId: 'v_tele', deviceId: 'tele' }] }];

describe('el automático en el servicio: lo que no se apunta ni se quita', () => {
  it('no apunta «Sin señal» a las que pone el propio automático en la misma racha', async () => {
    const { core, clock, party, recorded } = setupMore([candidate(H(4)), candidate(H(5))], {
      [H(4)]: 'working',
      [H(5)]: 'working',
    });
    await party.start();
    const host = party.create(BODY);
    const room = host.room.code;
    await openVideo(party, room, host.member.token);
    fail(core);
    await flush();
    expect(party.join(room, 'Leo').room.live?.hash).toBe(H(4));
    clock.advance(AUTO_GAP_MS);
    await openVideo(party, room, host.member.token);
    fail(core);
    await flush();
    expect(party.join(room, 'Eva').room.live?.hash).toBe(H(5));
    /* Solo la primera, la que se cayó sola. */
    expect(recorded).toEqual([H(9)]);
    await party.stop();
  });

  it('con el motor caído, el corte no es «Sin señal» de la fuente', async () => {
    const { core, party, recorded } = setupMore(
      [candidate(H(5))],
      { [H(5)]: 'working' },
      { engine: 'offline' },
    );
    await party.start();
    const host = party.create(BODY);
    await openVideo(party, host.room.code, host.member.token);
    fail(core);
    await flush();
    expect(recorded).toEqual([]);
    await party.stop();
  });

  it('cae la AceStream y la tele ve otro canal por la IPTV: no se la quita, va a la AceStream', async () => {
    const { core, party } = setupMore(
      [iptv(H(1), 'dazn 1'), candidate(H(5))],
      { [H(5)]: 'working' },
      { sessions: () => TELE },
    );
    await party.start();
    const host = party.create(BODY);
    const room = host.room.code;
    await openVideo(party, room, host.member.token);
    fail(core);
    await flush();
    expect(party.join(room, 'Leo').room.live?.hash).toBe(H(5));
    await party.stop();
  });

  it('solo queda la IPTV ocupada: lo dice en el chat y no la abre', async () => {
    const { core, party } = setupMore([iptv(H(1), 'dazn 1')], {}, { sessions: () => TELE });
    await party.start();
    const host = party.create(BODY);
    const room = host.room.code;
    const events = listen(party, room, host.member.token);
    await openVideo(party, room, host.member.token);
    fail(core);
    await flush();
    expect(party.join(room, 'Leo').room.live?.hash).toBe(H(9));
    expect(chatText(events())).toContain(AUTO_IPTV_BUSY_TEXT);
    await party.stop();
  });

  it('sin veredictos aún y el comprobador en marcha: espera y salta cuando llega la verificada', async () => {
    const map: Record<string, VerdictState> = {};
    let status: ScanJob['status'] = 'running';
    const { core, clock, party } = setupMore([candidate(H(5))], map, {
      scan: () => ({ id: 'job-sala', status, candidates: [] }) as unknown as ScanJob,
    });
    await party.start();
    const host = party.create(BODY);
    const room = host.room.code;
    const events = listen(party, room, host.member.token);
    await openVideo(party, room, host.member.token);
    fail(core);
    await flush();
    expect(chatText(events())).not.toContain(AUTO_NONE_TEXT);
    map[H(5)] = 'working';
    status = 'complete';
    await clock.advanceAsync(AUTO_SCAN_RETRY_MS);
    await flush();
    expect(party.join(room, 'Leo').room.live?.hash).toBe(H(5));
    expect(chatText(events())).not.toContain(AUTO_NONE_TEXT);
    await party.stop();
  });
});

describe('la corona en directo: dos ausencias seguidas', () => {
  it('se va el anfitrión y luego el líder provisional: al volver, la corona es del anfitrión', async () => {
    const { clock, party } = setupMore([], {});
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    const leo = party.join(room, 'Leo');
    const keep = async (tokens: string[], ms: number) => {
      for (let left = ms; left > 0; left -= 10_000) {
        clock.advance(Math.min(10_000, left));
        for (const token of tokens) {
          await party.status(room, { token, positionS: 0, buffering: false });
        }
      }
    };
    await keep([ana.member.token, leo.member.token], LIVE_LEADER_GRACE_MS + 60_000);
    expect(party.join(room, 'Eva').room.leaderId).toBe(ana.member.id);
    await keep([leo.member.token], LIVE_LEADER_GRACE_MS + 60_000);
    expect(party.join(room, 'Max').room.leaderId).toBe(leo.member.id);
    await party.status(room, { token: host.member.token, positionS: 0, buffering: false });
    clock.advance(1_000);
    expect(party.join(room, 'Sol').room.leaderId).toBe(host.member.id);
    await party.stop();
  });
});
