/* Planificador de «Arranque instantáneo» (D24) con FakeClock:
   - con dobles de football y playback: qué partidos cuentan, cuándo se
     resuelve y cuándo se prepara, reintento con la casa ocupada, suelta a
     los 10 min, no repite tras ceder, se apaga con el ajuste y elige uno si
     coinciden dos;
   - integración con el playback de verdad (motor falso): a T-3 se abre la
     sesión del motor y el «Ver» la reutiliza; otra reproducción la cierra. */

import { describe, expect, it, vi } from 'vitest';
import type { ChannelStreamQuery, ResolutionCandidate, StateV1 } from '@ace/shared';
import { demoContentId } from '../../../test/fake-engine/catalog.js';
import { createTestCore } from '../../../test/helpers/index.js';
import { FakeClock } from '../../core/clock.js';
import type { FootballService, PreparedMatch } from '../football/types.js';
import { partial, setupPlayback } from '../playback/test-support.js';
import type {
  PlaybackService,
  PrewarmInfo,
  PrewarmRequest,
  PrewarmResult,
} from '../playback/types.js';
import type { ScannerService } from '../scanner/types.js';
import type { StateService } from '../state/types.js';
import { INSTANT_START_TICK_MS } from './constants.js';
import { createInstantStartRuntime } from './service.js';

const MIN = 60_000;
/** Saque: 1 h después de la época del FakeClock. */
const KICKOFF = Date.UTC(2026, 0, 1, 1, 0);
const ACE = demoContentId(1);
const OTRO = demoContentId(2);
const IPTV_ID = 'e'.repeat(40);

function match(id: string, home: string, away: string, start = KICKOFF) {
  return {
    id,
    start,
    home,
    away,
    title: `${home} - ${away}`,
    competition: 'LaLiga EA Sports',
    channels: [{ id: 'c1', name: 'DAZN LaLiga' }],
  };
}

function candidate(id: string, source: ResolutionCandidate['source']): ResolutionCandidate {
  return {
    id,
    title: source === 'iptv' ? 'DAZN LaLiga (IPTV)' : 'DAZN LaLiga',
    alias: null,
    ih: false,
    source,
    score: 100,
    matchedChannel: 'DAZN LaLiga',
    soloFamilia: false,
    familyFallbackAllowed: false,
    listaId: null,
    availability: null,
    bitrate: null,
    learned: null,
    reported: null,
    rejectedByLearning: false,
    quarantined: false,
  };
}

interface Options {
  readonly teams?: string[];
  readonly leagues?: string[];
  readonly matches?: unknown[];
  readonly candidates?: ResolutionCandidate[];
  readonly playback?: PlaybackService;
}

/** Doble de playback que recuerda lo que se le pide y deja simular cómo acaba. */
function fakePlayback() {
  let active: PrewarmInfo['active'] = null;
  let last: PrewarmInfo['last'] = null;
  let next: PrewarmResult | null = null;
  const calls: PrewarmRequest[] = [];
  const releases: string[] = [];
  const service = partial<PlaybackService>('playback', {
    prewarm: async (request) => {
      calls.push(request);
      const result = next ?? { status: 'warm', source: 'engine', sessionId: 's_1' };
      next = null;
      if (result.status === 'warm') {
        active = {
          matchId: request.matchId,
          hash: request.hash,
          source: result.source,
          since: 0,
          ready: true,
        };
      }
      return result;
    },
    releasePrewarm: async (reason) => {
      releases.push(reason);
      if (!active) return false;
      last = { matchId: active.matchId, hash: active.hash, outcome: reason, code: null, at: 1 };
      active = null;
      return true;
    },
    prewarmInfo: () => ({ active, last }),
  });
  return {
    service,
    calls,
    releases,
    willReturn: (result: PrewarmResult) => {
      next = result;
    },
    /** Otra reproducción se la queda (playback la cierra y lo apunta). */
    yieldIt: () => {
      if (!active) return;
      last = { matchId: active.matchId, hash: active.hash, outcome: 'yielded', code: null, at: 2 };
      active = null;
    },
  };
}

function setup(options: Options = {}) {
  const clock = new FakeClock();
  const core = createTestCore({ clock });
  let enabled = true;
  let teams = options.teams ?? ['Real Madrid'];
  const state = partial<StateService>('state', {
    instantStartEnabled: () => enabled,
    get: () =>
      ({
        preferences: { leagues: options.leagues ?? [], teams, nationalities: [] },
      }) as unknown as StateV1,
  });
  const payload = {
    days: [
      { date: '2026-01-01', matches: options.matches ?? [match('rm', 'Real Madrid', 'Getafe')] },
    ],
  };
  const prepared: PreparedMatch = {
    candidate: null,
    candidates: options.candidates ?? [candidate(ACE, 'acestream'), candidate(IPTV_ID, 'iptv')],
  };
  const prepareMatch = vi.fn(
    async (_id: string, _options: { readonly refresh: boolean }): Promise<PreparedMatch> =>
      prepared,
  );
  const football = partial<FootballService>('football', {
    schedule: async () => payload as never,
    prepareMatch,
  });
  const scanner = partial<ScannerService>('scanner', {
    isEnabled: () => true,
    verdict: (hash: string) => (hash === ACE ? ({ state: 'working' } as never) : null),
  });
  const playback = fakePlayback();
  const service = createInstantStartRuntime({
    ...core,
    state,
    football,
    playback: options.playback ?? playback.service,
    scanner,
  });
  /** Pone el reloj a `KICKOFF + offset` y da una vuelta. */
  const at = async (offset: number): Promise<void> => {
    clock.set(KICKOFF + offset);
    await service.tick();
  };
  return {
    clock,
    core,
    service,
    playback,
    prepareMatch,
    at,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    setTeams: (value: string[]) => {
      teams = value;
    },
  };
}

describe('instant-start: qué partidos y cuándo', () => {
  it('siguiendo solo la liga no se prepara nada (no se sobrecarga el Umbrel)', async () => {
    const t = setup({ teams: [], leagues: ['LaLiga'] });
    for (const offset of [-10 * MIN, -3 * MIN, 0]) await t.at(offset);
    expect(t.prepareMatch).not.toHaveBeenCalled();
    expect(t.playback.calls).toEqual([]);
  });

  it('T-10 resuelve (una vez); T-3 prepara la IPTV primero', async () => {
    const t = setup();
    await t.at(-11 * MIN);
    expect(t.prepareMatch).not.toHaveBeenCalled();
    await t.at(-10 * MIN);
    expect(t.prepareMatch).toHaveBeenCalledTimes(1);
    expect(t.prepareMatch).toHaveBeenLastCalledWith('rm', { refresh: true });
    await t.at(-5 * MIN);
    await t.at(-3 * MIN - 1);
    expect(t.prepareMatch).toHaveBeenCalledTimes(1);
    expect(t.playback.calls).toEqual([]);
    await t.at(-3 * MIN);
    expect(t.prepareMatch).toHaveBeenLastCalledWith('rm', { refresh: false });
    expect(t.playback.calls).toEqual([
      { hash: IPTV_ID, matchId: 'rm', title: 'DAZN LaLiga (IPTV)', ih: false },
    ]);
    expect(t.service.healthInfo()).toEqual({
      enabled: true,
      status: 'warm',
      matchId: 'rm',
      source: 'engine',
      last: null,
    });
    /* Ya preparada: las vueltas siguientes no piden otra. */
    await t.at(-2 * MIN);
    expect(t.playback.calls).toHaveLength(1);
  });

  it('con la casa ocupada se reintenta cada vuelta hasta T+5', async () => {
    const t = setup();
    await t.at(-10 * MIN);
    t.playback.willReturn({ status: 'skipped', reason: 'busy' });
    await t.at(-3 * MIN);
    expect(t.service.healthInfo()).toMatchObject({ status: 'idle', last: 'skipped:busy' });
    await t.at(-3 * MIN + INSTANT_START_TICK_MS);
    expect(t.playback.calls).toHaveLength(2);
    expect(t.service.healthInfo().status).toBe('warm');
  });

  it('nadie pulsa «Ver»: se suelta a los 10 min del saque', async () => {
    const t = setup();
    await t.at(-10 * MIN);
    await t.at(-3 * MIN);
    await t.at(10 * MIN);
    expect(t.playback.releases).toEqual([]);
    await t.at(10 * MIN + INSTANT_START_TICK_MS);
    expect(t.playback.releases).toEqual(['expired']);
    expect(t.service.healthInfo()).toMatchObject({ status: 'idle', last: 'expired' });
  });

  it('si otra reproducción se la queda, no se vuelve a preparar ese partido', async () => {
    const t = setup();
    await t.at(-10 * MIN);
    await t.at(-3 * MIN);
    t.playback.yieldIt();
    await t.at(-2 * MIN);
    await t.at(0);
    expect(t.playback.calls).toHaveLength(1);
    expect(t.service.healthInfo().last).toBe('yielded');
  });

  it('un fallo al preparar se ve en la salud', async () => {
    const t = setup();
    await t.at(-10 * MIN);
    t.playback.willReturn({ status: 'failed', code: 'engine_timeout' });
    await t.at(-3 * MIN);
    expect(t.service.healthInfo().last).toBe('failed:engine_timeout');
  });

  it('apagar el ajuste suelta lo preparado al momento (sin esperar a la vuelta)', async () => {
    const t = setup();
    await t.at(-10 * MIN);
    await t.at(-3 * MIN);
    /* Arrancado después: sus temporizadores no se mezclan con las vueltas a mano. */
    await t.service.start();
    t.setEnabled(false);
    t.core.bus.emit('state.changed', { scopes: ['settings'], at: new Date().toISOString() });
    await t.service.tick();
    expect(t.playback.releases).toEqual(['disabled']);
    expect(t.service.healthInfo()).toMatchObject({ enabled: false, status: 'off' });
    await t.service.stop();
    await t.at(-2 * MIN);
    expect(t.playback.calls).toHaveLength(1);
  });

  it('dos partidos de tus equipos a la vez: solo uno, el que va antes en tus gustos', async () => {
    const t = setup({
      teams: ['Barcelona', 'Real Madrid'],
      matches: [match('rm', 'Real Madrid', 'Getafe'), match('bar', 'Barcelona', 'Sevilla')],
    });
    await t.at(-10 * MIN);
    expect(t.prepareMatch.mock.calls.map(([id]) => id)).toEqual(['bar']);
    await t.at(-3 * MIN);
    expect(t.playback.calls.map((call) => call.matchId)).toEqual(['bar']);
  });

  it('el de saque más temprano manda aunque el otro equipo vaya antes en tus gustos', async () => {
    const t = setup({
      teams: ['Barcelona', 'Real Madrid'],
      matches: [
        match('rm', 'Real Madrid', 'Getafe'),
        match('bar', 'Barcelona', 'Sevilla', KICKOFF + 5 * MIN),
      ],
    });
    await t.at(-10 * MIN);
    await t.at(-3 * MIN);
    await t.at(2 * MIN);
    expect(t.playback.calls.map((call) => call.matchId)).toEqual(['rm']);
    expect(t.prepareMatch.mock.calls.map(([id]) => id)).not.toContain('bar');
  });
});

describe('instant-start + playback de verdad (motor falso)', () => {
  const query: ChannelStreamQuery = {
    client: 'web',
    kind: 'auto',
    mode: 'balanced',
    viewer: 'visor-web',
  };
  const viewer = { viewerId: 'visor-web', deviceId: 'pc', device: null };

  it('a T-3 abre la sesión del motor y el «Ver» la reutiliza sin abrir otra', async () => {
    const pb = await setupPlayback();
    const t = setup({ candidates: [candidate(ACE, 'acestream')], playback: pb.runtime.service });
    await t.at(-10 * MIN);
    await t.at(-3 * MIN);
    expect(pb.fakeEngine.control.metrics()).toMatchObject({ sessionsOpened: 1, sessionsOpen: 1 });
    expect(pb.runtime.service.status().sessions).toEqual([]);
    expect(t.service.healthInfo()).toMatchObject({
      status: 'warm',
      matchId: 'rm',
      source: 'engine',
    });

    const grant = await pb.runtime.service.acquire(
      ACE,
      query,
      viewer,
      new AbortController().signal,
    );
    expect(grant.url).toBeTruthy();
    expect(pb.fakeEngine.control.metrics().sessionsOpened).toBe(1);
    await t.at(-2 * MIN);
    expect(t.service.healthInfo()).toMatchObject({ status: 'idle', last: 'used' });
    /* Ni a los 10 min se toca lo que ya es del usuario. */
    await t.at(11 * MIN);
    expect(pb.runtime.inspect().sessions[0]?.viewers).toEqual(['visor-web']);
  });

  it('otra reproducción la cierra antes de abrir lo suyo y no se vuelve a preparar', async () => {
    const pb = await setupPlayback();
    const t = setup({ candidates: [candidate(ACE, 'acestream')], playback: pb.runtime.service });
    await t.at(-10 * MIN);
    await t.at(-3 * MIN);
    await pb.runtime.service.acquire(OTRO, query, viewer, new AbortController().signal);
    expect(pb.fakeEngine.control.metrics()).toMatchObject({ sessionsOpen: 1, sessionsStopped: 1 });
    await pb.runtime.service.release(
      pb.runtime.inspect().sessions[0]?.id ?? '',
      { viewer: 'visor-web', reason: 'user' },
      viewer,
    );
    await t.at(-2 * MIN);
    expect(pb.fakeEngine.control.metrics().sessionsOpened).toBe(2);
    expect(t.service.healthInfo().last).toBe('yielded');
  });
});
