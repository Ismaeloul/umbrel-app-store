/* Página de invitado de «Ver juntos» (docs/ver-juntos.md §9): el código sale
   de /s/<código>; sin código válido, el aviso; con él, la entrada de la sala. */

import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import preview from '@fixtures/web/v1/partyPreview.json';
import { resetMode, setMode } from '../api/mode.ts';
import { json, mockFetch } from '../test/fetch.ts';
import { saveCredential } from '../features/juntos/client.ts';
import { codeFromPath, GuestApp } from './App.tsx';

/* La sala de verdad abre el SSE y el vídeo: aquí solo importa con qué se monta. */
const roomProps = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock('../features/juntos/Room.tsx', () => ({
  Room: (props: Record<string, unknown>) => {
    roomProps.push(props);
    return null;
  },
}));

let net: ReturnType<typeof mockFetch> | undefined;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  net = undefined;
  resetMode();
  localStorage.clear();
});

describe('página de invitado', () => {
  it('el código sale de /s/<código> (con o sin barra final) y nada más', () => {
    expect(codeFromPath('/s/k3J9xQ2mZpL8wR4t')).toBe('k3J9xQ2mZpL8wR4t');
    expect(codeFromPath('/s/k3J9xQ2mZpL8wR4t/')).toBe('k3J9xQ2mZpL8wR4t');
    expect(codeFromPath('/s/corto')).toBeNull();
    expect(codeFromPath('/')).toBeNull();
    expect(codeFromPath('/s/k3J9xQ2mZpL8wR4t/otra')).toBeNull();
  });

  it('un enlace sin sala dice que no vale', () => {
    render(<GuestApp pathname="/s/nada" />);
    expect(screen.getByText('Este enlace no es de ninguna sala')).toBeInTheDocument();
  });

  it('con el enlace de una sala: qué se va a ver, quién está y el nombre, sin salir a la casa', async () => {
    net = mockFetch({ 'GET /api/v1/party/k3J9xQ2mZpL8wR4t': () => json(preview) });
    render(<GuestApp pathname="/s/k3J9xQ2mZpL8wR4t" />);
    expect(await screen.findByRole('heading', { name: 'Dune: Parte Dos' })).toBeInTheDocument();
    expect(screen.getByText('Ya están: Isma.')).toBeInTheDocument();
    expect(screen.getByLabelText('Tu nombre')).toBeInTheDocument();
    expect(screen.queryByText('Volver a Películas y series')).toBeNull();
    /* Ninguna petición a la casa: solo la de la sala. */
    expect(net.calls.map((call) => call.url)).toEqual(['/api/v1/party/k3J9xQ2mZpL8wR4t']);
  });

  it('ya dentro, la sala del invitado pide las dos calidades (`guest`, docs/ver-juntos.md §17)', () => {
    saveCredential('k3J9xQ2mZpL8wR4t', { id: 'm_AnaInvitada01', token: 'm_AnaInvitada01.secreto' });
    render(<GuestApp pathname="/s/k3J9xQ2mZpL8wR4t" />);
    expect(roomProps.at(-1)).toMatchObject({ code: 'k3J9xQ2mZpL8wR4t', guest: true });
  });
});
