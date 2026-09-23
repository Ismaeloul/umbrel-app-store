import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notify, noticeFlags, setImmersive, setWatching } from './notify.ts';
import { clearStatus, setStatusBase, showStatus, statusStore, STATUS_MS } from './statusLine.ts';
import { StatusLineHost } from './StatusLineHost.tsx';
import { Toaster } from './Toaster.tsx';
import { dismissToast, FADE_MS, resetToasts, toast, toastStore, TOAST_MS } from './toasts.ts';

beforeEach(() => {
  vi.useFakeTimers();
  resetToasts();
  clearStatus();
  noticeFlags.set({ watching: false, immersive: false });
});
afterEach(() => {
  vi.useRealTimers();
});

const visible = () => toastStore.get().filter((t) => !t.leaving);

describe('toasts (inventario §10.1)', () => {
  it('duran 2,8 s y salen con un fundido de 320 ms', () => {
    toast('Hash copiado', { tone: 'ok' });
    vi.advanceTimersByTime(TOAST_MS - 1);
    expect(visible()).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(toastStore.get()[0]?.leaving).toBe(true);
    vi.advanceTimersByTime(FADE_MS);
    expect(toastStore.get()).toHaveLength(0);
  });

  it('nunca más de 2: el más viejo cede', () => {
    toast('Uno');
    toast('Dos');
    toast('Tres');
    expect(visible().map((t) => t.text)).toEqual(['Dos', 'Tres']);
  });

  it('un repetido no se apila: ×n y vuelve a contar', () => {
    toast('Hash copiado', { tone: 'ok' });
    vi.advanceTimersByTime(2000);
    toast('Hash copiado', { tone: 'ok' });
    expect(visible()).toHaveLength(1);
    expect(visible()[0]?.count).toBe(2);
    vi.advanceTimersByTime(2000);
    expect(visible()).toHaveLength(1);
  });

  it('la acción (Deshacer) cierra el toast', () => {
    const undo = vi.fn();
    const id = toast('«DAZN 1» eliminado', {
      tone: 'warn',
      ms: 6000,
      action: { label: 'Deshacer', onAction: undo },
    });
    toastStore.get()[0]?.action?.onAction();
    expect(undo).toHaveBeenCalledOnce();
    expect(toastStore.get().find((t) => t.id === id)?.leaving).toBe(true);
    dismissToast(id);
  });

  it('el contenedor es una región viva y se aparta con el vídeo a pantalla completa', () => {
    render(<Toaster bottomOffset="80px" />);
    act(() => {
      toast('Guardado', { tone: 'ok' });
    });
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Guardado')).toBeInTheDocument();
    act(() => setImmersive(true));
    expect(document.querySelector('.toaster')).toHaveAttribute('data-immersive', 'true');
  });

  it('el botón de la acción funciona desde el contenedor', () => {
    const undo = vi.fn();
    render(<Toaster />);
    act(() => {
      toast('Eliminado', { action: { label: 'Deshacer', onAction: undo } });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Deshacer' }));
    expect(undo).toHaveBeenCalledOnce();
  });
});

describe('línea de estado (inventario §9)', () => {
  it('una cosa a la vez, 4,5 s + fundido y vuelve el estado base', () => {
    setStatusBase({
      text: 'Fuente 1 verificada. Vas en directo.',
      signal: 'ok',
      meta: '6 s de retraso',
    });
    showStatus({ text: 'Reconectando…', tone: 'warn' });
    showStatus({ text: 'Fuente 2 floja', tone: 'warn' });
    expect(statusStore.get().message?.text).toBe('Fuente 2 floja');
    vi.advanceTimersByTime(STATUS_MS);
    expect(statusStore.get().message?.leaving).toBe(true);
    vi.advanceTimersByTime(FADE_MS);
    expect(statusStore.get().message).toBeNull();
    expect(statusStore.get().base?.text).toBe('Fuente 1 verificada. Vas en directo.');
  });

  it('un repetido suma ×n', () => {
    showStatus({ text: 'Rellenando el búfer', tone: 'warn' });
    showStatus({ text: 'Rellenando el búfer', tone: 'warn' });
    expect(statusStore.get().message?.count).toBe(2);
  });

  it('la región se lee sola (aria-live) y enseña el aviso encima del estado base', () => {
    render(<StatusLineHost />);
    act(() => setStatusBase({ text: 'Vas en directo.', tone: 'ok' }));
    expect(screen.getByRole('status')).toHaveTextContent('Vas en directo.');
    act(() => showStatus({ text: 'Probando la fuente 2', tone: 'info' }));
    expect(screen.getByRole('status')).toHaveTextContent('Probando la fuente 2');
    expect(screen.getByRole('status')).not.toHaveTextContent('Vas en directo.');
  });
});

describe('notify(): dónde va cada aviso (regla 7)', () => {
  it('lo de la señal va bajo el vídeo si se está viendo algo', () => {
    setWatching(true);
    expect(notify('Reconectando la fuente 1', { kind: 'signal', tone: 'warn' })).toBe('status');
    expect(statusStore.get().message?.text).toBe('Reconectando la fuente 1');
    expect(toastStore.get()).toHaveLength(0);
  });

  it('sin vídeo, lo mismo sale como toast', () => {
    expect(notify('Reconectando la fuente 1', { kind: 'signal' })).toBe('toast');
    expect(toastStore.get()).toHaveLength(1);
  });

  it('las acciones y lo que lleva botón siempre van a toast', () => {
    setWatching(true);
    expect(notify('«DAZN 1» guardado en favoritos', { tone: 'ok' })).toBe('toast');
    expect(
      notify('Fuente caída', { kind: 'signal', action: { label: 'Rebuscar', onAction: () => {} } }),
    ).toBe('toast');
  });
});
