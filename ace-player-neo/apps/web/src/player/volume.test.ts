import { afterEach, describe, expect, it, vi } from 'vitest';
import { readItem, resetMemoryStorage, STORAGE_KEYS, writeItem } from '../lib/storage.ts';
import {
  applySavedVolume,
  clampVolume,
  readSavedVolume,
  saveVolume,
  volumeForKey,
  volumeText,
  WHEEL_IDLE,
  WHEEL_STEP_MS,
  wheelStep,
  type WheelState,
} from './volume.ts';

afterEach(() => {
  localStorage.removeItem(STORAGE_KEYS.volume);
  resetMemoryStorage();
  vi.restoreAllMocks();
});

describe('volumen: las cuentas', () => {
  it('entre 0 y 1, sin colas de coma flotante', () => {
    expect(clampVolume(0.1 + 0.2)).toBe(0.3);
    expect(clampVolume(-1)).toBe(0);
    expect(clampVolume(7)).toBe(1);
    expect(clampVolume(Number.NaN)).toBe(0);
  });

  it('«NN %» para el lector de pantalla', () => {
    expect(volumeText(0.4)).toBe('40 %');
    expect(volumeText(0)).toBe('0 %');
    expect(volumeText(1)).toBe('100 %');
  });

  it('↑ → suben un 5 %, ↓ ← bajan, Re Pág / Av Pág un 10 %, Inicio y Fin a los extremos', () => {
    expect(volumeForKey('ArrowUp', 0.4)).toBe(0.45);
    expect(volumeForKey('ArrowRight', 0.4)).toBe(0.45);
    expect(volumeForKey('ArrowDown', 0.4)).toBe(0.35);
    expect(volumeForKey('ArrowLeft', 0.02)).toBe(0);
    expect(volumeForKey('PageUp', 0.95)).toBe(1);
    expect(volumeForKey('PageDown', 0.5)).toBe(0.4);
    expect(volumeForKey('Home', 0.5)).toBe(0);
    expect(volumeForKey('End', 0.5)).toBe(1);
    expect(volumeForKey('m', 0.5)).toBeNull();
  });

  it('la rueda de siempre: un paso por clic (~100 px), arriba sube y abajo baja; sin movimiento, nada', () => {
    expect(wheelStep(WHEEL_IDLE, -100, 0, 1_000).step).toBe(1);
    expect(wheelStep(WHEEL_IDLE, 120, 0, 1_000).step).toBe(-1);
    expect(wheelStep(WHEEL_IDLE, -3, 1, 1_000).step).toBe(1);
    expect(wheelStep(WHEEL_IDLE, 0, 0, 1_000)).toEqual({ step: 0, state: WHEEL_IDLE });
  });

  it('un trackpad: un gesto de muchos eventos pequeños suma, no da un paso por evento', () => {
    let state: WheelState = WHEEL_IDLE;
    let steps = 0;
    /* 60 eventos de 4 px en un segundo (y la inercia): 240 px, dos pasos y pico. */
    for (let i = 0; i < 60; i += 1) {
      const out = wheelStep(state, -4, 0, 1_000 + i * 16);
      state = out.state;
      steps += out.step;
    }
    expect(steps).toBe(2);
    /* Cambiar de sentido empieza de cero. */
    const back = wheelStep({ rest: -90, at: 0 }, 20, 0, 10_000);
    expect(back).toEqual({ step: 0, state: { rest: 20, at: 0 } });
  });

  it('como mucho un paso cada WHEEL_STEP_MS, aunque llegue una ráfaga grande', () => {
    const first = wheelStep(WHEEL_IDLE, -100, 0, 1_000);
    expect(first.step).toBe(1);
    expect(wheelStep(first.state, -100, 0, 1_000 + WHEEL_STEP_MS - 1).step).toBe(0);
    expect(wheelStep(first.state, -100, 0, 1_000 + WHEEL_STEP_MS).step).toBe(1);
  });
});

describe('volumen: lo que recuerda este navegador', () => {
  it('guarda el nivel y lo devuelve', () => {
    expect(readSavedVolume()).toBeNull();
    saveVolume(0.35);
    expect(readItem(STORAGE_KEYS.volume)).toBe('0.35');
    expect(readSavedVolume()).toBe(0.35);
  });

  it('un 0 no se guarda (eso es silenciar): se queda el último que sonaba', () => {
    saveVolume(0.6);
    saveVolume(0);
    expect(readSavedVolume()).toBe(0.6);
  });

  it('lo guardado que no vale se ignora', () => {
    writeItem(STORAGE_KEYS.volume, 'mucho');
    expect(readSavedVolume()).toBeNull();
    writeItem(STORAGE_KEYS.volume, '3');
    expect(readSavedVolume()).toBeNull();
  });

  it('si el navegador no deja guardar (ventana privada), sigue en memoria sin romperse', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cuota', 'QuotaExceededError');
    });
    expect(() => saveVolume(0.7)).not.toThrow();
    expect(readSavedVolume()).toBe(0.7);
  });

  it('lo pone en el <video> si lo hay', () => {
    const video = document.createElement('video');
    expect(applySavedVolume(video)).toBe(false);
    expect(video.volume).toBe(1);
    saveVolume(0.25);
    expect(applySavedVolume(video)).toBe(true);
    expect(video.volume).toBe(0.25);
  });
});
