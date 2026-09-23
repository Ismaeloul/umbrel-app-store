import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { fixture, json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { agendaUi, resetAgendaUi } from '../agenda/state.ts';
import { renderWithApp } from '../agenda/test-utils.tsx';
import { PreferencesSheet } from './PreferencesSheet.tsx';

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  resetAgendaUi();
  resetToasts();
});
afterEach(() => {
  net?.restore();
  resetMode();
  resetToasts();
});

function setup(put: (call: MockCall) => Response = (call) => json({ preferences: call.body })) {
  net = mockFetch({
    'GET /api/v1/preferences': fixture('preferencesGet'),
    'PUT /api/v1/preferences': put,
  });
  const onClose = vi.fn();
  const utils = renderWithApp(<PreferencesSheet open onClose={onClose} />);
  return { ...utils, onClose };
}

describe('hoja «Tu agenda»', () => {
  it('parte de lo guardado, conmuta chips con aria-pressed, añade con Intro y guarda entero', async () => {
    const { onClose } = setup();
    const dialog = await screen.findByRole('dialog', { name: '¿Qué fútbol te mueve?' });
    // El ejemplo trae LaLiga, Champions, Real Madrid y España.
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'LaLiga' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(within(dialog).getByRole('button', { name: 'Real Madrid' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(within(dialog).getByRole('button', { name: /España/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Inter' }));
    expect(within(dialog).getByRole('button', { name: 'Inter' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'Champions League' }));

    const input = within(dialog).getByLabelText('Añadir otro equipo');
    fireEvent.change(input, { target: { value: 'Getafe' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(within(dialog).getByRole('button', { name: 'Getafe' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(input).toHaveValue('');

    const country = within(dialog).getByLabelText('Añadir otro país');
    fireEvent.change(country, { target: { value: 'Japón' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Añadir país' }));
    expect(within(dialog).getByRole('button', { name: /Japón/ })).toHaveTextContent('🌍');

    expect(within(dialog).getByText(/se comparten entre tus dispositivos/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar y ver mi agenda' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const put = net.calls.find((call) => call.method === 'PUT');
    expect(put?.body).toEqual({
      onboardingComplete: true,
      country: 'Spain',
      leagues: ['LaLiga'],
      teams: ['Real Madrid', 'Inter', 'Getafe'],
      nationalities: ['España', 'Japón'],
    });
    expect(toastStore.get().map((t) => t.text)).toContain('Tu agenda ya está personalizada');
    // Guardar cuenta como tocar el conmutador: la agenda pasa a «Para ti».
    expect(agendaUi.get().mode).toBe('forYou');
  });

  it('guardar sin nada: «Puedes personalizar tu agenda cuando quieras» y «Todos»', async () => {
    const { onClose } = setup();
    const dialog = await screen.findByRole('dialog');
    await waitFor(() =>
      expect(within(dialog).getByRole('button', { name: 'LaLiga' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    for (const name of ['LaLiga', 'Champions League', 'Real Madrid']) {
      fireEvent.click(within(dialog).getByRole('button', { name }));
    }
    fireEvent.click(within(dialog).getByRole('button', { name: /España/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar y ver mi agenda' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastStore.get().map((t) => t.text)).toContain(
      'Puedes personalizar tu agenda cuando quieras',
    );
    expect(agendaUi.get().mode).toBe('all');
  });

  it('si guardar falla, lo dice y nada queda bloqueado (regla 35)', async () => {
    const { onClose } = setup(() =>
      json({ error: { code: 'internal_error', message: 'Fallo', requestId: 'r' } }, 500),
    );
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar y ver mi agenda' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'No pudimos guardar tus gustos. Puedes cerrar y reintentarlo luego.',
    );
    expect(onClose).not.toHaveBeenCalled();
    const cancel = within(dialog).getByRole('button', { name: 'Cancelar' });
    expect(cancel).toBeEnabled();
    fireEvent.click(cancel);
    expect(onClose).toHaveBeenCalled();
  });

  it('en la demo avisa de que se guarda solo en este navegador', async () => {
    resetMode();
    setMode('demo', 'param');
    setup();
    expect(
      await screen.findByText('En la demo se guardan únicamente en este navegador.'),
    ).toBeInTheDocument();
  });
});
