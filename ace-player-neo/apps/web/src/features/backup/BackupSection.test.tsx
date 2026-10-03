/* Ajustes → Copia de seguridad (decisiones.md D24): descargar (con y sin la
   contraseña de la IPTV), restaurar con vista previa y confirmación en la
   página, errores y la IPTV pendiente. Sin red: fetch simulado. */

import type { BackupFile, BackupImportResponse, IptvView } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { setTheme, setTransparency, themeStore } from '../../app/theme.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { resetPlayerApi, setPlaybackMode } from '../../player/api.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { renderWithApp } from '../library/test-utils.tsx';
import BackupSection from './BackupSection.tsx';

const AT = '2026-10-01T09:00:00.000Z';
const toasts = () => toastStore.get().map((t) => t.text);

const FILE: BackupFile = {
  format: 'ace-player-neo-copia',
  schemaVersion: 1,
  appVersion: '0.8.4',
  createdAt: AT,
  library: {
    favorites: [
      {
        id: 'a'.repeat(40),
        title: 'DAZN 1',
        type: 'fav',
        category: '',
        date: AT,
        fromWebSync: false,
        ih: false,
      },
    ],
    history: [],
  },
  directories: {
    sources: [
      {
        id: 'principal',
        name: 'Principal',
        url: 'https://example.com/lista.m3u',
        type: 'm3u',
        streams: [],
        renames: {},
        hidden: [],
        syncedAt: null,
        lastErrorAt: null,
        lastError: null,
      },
    ],
    activeId: 'principal',
  },
  preferences: {
    onboardingComplete: true,
    country: 'Spain',
    leagues: ['LaLiga'],
    teams: [],
    nationalities: [],
  },
  channelBindings: [],
  channelFeedback: [],
  settings: { sameChannelPolicy: 'share' },
  iptv: null,
};

const counts = (favorites: number) => ({
  favorites,
  history: 0,
  directories: 1,
  channels: 0,
  channelBindings: 0,
  channelFeedback: 0,
});

const PREVIEW: BackupImportResponse = {
  applied: false,
  mode: 'replace',
  source: { appVersion: '0.8.4', createdAt: AT, schemaVersion: 1 },
  current: counts(3),
  incoming: counts(1),
  result: counts(1),
  preferences: true,
  settings: false,
  iptv: {
    action: 'none',
    protected: false,
    kind: null,
    name: null,
    host: null,
    server: null,
    username: null,
    relinkItems: 0,
  },
  browser: { theme: 'oscuro' },
};

const IPTV: IptvView = {
  provider: {
    kind: 'xtream',
    name: 'Casa',
    enabled: true,
    host: 'proveedor.example:8080',
    origin: 'http://proveedor.example:8080',
    hasUrl: false,
    hasUsername: true,
    hasPassword: true,
    status: 'ok',
    channels: 10,
    updatedAt: AT,
    error: null,
    staleSince: null,
    account: null,
    guide: { available: false, channelsWithGuide: 0, updatedAt: null, failedAt: null },
  },
  refreshHours: 6,
};

let net: ReturnType<typeof mockFetch>;
let blobs: Blob[];

function setup(routes: NonNullable<Parameters<typeof mockFetch>[0]> = {}) {
  net = mockFetch({
    'GET /api/v1/iptv': { provider: null, refreshHours: 6 },
    'GET /api/v1/backup': FILE as unknown as Record<string, unknown>,
    ...routes,
  });
  return renderWithApp(<BackupSection />, { search: '?vista=ajustes/copia' });
}

function pick(content: unknown, name = 'ace-player-neo-copia-2026-10-01.json') {
  const input = screen.getByLabelText('Fichero de la copia (.json)');
  const file = new File([typeof content === 'string' ? content : JSON.stringify(content)], name, {
    type: 'application/json',
  });
  fireEvent.change(input, { target: { files: [file] } });
}

const imports = () =>
  net.calls.filter((call) => call.method === 'POST' && call.url === '/api/v1/backup/import');

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  blobs = [];
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return 'blob:copia';
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  net?.restore();
  resetToasts();
  resetMode();
  setTheme('sistema');
  setTransparency('normal');
  setPlaybackMode('balanced');
  resetPlayerApi();
});

describe('descargar copia', () => {
  it('sin IPTV: GET, fichero con lo de este navegador y aviso', async () => {
    setTheme('claro');
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar copia' }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    expect(net.calls.some((call) => call.url === '/api/v1/backup')).toBe(true);
    const text = await blobs[0]!.text();
    const saved = JSON.parse(text) as BackupFile;
    expect(saved.format).toBe('ace-player-neo-copia');
    expect(saved.browser).toMatchObject({ theme: 'claro', transparency: 'normal' });
    expect(screen.queryByRole('switch', { name: /Incluir la contraseña/ })).toBeNull();
    await waitFor(() =>
      expect(toasts().some((t) => /^Copia descargada: ace-player-neo-copia-/.test(t))).toBe(true),
    );
  });

  it('con «Incluir la contraseña»: clave de 8 o más, repetida; va por POST y no se queda en la página', async () => {
    const CLAVE = 'clave-de-isma-123';
    setup({
      'GET /api/v1/iptv': IPTV,
      'POST /api/v1/backup/export': FILE,
    });
    const toggle = await screen.findByRole('switch', { name: /Incluir la contraseña de la IPTV/ });
    fireEvent.click(toggle);
    const first = screen.getByLabelText('Clave para proteger la contraseña');
    const second = screen.getByLabelText('Repite la clave');
    fireEvent.change(first, { target: { value: 'corta' } });
    fireEvent.click(screen.getByRole('button', { name: 'Descargar copia' }));
    expect(await screen.findByText('Al menos 8 caracteres.')).toBeInTheDocument();
    fireEvent.change(first, { target: { value: CLAVE } });
    fireEvent.change(second, { target: { value: 'otra-cosa-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Descargar copia' }));
    expect(await screen.findByText('Las dos claves no coinciden.')).toBeInTheDocument();
    expect(net.calls.some((call) => call.url.startsWith('/api/v1/backup'))).toBe(false);
    fireEvent.change(second, { target: { value: CLAVE } });
    fireEvent.click(screen.getByRole('button', { name: 'Descargar copia' }));
    await waitFor(() => expect(blobs).toHaveLength(1));
    const post = net.calls.find((call) => call.url === '/api/v1/backup/export');
    expect(post?.method).toBe('POST');
    expect(post?.body).toEqual({ passphrase: CLAVE });
    /* La clave no se queda escrita ni va al fichero en claro. */
    await waitFor(() =>
      expect(screen.getByLabelText('Clave para proteger la contraseña')).toHaveValue(''),
    );
    expect(document.body.innerHTML).not.toContain(CLAVE);
    expect(await blobs[0]!.text()).not.toContain(CLAVE);
  });

  it('un fallo del servidor se dice en la página', async () => {
    setup({
      'GET /api/v1/backup': () =>
        json(
          { error: { code: 'internal_error', message: 'Algo ha fallado.', requestId: 'r' } },
          500,
        ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar copia' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo hacer la copia/);
  });
});

describe('restaurar copia', () => {
  it('vista previa, aviso de Reemplazar, confirmación en la página y lo del navegador aplicado', async () => {
    setup({
      'POST /api/v1/backup/import': (call) =>
        json((call.body as { dryRun: boolean }).dryRun ? PREVIEW : { ...PREVIEW, applied: true }),
    });
    await screen.findByRole('button', { name: 'Descargar copia' });
    pick(FILE);
    expect(
      await screen.findByRole('heading', { name: /^Copia del .* versión 0\.8\.4$/ }),
    ).toBeInTheDocument();
    expect(screen.getByText('1 favorito')).toBeInTheDocument();
    expect(screen.getByText('ahora 3')).toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent(/Lo de ahora se pierde/);
    expect(imports()).toHaveLength(1);
    expect(imports()[0]?.body).toMatchObject({ mode: 'replace', dryRun: true });

    fireEvent.click(screen.getByRole('button', { name: 'Restaurar y reemplazar…' }));
    const dialog = await screen.findByRole('dialog', { name: '¿Reemplazar con la copia?' });
    expect(imports()).toHaveLength(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Sí, reemplazar' }));
    await waitFor(() => expect(imports()).toHaveLength(2));
    expect(imports()[1]?.body).toMatchObject({ mode: 'replace', dryRun: false });
    await waitFor(() => expect(toasts()).toContain('Copia restaurada.'));
    expect(themeStore.get().theme).toBe('oscuro');
  });

  it('Combinar vuelve a pedir la vista previa y cambia el aviso', async () => {
    setup({
      'POST /api/v1/backup/import': (call) =>
        json({ ...PREVIEW, mode: (call.body as { mode: string }).mode }),
    });
    await screen.findByRole('button', { name: 'Descargar copia' });
    pick(FILE);
    await screen.findByText('1 favorito');
    fireEvent.click(screen.getByRole('radio', { name: 'Combinar' }));
    await waitFor(() => expect(imports()).toHaveLength(2));
    expect(imports()[1]?.body).toMatchObject({ mode: 'merge', dryRun: true });
    expect(screen.getByRole('note')).toHaveTextContent(/añade lo que falte/);
    expect(screen.getByRole('button', { name: 'Restaurar y combinar…' })).toBeInTheDocument();
  });

  it('un fichero que no es una copia, o de una versión más nueva: se dice y no se aplica nada', async () => {
    setup({
      'POST /api/v1/backup/import': () =>
        json(
          {
            error: {
              code: 'backup_version_unsupported',
              message:
                'Esta copia es de una versión más nueva de Ace Player Neo. Actualiza la app y vuelve a intentarlo.',
              requestId: 'r',
            },
          },
          422,
        ),
    });
    await screen.findByRole('button', { name: 'Descargar copia' });
    pick('esto no es json');
    expect(await screen.findByRole('alert')).toHaveTextContent(/no es una copia de seguridad/);
    pick({ hola: 1 });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /no es una copia de seguridad de Ace Player Neo/,
      ),
    );
    expect(imports()).toHaveLength(0);
    pick({ ...FILE, schemaVersion: 2 });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/versión más nueva/));
    expect(screen.queryByRole('button', { name: /Restaurar y/ })).toBeNull();
  });

  it('copia protegida: pide la clave antes de enseñarla; la IPTV pendiente se guarda aquí', async () => {
    const protectedFile = {
      ...FILE,
      iptv: {
        kind: 'xtream',
        name: 'Casa',
        enabled: true,
        host: 'proveedor.example:8080',
        server: 'http://proveedor.example:8080',
        username: 'isma',
        secret: {
          kdf: 'scrypt',
          n: 32768,
          r: 8,
          p: 1,
          salt: 'AAECAwQFBgcICQoLDA0ODw',
          alg: 'A256GCM',
          iv: 'AAECAwQFBgcICQoL',
          tag: 'AAECAwQFBgcICQoLDA0ODw',
          data: 'ZWplbXBsbw',
        },
      },
    };
    const pending: BackupImportResponse['iptv'] = {
      action: 'needs_secret',
      protected: true,
      kind: 'xtream',
      name: 'Casa',
      host: 'proveedor.example:8080',
      server: 'http://proveedor.example:8080',
      username: 'isma',
      relinkItems: 2,
    };
    setup({
      'POST /api/v1/backup/import': (call) =>
        json({
          ...PREVIEW,
          applied: !(call.body as { dryRun: boolean }).dryRun,
          iptv: pending,
        }),
      'PUT /api/v1/iptv': IPTV,
    });
    await screen.findByRole('button', { name: 'Descargar copia' });
    pick(protectedFile);
    const key = await screen.findByLabelText('Clave de la copia');
    expect(imports()).toHaveLength(0);
    /* Sin clave también vale: la IPTV queda pendiente. */
    fireEvent.click(screen.getByRole('button', { name: 'Ver qué contiene' }));
    await screen.findByText(/te pediremos la contraseña/);
    expect(imports()[0]?.body).not.toHaveProperty('passphrase');
    expect(key).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar y reemplazar…' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Sí, reemplazar' }),
    );
    const password = await screen.findByLabelText('Contraseña de la IPTV');
    expect(screen.getByText(/usuario isma/)).toBeInTheDocument();
    fireEvent.change(password, { target: { value: 'secreta-iptv' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar IPTV' }));
    await waitFor(() =>
      expect(net.calls.find((call) => call.method === 'PUT')?.body).toEqual({
        kind: 'xtream',
        name: 'Casa',
        server: 'http://proveedor.example:8080',
        username: 'isma',
        password: 'secreta-iptv',
      }),
    );
    await waitFor(() => expect(screen.queryByLabelText('Contraseña de la IPTV')).toBeNull());
    expect(toasts().some((t) => t.startsWith('IPTV guardada'))).toBe(true);
  });

  it('con la clave, la manda con la vista previa', async () => {
    setup({ 'POST /api/v1/backup/import': PREVIEW });
    await screen.findByRole('button', { name: 'Descargar copia' });
    pick({
      ...FILE,
      iptv: {
        kind: 'm3u',
        name: 'Casa',
        enabled: true,
        host: 'h',
        server: null,
        username: null,
        secret: { kdf: 'scrypt' },
      },
    });
    const key = await screen.findByLabelText('Clave de la copia');
    fireEvent.change(key, { target: { value: 'clave-de-isma' } });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Ver qué contiene' }));
    });
    await waitFor(() => expect(imports()[0]?.body).toMatchObject({ passphrase: 'clave-de-isma' }));
  });
});
