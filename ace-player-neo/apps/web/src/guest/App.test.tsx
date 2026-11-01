/* Página de invitado de «Ver juntos» (docs/ver-juntos.md §9): el código sale
   de /s/<código>; sin código válido, el aviso; con él, la entrada de la sala.
   Y lo que pide la página, contra la lista blanca del Caddyfile: lo que no
   pase por @sala, @pagina o @estaticos le da 404 al invitado de fuera (el
   cartel de la 1.1.1, que iba por el catálogo). */

import { useQueryClient } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import joined from '@fixtures/web/v1/partyJoin.json';
import preview from '@fixtures/web/v1/partyPreview.json';
import { resetMode, setMode } from '../api/mode.ts';
import { json, mockFetch } from '../test/fetch.ts';
import { saveCredential } from '../features/juntos/client.ts';
import { codeFromPath, GuestApp } from './App.tsx';

/* La sala de verdad abre el SSE y el vídeo: casi siempre solo importa con qué se monta y
   que tenga el QueryClient que usa la pestaña Fuentes del directo (useRoomSources). */
const roomProps = vi.hoisted(() => [] as Record<string, unknown>[]);
const realRoom = vi.hoisted(() => ({ on: false }));
const roomQuery = vi.hoisted(() => ({ ok: false }));
vi.mock('../features/juntos/Room.tsx', async (importOriginal) => {
  const actual = await importOriginal<{ Room: ComponentType<Record<string, unknown>> }>();
  return {
    Room: (props: Record<string, unknown>) => {
      roomProps.push(props);
      roomQuery.ok = useQueryClient() !== undefined;
      return realRoom.on ? <actual.Room {...props} /> : null;
    },
  };
});

/* El vigilante de la zona visible lo instala main.tsx: aquí solo se mira que lo haga. */
const viewport = vi.hoisted(() => ({ installs: 0 }));
vi.mock('../lib/viewport.ts', () => ({
  installViewportWatcher: () => {
    viewport.installs += 1;
    return () => undefined;
  },
}));

const CODE = 'k3J9xQ2mZpL8wR4t';

/* La lista blanca del proxy (deploy/umbrel/Caddyfile), leída del fichero. */
const CADDYFILE = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../deploy/umbrel/Caddyfile'),
  'utf8',
);
function caddyLine(name: string, kind: 'path_regexp' | 'path'): string {
  const line = new RegExp(`^\\s*@${name}\\s+${kind}\\s+(.+)$`, 'm').exec(CADDYFILE)?.[1];
  if (!line) throw new Error(`el Caddyfile no tiene @${name} ${kind}`);
  return line.trim();
}
const SALA = new RegExp(caddyLine('sala', 'path_regexp'));
const PAGINA = new RegExp(caddyLine('pagina', 'path_regexp'));
const ESTATICOS = caddyLine('estaticos', 'path').split(/\s+/);
function guestAllowed(url: string): boolean {
  const pathname = new URL(url, 'https://sala.example').pathname;
  return (
    SALA.test(pathname) ||
    PAGINA.test(pathname) ||
    ESTATICOS.some((pattern) =>
      pattern.endsWith('*') ? pathname.startsWith(pattern.slice(0, -1)) : pathname === pattern,
    )
  );
}

/** Un EventSource falso que apunta a dónde se conecta. */
class FakeSource extends EventTarget {
  static urls: string[] = [];
  static last: FakeSource | null = null;
  readyState = 1;
  constructor(readonly url: string) {
    super();
    FakeSource.urls.push(url);
    FakeSource.last = this;
  }
  close(): void {
    this.readyState = 2;
  }
  emit(type: string, data: unknown): void {
    this.dispatchEvent(new MessageEvent(type, { data: JSON.stringify(data) }));
  }
}

/** Todo lo que la página ha pedido o pintado: peticiones, SSE e imágenes, vídeos y enlaces. */
function everyUrl(calls: readonly { url: string }[]): string[] {
  const attributes = [...document.querySelectorAll('[src], link[href]')].map(
    (element) => element.getAttribute('src') ?? element.getAttribute('href') ?? '',
  );
  return [...calls.map((call) => call.url), ...FakeSource.urls, ...attributes].filter(
    (url) => url && !url.startsWith('blob:') && !url.startsWith('data:'),
  );
}

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
  realRoom.on = false;
  FakeSource.urls = [];
  FakeSource.last = null;
  vi.unstubAllGlobals();
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
    /* El cartel, por la ruta de la sala (el invitado no tiene el catálogo). */
    const poster = document.querySelector('.juntos-join__poster img');
    expect(poster?.getAttribute('src')).toBe(
      `/api/v1/party/${CODE}/art/${preview.title.artId}?v=${preview.title.poster}`,
    );
    expect(everyUrl(net.calls).filter((url) => !guestAllowed(url))).toEqual([]);
    /* Fuera de la sala, la página sigue con su barra. */
    expect(document.querySelector('.guest--room')).toBeNull();
  });

  it('sin red: «Reintentar» y un texto que no habla del Umbrel', async () => {
    net = mockFetch({
      'GET /api/v1/party/k3J9xQ2mZpL8wR4t': () => {
        throw new TypeError('Failed to fetch');
      },
    });
    render(<GuestApp pathname="/s/k3J9xQ2mZpL8wR4t" />);
    expect(
      await screen.findByText('No hay conexión con la sala. Comprueba tu conexión a internet.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument();
    expect(screen.queryByText(/Umbrel/)).toBeNull();
  });

  it('ya dentro, la sala del invitado pide las dos calidades (`guest`, docs/ver-juntos.md §17)', () => {
    saveCredential('k3J9xQ2mZpL8wR4t', { id: 'm_AnaInvitada01', token: 'm_AnaInvitada01.secreto' });
    render(<GuestApp pathname="/s/k3J9xQ2mZpL8wR4t" />);
    expect(roomProps.at(-1)).toMatchObject({ code: 'k3J9xQ2mZpL8wR4t', guest: true });
    /* Ya dentro: en el móvil, la sala a la altura de lo que se ve (guest.css). */
    expect(document.querySelector('.guest.guest--room')).toBeTruthy();
    /* Fuentes (react-query) no tira la sala del enlace: hay QueryClient. */
    expect(roomQuery.ok).toBe(true);
  });

  it('main.tsx instala el vigilante de la zona visible (--vvh para la sala en el iPhone)', async () => {
    const root = document.createElement('div');
    root.id = 'root';
    document.body.append(root);
    try {
      await act(async () => {
        await import('./main.tsx');
      });
      expect(viewport.installs).toBe(1);
    } finally {
      root.remove();
    }
  });

  it('dentro de la sala, todo lo que pide la página pasa por la lista blanca del Caddyfile', async () => {
    realRoom.on = true;
    vi.stubGlobal('EventSource', FakeSource);
    net = mockFetch({
      [`POST /api/v1/party/${CODE}/status`]: () => json({ serverNow: 1, rev: 1, stream: 'none' }),
      [`GET /api/v1/party/${CODE}/stream`]: () =>
        json({ error: { code: 'remux_timeout', message: '…', requestId: 'r1' } }, 503),
    });
    saveCredential(CODE, { id: 'm_AnaInvitada01', token: 'm_AnaInvitada01.secreto' });
    render(<GuestApp pathname={`/s/${CODE}`} />);
    await waitFor(() => expect(FakeSource.last).toBeTruthy());
    act(() =>
      FakeSource.last?.emit('party.snapshot', {
        room: { ...joined.room, playback: { ...joined.room.playback, lobby: false } },
        chat: [],
        serverNow: 1,
      }),
    );
    expect(await screen.findByRole('heading', { name: /Dune: Parte Dos/ })).toBeInTheDocument();
    const urls = everyUrl(net.calls);
    expect(urls.some((url) => url.includes('/art/'))).toBe(true);
    expect(urls.filter((url) => !guestAllowed(url))).toEqual([]);
  });
});
