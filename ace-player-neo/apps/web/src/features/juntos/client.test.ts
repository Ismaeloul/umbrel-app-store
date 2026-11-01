/* La sesión de vídeo del latido (`stream` de `partyStatus`): un «lost» viejo
   no puede tirar el vídeo recién abierto. Lo que pasaba: tras una sesión
   perdida, el reproductor reabría y el siguiente evento de la sala volvía a
   ver el «lost» de antes y la tiraba otra vez, hasta gastar los reintentos. */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { PartyClient, type PartyEnv } from './client.ts';

const ANA = 'm_AnaInvitada01';
const STATUS = `POST /api/v1/party/${joined.room.code}/status`;

let net: ReturnType<typeof mockFetch> | undefined;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  net = undefined;
  resetMode();
});

function setup() {
  const clock = { now: 1_000 };
  let beat: (() => void) | null = null;
  const env: PartyEnv = {
    now: () => clock.now,
    eventSource: () => Object.assign(new EventTarget(), { close() {} }) as unknown as EventSource,
    setInterval: (fn) => {
      beat = fn;
      return 1;
    },
    clearInterval: () => undefined,
  };
  const client = new PartyClient(
    joined.room.code,
    { id: ANA, token: `${ANA}.secreto0123456789abcdef` },
    env,
  );
  client.start();
  return { client, clock, beat: () => beat?.() };
}

describe('«Ver juntos»: la sesión del latido', () => {
  it('resetStream borra el «lost» sin avisar, y una respuesta a un envío de antes no lo trae', async () => {
    /* Cada latido espera a que el test le conteste. */
    const pending: ((stream: string) => void)[] = [];
    net = mockFetch({
      [STATUS]: () =>
        new Promise<Response>((resolve) => {
          pending.push((stream) => resolve(json({ serverNow: 5_000, rev: 2, stream })));
        }),
    });
    const answer = async (stream: string) => {
      await vi.waitFor(() => expect(pending.length).toBeGreaterThan(0));
      pending.shift()?.(stream);
    };
    const { client, clock, beat } = setup();
    beat();
    await vi.waitFor(() => expect(net?.calls).toHaveLength(1));
    await answer('lost');
    await vi.waitFor(() => expect(client.getState().stream).toBe('lost'));

    const listener = vi.fn();
    client.subscribe(listener);
    clock.now = 2_000;
    /* Un latido sale justo antes de la sesión nueva… */
    beat();
    await vi.waitFor(() => expect(net?.calls).toHaveLength(2));
    clock.now = 3_000;
    client.resetStream();
    expect(client.getState().stream).toBe('none');
    expect(listener).not.toHaveBeenCalled();
    /* …y su «lost» habla de la vieja: no cuenta. */
    await answer('lost');
    await vi.waitFor(() => expect(listener).toHaveBeenCalled());
    expect(client.getState().stream).toBe('none');
    expect(client.getState().offsetMs).not.toBe(0);

    /* Un latido de después sí cuenta. */
    clock.now = 4_000;
    beat();
    await vi.waitFor(() => expect(net?.calls).toHaveLength(3));
    await answer('ok');
    await vi.waitFor(() => expect(client.getState().stream).toBe('ok'));
    client.stop();
  });
});
