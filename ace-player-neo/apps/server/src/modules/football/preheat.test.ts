/* Precalentado de partidos (server.js:4337-4456, 5138-5143; api.md §4.11;
   B-029, B-180). */

import { createHash } from 'node:crypto';
import { PreheatPublicSchema } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  FLTV_URL,
  FOOTBALL_CACHE_MS,
  PREHEAT_FIRST_RUN_MS,
  PREHEAT_RECORD_MAX_AGE_MS,
  PREHEAT_RESULT_TTL_MS,
  PREHEAT_TICK_MS,
} from './constants.js';
import {
  footballPreheatStage,
  preheatFootballMatch,
  runFootballPreheat,
} from './legacy-exports.js';
import {
  ID_A,
  ID_B,
  ID_C,
  createFootball,
  fixture,
  withStreams,
  type FootballHarness,
} from './test-support.js';

const MIN = 60 * 1000;
const KICKOFF = Date.UTC(2026, 0, 1, 20); // Real Madrid - Manchester City del fixture
const ID_D = 'd'.repeat(40);

function match(id: string, start: number | undefined, channels: string[]) {
  return {
    id,
    date: '2026-01-01',
    time: '21:00',
    ...(start === undefined ? {} : { start }),
    title: `${id} - Rival`,
    home: id,
    away: 'Rival',
    competition: 'Champions League',
    country: 'España',
    channels: channels.map((name, index) => ({ id: `${id}-${index}`, name })),
  };
}

function agenda(...matches: ReturnType<typeof match>[]) {
  return { days: [{ date: '2026-01-01', matches }] };
}

let lastCore: FootballHarness['core'] | null = null;

function harness(options: { scanner?: boolean; state?: ReturnType<typeof withStreams> } = {}) {
  const created = createFootball({
    scanner: { enabled: options.scanner !== false },
    net: { [FLTV_URL]: fixture('futbolenlatv.html') },
    state:
      options.state ??
      withStreams([
        { id: ID_A, title: 'M+ Liga de Campeones' },
        { id: ID_B, title: 'DAZN LaLiga 1080p' },
      ]),
  });
  lastCore = created.core;
  return created;
}

/** Pone el reloj falso en `now` (siempre hacia delante) y da una vuelta de precalentado. */
async function runAt(football: FootballHarness['football'], payload: unknown, now: number) {
  lastCore?.clock.set(now);
  await football.runPreheat({ payload });
}

describe('T-078 · el precalentamiento avanza por descubrimiento, escaneo, saque y directo (B-029)', () => {
  it('fases según lo que falta para el saque', () => {
    const kickoff = KICKOFF;
    expect(footballPreheatStage(kickoff, kickoff - 46 * MIN)).toBeNull();
    expect(footballPreheatStage(kickoff, kickoff - 40 * MIN)).toBe('discovery');
    expect(footballPreheatStage(kickoff, kickoff - 10 * MIN)).toBe('scan');
    expect(footballPreheatStage(kickoff, kickoff - 2 * MIN)).toBe('kickoff');
    expect(footballPreheatStage(kickoff, kickoff + 10 * MIN)).toBe('live');
    expect(footballPreheatStage(kickoff, kickoff + 121 * MIN)).toBeNull();
    expect(footballPreheatStage(undefined, kickoff)).toBeNull();
    expect(footballPreheatStage(0, kickoff)).toBeNull();
  });
});

describe('Precalentado del servicio (B-029)', () => {
  it('descubrimiento: resuelve, refresca listas y no lanza el comprobador', async () => {
    const { football, scanner, directories } = harness();
    await runAt(
      football,
      agenda(match('m1', KICKOFF, ['M+ Liga de Campeones'])),
      KICKOFF - 40 * MIN,
    );
    const record = football.preheat('m1');
    expect(PreheatPublicSchema.parse(record)).toEqual(record);
    expect(record).toEqual({
      matchId: 'm1',
      stage: 'discovery',
      status: 'discovered',
      updatedAt: new Date(KICKOFF - 40 * MIN).toISOString(),
      candidateCount: 1,
      checked: 0,
      playable: 0,
      total: 1,
      error: '',
    });
    expect(scanner.enqueue).not.toHaveBeenCalled();
    // una vez en la fase y otra dentro de la resolución, como la 0.6.59
    expect(directories.refreshStaleInBackground).toHaveBeenCalledTimes(2);
    expect(football.healthInfo().preheated).toBe(1);
  });

  it('escaneo: lanza el comprobador sin forzar ni prioridad, con clave por partido', async () => {
    const { football, scanner } = harness();
    await runAt(
      football,
      agenda(match('m1', KICKOFF, ['M+ Liga de Campeones'])),
      KICKOFF - 10 * MIN,
    );
    const key = createHash('sha1').update('m1').digest('hex').slice(0, 20);
    expect(scanner.enqueue).toHaveBeenCalledWith({
      kind: 'preheat',
      candidates: [{ id: ID_A, ih: false, title: 'M+ Liga de Campeones' }],
      clientKey: `preheat_${key}`,
      matchId: 'm1',
      force: false,
      priority: false,
    });
    expect(football.preheat('m1')).toMatchObject({ stage: 'scan', status: 'scanning', total: 1 });
  });

  it('saque y directo fuerzan la sonda, salvo si una fuente del partido se está viendo', async () => {
    const { football, scanner, core } = harness();
    const payload = agenda(match('m1', KICKOFF, ['M+ Liga de Campeones']));
    /* start() para oír el bus; el reloj no se mueve después para que sus
       temporizadores no lancen otra vuelta con la agenda del fixture. */
    core.clock.set(KICKOFF - 2 * MIN);
    await football.start();
    await football.runPreheat({ payload });
    expect(scanner.enqueue.mock.lastCall?.[0]).toMatchObject({ force: true });
    core.bus.emit('playback.activity', { watching: true, hashes: [ID_A], viewers: 1 });
    await football.runPreheat({ payload, now: KICKOFF + 10 * MIN });
    expect(scanner.enqueue.mock.lastCall?.[0]).toMatchObject({ force: false });
    core.bus.emit('playback.activity', { watching: false, hashes: [], viewers: 0 });
    await football.runPreheat({ payload, now: KICKOFF + 31 * MIN });
    expect(scanner.enqueue.mock.lastCall?.[0]).toMatchObject({ force: true });
    expect(scanner.enqueue).toHaveBeenCalledTimes(3);
    await football.stop();
  });

  it('en directo repite cada 20 min; en otras fases, solo al cambiar de fase', async () => {
    const { football, scanner } = harness();
    const payload = agenda(match('m1', KICKOFF, ['M+ Liga de Campeones']));
    await runAt(football, payload, KICKOFF - 10 * MIN);
    await runAt(football, payload, KICKOFF - 9 * MIN);
    expect(scanner.enqueue).toHaveBeenCalledTimes(1);
    await runAt(football, payload, KICKOFF + 10 * MIN);
    await runAt(football, payload, KICKOFF + 20 * MIN);
    expect(scanner.enqueue).toHaveBeenCalledTimes(2);
    await runAt(football, payload, KICKOFF + 10 * MIN + PREHEAT_RESULT_TTL_MS);
    expect(scanner.enqueue).toHaveBeenCalledTimes(3);
  });

  it('como mucho 2 partidos por vuelta, los más cercanos a ahora', async () => {
    const { football } = harness();
    await runAt(
      football,
      agenda(
        match('lejos', KICKOFF + 40 * MIN, ['M+ Liga de Campeones']),
        match('cerca', KICKOFF + 5 * MIN, ['M+ Liga de Campeones']),
        match('medio', KICKOFF - 20 * MIN, ['M+ Liga de Campeones']),
        match('sin-canal', KICKOFF, []),
        match('sin-saque', undefined, ['M+ Liga de Campeones']),
      ),
      KICKOFF,
    );
    expect(football.preheat('cerca')).not.toBeNull();
    expect(football.preheat('medio')).not.toBeNull();
    expect(football.preheat('lejos')).toBeNull();
    expect(football.preheat('sin-canal')).toBeNull();
    expect(football.preheat('sin-saque')).toBeNull();
  });

  it('sin fuentes: `no_sources`; sin comprobador: `scanner_offline`; si la resolución falla: `failed`', async () => {
    const { football } = harness({ scanner: false });
    await runAt(
      football,
      agenda(
        match('nada', KICKOFF, ['Amazon Prime Video']),
        match('offline', KICKOFF, ['M+ Liga de Campeones']),
      ),
      KICKOFF - 10 * MIN,
    );
    expect(football.preheat('nada')).toMatchObject({ status: 'no_sources', total: 0 });
    expect(football.preheat('offline')).toMatchObject({ status: 'scanner_offline' });
    await runAt(football, agenda(match('roto', KICKOFF, ['***'])), KICKOFF - 10 * MIN);
    expect(football.preheat('roto')).toMatchObject({ status: 'failed', error: 'channel_required' });
  });

  it('al terminar su trabajo (`scan.jobDone`) queda `ready` con lo comprobado', async () => {
    const { football, core, scanner } = harness();
    core.clock.set(KICKOFF - 10 * MIN);
    await football.start();
    await football.runPreheat({ payload: agenda(match('m1', KICKOFF, ['M+ Liga de Campeones'])) });
    const jobId = (scanner.enqueue.mock.results[0]?.value as { id: string }).id;
    scanner.job.mockImplementationOnce(
      () => ({ checked: 1, playable: 1, total: 1 }) as ReturnType<typeof scanner.job>,
    );
    const done = {
      jobId,
      kind: 'preheat' as const,
      status: 'complete' as const,
      matchId: 'm1',
      reportKey: null,
      total: 1,
      playable: 0,
    };
    // lo que no es de precalentado, no ha terminado o no es de este partido, no toca nada
    core.bus.emit('scan.jobDone', { ...done, kind: 'interactive' });
    core.bus.emit('scan.jobDone', { ...done, status: 'cancelled' });
    core.bus.emit('scan.jobDone', { ...done, matchId: 'otro' });
    core.bus.emit('scan.jobDone', { ...done, matchId: null });
    expect(football.preheat('m1')?.status).toBe('scanning');
    core.bus.emit('scan.jobDone', done);
    expect(football.preheat('m1')).toMatchObject({
      status: 'ready',
      checked: 1,
      playable: 1,
      total: 1,
      updatedAt: new Date(core.clock.now()).toISOString(),
    });
    // si el trabajo ya no existe, con los números del evento
    core.bus.emit('scan.jobDone', done);
    expect(football.preheat('m1')).toMatchObject({ checked: 1, playable: 0 });
    await football.stop();
  });

  it('los registros de más de 3 h se olvidan', async () => {
    const { football } = harness();
    await runAt(
      football,
      agenda(match('m1', KICKOFF, ['M+ Liga de Campeones'])),
      KICKOFF - 10 * MIN,
    );
    expect(football.preheat('m1')).not.toBeNull();
    await runAt(football, agenda(), KICKOFF - 10 * MIN + PREHEAT_RECORD_MAX_AGE_MS + 1);
    expect(football.preheat('m1')).toBeNull();
  });

  it('dos vueltas a la vez no se pisan', async () => {
    const { football, search } = harness();
    const payload = agenda(match('m1', KICKOFF, ['M+ Liga de Campeones']));
    await Promise.all([
      football.runPreheat({ payload, now: KICKOFF - 10 * MIN }),
      football.runPreheat({ payload, now: KICKOFF - 10 * MIN }),
    ]);
    expect(search.search).toHaveBeenCalledTimes(1);
  });

  it('sin agenda propia pide la del servicio y la refresca si caducó (§8.2.13)', async () => {
    const { football, net, core } = harness();
    await football.runPreheat();
    expect(net.fetchText).toHaveBeenCalledTimes(1);
    core.clock.advance(FOOTBALL_CACHE_MS);
    await football.runPreheat();
    expect(net.fetchText).toHaveBeenCalledTimes(2);
  });

  it('los temporizadores: primera vuelta a los 5 s y después cada 60 s', async () => {
    const { football, core, search } = harness();
    core.clock.set(KICKOFF - 10 * MIN);
    await football.start();
    await football.start();
    await core.clock.advanceAsync(PREHEAT_FIRST_RUN_MS);
    await football.idle();
    // Madrid-City (en `scan`) y Sevilla-Rayo (en `live`) del fixture
    expect(football.healthInfo().preheated).toBe(2);
    const calls = search.search.mock.calls.length;
    await core.clock.advanceAsync(PREHEAT_TICK_MS);
    await football.idle();
    expect(search.search.mock.calls.length).toBe(calls);
    await football.stop();
    await core.clock.advanceAsync(PREHEAT_TICK_MS * 30);
    expect(search.search.mock.calls.length).toBe(calls);
  });

  it('un fallo de la agenda en el temporizador solo se anota', async () => {
    const { football, core } = createFootball();
    await football.start();
    await core.clock.advanceAsync(PREHEAT_FIRST_RUN_MS);
    await football.idle();
    expect(football.healthInfo().status).toBe('warming');
    await football.stop();
  });
});

describe('Reutilizar el precalentado al resolver (server.js:4776-4796; B-180)', () => {
  it('menos de 20 min: `preheated`, lo aprendido aplicado y el comprobador interactivo', async () => {
    const { football, scanner } = harness();
    const payload = agenda(match('m1', KICKOFF, ['M+ Liga de Campeones']));
    await runAt(football, payload, KICKOFF - 40 * MIN);
    const result = await football.resolve({ match: 'm1', channel: 'Otro canal' });
    expect(result).toMatchObject({
      status: 'found',
      preheated: true,
      candidate: { id: ID_A },
      program: { id: 'm1', channels: ['M+ Liga de Campeones'] },
      preheat: { matchId: 'm1', stage: 'discovery', status: 'discovered' },
    });
    expect(scanner.enqueue).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'interactive', matchId: 'm1', force: false }),
    );
  });

  it('en la rama precargada un candidato flojo sale `found` (api.md §6.21) y sin nada, `not_found`', async () => {
    const { football, state } = harness({
      state: withStreams([{ id: ID_C, title: 'DAZN' }]),
    });
    await runAt(football, agenda(match('m1', KICKOFF, ['DAZN 1'])), KICKOFF - 40 * MIN);
    const flojo = await football.resolve({ match: 'm1' });
    expect(flojo).toMatchObject({
      status: 'found',
      preheated: true,
      candidate: { id: ID_C, score: 78 },
    });
    // una cuarentena posterior deja la rama precargada sin candidatos
    state.set({
      ...state.get(),
      sourceReports: [
        {
          reportId: 'r',
          id: ID_C,
          title: 'DAZN',
          ih: false,
          source: '',
          channel: 'DAZN 1',
          channelKey: 'dazn 1',
          matchId: 'm1',
          reason: 'not_starting',
          state: 'failed',
          checkReason: '',
          reportCount: 1,
          reportedAt: '2026-01-01T00:00:00.000Z',
          lastCheckedAt: null,
          quarantineUntil: '2999-01-01T00:00:00.000Z',
        },
      ],
    });
    const vacio = await football.resolve({ match: 'm1' });
    expect(vacio).toMatchObject({
      status: 'not_found',
      candidate: null,
      candidates: [],
      scan: null,
    });
  });

  it('Rebuscar y lo de más de 20 min hacen una pasada nueva', async () => {
    const { football, core } = harness();
    await runAt(
      football,
      agenda(match('m1', KICKOFF, ['M+ Liga de Campeones'])),
      KICKOFF - 40 * MIN,
    );
    const rebuscar = await football.resolve({
      match: 'm1',
      channel: 'M+ Liga de Campeones',
      research: '1',
    });
    expect(rebuscar).not.toHaveProperty('preheated');
    expect(rebuscar.preheat).toBeNull();
    core.clock.advance(PREHEAT_RESULT_TTL_MS + 1);
    const viejo = await football.resolve({ match: 'm1', channel: 'M+ Liga de Campeones' });
    expect(viejo).not.toHaveProperty('preheated');
  });
});

describe('Fachada antigua del precalentado', () => {
  it('preheatFootballMatch sin comprobador: `scanner_offline`; sin canales, null', async () => {
    const record = await preheatFootballMatch(match('legacy-1', KICKOFF, ['DAZN']), 'scan', {
      state: withStreams([{ id: ID_D, title: 'DAZN' }]),
      search: async () => [],
      now: KICKOFF - 10 * MIN,
    });
    expect(record).toMatchObject({ matchId: 'legacy-1', status: 'scanner_offline', stage: 'scan' });
    expect(await preheatFootballMatch(match('legacy-2', KICKOFF, []), 'scan')).toBeNull();
    expect(await preheatFootballMatch(null, 'scan')).toBeNull();
  });

  it('preheatFootballMatch con `resolve` propio, como la 0.6.59', async () => {
    const record = await preheatFootballMatch(match('legacy-3', KICKOFF, ['X']), 'discovery', {
      resolve: async (_state, channels, _search, options) => ({
        status: 'not_found',
        channels,
        checked: [],
        candidates: [],
        engineAvailable: false,
        ai: { enabled: false, used: false, model: null, catalogSize: 0, error: null },
        program: options.program,
        research: false,
      }),
    });
    expect(record).toMatchObject({ status: 'no_sources' });
  });

  it('runFootballPreheat necesita la agenda y no se solapa', async () => {
    await expect(runFootballPreheat()).rejects.toMatchObject({ code: 'not_implemented' });
    const payload = agenda(match('legacy-4', KICKOFF, ['DAZN']));
    await Promise.all([
      runFootballPreheat({ payload, now: KICKOFF - 10 * MIN, search: async () => [] }),
      runFootballPreheat({ payload, now: KICKOFF - 10 * MIN }),
    ]);
  });
});
