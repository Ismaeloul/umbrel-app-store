/* Las fuentes de una sala en directo (directo §14, `partyLiveSources`):

   - la clave del comprobador es `party-<código>` (no cancela la de la ficha);
   - unos minutos de caché por sala, y una sola resolución a la vez;
   - con `job`, solo el estado de ese trabajo; con `research`, otra pasada;
   - en el servicio: el líder, los co-líderes (aunque no controlen) y el anfitrión; el invitado no. */

import { describe, expect, it } from 'vitest';
import type { PartyCreateBody, ResolutionCandidate, ScanJob } from '@ace/shared';
import { createTestCore } from '../../../test/helpers/index.js';
import type { FakeClock } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import { createPartyService } from './index.js';
import {
  LIVE_SOURCES_TTL_MS,
  channelOfLive,
  createLiveSources,
  partyClientKey,
} from './live-sources.js';

const DAZN = 'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00';
const JOB = 'abcdefabcdefabcdefabcdef';

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

const LIVE = {
  hash: DAZN,
  channel: 'DAZN 1 · 1080p',
  source: 'engine' as const,
  matchId: 'fltv-2026-10-31-aaaa',
  match: 'Real Madrid – Barcelona',
  auto: true,
};

function fakeFootball() {
  const calls: Record<string, unknown>[] = [];
  return {
    calls,
    football: {
      resolve: async (query: Record<string, unknown>) => {
        calls.push(query);
        return {
          candidates: [candidate(DAZN)],
          scan: { id: JOB, statusUrl: '', total: 1, initialCount: 3 },
        } as never;
      },
    },
  };
}

const JOB_STATE = { id: JOB, done: false, candidates: [] } as unknown as ScanJob;

describe('fuentes de la sala en directo (live-sources)', () => {
  it('resuelve con la clave de la sala y el canal sin la calidad', async () => {
    const core = createTestCore({});
    const { football, calls } = fakeFootball();
    const sources = createLiveSources({
      clock: core.clock,
      football,
      scanner: { job: () => JOB_STATE },
    });
    const result = await sources.get('abc123', LIVE);
    expect(calls).toEqual([{ match: LIVE.matchId, channel: ['DAZN 1'], client: 'party-abc123' }]);
    expect(result.candidates.map((item) => item.id)).toEqual([DAZN]);
    expect(result.scan).toBe(JOB_STATE);
    expect(partyClientKey('x.y/z')).toBe('party-xyz');
    expect(channelOfLive('M+ LaLiga · 720p')).toBe('M+ LaLiga');
  });

  it('caché por sala: no relanza hasta que caduca; `job` solo lee; `research` relanza', async () => {
    const core = createTestCore({});
    const clock = core.clock as FakeClock;
    const { football, calls } = fakeFootball();
    const sources = createLiveSources({ clock, football, scanner: { job: () => JOB_STATE } });
    await Promise.all([sources.get('r', LIVE), sources.get('r', LIVE)]);
    expect(calls).toHaveLength(1);
    await sources.get('r', LIVE, { job: JOB });
    expect(calls).toHaveLength(1);
    clock.advance(LIVE_SOURCES_TTL_MS + 1);
    await sources.get('r', LIVE);
    expect(calls).toHaveLength(2);
    await sources.get('r', LIVE, { research: true });
    expect(calls.at(-1)).toMatchObject({ research: '1', current: DAZN });
    expect(sources.cached('r')?.candidates).toHaveLength(1);
    sources.forget('r');
    expect(sources.cached('r')).toBeNull();
  });

  it('un canal suelto: `scope: channel` con el hash de la sala', async () => {
    const core = createTestCore({});
    const { football, calls } = fakeFootball();
    const sources = createLiveSources({ clock: core.clock, football });
    const result = await sources.get('r', { ...LIVE, matchId: null, match: null });
    expect(calls[0]).toEqual({
      scope: 'channel',
      channel: ['DAZN 1'],
      iptv: DAZN,
      client: 'party-r',
    });
    /* Sin comprobador, la lista va sin trabajo. */
    expect(result.scan).toBeNull();
  });
});

describe('partyLiveSources en el servicio: quién puede', () => {
  const BODY: PartyCreateBody = {
    live: {
      hash: DAZN,
      channel: 'DAZN 1 · 1080p',
      source: 'engine',
      matchId: 'fltv-2026-10-31-aaaa',
      match: 'Real Madrid – Barcelona',
    },
    name: 'Isma',
    control: 'leader',
    coleaders: false,
  };

  function setup() {
    const core = createTestCore({});
    const { football, calls } = fakeFootball();
    const party = createPartyService({
      ...core,
      playback: {
        acquire: () => Promise.reject(new Error('no')),
        acquireVod: () => Promise.reject(new Error('no')),
        heartbeat: () => Promise.reject(new Error('no')),
        release: async () => ({ released: true, sessionClosed: false }),
      },
      football,
      scanner: {
        job: () => JOB_STATE,
        verdict: () => null,
        recordVerdict: () => {
          throw new Error('no');
        },
      },
    });
    return { party, calls };
  }

  it('el líder y el co-líder (aunque los co-líderes no controlen); el invitado no', async () => {
    const { party, calls } = setup();
    const host = party.create(BODY);
    const room = host.room.code;
    const ana = party.join(room, 'Ana');
    const leo = party.join(room, 'Leo');
    party.member(room, { token: host.member.token, memberId: ana.member.id, action: 'coleader' });
    const own = await party.liveSources(room, { t: host.member.token });
    expect(own.candidates).toHaveLength(1);
    expect(calls[0]?.client).toBe(`party-${room}`);
    await expect(party.liveSources(room, { t: ana.member.token })).resolves.toMatchObject({
      scan: JOB_STATE,
    });
    await expect(party.liveSources(room, { t: leo.member.token })).rejects.toSatisfy(
      (error: unknown) => error instanceof AppError && error.code === 'party_leader_only',
    );
    /* El co-líder también cambia de fuente con los co-líderes sin control. */
    party.control(room, {
      token: ana.member.token,
      action: 'live',
      live: { hash: 'b'.repeat(40), channel: 'M+', source: 'engine', matchId: null, match: null },
    });
    expect(party.join(room, 'Eva').room.live?.hash).toBe('b'.repeat(40));
  });
});
