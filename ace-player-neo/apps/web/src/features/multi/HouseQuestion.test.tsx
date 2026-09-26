/* La hoja «¿Cambiar en los dos o solo aquí?» (docs/multidispositivo.md
   §2.4.2 y §2.5.1): los casos de la tabla, Escape = cancelar y los botones
   mandan la orden con `others`. */

import type { SessionSummary } from '@ace/shared';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  connectRuntime,
  play,
  resetPlayerApi,
  setHouseGate,
  type PlayCommand,
  type PlayerCommand,
} from '../../player/api.ts';
import { houseGate, houseQuestionStore, resetHouseGate } from './gate.ts';
import { HouseQuestion } from './HouseQuestion.tsx';
import { H1, H2, houseSession, iphone, me, resetHouse, seedHouse } from './test-utils.ts';

let commands: PlayerCommand[] = [];
const plays = () => commands.filter((c): c is PlayCommand => c.type === 'play');

beforeEach(() => {
  commands = [];
  resetPlayerApi();
  resetHouseGate();
  setHouseGate(houseGate);
  connectRuntime({ handle: (command) => commands.push(command) });
});

afterEach(() => {
  resetPlayerApi();
  resetHouse();
});

function ask(sessions: SessionSummary[]) {
  seedHouse({ sessions });
  render(<HouseQuestion />);
  act(() => {
    play({ hash: H2, title: 'Antena 3' });
  });
  return screen.getByRole('dialog');
}

describe('HouseQuestion (§2.5.1)', () => {
  it('un dispositivo, juntos: título, frase, aclaración y los tres botones', () => {
    const dialog = ask([houseSession(H1, [me(), iphone()])]);
    expect(dialog).toHaveAccessibleName('¿Cambiar en los dos o solo aquí?');
    expect(
      screen.getByText('En el iPhone también se está viendo DAZN LaLiga.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Tu Umbrel pone un canal a la vez para toda la casa: si cambias solo aquí, el iPhone deja de verlo.',
      ),
    ).toBeInTheDocument();
    for (const name of ['Cambiar en los dos', 'Solo aquí', 'Cancelar'])
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
  });

  it('dos o más: «en todos»', () => {
    ask([
      houseSession(H1, [
        iphone(),
        iphone({
          viewerId: 'v_tele',
          deviceId: 'web_tele',
          client: 'web',
          platform: 'web',
          deviceName: 'Navegador · Smart TV',
        }),
      ]),
    ]);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('¿Cambiar en todos o solo aquí?');
    expect(
      screen.getByText('En el iPhone y la tele se está viendo DAZN LaLiga.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cambiar en todos' })).toBeInTheDocument();
  });

  it('ninguno puede seguir (app 0.8.0): solo «Cambiar aquí» y «Cancelar»', () => {
    ask([houseSession(H1, [iphone({ follows: undefined })])]);
    expect(screen.getByRole('dialog')).toHaveAccessibleName('¿Cambiar solo aquí?');
    expect(screen.queryByRole('button', { name: 'Solo aquí' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar aquí' }));
    expect(plays()[0]?.options).toMatchObject({ others: 'stop' });
  });

  it('«Cambiar en los dos» manda others=move; el foco empieza en el principal', () => {
    ask([houseSession(H1, [me(), iphone()])]);
    expect(screen.getByRole('button', { name: 'Cambiar en los dos' })).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar en los dos' }));
    expect(plays()[0]?.options).toMatchObject({ others: 'move' });
    expect(houseQuestionStore.get()).toBeNull();
  });

  it('Escape = cancelar: no se manda nada', () => {
    const dialog = ask([houseSession(H1, [iphone()])]);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(houseQuestionStore.get()).toBeNull();
    expect(plays()).toEqual([]);
  });
});
