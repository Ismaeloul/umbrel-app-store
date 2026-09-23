import { describe, expect, it } from 'vitest';
import { derivePhase, isEngaged, nextState, TRANSITIONS, type ConnState } from './machine.ts';

describe('máquina de estados de la conexión', () => {
  it('el camino feliz: idle → pidiendo → conectando → precarga → arrancando → activa', () => {
    let state: ConnState = 'idle';
    for (const [event, expected] of [
      ['solicitar', 'pidiendo'],
      ['concedida', 'conectando'],
      ['motor-listo', 'precarga'],
      ['colchon-listo', 'arrancando'],
      ['primer-fotograma', 'activa'],
    ] as const) {
      const next = nextState(state, event);
      expect(next).toBe(expected);
      state = next!;
    }
  });

  it('HLS nativo se salta la precarga (el remux ya esperó en el servidor)', () => {
    expect(nextState('conectando', 'colchon-listo')).toBe('arrancando');
  });

  it('un fallo reconecta y la reconexión vuelve a pedir la URL', () => {
    for (const from of ['pidiendo', 'conectando', 'precarga', 'arrancando', 'activa'] as const) {
      expect(nextState(from, 'fallo')).toBe('reconectando');
      expect(nextState(from, 'agotado')).toBe('error');
    }
    expect(nextState('reconectando', 'reintentar')).toBe('pidiendo');
  });

  it('las transiciones que no están en la tabla se ignoran (respuestas tardías)', () => {
    expect(nextState('idle', 'primer-fotograma')).toBeNull();
    expect(nextState('error', 'concedida')).toBeNull();
    expect(nextState('reconectando', 'fallo')).toBeNull();
    // Sin URL aún no hay motor que cambiar.
    expect(nextState('pidiendo', 'reenganche')).toBeNull();
    expect(nextState('activa', 'reenganche')).toBe('conectando');
  });

  it('detener, traspasar y pedir otro canal valen desde cualquier estado', () => {
    for (const state of Object.keys(TRANSITIONS) as ConnState[]) {
      expect(nextState(state, 'detener')).toBe('idle');
      expect(nextState(state, 'solicitar')).toBe('pidiendo');
      if (state !== 'idle') expect(nextState(state, 'traspaso')).toBe('idle');
    }
  });

  it('fase pública: la conexión manda hasta el primer fotograma; después, el medio', () => {
    expect(derivePhase('idle', 'idle')).toBe('idle');
    expect(derivePhase('pidiendo', 'paused')).toBe('cargando');
    expect(derivePhase('precarga', 'paused')).toBe('cargando');
    expect(derivePhase('arrancando', 'starting')).toBe('cargando');
    expect(derivePhase('arrancando', 'blocked')).toBe('bloqueado');
    expect(derivePhase('activa', 'playing')).toBe('reproduciendo');
    expect(derivePhase('activa', 'buffering')).toBe('buffer');
    expect(derivePhase('activa', 'paused')).toBe('pausado');
    expect(derivePhase('activa', 'seeking')).toBe('buscando');
    expect(derivePhase('activa', 'blocked')).toBe('bloqueado');
    expect(derivePhase('reconectando', 'paused')).toBe('reconectando');
    expect(derivePhase('error', 'idle')).toBe('error');
  });

  it('«hay algo sonando o conectando» excluye reposo y error', () => {
    expect(isEngaged('idle')).toBe(false);
    expect(isEngaged('error')).toBe(false);
    expect(isEngaged('reconectando')).toBe(true);
    expect(isEngaged('activa')).toBe(true);
  });
});
