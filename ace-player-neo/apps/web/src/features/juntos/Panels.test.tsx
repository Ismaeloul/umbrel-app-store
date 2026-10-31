/* Lo de la sala que viene de Rave (docs/ver-juntos.md §11 y §13): quién
   controla (líder, co-líderes, todos), «está escribiendo» por el SSE,
   Siguiente con sus votos, el menú del líder sobre cada persona, la nota
   de los invitados y «Esperando a todos». Con la sala de ejemplo de
   partyJoin. Las reacciones ya no existen. */

import type { PartyMember, PartyRoom } from '@ace/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { canControl, controllers, PartyClient, roleOf, type PartyEnv } from './client.ts';
import { Lobby, NextPanel, People } from './Panels.tsx';

const HOST = 'm_IsmaAnfitrion';
const ANA = 'm_AnaInvitada01';
const BEA = 'm_BeaCoLider001';
const BASE = joined.room as PartyRoom;
const ana = BASE.members.find((m) => m.id === ANA) as PartyMember;
const bea: PartyMember = { ...ana, id: BEA, name: 'Bea', role: 'coleader' };

const room = (over: Partial<PartyRoom> = {}): PartyRoom => ({
  ...BASE,
  members: [...BASE.members, bea],
  playback: { ...BASE.playback, lobby: false },
  ...over,
});
const settings = (over: Partial<PartyRoom['settings']>): PartyRoom['settings'] => ({
  ...BASE.settings,
  ...over,
});

let net: ReturnType<typeof mockFetch> | undefined;

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
});
afterEach(() => {
  net?.restore();
  net = undefined;
  resetMode();
});

/** Un EventSource falso al que se le pueden mandar eventos. */
class FakeSource extends EventTarget {
  readyState = 1;
  close(): void {
    this.readyState = 2;
  }
  emit(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

function client(selfId = ANA, clock = { now: 1_000 }) {
  const source = new FakeSource();
  const env: PartyEnv = {
    now: () => clock.now,
    eventSource: () => source as unknown as EventSource,
    setInterval: () => 0,
    clearInterval: () => undefined,
  };
  const created = new PartyClient(
    BASE.code,
    { id: selfId, token: `${selfId}.secreto0123456789abcdef` },
    env,
  );
  return { client: created, source, clock };
}

describe('«Ver juntos»: quién controla (§13)', () => {
  it('el líder y los co-líderes; con «Solo yo», solo el líder; con «Todos», cualquiera', () => {
    expect(roleOf(room(), HOST)).toBe('leader');
    expect(roleOf(room(), BEA)).toBe('coleader');
    expect(roleOf(room(), ANA)).toBe('guest');
    expect(canControl(room(), HOST)).toBe(true);
    expect(canControl(room(), BEA)).toBe(true);
    expect(canControl(room(), ANA)).toBe(false);
    expect(controllers(room())).toEqual(['Isma', 'Bea']);
    const solo = room({ settings: settings({ coleaders: false }) });
    expect(canControl(solo, BEA)).toBe(false);
    expect(controllers(solo)).toEqual(['Isma']);
    const all = room({ settings: settings({ control: 'everyone' }) });
    expect(canControl(all, ANA)).toBe(true);
    expect(controllers(all)).toBeNull();
    expect(canControl(null, HOST)).toBe(false);
  });
});

describe('«Ver juntos»: «está escribiendo» (§13)', () => {
  it('llega por el SSE (no el propio), caduca solo y se va al llegar su mensaje', () => {
    const { client: party, source, clock } = client(HOST);
    party.start();
    source.emit('party.snapshot', { room: room(), chat: [], serverNow: 1_000 });
    source.emit('party.typing', { memberId: ANA, name: 'Ana' });
    source.emit('party.typing', { memberId: HOST, name: 'Isma' });
    expect(party.getState().typing.map((t) => t.name)).toEqual(['Ana']);
    clock.now += 5_000;
    party.expireTyping();
    expect(party.getState().typing).toEqual([]);
    source.emit('party.typing', { memberId: ANA, name: 'Ana' });
    source.emit('party.chat', {
      message: { id: 9, at: 1, kind: 'chat', memberId: ANA, name: 'Ana', text: 'hola' },
    });
    expect(party.getState().typing).toEqual([]);
    party.stop();
  });

  it('avisar de que se escribe manda partyTyping como mucho uno cada 2 s', async () => {
    net = mockFetch({ 'POST /api/v1/party/:code/typing': () => json({ ok: true }) });
    const { client: party, clock } = client(ANA);
    party.typing();
    party.typing();
    clock.now += 2_000;
    party.typing();
    await waitFor(() => expect(net?.calls).toHaveLength(2));
    expect(net?.calls[0]?.body).toEqual({ token: `${ANA}.secreto0123456789abcdef` });
  });

  it('las reacciones ya no existen', () => {
    const { client: party } = client();
    expect('react' in party).toBe(false);
    expect('reactions' in party.getState()).toBe(false);
  });
});

describe('«Ver juntos»: Siguiente', () => {
  const queued = (over: Partial<PartyRoom> = {}) =>
    room({
      queue: [
        {
          id: 'q_abcdefgh',
          title: { ...BASE.title, title: 'Otra peli' },
          addedBy: HOST,
          addedByName: 'Isma',
          votes: [HOST],
        },
        {
          id: 'q_ijklmnop',
          title: { ...BASE.title, title: 'La más votada' },
          addedBy: ANA,
          addedByName: 'Ana',
          votes: [HOST, ANA],
        },
      ],
      ...over,
    });

  it('«Cuando acabe» va por votos; el invitado vota y propone, pero no pone ya ni quita lo de otro', async () => {
    net = mockFetch({ 'POST /api/v1/party/:code/queue': () => json({ ok: true }) });
    const { client: party } = client();
    render(<NextPanel room={queued()} client={party} selfId={ANA} onPropose={() => undefined} />);
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')[0]?.textContent).toContain('La más votada');
    expect(screen.getByText('El más votado · 2 votos')).toBeTruthy();
    expect(screen.getByText('Película · propuesta por Isma')).toBeTruthy();
    /* La regla la cambian el líder y los co-líderes. */
    expect(screen.getByRole('radio', { name: 'Por votos' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: 'En orden' })).toBeDisabled();
    /* Como la maqueta, cada fila lleva solo su voto: ni «⋯» ni «Siguiente» debajo. */
    expect(screen.queryByRole('button', { name: /Opciones de/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Siguiente' })).toBeNull();
    /* De lo suyo puede quitar (menú contextual); de lo de Isma, nada (ni «Poner ya»). */
    const vote = (title: string) =>
      screen.getByRole('button', { name: new RegExp(`Votar ${title}`) });
    expect(vote('Otra peli')).not.toHaveAttribute('aria-haspopup');
    expect(vote('La más votada')).toHaveAttribute('aria-haspopup', 'menu');
    fireEvent.contextMenu(vote('La más votada'));
    expect(await screen.findByRole('menuitem', { name: /Quitar/ })).toBeTruthy();
    expect(screen.queryByRole('menuitem', { name: /Poner ya/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Proponer algo de Pelis y series' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Votar Otra peli/ }));
    await waitFor(() =>
      expect(net?.calls.at(-1)?.body).toMatchObject({ action: 'vote', itemId: 'q_abcdefgh' }),
    );
  });

  it('el co-líder cambia la regla y tiene «Poner ya»', async () => {
    net = mockFetch({ 'POST /api/v1/party/:code/settings': () => json({ ok: true }) });
    const { client: party } = client(BEA);
    render(<NextPanel room={queued()} client={party} selfId={BEA} />);
    fireEvent.contextMenu(screen.getByRole('button', { name: /Votar Otra peli/ }));
    expect(await screen.findByRole('menuitem', { name: /Poner ya/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Elijo yo' }));
    await waitFor(() => expect(net?.calls.at(-1)?.body).toMatchObject({ queueMode: 'leader' }));
  });
});

describe('«Ver juntos»: Gente', () => {
  it('el líder: «Hacer co-líder», «Pasar el liderazgo» y «Echar», y «Quién controla»', async () => {
    net = mockFetch({ 'POST /api/v1/party/:code/member': () => json({ ok: true }) });
    const { client: party } = client(HOST);
    render(<People room={room()} client={party} selfId={HOST} />);
    const anaRow = screen.getByText('Ana').closest('li') as HTMLElement;
    expect(within(anaRow).getByText('Viendo')).toBeTruthy();
    fireEvent.click(within(anaRow).getByRole('button', { name: 'Opciones de Ana' }));
    expect(await screen.findByRole('menuitem', { name: /Pasar el liderazgo/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Echar de la sala/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('menuitem', { name: /Hacer co-líder/ }));
    await waitFor(() =>
      expect(net?.calls.at(-1)?.body).toMatchObject({ memberId: ANA, action: 'coleader' }),
    );
    const beaRow = screen.getByText('Bea').closest('li') as HTMLElement;
    expect(within(beaRow).getByText('Co-líder · también controla')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Yo y co-líderes' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.queryByText(/Tú puedes chatear/)).toBeNull();
  });

  it('el co-líder no tiene menú sobre nadie (no echa ni pasa la corona)', () => {
    const { client: party } = client(BEA);
    render(<People room={room()} client={party} selfId={BEA} />);
    expect(screen.queryByRole('button', { name: /Opciones de/ })).toBeNull();
    expect(screen.queryByRole('radiogroup', { name: 'Quién controla' })).toBeNull();
  });

  it('el invitado ve la nota de quién controla', () => {
    const { client: party } = client(ANA);
    render(<People room={room()} client={party} selfId={ANA} />);
    expect(screen.queryByRole('button', { name: /Opciones de/ })).toBeNull();
    expect(screen.getByText(/Solo Isma y Bea pueden pausar/)).toBeTruthy();
    expect(screen.getByText(/Tú puedes chatear/)).toBeTruthy();
  });
});

describe('«Ver juntos»: «Esperando a todos»', () => {
  const lobby = room({
    playback: { ...BASE.playback, lobby: true, playing: false },
    members: [
      { ...BASE.members[0]!, ready: true, progress: 100 },
      { ...ana, ready: false, progress: 63 },
    ],
  });

  it('quién está listo y quién cargando; «Empezar para todos» para quien controla', async () => {
    net = mockFetch({
      'POST /api/v1/party/:code/control': () => json({ serverNow: 1, rev: 2 }),
    });
    const { client: party } = client(HOST);
    render(<Lobby room={lobby} client={party} selfId={HOST} />);
    expect(screen.getByText('Esperando a todos')).toBeTruthy();
    expect(within(screen.getByText(/Isma/).closest('li')!).getByText('Listo')).toBeTruthy();
    expect(within(screen.getByText('Ana').closest('li')!).getByText('63 %')).toBeTruthy();
    expect(screen.getByText(/Esperando a Ana… empieza sola/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Empezar para todos' }));
    await waitFor(() => expect(net?.calls.at(-1)?.body).toMatchObject({ action: 'play' }));
  });

  it('el invitado no puede empezar', () => {
    const { client: party } = client(ANA);
    render(<Lobby room={lobby} client={party} selfId={ANA} />);
    expect(screen.queryByRole('button', { name: 'Empezar para todos' })).toBeNull();
    expect(screen.getByText(/cuando Isma le dé/)).toBeTruthy();
  });

  it('en la espera, el latido lleva si está listo y su %; fuera de ella, no', async () => {
    net = mockFetch({
      'POST /api/v1/party/:code/status': () => json({ serverNow: 1, rev: 2, stream: 'ok' }),
    });
    const { client: party } = client(ANA);
    party.report(0, true, { ready: false, progress: 40 });
    await waitFor(() => expect(net?.calls).toHaveLength(1));
    expect(net?.calls[0]?.body).toMatchObject({ buffering: true, ready: false, progress: 40 });
    party.report(0, false, null);
    await waitFor(() => expect(net?.calls).toHaveLength(2));
    expect(net?.calls[1]?.body).not.toHaveProperty('ready');
  });

  it('«listo» sale al momento aunque el % acabe de salir (la sala arranca con él)', async () => {
    net = mockFetch({
      'POST /api/v1/party/:code/status': () => json({ serverNow: 1, rev: 2, stream: 'ok' }),
    });
    const { client: party } = client(ANA);
    party.report(0, false, { ready: false, progress: 40 });
    await waitFor(() => expect(net?.calls).toHaveLength(1));
    /* Un % nuevo en el mismo segundo espera al siguiente tramo… */
    party.report(0, false, { ready: false, progress: 60 });
    /* …pero «listo», no. */
    party.report(0, false, { ready: true, progress: 100 });
    await waitFor(() => expect(net?.calls).toHaveLength(2));
    expect(net?.calls[1]?.body).toMatchObject({ ready: true, progress: 100 });
  });
});
