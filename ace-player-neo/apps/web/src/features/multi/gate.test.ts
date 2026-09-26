/* La puerta de la casa en play() (docs/multidispositivo.md §2.4.1): preguntar
   no toca el reproductor ni la presencia; contestar manda `others` y `from`;
   cancelar avisa; `continue`, `follow` y `join` no preguntan; sin SSE se
   refresca y se decide después; la hoja abierta se vuelve a evaluar y se
   cierra con un traspaso. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getViewerId } from '../../api/identity.ts';
import { dispatchSse } from '../../api/sse.ts';
import { playerPresence } from '../../app/player-presence.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { toastStore } from '../../notices/toasts.ts';
import {
  connectRuntime,
  onPlayCancelled,
  play,
  playerStore,
  putHere,
  resetPlayerApi,
  setHouseGate,
  type PlayerCommand,
} from '../../player/api.ts';
import {
  answerHouse,
  houseGate,
  houseQuestionStore,
  listenHouseGate,
  resetHouseGate,
} from './gate.ts';
import {
  H1,
  H2,
  H3,
  houseSession,
  iphone,
  me,
  resetHouse,
  seedHouse,
  setSessions,
} from './test-utils.ts';

const META = { id: '1', synthetic: false };
let commands: PlayerCommand[] = [];
let off: (() => void) | null = null;

beforeEach(() => {
  commands = [];
  resetPlayerApi();
  resetHouseGate();
  setHouseGate(houseGate);
  off = listenHouseGate();
  connectRuntime({ handle: (command) => commands.push(command) });
  playerPresence.set({ active: false, immersive: false, route: null });
});

afterEach(() => {
  off?.();
  resetPlayerApi();
  resetHouse();
});

const played = () =>
  commands.filter((c): c is Extract<PlayerCommand, { type: 'play' }> => c.type === 'play');

describe('la puerta pregunta (§2.1)', () => {
  it('ask: guarda la orden y no toca ni el reproductor ni la presencia', () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    expect(play({ hash: H2, title: 'Antena 3' })).toBe(true);
    expect(commands).toEqual([]);
    expect(playerPresence.get().active).toBe(false);
    expect(houseQuestionStore.get()?.texts).toMatchObject({
      title: '¿Cambiar en los dos o solo aquí?',
      sentence: 'En el iPhone se está viendo DAZN LaLiga.',
    });
  });

  it('«Cambiar en los dos»: others=move y from = la sesión de la pregunta', () => {
    seedHouse({ sessions: [houseSession(H1, [me(), iphone()])] });
    play({ hash: H2, title: 'Antena 3' });
    answerHouse('both');
    expect(houseQuestionStore.get()).toBeNull();
    expect(played()[0]?.options).toMatchObject({ others: 'move', from: `s_${H1.slice(0, 12)}` });
    expect(playerPresence.get().active).toBe(true);
  });

  it('«Solo aquí»: others=stop; «Cancelar»: no manda nada y avisa', () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    play({ hash: H2, title: 'Antena 3' });
    answerHouse('here');
    expect(played()[0]?.options).toMatchObject({ others: 'stop' });
    const cancelled: string[] = [];
    onPlayCancelled((hash) => cancelled.push(hash));
    play({ hash: H3, title: 'La 1' });
    answerHouse('cancel');
    expect(played()).toHaveLength(1);
    expect(cancelled).toEqual([H3]);
  });

  it('canal suelto sin nada aquí: detrás de la hoja, «otra cosa en casa»; al cancelar sigue con «Poner aquí» y «No has cambiado nada»', () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    toastStore.set([]);
    play({ hash: H2, title: 'Antena 3' });
    expect(playerStore.get()).toMatchObject({
      idleReason: 'otra-cosa-en-casa',
      houseIdle: { labels: ['el iPhone'], title: 'DAZN LaLiga' },
    });
    answerHouse('cancel');
    expect(played()).toHaveLength(0);
    expect(playerStore.get().houseIdle).not.toBeNull();
    expect(toastStore.get().map((item) => item.text)).toContain('No has cambiado nada');
    /* «Poner aquí» vuelve a preguntar (pasa otra vez por la puerta). */
    putHere();
    expect(houseQuestionStore.get()?.command.channel.hash).toBe(H2);
    answerHouse('here');
    expect(played()[0]?.options).toMatchObject({ others: 'stop' });
  });

  it('continue, follow y join no preguntan; con la política handoff tampoco', () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    play({ hash: H2, title: 'x' }, { house: 'join' });
    play({ hash: H3, title: 'y' }, { house: 'follow' });
    play({ hash: H2, title: 'z' }, { house: 'continue', others: 'move', from: 's_fuente1234' });
    expect(played().map((c) => c.options.house)).toEqual(['join', 'follow', 'continue']);
    expect(played()[2]?.options).toMatchObject({ others: 'move', from: 's_fuente1234' });
    expect(houseQuestionStore.get()).toBeNull();
    seedHouse({ sessions: [houseSession(H1, [iphone()])], policy: 'handoff' });
    play({ hash: H3, title: 'otra' });
    expect(played()).toHaveLength(4);
  });

  it('sin features.multi (servidor de antes): nunca pregunta', () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])], multi: false });
    play({ hash: H2, title: 'Antena 3' });
    expect(played()).toHaveLength(1);
    expect(played()[0]?.options).not.toHaveProperty('others');
  });

  it('«en los dos» recordado: el siguiente cambio con los mismos no pregunta', () => {
    seedHouse({ sessions: [houseSession(H1, [me(), iphone()])] });
    play({ hash: H2, title: 'Antena 3' });
    answerHouse('both');
    setSessions([houseSession(H2, [me(), iphone()])]);
    play({ hash: H3, title: 'La 1' });
    expect(houseQuestionStore.get()).toBeNull();
    expect(played()[1]?.options).toMatchObject({ others: 'move', from: `s_${H2.slice(0, 12)}` });
  });
});

describe('sin SSE: pending (§2.1)', () => {
  it('refresca playbackStatus, decide con lo nuevo y play() no espera', async () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])], sse: 'fallback' });
    const net = mockFetch({
      'GET /api/v1/playback': () =>
        json({ nowPlaying: null, learningCount: 0, serverTime: 1, sessions: [] }),
    });
    expect(play({ hash: H2, title: 'Antena 3' })).toBe(true);
    expect(commands).toEqual([]);
    await vi.waitFor(() => expect(played()).toHaveLength(1));
    expect(net.calls[0]?.url).toBe('/api/v1/playback');
    expect(houseQuestionStore.get()).toBeNull();
  });

  it('con el otro aún viendo tras refrescar: pregunta; una orden nueva sustituye a la pendiente', async () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])], sse: 'fallback' });
    const status = {
      nowPlaying: null,
      learningCount: 0,
      serverTime: 1,
      sessions: [houseSession(H1, [iphone()])],
    };
    mockFetch({ 'GET /api/v1/playback': () => json(status) });
    play({ hash: H2, title: 'Antena 3' });
    play({ hash: H3, title: 'La 1' });
    await vi.waitFor(() => expect(houseQuestionStore.get()).not.toBeNull());
    expect(houseQuestionStore.get()?.command.channel.hash).toBe(H3);
  });
});

describe('la hoja abierta no se queda vieja (§2.4.1)', () => {
  it('playback.sessions sin nadie más: si sigue así 1,5 s, se cierra y la orden sigue', async () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    play({ hash: H2, title: 'Antena 3' });
    setSessions([]);
    dispatchSse('playback.sessions', { sessions: [] }, META);
    /* Un instante raro (un traspaso a medias) no la cierra: espera a confirmarse. */
    expect(houseQuestionStore.get()).not.toBeNull();
    await vi.waitFor(() => expect(houseQuestionStore.get()).toBeNull(), { timeout: 3_000 });
    expect(played()).toHaveLength(1);
  });

  it('si el otro vuelve a aparecer antes de 1,5 s, la hoja sigue abierta', async () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    play({ hash: H2, title: 'Antena 3' });
    dispatchSse('playback.sessions', { sessions: [] }, META);
    dispatchSse('playback.sessions', { sessions: [houseSession(H1, [iphone()])] }, META);
    await new Promise((resolve) => setTimeout(resolve, 1_800));
    expect(houseQuestionStore.get()).not.toBeNull();
    expect(played()).toHaveLength(0);
  });

  it('el otro cambia de canal: cambian la frase y from', () => {
    seedHouse({ sessions: [houseSession(H1, [iphone()])] });
    play({ hash: H2, title: 'Antena 3' });
    dispatchSse('playback.sessions', { sessions: [houseSession(H3, [iphone()])] }, META);
    expect(houseQuestionStore.get()?.question.from).toBe(`s_${H3.slice(0, 12)}`);
    expect(houseQuestionStore.get()?.texts.sentence).toBe('En el iPhone se está viendo La 1.');
  });

  it('un traspaso para este visor la cierra y cancela la orden', () => {
    seedHouse({ sessions: [houseSession(H1, [me(), iphone()])] });
    const cancelled: string[] = [];
    onPlayCancelled((hash) => cancelled.push(hash));
    play({ hash: H2, title: 'Antena 3' });
    dispatchSse(
      'playback.handoff',
      {
        sessionId: `s_${H1.slice(0, 12)}`,
        viewerIds: [getViewerId()],
        byDeviceId: 'dev_iphone',
        byClient: 'ios',
        hash: H3,
        title: 'La 1',
        reason: 'other_channel',
        follow: true,
      },
      META,
    );
    expect(houseQuestionStore.get()).toBeNull();
    expect(cancelled).toEqual([H2]);
    expect(played()).toHaveLength(0);
  });
});
