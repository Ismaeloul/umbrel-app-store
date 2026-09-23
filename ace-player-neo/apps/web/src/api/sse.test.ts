import { SSE_EVENT_TYPES } from '@ace/shared';
import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fixture } from '../test/fetch.ts';
import { getViewerId, resetIdentity } from './identity.ts';
import { routeKey } from './query.ts';
import { realtimeStore } from './realtime-store.ts';
import { onSseEvent, SSE_TYPES, startRealtime } from './sse.ts';

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  private listeners = new Map<string, Set<(event: MessageEvent) => void>>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }
  close() {
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  emit(type: string, data: unknown, id = '1') {
    const event = new MessageEvent(type, {
      data: typeof data === 'string' ? data : JSON.stringify(data),
      lastEventId: id,
    });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0;
    this.onerror?.(new Event('error'));
  }
}

const ES = FakeEventSource as unknown as typeof EventSource;
let client: QueryClient;
let stop: () => void = () => {};

beforeEach(() => {
  FakeEventSource.instances = [];
  resetIdentity();
  client = new QueryClient();
});
afterEach(() => {
  stop();
  vi.useRealTimers();
  client.clear();
});

const last = () => FakeEventSource.instances.at(-1) as FakeEventSource;

describe('SSE', () => {
  it('los tipos coinciden con los de @ace/shared', () => {
    expect([...SSE_TYPES].sort()).toEqual([...SSE_EVENT_TYPES].sort());
  });

  it('conecta con el id del dispositivo y pasa a «open»', () => {
    stop = startRealtime({ client, EventSourceImpl: ES });
    expect(last().url).toMatch(/^\/api\/v1\/events\?device=web_/);
    expect(realtimeStore.get().status).toBe('connecting');
    last().open();
    expect(realtimeStore.get().status).toBe('open');
  });

  it('engine.status actualiza la consulta del motor y avisa a los oyentes', () => {
    stop = startRealtime({ client, EventSourceImpl: ES });
    last().open();
    const heard = vi.fn();
    const off = onSseEvent('engine.status', heard);
    const data = {
      ...fixture<Record<string, unknown>>('engineStatus'),
      status: 'offline',
      online: false,
    };
    last().emit('engine.status', data, '42');
    expect(client.getQueryData(routeKey('engineStatus'))).toMatchObject({ status: 'offline' });
    expect(heard).toHaveBeenCalledWith(expect.objectContaining({ status: 'offline' }), {
      id: '42',
      synthetic: false,
    });
    expect(realtimeStore.get().lastEventId).toBe('42');
    off();
  });

  it('state.changed invalida las rutas de sus ámbitos', () => {
    stop = startRealtime({ client, EventSourceImpl: ES });
    last().open();
    client.setQueryData(routeKey('libraryGet'), fixture('libraryGet'));
    client.setQueryData(routeKey('settingsGet'), fixture('settingsGet'));
    last().emit('state.changed', { scopes: ['library'], at: '2026-09-23T18:30:00.000Z' });
    expect(client.getQueryState(routeKey('libraryGet'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(routeKey('settingsGet'))?.isInvalidated).toBe(false);
  });

  it('playback.sessions cambia las sesiones del estado de reproducción sin tocar el mando', () => {
    stop = startRealtime({ client, EventSourceImpl: ES });
    last().open();
    const status = fixture<{ nowPlaying: unknown; sessions: unknown[] }>('playbackStatus');
    client.setQueryData(routeKey('playbackStatus'), status);
    last().emit('playback.sessions', { sessions: [] });
    expect(client.getQueryData(routeKey('playbackStatus'))).toEqual({ ...status, sessions: [] });
  });

  it('los eventos dirigidos solo llegan si son de un visor de esta pestaña', () => {
    stop = startRealtime({ client, EventSourceImpl: ES });
    last().open();
    const heard = vi.fn();
    const off = onSseEvent('stream.closed', heard);
    const base = { sessionId: 's_Q2FuYWxEZVBydWViYQ', reason: 'handoff' };
    last().emit('stream.closed', { ...base, viewerIds: ['otro_visor'] });
    expect(heard).not.toHaveBeenCalled();
    last().emit('stream.closed', { ...base, viewerIds: [getViewerId()] });
    expect(heard).toHaveBeenCalledOnce();
    off();
  });

  it('en desarrollo avisa de un evento que no cumple el esquema', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    stop = startRealtime({ client, EventSourceImpl: ES });
    last().open();
    last().emit('resync', { reason: 'porque_si' });
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
  });

  it('si no conecta en 10 s, respaldo: sondea el mando cada 5 s y avisa si cambia', async () => {
    vi.useFakeTimers();
    const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue();
    const heard = vi.fn();
    const off = onSseEvent('playback.nowPlaying', heard);
    const status = fixture<{ nowPlaying: unknown; learningCount: number }>('playbackStatus');
    client.setQueryData(routeKey('playbackStatus'), status);
    stop = startRealtime({ client, EventSourceImpl: ES });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(realtimeStore.get().status).toBe('fallback');
    expect(refetch).toHaveBeenCalledWith({ queryKey: ['v1', 'playbackStatus'], type: 'active' });
    // Otro dispositivo se queda el mando: llega como un playback.nowPlaying «sintético».
    client.setQueryData(routeKey('playbackStatus'), { ...status, nowPlaying: null });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(heard).toHaveBeenCalledWith(
      { nowPlaying: null, learningCount: status.learningCount },
      { id: null, synthetic: true },
    );
    // Cuando el SSE vuelve, se deja de sondear.
    last().open();
    expect(realtimeStore.get().status).toBe('open');
    const calls = refetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(refetch.mock.calls.length).toBe(calls);
    off();
  });

  it('si el servidor cierra del todo, reabre con espera y con lastEventId', async () => {
    vi.useFakeTimers();
    stop = startRealtime({ client, EventSourceImpl: ES });
    last().open();
    last().emit('resync', { reason: 'server_restart' }, '77');
    last().fail(true);
    expect(FakeEventSource.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(last().url).toContain('lastEventId=77');
  });

  it('parar cierra la conexión', () => {
    const stopNow = startRealtime({ client, EventSourceImpl: ES });
    const source = last();
    stopNow();
    expect(source.readyState).toBe(2);
    expect(realtimeStore.get().status).toBe('idle');
  });
});
