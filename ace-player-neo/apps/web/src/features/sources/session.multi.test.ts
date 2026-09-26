/* La sesión de fuentes con otros dispositivos (docs/multidispositivo.md
   §2.4.5 y §2.1): lo que suena en casa primero (con `join`), y si llega tarde,
   la fuente de siempre; otra cosa en casa → no arranca y panel «Poner aquí»;
   los saltos automáticos se llevan a los demás (`continue` + `move` +
   `from`); cancelar la pregunta deja la sesión parada; y `match` en todo lo
   que arranca desde un partido. */

import type { ScanJob } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import {
  connectRuntime,
  getPlayer,
  notifyJoinExpired,
  notifyPlayCancelled,
  notifySourceFailed,
  playerStore,
  putHere,
  resetPlayerApi,
  type PlayCommand,
  type PlayerCommand,
} from '../../player/api.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { houseSession, iphone, me, resetHouse, seedHouse } from '../multi/test-utils.ts';
import { endSession, enterMatch, getSession, resetSessionForTests } from './session.ts';
import { hash, JOB, resolution, scanJob, testMatch } from './test-utils.ts';

const flush = () => vi.advanceTimersByTimeAsync(0);
const OTHER = 'f'.repeat(40);

let scan: ScanJob;
let net: ReturnType<typeof mockFetch>;
let commands: PlayerCommand[] = [];
const plays = () => commands.filter((c): c is PlayCommand => c.type === 'play');

beforeEach(() => {
  vi.useFakeTimers();
  resetPlayerApi();
  resetSessionForTests();
  resetToasts();
  commands = [];
  scan = scanJob(['working', 'checking', 'queued']);
  net = mockFetch({
    'GET /api/v1/football/resolve': () => json(resolution(3)),
    [`GET /api/v1/football/scans/${JOB}`]: () => json(scan),
  });
  connectRuntime({
    handle: (command) => {
      commands.push(command);
      /* Un reproductor mínimo: lo pedido pasa a «cargando» con su canal. */
      if (command.type === 'play')
        playerStore.set((state) => ({
          ...state,
          phase: 'cargando',
          conn: 'pidiendo',
          channel: command.channel,
          origin: command.options.origin ?? 'user',
          idleReason: null,
          houseIdle: null,
        }));
    },
  });
});

afterEach(() => {
  endSession();
  net.restore();
  resetPlayerApi();
  resetHouse();
  vi.useRealTimers();
});

describe('lo que suena en casa, primero (§2.4.5)', () => {
  it('otro dispositivo ve la fuente 2 del partido: se arranca esa con join y match', async () => {
    seedHouse({ sessions: [houseSession(hash(2), [iphone()])], sse: 'fallback' });
    enterMatch(testMatch());
    await flush();
    expect(plays()).toHaveLength(1);
    expect(plays()[0]).toMatchObject({
      channel: { hash: hash(2) },
      options: { house: 'join', match: 'm1', origin: 'auto' },
    });
    expect(toastStore.get().map((t) => t.text)).toContain('Te unes a lo que se ve en el iPhone');
  });

  it('si el join llega tarde, la fuente de siempre (pickAutoSource)', async () => {
    seedHouse({ sessions: [houseSession(hash(2), [iphone()])], sse: 'fallback' });
    enterMatch(testMatch());
    await flush();
    /* Como el reproductor: se para (detenido) y después avisa del join tardío. */
    playerStore.set((state) => ({
      ...state,
      phase: 'idle',
      channel: null,
      idleReason: 'detenido',
    }));
    notifyJoinExpired({ channel: { hash: hash(2), title: 'x' }, options: { house: 'join' } });
    await flush();
    expect(plays().at(-1)).toMatchObject({ channel: { hash: hash(1) } });
    expect(plays().at(-1)?.options.house).toBeUndefined();
  });
});

describe('otra cosa en casa (D-M2)', () => {
  it('no arranca solo: panel «En el iPhone se está viendo …» y «Poner aquí» arranca', async () => {
    seedHouse({
      sessions: [houseSession(OTHER, [iphone()], { title: 'DAZN LaLiga' })],
      sse: 'fallback',
    });
    enterMatch(testMatch());
    await flush();
    expect(plays()).toEqual([]);
    expect(getSession()).toMatchObject({ stopped: true, entries: expect.any(Array) });
    expect(getPlayer()).toMatchObject({
      idleReason: 'otra-cosa-en-casa',
      houseIdle: { labels: ['el iPhone'], title: 'DAZN LaLiga' },
    });
    putHere();
    expect(plays()).toHaveLength(1);
    expect(plays()[0]).toMatchObject({ channel: { hash: hash(1) }, options: { origin: 'user' } });
  });

  it('con un solo dispositivo arranca como siempre', async () => {
    seedHouse({ sessions: [], sse: 'fallback' });
    enterMatch(testMatch());
    await flush();
    expect(plays()[0]?.channel.hash).toBe(hash(1));
    expect(plays()[0]?.options.house).toBeUndefined();
  });

  it('cancelar la pregunta al empezar deja la sesión parada y dice «No has cambiado nada»', async () => {
    seedHouse({ sessions: [], sse: 'fallback' });
    enterMatch(testMatch());
    await flush();
    const command = plays()[0]!;
    playerStore.set((state) => ({ ...state, phase: 'idle', channel: null }));
    seedHouse({ sessions: [houseSession(OTHER, [iphone()])], sse: 'fallback' });
    notifyPlayCancelled(command);
    expect(getSession()).toMatchObject({ stopped: true, activeHash: null });
    expect(getPlayer().houseIdle).toMatchObject({ labels: ['el iPhone'] });
    expect(toastStore.get().map((t) => t.text)).toContain('No has cambiado nada');
  });
});

describe('saltos automáticos con otro dispositivo (§2.1, D-M4)', () => {
  it('la fuente cae viéndose juntos: continue + move + from = la sesión que falla', async () => {
    seedHouse({ sessions: [], sse: 'fallback' });
    scan = scanJob(['working', 'working', 'queued']);
    enterMatch(testMatch());
    await flush();
    expect(plays()[0]?.channel.hash).toBe(hash(1));
    seedHouse({ sessions: [houseSession(hash(1), [me(), iphone()])], sse: 'fallback' });
    playerStore.set((state) => ({ ...state, phase: 'error' }));
    const reply = notifySourceFailed({
      channel: { hash: hash(1), title: 'M+' },
      origin: 'auto',
      outcome: 'cayo',
      seconds: 60,
      reason: 'La señal se ha cortado',
    });
    expect(reply.next).toBe(true);
    expect(plays().at(-1)).toMatchObject({
      channel: { hash: hash(2) },
      options: { house: 'continue', others: 'move', from: `s_${hash(1).slice(0, 12)}` },
    });
  });
});
