/* Ajustes → Registro («Descargar logs», 0.9.0): lo guardado, el periodo, la
   descarga (con su aviso), los estados «preparando» y error, y la demo. */

import type { DiagnosticsLogInfo } from '@ace/shared';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import { json, mockFetch } from '../../test/fetch.ts';
import { renderSection } from '../health/test-utils.tsx';
import LogsSection from './LogsSection.tsx';
import { logsNotice } from './model.ts';

const INFO: DiagnosticsLogInfo = {
  enabled: true,
  since: '2026-09-21T08:02:11.000Z',
  days: 12,
  bytes: 1_468_006,
  maxBytes: 40 * 1024 * 1024,
  maxDays: 45,
};

let net: ReturnType<typeof mockFetch> | null = null;
let saved: Array<{ name: string; size: number; type: string }> = [];

function setup(info: DiagnosticsLogInfo | (() => Response) = INFO) {
  net = mockFetch({
    'GET /api/v1/diagnostics/log': typeof info === 'function' ? info : { ...info },
  });
  return renderSection(<LogsSection />, '?vista=ajustes/registro');
}

/** El zip que «manda» el servidor. */
function zipResponse(bytes = 2048): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="ace-player-neo-logs-2026-10-03-2145.zip"',
    },
  });
}

beforeEach(() => {
  resetMode();
  setMode('live', 'bootstrap');
  saved = [];
  const blobs = new Map<string, Blob>();
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:test/${blobs.size}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    const blob = blobs.get(this.href);
    saved.push({ name: this.download, size: blob?.size ?? -1, type: blob?.type ?? '' });
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  net?.restore();
  net = null;
  resetToasts();
  resetMode();
});

describe('Ajustes → Registro', () => {
  it('lo que hay guardado en el Umbrel, el periodo (mes por defecto) y qué NO lleva', async () => {
    setup();
    const list = await screen.findByLabelText('Lo que hay guardado en el Umbrel');
    expect(within(list).getByText('Guardando desde')).toBeInTheDocument();
    expect(within(list).getByText('21 sept 2026')).toBeInTheDocument();
    expect(within(list).getByText('1,4 MB de 40 MB')).toBeInTheDocument();
    expect(within(list).getByText('lo de más de 45 días')).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'Qué periodo' });
    expect(within(group).getByRole('radio', { name: '30 días' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(
      screen.getByText(/No lleva contraseñas, usuarios, enlaces con claves ni IPs públicas\./),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar logs' })).toBeEnabled();
  });

  it('descarga el zip del periodo elegido, con lo de la web, y avisa al terminar', async () => {
    setup();
    let resolve: (response: Response) => void = () => undefined;
    const fetchMock = vi.fn(
      (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Promise<Response>((done) => {
          resolve = done;
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const group = screen.getByRole('radiogroup', { name: 'Qué periodo' });
    fireEvent.click(within(group).getByRole('radio', { name: '1 día' }));
    fireEvent.click(screen.getByRole('button', { name: 'Descargar logs' }));

    // Preparando: el botón lo dice y no se puede pulsar otra vez.
    const busy = await screen.findByRole('button', { name: 'Preparando los logs…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe('/api/v1/diagnostics/log/download');
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', cache: 'no-store' });
    const body = JSON.parse(String(init?.body)) as {
      period: string;
      web: { view: string; log: unknown[] };
    };
    expect(body.period).toBe('dia');
    expect(body.web.view).toBe('ajustes/registro');
    expect(Array.isArray(body.web.log)).toBe(true);

    await act(async () => resolve(zipResponse(2048)));
    expect(await screen.findByRole('button', { name: 'Descargar logs' })).toBeEnabled();
    expect(saved).toEqual([
      { name: 'ace-player-neo-logs-2026-10-03-2145.zip', size: 2048, type: 'application/zip' },
    ]);
    await waitFor(() =>
      expect(toastStore.get().at(-1)?.text).toBe(
        logsNotice('ace-player-neo-logs-2026-10-03-2145.zip', 2048),
      ),
    );
    // Sin los «word joiner» (U+2060) que evitan cortar la fecha en el móvil.
    expect(logsNotice('ace-player-neo-logs-2026-10-03-2145.zip', 2048).replace(/⁠/g, '')).toBe(
      'Logs descargados: ace-player-neo-logs-2026-10-03-2145.zip (2 KB)',
    );
  });

  it('si falla lo dice debajo (y se puede volver a intentar)', async () => {
    setup();
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          json(
            {
              error: {
                code: 'internal_error',
                message: 'Algo ha fallado en el servidor.',
                requestId: 'r1',
              },
            },
            500,
          ),
        )
        .mockRejectedValueOnce(new TypeError('Failed to fetch')),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Descargar logs' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      'No se pudieron descargar los logs. Algo ha fallado en el servidor.',
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Descargar logs' }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /^No se pudieron descargar los logs\. .*conex/i,
      ),
    );
    expect(saved).toEqual([]);
  });

  it('sin nada guardado o sin registro en el servidor, lo explica', async () => {
    const first = setup({ ...INFO, since: null, days: 0, bytes: 0 });
    expect(
      await screen.findByText('Aún no hay nada guardado: empieza a apuntar desde ahora.'),
    ).toBeInTheDocument();
    first.unmount();
    net?.restore();
    setup({ ...INFO, enabled: false, since: null, days: 0, bytes: 0 });
    expect(
      await screen.findByText(/Este servidor no está guardando el registro/),
    ).toBeInTheDocument();
  });

  it('si no se puede leer lo guardado, lo dice y el botón sigue', async () => {
    setup(() =>
      json({ error: { code: 'internal_error', message: 'Algo ha fallado.', requestId: 'r' } }, 500),
    );
    expect(await screen.findByText(/No se pudo leer lo que hay guardado\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Descargar logs' })).toBeEnabled();
  });

  it('en la demo el zip se monta en el navegador, sin red', async () => {
    resetMode();
    setMode('demo', 'param');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    renderSection(<LogsSection />, '?vista=ajustes/registro&demo=1');
    expect(await screen.findByText('1,4 MB de 40 MB')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Descargar logs' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.name).toMatch(/^ace-player-neo-logs-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/);
    expect(saved[0]?.size).toBeGreaterThan(1000);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
