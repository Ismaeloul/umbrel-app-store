/* Avisos («Te aviso»): guardar y quitar, cuándo toca avisar y cómo (una
   notificación con permiso; si no, un toast con la app abierta). */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMemoryStorage } from '../../lib/storage.ts';
import { toastStore } from '../../notices/toasts.ts';
import {
  addAviso,
  AVISO_LEAD_MS,
  AVISOS_KEY,
  avisoWhen,
  dueAvisos,
  getAvisos,
  pruneAvisos,
  removeAviso,
  resetAvisos,
  useAvisosClock,
  type Aviso,
} from './store.ts';

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 31, 18, 0);

function aviso(id: string, startIn: number, patch: Partial<Aviso> = {}): Aviso {
  return {
    id,
    title: `Programa ${id}`,
    channel: 'M+ LaLiga',
    start: NOW + startIn,
    end: NOW + startIn + 60 * MINUTE,
    ...patch,
  };
}

const realNotification = globalThis.Notification;

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  try {
    localStorage.clear();
  } catch {}
  resetMemoryStorage();
  resetAvisos();
});
afterEach(() => {
  resetAvisos();
  vi.useRealTimers();
  Object.defineProperty(globalThis, 'Notification', {
    configurable: true,
    writable: true,
    value: realNotification,
  });
});

describe('avisos', () => {
  it('se guardan en este navegador, sin repetir el mismo programa, y se quitan', () => {
    addAviso(aviso('a', 30 * MINUTE));
    addAviso(aviso('b', 10 * MINUTE));
    addAviso(aviso('a', 30 * MINUTE));
    expect(getAvisos().map((item) => item.id)).toEqual(['b', 'a']);
    expect(JSON.parse(localStorage.getItem(AVISOS_KEY) ?? '[]')).toHaveLength(2);
    removeAviso('b');
    expect(getAvisos().map((item) => item.id)).toEqual(['a']);
  });

  it('lo ya terminado se tira; toca avisar 5 min antes y hasta un minuto después de empezar', () => {
    const list = [
      aviso('fin', -120 * MINUTE),
      aviso('ya', 4 * MINUTE),
      aviso('luego', 20 * MINUTE),
      aviso('hecho', 3 * MINUTE, { fired: true }),
    ];
    expect(pruneAvisos(list, NOW).map((item) => item.id)).toEqual(['hecho', 'ya', 'luego']);
    expect(dueAvisos(list, NOW).map((item) => item.id)).toEqual(['ya']);
    expect(AVISO_LEAD_MS).toBe(5 * MINUTE);
    expect(avisoWhen(NOW + 5 * MINUTE, NOW)).toBe('Empieza en 5 min');
  });

  it('sin permiso de notificaciones, el aviso es un toast a su hora (con la app abierta)', () => {
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const clock = renderHook(() => useAvisosClock());
    act(() => addAviso(aviso('a', 20 * MINUTE)));
    act(() => void vi.advanceTimersByTime(14 * MINUTE));
    expect(toastStore.get().some((item) => item.text.includes('Programa a'))).toBe(false);
    act(() => void vi.advanceTimersByTime(MINUTE + 1000));
    expect(toastStore.get().some((item) => item.text.includes('Programa a'))).toBe(true);
    expect(getAvisos()[0]?.fired).toBe(true);
    clock.unmount();
  });

  it('con permiso, una notificación del navegador', () => {
    const shown: { title: string; body?: string }[] = [];
    class FakeNotification {
      static permission = 'granted';
      onclick: (() => void) | null = null;
      constructor(title: string, options?: { body?: string }) {
        shown.push({ title, ...(options?.body ? { body: options.body } : {}) });
      }
      close() {}
    }
    Object.defineProperty(globalThis, 'Notification', {
      configurable: true,
      writable: true,
      value: FakeNotification,
    });
    const clock = renderHook(() => useAvisosClock());
    act(() => addAviso(aviso('a', 6 * MINUTE)));
    act(() => void vi.advanceTimersByTime(MINUTE + 1000));
    expect(shown).toEqual([
      { title: 'Programa a', body: expect.stringMatching(/^Empieza en 5 min · M\+ LaLiga · /) },
    ]);
    clock.unmount();
  });
});
