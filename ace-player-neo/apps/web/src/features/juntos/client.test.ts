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

// --- 1.1.2: el reloj, las órdenes y el SSE que se recupera ---

const CONTROL = `POST /api/v1/party/${joined.room.code}/control`;

/** Un EventSource de mentira: se abre, se cierra y recibe eventos a mano. */
class FakeSource extends EventTarget {
  readyState = 0;
  closed = false;
  constructor(readonly url: string) {
    super();
  }
  close(): void {
    this.closed = true;
    this.readyState = 2;
  }
  open(): void {
    this.readyState = 1;
    this.dispatchEvent(new Event('open'));
  }
  emit(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
  fail(): void {
    this.readyState = 2;
    this.dispatchEvent(new Event('error'));
  }
}

/** El cliente con todo a mano: reloj, temporizadores, EventSource y eventos de la página. */
function rig() {
  const clock = { now: 1_000 };
  /* La hora del sistema: solo se mueve a mano (dormir el aparato). */
  const wall = { now: 1_000 };
  const sources: FakeSource[] = [];
  let beat: (() => void) | null = null;
  let timers: { fn: () => void; ms: number }[] = [];
  const page = new EventTarget();
  let visible = true;
  const env: PartyEnv = {
    now: () => clock.now,
    wallNow: () => wall.now,
    eventSource: (url) => {
      const source = new FakeSource(url);
      sources.push(source);
      return source as unknown as EventSource;
    },
    setInterval: (fn) => {
      beat = fn;
      return 1;
    },
    clearInterval: () => undefined,
    setTimeout: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    clearTimeout: (handle) => {
      timers = timers.filter((timer) => timer !== handle);
    },
    listen: (_target, type, fn) => {
      page.addEventListener(type, fn);
      return () => page.removeEventListener(type, fn);
    },
    visible: () => visible,
  };
  const client = new PartyClient(
    joined.room.code,
    { id: ANA, token: `${ANA}.secreto0123456789abcdef` },
    env,
  );
  return {
    client,
    clock,
    wall,
    sources,
    page,
    setVisible: (value: boolean) => {
      visible = value;
    },
    beat: () => beat?.(),
    /** Los temporizadores pendientes (sus esperas) y ejecutarlos. */
    delays: () => timers.map((timer) => timer.ms),
    runTimers: () => {
      const due = timers;
      timers = [];
      for (const timer of due) timer.fn();
    },
  };
}

const statusCalls = () => net?.calls.filter((call) => call.url.endsWith('/status')) ?? [];

describe('«Ver juntos» 1.1.2: el reloj', () => {
  it('con `receivedAt`, las cuatro marcas: lo que tarda el servidor no tuerce el desfase', async () => {
    const { client, clock, beat } = rig();
    net = mockFetch({
      /* Sale a las 1000; el servidor la recibe a las 5050 y responde a las 5850 (esperó 800 ms al
         latido del vídeo); vuelve a las 1900. */
      [STATUS]: () => {
        clock.now = 1_900;
        return json({ serverNow: 5_850, receivedAt: 5_050, rev: 2 });
      },
    });
    client.start();
    clock.now = 1_000;
    beat();
    await vi.waitFor(() => expect(client.getState().offsetMs).toBe(4_000));
    expect(client.serverNow()).toBe(5_900);
    expect(client.clockInfo()).toEqual({ offsetMs: 4_000, rttMs: 100 });
    client.stop();
  });

  it('sin `receivedAt` (servidor viejo), la mitad de la ida y vuelta', async () => {
    const { client, clock, beat } = rig();
    net = mockFetch({
      [STATUS]: () => {
        clock.now = 1_900;
        return json({ serverNow: 5_850, rev: 2 });
      },
    });
    client.start();
    clock.now = 1_000;
    beat();
    await vi.waitFor(() => expect(client.getState().offsetMs).toBe(4_400));
    client.stop();
  });

  it('un desfase nuevo cercano (y mejor) se acerca 10 ms por tic, sin saltos', async () => {
    const { client, clock, beat } = rig();
    /* La primera con 20 ms de retardo; la segunda, sin retardo y 100 ms más: gana la segunda. */
    let answer = () => {
      clock.now += 20;
      return { serverNow: 5_010, receivedAt: 5_010 };
    };
    net = mockFetch({ [STATUS]: () => json({ ...answer(), rev: 2 }) });
    client.start();
    beat();
    await vi.waitFor(() => expect(client.getState().offsetMs).toBe(4_000));
    clock.now = 2_000;
    answer = () => ({ serverNow: 6_100, receivedAt: 6_100 });
    beat();
    await vi.waitFor(() => expect(statusCalls()).toHaveLength(2));
    await vi.waitFor(() => expect(client.clockInfo().rttMs).toBe(0));
    expect(client.serverNow()).toBe(2_000 + 4_000);
    clock.now = 2_500;
    expect(client.serverNow()).toBe(2_500 + 4_010);
    clock.now = 4_000;
    expect(client.serverNow()).toBe(4_000 + 4_040);
    clock.now = 20_000;
    expect(client.serverNow()).toBe(20_000 + 4_100);
    client.stop();
  });

  it('las muestras caducan al minuto: una vieja con poco retardo ya no manda (y 1 s más, de golpe)', async () => {
    const { client, clock, beat } = rig();
    let answer: () => object = () => ({ serverNow: 5_000, receivedAt: 5_000 });
    net = mockFetch({ [STATUS]: () => json({ ...answer(), rev: 2 }) });
    client.start();
    beat();
    await vi.waitFor(() => expect(client.getState().offsetMs).toBe(4_000));
    /* 70 s después, una muestra lenta (200 ms) que dice 1 s más: la vieja ya no cuenta. */
    clock.now = 71_000;
    answer = () => {
      clock.now = 71_200;
      return { serverNow: 76_100, receivedAt: 76_100 };
    };
    beat();
    await vi.waitFor(() => expect(client.getState().offsetMs).toBe(5_000));
    client.stop();
  });

  it('ráfaga de 4 `status` cada 250 ms al entrar, al reabrir el SSE y al volver a la página', async () => {
    const { client, delays, runTimers, sources, page, setVisible } = rig();
    net = mockFetch({ [STATUS]: () => json({ serverNow: 5_000, receivedAt: 5_000, rev: 2 }) });
    client.start();
    expect(delays()).toEqual([0, 250, 500, 750]);
    runTimers();
    await vi.waitFor(() => expect(statusCalls()).toHaveLength(4));
    /* La primera apertura no es una reapertura. */
    sources[0]?.open();
    expect(delays()).toEqual([]);
    /* Oculta, nada; visible otra vez, otra ráfaga. */
    setVisible(false);
    page.dispatchEvent(new Event('visibilitychange'));
    expect(delays()).toEqual([]);
    setVisible(true);
    page.dispatchEvent(new Event('visibilitychange'));
    expect(delays()).toEqual([0, 250, 500, 750]);
    runTimers();
    await vi.waitFor(() => expect(statusCalls()).toHaveLength(8));
    client.stop();
    expect(delays()).toEqual([]);
  });
});

describe('«Ver juntos» 1.1.2: el aparato que duerme', () => {
  it('tras dormir 10 min (la hora monótona parada): desfase con lo dormido, «sin muestra» y SSE nuevo', async () => {
    const { client, clock, wall, sources, page, beat } = rig();
    net = mockFetch({ [STATUS]: () => json({ serverNow: clock.now + 4_000, rev: 2 }) });
    client.start();
    sources[0]?.open();
    beat();
    await vi.waitFor(() => expect(client.getState().offsetMs).toBe(4_000));
    expect(client.clockStale()).toBe(false);
    /* El iPhone se bloquea 10 minutos: `performance.now()` no avanza, `Date.now()` sí. */
    clock.now += 100;
    wall.now += 600_000;
    page.dispatchEvent(new Event('visibilitychange'));
    expect(client.clockStale()).toBe(true);
    expect(client.serverNow()).toBe(clock.now + 4_000 + 599_900);
    /* El SSE de antes (que iOS deja medio muerto) se cierra y se abre otro. */
    expect(sources).toHaveLength(2);
    expect(sources[0]?.closed).toBe(true);
    /* La primera ida y vuelta nueva lo arregla. */
    net.restore();
    net = mockFetch({ [STATUS]: () => json({ serverNow: clock.now + 604_000, rev: 2 }) });
    beat();
    await vi.waitFor(() => expect(client.clockStale()).toBe(false));
    expect(client.serverNow()).toBe(clock.now + 604_000);
    client.stop();
  });

  it('sin dormir, la hora del sistema que va a la par no cambia nada', () => {
    const { client, clock, wall, sources } = rig();
    client.start();
    clock.now += 30_000;
    wall.now += 30_200;
    expect(client.clockStale()).toBe(false);
    expect(sources).toHaveLength(1);
    client.stop();
  });
});

describe('«Ver juntos» 1.1.2: las órdenes', () => {
  it('la misma orden en 500 ms no sale dos veces; un salto al mismo sitio tampoco; `source` va en el cuerpo', async () => {
    const { client, clock } = rig();
    net = mockFetch({ [CONTROL]: () => json({ serverNow: 5_000, rev: 3 }) });
    const sent = () => net?.calls.filter((call) => call.url.endsWith('/control')) ?? [];
    await client.control({ action: 'play', positionS: 10 }, 'button');
    await client.control({ action: 'play', positionS: 10.2 }, 'surface');
    expect(sent()).toHaveLength(1);
    expect(sent()[0]?.body).toMatchObject({ action: 'play', positionS: 10, source: 'button' });
    await client.control({ action: 'seek', positionS: 100 }, 'bar');
    await client.control({ action: 'seek', positionS: 100.4 }, 'bar');
    expect(sent()).toHaveLength(2);
    await client.control({ action: 'seek', positionS: 130 }, 'bar');
    expect(sent()).toHaveLength(3);
    clock.now += 600;
    await client.control({ action: 'seek', positionS: 130 }, 'bar');
    expect(sent()).toHaveLength(4);
    /* Sin `source`, el cuerpo de siempre. */
    clock.now += 600;
    await client.control({ action: 'pause', positionS: 131 });
    expect(sent().at(-1)?.body).not.toHaveProperty('source');
    expect(client.getOrders().map((order) => order.result)).toEqual([
      'sent',
      'duplicate',
      'sent',
      'duplicate',
      'sent',
      'sent',
      'sent',
    ]);
  });
});

describe('«Ver juntos» 1.1.2: el SSE que se recupera', () => {
  it('pide el latido con nombre; `party.ping` no repinta nada', () => {
    const { client, sources } = rig();
    net = mockFetch({ [STATUS]: () => json({ serverNow: 5_000, rev: 2 }) });
    client.start();
    expect(sources[0]?.url).toContain('ping=1');
    const listener = vi.fn();
    client.subscribe(listener);
    sources[0]?.emit('party.ping', { serverNow: 5_000 });
    expect(listener).not.toHaveBeenCalled();
    client.stop();
  });

  it('25 s sin ninguna trama: se cierra y se abre otro; lo que llegue por el viejo no cuenta', () => {
    const { client, clock, sources, beat } = rig();
    net = mockFetch({ [STATUS]: () => json({ serverNow: 5_000, rev: 2 }) });
    client.start();
    sources[0]?.open();
    clock.now += 20_000;
    sources[0]?.emit('party.ping', { serverNow: 5_000 });
    clock.now += 20_000;
    beat();
    expect(sources).toHaveLength(1);
    clock.now += 6_000;
    beat();
    expect(sources).toHaveLength(2);
    expect(sources[0]?.closed).toBe(true);
    /* El viejo ya no toca la sala. */
    sources[0]?.emit('party.snapshot', { room: joined.room, chat: [], serverNow: 5_000 });
    expect(client.getState().room).toBeNull();
    client.stop();
    expect(sources[1]?.closed).toBe(true);
  });

  it('perdido del todo: espera 3 s, mira la sala y reabre; sin red, espera más (6 s)', async () => {
    const { client, sources, delays, runTimers } = rig();
    let down = true;
    net = mockFetch({
      [STATUS]: () => {
        if (down) throw new TypeError('Failed to fetch');
        return json({ serverNow: 5_000, rev: 2 });
      },
    });
    client.start();
    runTimers();
    sources[0]?.open();
    sources[0]?.fail();
    expect(client.getState().connection).toBe('reconnecting');
    expect(delays()).toEqual([3_000]);
    runTimers();
    await vi.waitFor(() => expect(delays()).toEqual([6_000]));
    expect(sources).toHaveLength(1);
    down = false;
    runTimers();
    await vi.waitFor(() => expect(sources).toHaveLength(2));
    /* Al abrirse, otra vez de 3 s. */
    sources[1]?.open();
    runTimers();
    sources[1]?.fail();
    expect(delays()).toEqual([3_000]);
    client.stop();
    expect(delays()).toEqual([]);
  });

  it('si la sala ya no existe, se cierra y no se reintenta', async () => {
    const { client, sources, delays, runTimers } = rig();
    net = mockFetch({
      [STATUS]: () =>
        json({ error: { code: 'party_not_found', message: 'No.', requestId: 'r1' } }, 404),
    });
    client.start();
    sources[0]?.fail();
    runTimers();
    await vi.waitFor(() => expect(client.getState().closed).toBe('gone'));
    expect(sources).toHaveLength(1);
    expect(delays()).toEqual([]);
  });

  it('un `status` que responde con el SSE perdido lo reabre al momento', async () => {
    const { client, sources, beat } = rig();
    net = mockFetch({ [STATUS]: () => json({ serverNow: 5_000, rev: 2 }) });
    client.start();
    sources[0]!.readyState = 2;
    beat();
    await vi.waitFor(() => expect(sources).toHaveLength(2));
    client.stop();
  });
});
