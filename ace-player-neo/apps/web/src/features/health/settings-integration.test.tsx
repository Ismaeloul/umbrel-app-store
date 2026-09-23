/* Salud y Dispositivos dentro de Ajustes (el contrato de
   src/features/settings/external.tsx): Ajustes encuentra solas las dos
   secciones, las pone en su índice y el indicador del motor («ajustes/salud»)
   lleva a la de salud. */

import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { fixture, mockFetch } from '../../test/fetch.ts';
import { externalSection } from '../settings/external.tsx';
import SettingsView from '../settings/SettingsView.tsx';
import { renderSection } from './test-utils.tsx';

let net: ReturnType<typeof mockFetch>;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  net = mockFetch({
    'GET /api/v1/directories': {
      web: [],
      webSyncedAt: null,
      webSources: [],
      activeWebSourceId: null,
    },
    'GET /api/v1/settings': { settings: { sameChannelPolicy: 'share' }, source: 'saved' },
    'GET /api/v1/preferences': fixture('preferencesGet'),
    'GET /api/v1/engine/status': fixture('engineStatus'),
    'GET /api/v1/bootstrap': fixture('bootstrap'),
    'GET /api/v1/health': fixture('health'),
    'GET /api/v1/diagnostics': fixture('diagnosticsList'),
    'GET /api/v1/devices': fixture('devicesList'),
  });
});
afterEach(() => {
  net.restore();
  resetToasts();
  resetMode();
});

describe('Ajustes con Salud y Dispositivos', () => {
  it('las dos secciones existen y salen en el índice de Ajustes', async () => {
    expect(externalSection('salud')).not.toBeNull();
    expect(externalSection('dispositivos')).not.toBeNull();
    renderSection(
      <SettingsView route={{ vista: 'ajustes', seccion: null }} active />,
      '?vista=ajustes',
    );
    const index = screen.getByRole('navigation', { name: 'Secciones de Ajustes' });
    const names = within(index)
      .getAllByRole('link')
      .map((a) => a.textContent);
    expect(names).toEqual(expect.arrayContaining(['Dispositivos', 'Salud']));
    expect(
      await screen.findByRole('heading', { name: 'Salud del sistema', level: 2 }),
    ).toBeInTheDocument();
    expect(await screen.findByText('Todo funciona.')).toBeInTheDocument();
    expect(
      await screen.findByRole('button', { name: 'Emparejar un dispositivo' }),
    ).toBeInTheDocument();
  });

  it('«ajustes/salud» (el indicador del motor) lleva a Salud', async () => {
    renderSection(
      <SettingsView route={{ vista: 'ajustes', seccion: 'salud' }} active />,
      '?vista=ajustes/salud',
    );
    const index = screen.getByRole('navigation', { name: 'Secciones de Ajustes' });
    expect(within(index).getByRole('link', { name: 'Salud' })).toHaveAttribute(
      'aria-current',
      'location',
    );
    await waitFor(() => expect(Element.prototype.scrollIntoView).toHaveBeenCalled());
  });
});
