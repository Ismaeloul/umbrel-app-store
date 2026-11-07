/* Entrar en una sala con el enlace (docs/ver-juntos.md §7 y §9): quién invita, el nombre con el
   cursor ya puesto si no hay uno guardado, «Entrar en la sala» y, en directo, el icono del
   partido en vez del hueco del cartel. */

import type { PartyPreview } from '@ace/shared';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import preview from '@fixtures/web/v1/partyPreview.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { saveName } from './client.ts';
import { Join } from './Join.tsx';
import { JUNTOS_TEXT } from './texts.ts';

const BASE = preview as PartyPreview;
const CODE = BASE.code;

let net: ReturnType<typeof mockFetch> | undefined;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  localStorage.clear();
});
afterEach(() => {
  net?.restore();
  net = undefined;
  resetMode();
  localStorage.clear();
});

function mount(over: Partial<PartyPreview> = {}, without: (keyof PartyPreview)[] = []) {
  const body: Partial<PartyPreview> = { ...BASE, ...over };
  for (const key of without) delete body[key];
  net = mockFetch({ [`GET /api/v1/party/${CODE}`]: () => json(body) });
  render(<Join code={CODE} onJoined={() => undefined} exitAction={null} />);
}

describe('entrar con el enlace', () => {
  it('«Isma te invita a ver» si la vista previa dice quién creó la sala', async () => {
    mount({ host: 'Isma' });
    expect(await screen.findByText('Isma te invita a ver')).toBeTruthy();
  });

  it('sin quién (un servidor anterior), el texto de siempre', async () => {
    mount({}, ['host']);
    expect(await screen.findByText(JUNTOS_TEXT.joinTitle)).toBeTruthy();
  });

  it('sin nombre guardado, el cursor ya está en el nombre; el botón es «Entrar en la sala»', async () => {
    mount();
    await screen.findByRole('heading', { level: 1, name: BASE.title.title });
    expect(document.activeElement).toBe(screen.getByLabelText(JUNTOS_TEXT.nameLabel));
    expect(screen.getByRole('button', { name: JUNTOS_TEXT.join })).toBeTruthy();
  });

  it('con un nombre guardado, no se roba el foco (se entra y ya)', async () => {
    saveName('Ana');
    mount();
    await screen.findByRole('heading', { level: 1, name: BASE.title.title });
    expect(document.activeElement).not.toBe(screen.getByLabelText(JUNTOS_TEXT.nameLabel));
    expect(screen.getByLabelText(JUNTOS_TEXT.nameLabel)).toHaveValue('Ana');
  });

  it('en directo, el icono del partido en vez del cartel', async () => {
    mount({ title: { ...BASE.title, kind: 'live', title: 'Málaga – Racing' } });
    await screen.findByRole('heading', { level: 1, name: 'Málaga – Racing' });
    expect(document.querySelector('.juntos-join__live')).toBeTruthy();
    expect(document.querySelector('img.juntos-join__poster')).toBeNull();
  });
});
