import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { acestreamLink, copyAcestreamLink, copyHash, copyText } from './clipboard.ts';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function setSecure(secure: boolean, writeText?: (text: string) => Promise<void>) {
  Object.defineProperty(globalThis, 'isSecureContext', { configurable: true, value: secure });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: writeText ? { writeText } : undefined,
  });
}

function stubExecCommand(result: boolean) {
  const exec = vi.fn(() => result);
  Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
  return exec;
}

afterEach(() => {
  resetToasts();
  setSecure(false);
});

describe('copiar (regla 34: también por HTTP)', () => {
  it('en contexto seguro usa navigator.clipboard', async () => {
    const writeText = vi.fn(async () => {});
    setSecure(true, writeText);
    const exec = stubExecCommand(true);
    await expect(copyText('hola')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('hola');
    expect(exec).not.toHaveBeenCalled();
  });

  it('por HTTP recurre a execCommand con un textarea que luego quita', async () => {
    setSecure(false);
    const exec = stubExecCommand(true);
    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    await expect(copyText('texto')).resolves.toBe(true);
    expect(exec).toHaveBeenCalledWith('copy');
    expect(document.querySelector('textarea')).toBeNull();
    // El foco vuelve a donde estaba.
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it('si el portapapeles moderno falla, prueba el antiguo', async () => {
    setSecure(true, async () => {
      throw new Error('sin permiso');
    });
    const exec = stubExecCommand(false);
    await expect(copyText('x')).resolves.toBe(false);
    expect(exec).toHaveBeenCalled();
  });

  it('avisos de la 0.6.59 al copiar hash y enlace', async () => {
    setSecure(false);
    stubExecCommand(true);
    await copyHash(`acestream://${HASH.toUpperCase()}`);
    expect(toastStore.get().at(-1)?.text).toBe('Hash copiado');
    await copyHash('no es un hash');
    expect(toastStore.get().at(-1)?.text).toBe('No hay un hash válido para copiar');
    await copyAcestreamLink(HASH);
    expect(toastStore.get().at(-1)?.text).toBe('Enlace acestream:// copiado');
    stubExecCommand(false);
    await copyAcestreamLink(HASH);
    expect(toastStore.get().at(-1)?.text).toBe('No se pudo copiar');
    expect(acestreamLink(HASH)).toBe(`acestream://${HASH}`);
  });
});
