import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  readItem,
  readJson,
  removeItem,
  resetMemoryStorage,
  writeItem,
  writeJson,
} from './storage.ts';

afterEach(() => {
  resetMemoryStorage();
  vi.restoreAllMocks();
});

describe('storage', () => {
  it('guarda y lee en localStorage', () => {
    expect(writeItem('aceneo-x', '1')).toBe(true);
    expect(localStorage.getItem('aceneo-x')).toBe('1');
    expect(readItem('aceneo-x')).toBe('1');
    removeItem('aceneo-x');
    expect(readItem('aceneo-x')).toBeNull();
  });

  it('si el navegador lanza (ventana privada), sigue con la memoria', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('cuota', 'QuotaExceededError');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('bloqueado', 'SecurityError');
    });
    expect(writeItem('aceneo-tema', 'oscuro')).toBe(false);
    expect(readItem('aceneo-tema')).toBe('oscuro');
  });

  it('JSON con validación: lo que no pasa se ignora', () => {
    writeJson('aceneo-demo', { version: 1 });
    const isV1 = (value: unknown): value is { version: 1 } =>
      typeof value === 'object' && value !== null && (value as { version?: unknown }).version === 1;
    expect(readJson('aceneo-demo', isV1)).toEqual({ version: 1 });
    writeItem('aceneo-demo', '{roto');
    expect(readJson('aceneo-demo', isV1)).toBeNull();
    writeJson('aceneo-demo', { version: 2 });
    expect(readJson('aceneo-demo', isV1)).toBeNull();
  });

  it('sessionStorage por separado', () => {
    writeItem('k', 'sesion', 'session');
    expect(readItem('k', 'session')).toBe('sesion');
    expect(readItem('k')).toBeNull();
  });
});
