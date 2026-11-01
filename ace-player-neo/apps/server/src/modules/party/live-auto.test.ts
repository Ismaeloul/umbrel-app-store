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
  AUTO_MAX_JUMPS,
  AUTO_MANUAL_GRACE_MS,
  AUTO_NONE_TEXT,
  decide,
  manualSwitch,
  newStreak,
  pickLiveFallback,
  refreshStreak,
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
