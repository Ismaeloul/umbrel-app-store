/* Lo de la sala que viene de Rave (docs/ver-juntos.md §11 y §13): quién
   controla (líder, co-líderes, todos), «está escribiendo» por el SSE,
   Siguiente con sus votos, el menú del líder sobre cada persona, la nota
   de los invitados y «Esperando a todos». Con la sala de ejemplo de
   partyJoin. Las reacciones ya no existen. */

import type { PartyMember, PartyRoom } from '@ace/shared';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import { resetMode, setMode } from '../../api/mode.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { canControl, controllers, PartyClient, roleOf, type PartyEnv } from './client.ts';
import { Faces, Lobby, NextPanel, People } from './Panels.tsx';

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

  it('«Estoy listo» de los demás llega en `party.votes` (aparte de `members`); sin él, todos sí', () => {
    const { client: party, source } = client(HOST);
    party.start();
    source.emit('party.snapshot', { room: room(), chat: [], serverNow: 1_000 });
    expect(party.getState().unvoted).toEqual([]);
    source.emit('party.votes', { unvoted: [ANA] });
    expect(party.getState().unvoted).toEqual([ANA]);
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
    /* La regla, para quien no la cambia, la cuenta Queue.test.tsx (Siguiente vive en Queue.tsx). */
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
    expect(screen.getByRole('button', { name: /Proponer/ })).toBeTruthy();
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

  it('el invitado ve la nota de quién controla (el de fuera vota; en casa, además, propone)', () => {
    const { client: party } = client(ANA);
    const { rerender } = render(<People room={room()} client={party} selfId={ANA} />);
    expect(screen.queryByRole('button', { name: /Opciones de/ })).toBeNull();
    expect(screen.getByText(/Solo Isma y Bea pueden pausar/)).toBeTruthy();
    expect(screen.getByText(/Tú puedes chatear y votar lo que propongan/)).toBeTruthy();
    rerender(<People room={room()} client={party} selfId={ANA} canPropose />);
    expect(screen.getByText(/Tú puedes chatear y proponer lo siguiente/)).toBeTruthy();
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

  it('una sola pista: «Esperando a Ana (63 %)»; «Empezar sin esperar» pide un segundo toque', async () => {
    net = mockFetch({
      'POST /api/v1/party/:code/control': () => json({ serverNow: 1, rev: 2 }),
    });
    const { client: party } = client(HOST);
    const onVote = vi.fn();
    render(<Lobby room={lobby} client={party} selfId={HOST} voted onVote={onVote} />);
    expect(screen.getByText('Esperando a todos')).toBeTruthy();
    expect(screen.getByText('Esperando a Ana (63 %)')).toBeTruthy();
    /* La lista uno a uno ya no va en la tarjeta (en el móvil no cabe): va en Gente y en las caras. */
    expect(document.querySelector('.juntos-lobby li')).toBeNull();
    /* Ya he tocado: el mismo botón dice «Estás listo» y no hace nada (aria-disabled, sin perder
       el foco); la región de estado, que ya estaba montada, lo anuncia. */
    const done = screen.getByRole('button', { name: 'Estás listo' });
    expect(done.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(done);
    expect(screen.queryByRole('button', { name: 'Estoy listo' })).toBeNull();
    expect(screen.getAllByRole('status').some((node) => node.textContent === 'Estás listo')).toBe(
      true,
    );
    /* Ana carga: forzar pide el segundo toque. */
    fireEvent.click(screen.getByRole('button', { name: 'Empezar sin esperar' }));
    expect(net?.calls ?? []).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Toca otra vez: empieza sin esperar' }));
    /* Con su fuente, para el registro del servidor. */
    await waitFor(() =>
      expect(net?.calls.at(-1)?.body).toMatchObject({ action: 'play', source: 'lobby' }),
    );
    expect(onVote).not.toHaveBeenCalled();
  });

  it('sin tocar yo: «Te esperamos a ti», y se vota con el clic (en el iPhone, bajar el dedo no cuenta)', () => {
    const { client: party } = client(ANA);
    const onVote = vi.fn();
    const unvoted = room({
      playback: { ...BASE.playback, lobby: true, playing: false },
      members: [
        { ...BASE.members[0]!, ready: true, progress: 100 },
        { ...ana, ready: true, progress: 100 },
        { ...bea, ready: true, progress: 100 },
      ],
    });
    render(
      <Lobby
        room={unvoted}
        client={party}
        selfId={ANA}
        voted={false}
        unvoted={[BEA]}
        onVote={onVote}
      />,
    );
    expect(screen.getByText('Te esperamos a ti')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Estoy listo' });
    /* Por qué hay que tocar, sin otra línea en la tarjeta. */
    expect(button).toHaveAttribute('title', 'Así suena en tu aparato cuando empiece.');
    fireEvent.pointerDown(button, { pointerType: 'touch' });
    expect(onVote).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(onVote).toHaveBeenCalledTimes(1);
    /* Tocar en otro sitio de la espera no es votar. */
    fireEvent.click(document.querySelector('.juntos-lobby') as HTMLElement);
    expect(onVote).toHaveBeenCalledTimes(1);
  });

  it('ya votado y faltan otros: «Esperando a Ana y Bea» (sin % quien no ha tocado)', () => {
    const { client: party } = client(HOST);
    const three = room({
      playback: { ...BASE.playback, lobby: true, playing: false },
      members: [
        { ...BASE.members[0]!, ready: true, progress: 100 },
        { ...ana, ready: true, progress: 100 },
        { ...bea, ready: true, progress: 100 },
      ],
    });
    render(
      <Lobby
        room={three}
        client={party}
        selfId={HOST}
        voted
        unvoted={[ANA, BEA]}
        onVote={() => undefined}
      />,
    );
    expect(screen.getByText('Esperando a Ana y Bea')).toBeTruthy();
  });

  it('votar no deja el foco en el aire: el mismo botón pasa a «Estás listo» y el estado se anuncia', () => {
    const { client: party } = client(ANA);
    const props = { room: lobby, client: party, selfId: ANA, onVote: () => undefined };
    const { rerender } = render(<Lobby {...props} voted={false} />);
    const status = screen
      .getAllByRole('status')
      .find((node) => node.classList.contains('sr-only'))!;
    /* Montada y vacía antes del voto: así el cambio se lee. */
    expect(status.textContent).toBe('');
    const button = screen.getByRole('button', { name: 'Estoy listo' });
    button.focus();
    rerender(<Lobby {...props} voted />);
    expect(document.activeElement).toBe(button);
    expect(button.textContent).toContain('Estás listo');
    expect(status.textContent).toBe('Estás listo');
  });

  it('sola y sin tocar: «Empezar ya» al primer toque, y vale como su «Estoy listo»', async () => {
    net = mockFetch({
      'POST /api/v1/party/:code/control': () => json({ serverNow: 1, rev: 2 }),
    });
    const { client: party } = client(HOST);
    const onVote = vi.fn();
    const alone = room({
      playback: { ...BASE.playback, lobby: true, playing: false },
      members: [{ ...BASE.members[0]!, ready: true, progress: 100 }],
    });
    render(<Lobby room={alone} client={party} selfId={HOST} voted={false} onVote={onVote} />);
    expect(screen.getByText('Te esperamos a ti')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Empezar ya' }));
    expect(onVote).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(net?.calls.at(-1)?.body).toMatchObject({ action: 'play' }));
  });

  it('el invitado no puede empezar; con todos listos, «Ya estáis todos»', () => {
    const { client: party } = client(ANA);
    const ready = room({
      playback: { ...BASE.playback, lobby: true, playing: false },
      members: [
        { ...BASE.members[0]!, ready: true, progress: 100 },
        { ...ana, ready: true, progress: 100 },
      ],
    });
    render(<Lobby room={ready} client={party} selfId={ANA} voted onVote={() => undefined} />);
    expect(screen.queryByRole('button', { name: /Empezar/ })).toBeNull();
    expect(screen.getByText('Ya estáis todos')).toBeTruthy();
  });

  it('el anillo de las caras sale de lo mismo que Gente: listo, el % cargando, sin tocar y desconectado', () => {
    const { client: party } = client(HOST);
    const ring = room({
      playback: { ...BASE.playback, lobby: true, playing: false },
      members: [
        { ...BASE.members[0]!, ready: true, progress: 100 },
        { ...ana, ready: false, progress: 42 },
        { ...bea, ready: true, progress: 100 },
        { ...bea, id: 'm_YassinFuera01', name: 'Yassin', role: 'guest', online: false },
      ],
    });
    const { unmount } = render(
      <Faces room={ring} selfId={HOST} selfVoted unvoted={[BEA, 'm_YassinFuera01']} />,
    );
    const face = (name: string) =>
      screen.getByText(name, { exact: false }).closest('li')!.querySelector('.juntos-av')!;
    expect(face('Isma').getAttribute('data-ring')).toBe('ready');
    expect(face('Ana').getAttribute('data-ring')).toBe('loading');
    expect((face('Ana') as HTMLElement).style.getPropertyValue('--ring')).toBe('0.42');
    expect(face('Bea').getAttribute('data-ring')).toBe('wait');
    /* Desconectado: gris entero, sin anillo de espera. */
    expect(face('Yassin').hasAttribute('data-ring')).toBe(false);
    expect(face('Yassin').classList.contains('juntos-av--off')).toBe(true);
    unmount();
    /* Gente dice lo mismo, con palabras. */
    render(
      <People
        room={ring}
        client={party}
        selfId={HOST}
        selfVoted
        unvoted={[BEA, 'm_YassinFuera01']}
      />,
    );
    const row = (name: string) => screen.getByText(name, { exact: false }).closest('li')!;
    expect(within(row('Isma')).getByText('Líder · Listo')).toBeTruthy();
    expect(within(row('Ana')).getByText('42 %')).toBeTruthy();
    expect(within(row('Bea')).getByText('Co-líder · Sin confirmar')).toBeTruthy();
    expect(within(row('Yassin')).getByText('desconectado')).toBeTruthy();
  });

  it('las caras llevan la marca de quien ya ha tocado (la mía, la de esta página); fuera de la espera, no', () => {
    const marks = room({
      playback: { ...BASE.playback, lobby: true, playing: false },
      members: [{ ...BASE.members[0]! }, { ...ana }, { ...bea }],
    });
    /* Lo de los demás, del evento `party.votes` (no va en `members`). */
    const { rerender } = render(
      <Faces room={marks} selfId={ANA} selfVoted={false} unvoted={[ANA, BEA]} />,
    );
    const face = (name: string) =>
      screen.getByText(name, { exact: false }).closest('li')!.querySelector('.juntos-av')!;
    expect(face('Isma').getAttribute('data-voted')).toBe('true');
    expect(face('Ana').getAttribute('data-voted')).toBe('false');
    expect(face('Bea').getAttribute('data-voted')).toBe('false');
    expect(document.querySelectorAll('.juntos-av__voted')).toHaveLength(1);
    rerender(<Faces room={room()} selfId={ANA} selfVoted={false} />);
    expect(document.querySelectorAll('[data-voted]')).toHaveLength(0);
  });

  it('el latido lleva siempre «Estoy listo» y, si cambia, sale al momento', async () => {
    net = mockFetch({
      'POST /api/v1/party/:code/status': () => json({ serverNow: 1, rev: 2, stream: 'ok' }),
    });
    const { client: party } = client(ANA);
    party.report(0, true, null, false);
    await waitFor(() => expect(net?.calls).toHaveLength(1));
    expect(net?.calls[0]?.body).toMatchObject({ voted: false });
    /* Lo mismo otra vez: nada. */
    party.report(0, true, null, false);
    party.report(0, true, null, true);
    await waitFor(() => expect(net?.calls).toHaveLength(2));
    expect(net?.calls[1]?.body).toMatchObject({ voted: true });
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
