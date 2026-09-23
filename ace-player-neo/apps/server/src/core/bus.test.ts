import { describe, expect, it, vi } from 'vitest';
import { createDomainBus } from './bus.js';

const VERDICT = {
  jobId: null,
  hash: 'a'.repeat(40),
  state: 'working' as const,
  reason: 'playable_media',
  by: 'scanner' as const,
  checkedAt: '2026-01-01T00:00:00.000Z',
};

describe('bus de dominio', () => {
  it('entrega síncrona, en orden de suscripción y solo a los del tipo', () => {
    const bus = createDomainBus();
    const order: string[] = [];
    bus.on('scan.verdict', (payload) => order.push(`a:${payload.state}`));
    bus.on('scan.verdict', () => order.push('b'));
    bus.on('engine.status', () => order.push('motor'));
    bus.emit('scan.verdict', VERDICT);
    expect(order).toEqual(['a:working', 'b']);
    expect(bus.listenerCount('scan.verdict')).toBe(2);
  });

  it('on devuelve la baja y once se da de baja solo', () => {
    const bus = createDomainBus();
    const on = vi.fn();
    const once = vi.fn();
    const off = bus.on('state.changed', on);
    bus.once('state.changed', once);
    const payload = { scopes: ['library' as const], at: '2026-01-01T00:00:00.000Z' };
    bus.emit('state.changed', payload);
    off();
    bus.emit('state.changed', payload);
    expect(on).toHaveBeenCalledTimes(1);
    expect(once).toHaveBeenCalledTimes(1);
    expect(bus.listenerCount('state.changed')).toBe(0);
  });

  it('un suscriptor que falla no corta a los demás y queda en el log', () => {
    const logger = { error: vi.fn() };
    const bus = createDomainBus({ logger });
    const second = vi.fn();
    bus.on('scan.verdict', () => {
      throw new Error('fallo');
    });
    bus.on('scan.verdict', second);
    expect(() => bus.emit('scan.verdict', VERDICT)).not.toThrow();
    expect(second).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('darse de baja durante la entrega no cambia a quién le llega ese evento', () => {
    const bus = createDomainBus();
    const later = vi.fn();
    const offLater = bus.on('scan.verdict', () => offSecond());
    const offSecond = bus.on('scan.verdict', later);
    bus.emit('scan.verdict', VERDICT);
    expect(later).toHaveBeenCalledOnce();
    offLater();
    bus.clear();
    expect(bus.listenerCount('scan.verdict')).toBe(0);
    bus.emit('scan.verdict', VERDICT);
  });
});
