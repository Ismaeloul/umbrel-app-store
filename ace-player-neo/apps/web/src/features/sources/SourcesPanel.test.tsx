/* El selector de fuentes pintado: lista y rack, qué se ve (regla 22), la
   activa, el inspector, las hojas de reportar y «Encontrar canal», y los
   atajos N y 1-9. Sin red: fetch simulado y la sesión preparada a mano. */

import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { installShortcutListener } from '../../app/shortcuts.ts';
import { resetToasts } from '../../notices/toasts.ts';
import { getPlayer, play, resetPlayerApi } from '../../player/api.ts';
import { fixture, json, mockFetch, type MockCall } from '../../test/fetch.ts';
import { renderWithApp } from '../agenda/test-utils.tsx';
import { applyScan, entryFromCandidate, startScan } from './model.ts';
import { ReportSheet } from './ReportSheet.tsx';
import { ResolverSheet } from './ResolverSheet.tsx';
import { endSession, getSession, sessionStore, type SessionState } from './session.ts';
import { SourcesPanel } from './SourcesPanel.tsx';
import { candidate, hash, JOB, resolution, scanJob, testMatch } from './test-utils.ts';

let net: ReturnType<typeof mockFetch>;
let uninstall: () => void;

function prepare(
  states: Array<'working' | 'weak' | 'failed' | 'checking' | 'queued'>,
  extra: Partial<SessionState> = {},
) {
  const entries = applyScan(
    startScan(
      states.map((_, i) => entryFromCandidate(candidate(i + 1))),
      3,
    ),
    scanJob(states),
  );
  const job = scanJob(states);
  sessionStore.set({
    ...sessionStore.get(),
    key: 'm:m1',
    kind: 'match',
    match: {
      id: 'm1',
      title: testMatch().title,
      home: testMatch().home,
      away: testMatch().away,
      competition: 'Champions League',
      date: '2026-09-23',
      time: '21:00',
      channels: ['M+ Liga de Campeones'],
    },
    phase: 'ready',
    entries,
    scan: {
      id: JOB,
      status: job.status,
      total: job.total,
      checked: job.checked,
      playable: job.playable,
      retryAt: null,
    },
    ...extra,
  });
}

beforeEach(() => {
  setMode('live', 'bootstrap');
  resetPlayerApi();
  endSession();
  resetToasts();
  uninstall = installShortcutListener(window);
  net = mockFetch({
    'GET /api/v1/library': fixture('libraryGet'),
    'POST /api/v1/sources/report': (call: MockCall) =>
      json({
        report: {
          reportId: 'rep_1',
          id: (call.body as { id: string }).id,
          channel: 'M+ Liga de Campeones',
          matchId: 'm1',
          reason: (call.body as { reason: string }).reason,
          state: 'checking',
          checkReason: '',
          reportedAt: '2026-09-23T18:30:00.000Z',
          lastCheckedAt: null,
          quarantineUntil: '2099-01-01T00:00:00.000Z',
        },
        scan: null,
      }),
  });
});

afterEach(() => {
  uninstall();
  endSession();
  net.restore();
  resetMode();
});

describe('lista (móvil)', () => {
  it('enseña la activa, las vivas y las iniciales; las caídas quedan plegadas', () => {
    prepare(['failed', 'working', 'checking', 'queued', 'weak', 'failed'], { activeHash: hash(2) });
    renderWithApp(<SourcesPanel variant="list" />);
    expect(screen.getByRole('heading', { name: /Fuentes\s*6/ })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Fuentes del partido' });
    const rows = within(list).getAllByRole('button');
    // 2 (activa y verificada), 3 (inicial comprobándose) y 5 (floja).
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveAttribute('aria-current', 'true');
    expect(rows[0]).toHaveAccessibleName(/^Fuente 2: .*Faro/);
    expect(screen.getByText('4/6 · buscando señales vivas')).toBeInTheDocument();
    const more = screen.getByRole('button', { name: 'Ver 3 más (2 sin señal, 1 en cola)' });
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('list', { name: /sin señal o en cola/ })).toBeInTheDocument();
  });

  it('pulsar una fuente la reproduce y apaga el automatismo', () => {
    prepare(['working', 'working', 'queued'], { autoVerified: true });
    renderWithApp(<SourcesPanel variant="list" />);
    fireEvent.click(screen.getByRole('button', { name: /^Fuente 2:/ }));
    expect(getPlayer().channel?.hash).toBe(hash(2));
    expect(getSession()).toMatchObject({ autoVerified: false, manualChosen: true });
  });

  it('la que suena lleva «En pantalla» y la barra «Emitiendo» cuenta sobre el total', () => {
    prepare(['working', 'working', 'failed'], { activeHash: hash(1) });
    act(() => {
      play({ hash: hash(1), title: 'M+ Liga de Campeones' }, { origin: 'auto' });
    });
    renderWithApp(<SourcesPanel variant="list" />);
    expect(screen.getByText('En pantalla')).toBeInTheDocument();
    expect(screen.getByText('Emitiendo')).toBeInTheDocument();
    expect(screen.getByText(/Fuente/, { selector: '.src-now__meta' })).toHaveTextContent(
      'Fuente 1 de 3',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Fuente siguiente' }));
    expect(getPlayer().channel?.hash).toBe(hash(2));
  });

  it('deslizar la barra «Emitiendo» cambia de fuente aunque la barra salga después de montar el panel', () => {
    // Al entrar al partido todavía no suena nada: el panel se monta sin barra.
    prepare(['working', 'working', 'queued'], { activeHash: null });
    const { container } = renderWithApp(<SourcesPanel variant="list" />);
    expect(container.querySelector('.src-now')).toBeNull();
    // Arranca la primera verificada: aparece la barra.
    act(() => {
      play({ hash: hash(1), title: 'M+ Liga de Campeones' }, { origin: 'auto' });
      sessionStore.set({ ...sessionStore.get(), activeHash: hash(1) });
    });
    const bar = container.querySelector<HTMLElement>('.src-now');
    expect(bar).not.toBeNull();
    const finger = { pointerId: 3, pointerType: 'touch' };
    fireEvent.pointerDown(bar!, { ...finger, clientX: 260, clientY: 40 });
    fireEvent.pointerMove(bar!, { ...finger, clientX: 200, clientY: 41 });
    fireEvent.pointerUp(bar!, { ...finger, clientX: 120, clientY: 42 });
    expect(getPlayer().channel?.hash).toBe(hash(2));
  });

  it('cartel: proveedor en la tesela, canal debajo, calidad y tipo; las flechas pasan de un cartel a otro', () => {
    prepare(['working', 'working', 'weak'], { activeHash: hash(1) });
    act(() =>
      sessionStore.set((s) => ({
        ...s,
        entries: s.entries.map((entry, i) =>
          i === 0 && entry.probe
            ? { ...entry, probe: { ...entry.probe, rateKbps: 4200, videoCodec: 'hevc' } }
            : entry,
        ),
      })),
    );
    renderWithApp(<SourcesPanel variant="list" />);
    const list = screen.getByRole('list', { name: 'Fuentes del partido' });
    const [first, second, third] = within(list).getAllByRole('button');
    expect(first!.querySelector('.dorsal__abbrev')).toHaveTextContent(/^Elcano$/);
    expect(first!.querySelector('.src-poster__name')).toHaveTextContent(/^M\+ Liga de Campeones$/);
    const tags = [...first!.querySelectorAll('.src-poster__tags .src-poster__tag')];
    expect(tags.map((tag) => tag.textContent)).toEqual(['1080p', 'HEVC', 'AceStream']);
    first!.focus();
    fireEvent.keyDown(first!, { key: 'ArrowRight' });
    expect(second).toHaveFocus();
    fireEvent.keyDown(second!, { key: 'ArrowDown' });
    expect(third).toHaveFocus();
    fireEvent.keyDown(third!, { key: 'ArrowLeft' });
    expect(second).toHaveFocus();
  });

  it('Isma, 26-sep: arriba (en la tesela) el proveedor y debajo SOLO el canal, sin repetirlo', () => {
    prepare(['working', 'working']);
    act(() =>
      sessionStore.set((s) => ({
        ...s,
        entries: s.entries.map((entry, i) =>
          i === 0 ? { ...entry, title: 'Movistar LaLiga [NEW ERA] --> New Era III' } : entry,
        ),
      })),
    );
    renderWithApp(<SourcesPanel variant="list" />);
    const list = screen.getByRole('list', { name: 'Fuentes del partido' });
    const [first, second] = within(list).getAllByRole('button');
    // El orden del cartel: la tesela (con el proveedor) y después el nombre del canal.
    const tag = first!.querySelector('.src-poster__tile .dorsal__abbrev')!;
    const name = first!.querySelector('.src-poster__body .src-poster__name')!;
    expect(tag).toHaveTextContent(/^New Era III$/);
    expect(name).toHaveTextContent(/^Movistar LaLiga$/);
    expect(tag.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // Ni la sigla recortada («MOVIST») ni el proveedor repetido debajo.
    expect(first).not.toHaveTextContent('MOVIST');
    expect(name).not.toHaveTextContent(/new era/i);
    // La cifra grande, el número de fuente y el aria-label largo no cambian.
    expect(first!.querySelector('.dorsal b')).toHaveTextContent(/^M$/);
    expect(first!.querySelector('.src-poster__num')).toHaveTextContent('1');
    expect(first).toHaveAttribute(
      'aria-label',
      expect.stringMatching(
        /^Fuente 1: Movistar LaLiga \[NEW ERA\] --> New Era III · AceStream · New Era III/,
      ),
    );
    expect(second!.querySelector('.dorsal__abbrev')).toHaveTextContent(/^Faro$/);
    expect(second!.querySelector('.src-poster__name')).toHaveTextContent(/^M\+ Liga de Campeones$/);
  });

  it('Isma, 26-sep: canal, estado, datos técnicos (una etiqueta por dato) y la frase, por ese orden', () => {
    prepare(['working', 'checking', 'weak'], { activeHash: hash(1) });
    act(() =>
      sessionStore.set((s) => ({
        ...s,
        entries: s.entries.map((entry, i) =>
          i === 0 && entry.probe
            ? { ...entry, probe: { ...entry.probe, rateKbps: 4200, videoCodec: 'hevc' } }
            : entry,
        ),
      })),
    );
    renderWithApp(<SourcesPanel variant="list" />);
    const list = screen.getByRole('list', { name: 'Fuentes del partido' });
    const [first, second] = within(list).getAllByRole('button');
    const lines = (poster: HTMLElement) =>
      [...poster.querySelector('.src-poster__body')!.children].map((child) => child.className);
    // Verificada con datos: la frase «verificada» repetiría el estado y no sale.
    expect(lines(first!)).toEqual(['src-poster__name', 'src-poster__state', 'src-poster__tags']);
    expect(first!.querySelector('.src-poster__state')).toHaveTextContent(/^Verificada$/);
    const tags = [...first!.querySelectorAll('.src-poster__tag')].map((tag) => tag.textContent);
    expect(tags).toEqual(['1080p', 'HEVC', 'AceStream']);
    // Cada dato en su etiqueta, sin «·» ni «…» pegados.
    expect(first!.querySelector('.src-poster__tags')).not.toHaveTextContent(/[·…]/);
    // Comprobando: la frase dice algo más que el estado y sí sale, al final.
    expect(second!.querySelector('.src-poster__state')).toHaveTextContent(/^Comprobando$/);
    expect(second!.querySelector('.src-poster__detail')).toHaveTextContent(
      /^probándose en el segundo motor$/,
    );
    expect(lines(second!).at(-1)).toBe('src-poster__detail');
    // El aria-label largo no cambia: sigue diciendo la frase entera.
    expect(first).toHaveAttribute(
      'aria-label',
      expect.stringMatching(
        /^Fuente 1: M\+ Liga de Campeones --> Elcano · AceStream · Elcano · Hash .* · verificada/,
      ),
    );
  });

  it('sin datos técnicos la línea de etiquetas no aparece', () => {
    prepare(['working']);
    act(() =>
      sessionStore.set((s) => ({
        ...s,
        entries: s.entries.map((entry) => ({
          ...entry,
          origin: 'saved',
          listaId: null,
          title: 'M+ Liga de Campeones',
        })),
      })),
    );
    renderWithApp(<SourcesPanel variant="list" />);
    const list = screen.getByRole('list', { name: 'Fuentes del partido' });
    const [first] = within(list).getAllByRole('button');
    expect(first!.querySelector('.dorsal__abbrev')).toHaveTextContent(/^Guardada$/);
    expect(first!.querySelector('.src-poster__tags')).toBeNull();
    expect(first!.querySelector('.src-poster__state')).toHaveTextContent(/^Verificada$/);
  });

  it('atajos: N pasa a la siguiente y los números eligen', () => {
    prepare(['working', 'working', 'weak'], { activeHash: hash(1) });
    renderWithApp(<SourcesPanel variant="list" />);
    fireEvent.keyDown(window, { key: 'n' });
    expect(getPlayer().channel?.hash).toBe(hash(2));
    fireEvent.keyDown(window, { key: '3' });
    expect(getPlayer().channel?.hash).toBe(hash(3));
  });

  it('sin fuente activa dentro de un partido solo queda «Pegar hash» (regla 26)', () => {
    prepare(['failed', 'failed'], {
      activeHash: null,
      failureText:
        'Ninguna de las 2 fuentes da señal ahora mismo. Prueba "Rebuscar" o pega un Content ID.',
    });
    renderWithApp(<SourcesPanel variant="list" />);
    const group = screen.getByRole('group', { name: 'Acciones de la fuente' });
    expect(
      within(group)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Pegar hash']);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Ninguna de las 2 fuentes da señal ahora mismo.',
    );
    fireEvent.click(within(group).getByRole('button', { name: 'Pegar hash' }));
    expect(getSession().pasteOpen).toBe(true);
  });
});

describe('inspector y rack (escritorio)', () => {
  it('B-264: el panel solo se desplaza al CAMBIAR la activa, lo justo y nunca con scrollIntoView', () => {
    prepare(['working', 'working', 'working'], { activeHash: hash(1) });
    const scrollIntoView = (Element.prototype.scrollIntoView = vi.fn());
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const box = (top: number, bottom: number) =>
        ({
          top,
          bottom,
          left: 0,
          right: 300,
          width: 300,
          height: bottom - top,
          x: 0,
          y: top,
          toJSON: () => ({}),
        }) as DOMRect;
      if (this.classList.contains('app-aside')) return box(0, 300);
      // La activa (aria-current) queda por debajo del borde del panel.
      if (this.getAttribute('aria-current') === 'true') return box(500, 540);
      return box(0, 0);
    });
    try {
      renderWithApp(
        <div className="app-aside">
          <SourcesPanel variant="rack" />
        </div>,
        { kind: 'wide' },
      );
      const panel = document.querySelector<HTMLElement>('.app-aside')!;
      const scrollTo = (panel.scrollTo = vi.fn());
      // Repintar con la misma activa (el comprobador cambia estados): no se mueve.
      act(() =>
        sessionStore.set((s) => ({ ...s, scan: s.scan ? { ...s.scan, checked: 3 } : s.scan })),
      );
      expect(scrollTo).not.toHaveBeenCalled();
      // Cambia la activa: se desplaza el panel lo justo (252 = 540 − 300 + 12), no la página.
      act(() => sessionStore.set((s) => ({ ...s, activeHash: hash(3) })));
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollTo.mock.calls[0]?.[0]).toMatchObject({ top: 252 });
      act(() =>
        sessionStore.set((s) => ({ ...s, scan: s.scan ? { ...s.scan, checked: 2 } : s.scan })),
      );
      expect(scrollTo).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      rect.mockRestore();
      delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });

  it('rack de carteles (forma + palabra de cada estado) y todas las acciones de la fuente activa', () => {
    prepare(['working', 'weak', 'checking'], { activeHash: hash(1) });
    const { container } = renderWithApp(<SourcesPanel variant="rack" />, { kind: 'wide' });
    const list = screen.getByRole('list', { name: 'Fuentes del partido' });
    const posters = within(list).getAllByRole('button');
    expect(posters.map((poster) => poster.getAttribute('data-state'))).toEqual([
      'ok',
      'weak',
      'checking',
    ]);
    // Cada cartel: anillo con su palabra (nunca solo color) y sin miniatura de vídeo.
    for (const word of ['Verificada', 'Floja', 'Comprobando'])
      expect(within(list).getByText(word, { selector: '.sring__word' })).toBeInTheDocument();
    expect(container.querySelectorAll('.src-poster .sring')).toHaveLength(3);
    expect(container.querySelector('.src-list video, .src-list img, .src-list canvas')).toBeNull();
    const group = screen.getByRole('group', { name: 'Acciones de la fuente' });
    const names = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual([
      'Favorito',
      'Rebuscar',
      'Pegar hash',
      'Copiar hash',
      'Es el canal correcto',
      'Reportar',
      'Abrir en…',
    ]);
    fireEvent.click(within(group).getByRole('button', { name: 'Abrir en…' }));
    expect(
      screen.getByRole('menuitem', { name: /Copiar URL del stream \(VLC\)/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('menuitem', { name: /Abrir en la app de AceStream/ }),
    ).toBeInTheDocument();
  });

  it('«Reportar» abre la hoja con los 5 motivos y manda el elegido', async () => {
    prepare(['working', 'working'], { activeHash: hash(1) });
    renderWithApp(
      <>
        <SourcesPanel variant="list" />
        <ReportSheet />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reportar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Reportar fuente' });
    expect(
      within(dialog).getByText(/Fuente 1 · M\+ Liga de Campeones --> Elcano/),
    ).toBeInTheDocument();
    const radios = within(dialog).getAllByRole('radio');
    expect(radios.map((r) => (r.closest('label') as HTMLElement).textContent)).toEqual([
      'No arranca',
      'Se corta',
      'Canal incorrecto',
      'Mala calidad',
      'Problema de audio',
    ]);
    expect(radios[0]).toBeChecked();
    fireEvent.click(radios[2]!);
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Reportar y comprobar' }));
    });
    await screen
      .findByText('Fuente apartada; el segundo motor ya la está comprobando', { exact: false })
      .catch(() => null);
    const call = net.calls.find((c) => c.url === '/api/v1/sources/report');
    expect(call?.body).toMatchObject({ id: hash(1), reason: 'wrong_channel' });
    expect(getSession().entries[0]?.reported?.reason).toBe('wrong_channel');
    expect(getSession().reportFor).toBeNull();
  });
});

describe('«Encontrar canal»', () => {
  it('candidatos con su origen y disponibilidad, «Recordar» marcado y vínculo a mano', async () => {
    const data = resolution(2, { status: 'choices', candidate: null, scan: null });
    data.candidates[0] = candidate(1, {
      source: 'acestream',
      availability: 0.91,
      title: 'Zapping HD',
    });
    sessionStore.set({
      ...sessionStore.get(),
      key: 'm:m1',
      kind: 'match',
      phase: 'choices',
      resolution: data,
      resolverOpen: true,
    });
    renderWithApp(<ResolverSheet />);
    const dialog = await screen.findByRole('dialog', { name: 'Encontrar canal' });
    expect(within(dialog).getByText('Elige la señal que quieres usar')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Hay varias coincidencias posibles. No reproduciremos ninguna sin que la confirmes.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Buscador AceStream · 91% disponible')).toBeInTheDocument();
    expect(within(dialog).getByText('Vínculos ✓')).toBeInTheDocument();
    expect(
      within(dialog).getByRole('checkbox', {
        name: /Recordar mi elección para M\+ Liga de Campeones/,
      }),
    ).toBeChecked();
    expect(
      within(dialog).getByRole('button', { name: 'Copiar nombre del canal' }),
    ).toBeInTheDocument();
    // Nada suena hasta que se elige.
    expect(getPlayer().channel).toBeNull();
    fireEvent.change(within(dialog).getByLabelText('Content ID o enlace AceStream'), {
      target: { value: 'hola' },
    });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Vincular y reproducir' }));
    });
    expect(
      within(dialog).getByText(
        'Introduce un Content ID o enlace AceStream válido de 40 caracteres.',
      ),
    ).toBeInTheDocument();
  });

  it('sin candidatos: el texto depende de si el buscador estaba disponible', async () => {
    sessionStore.set({
      ...sessionStore.get(),
      key: 'm:m1',
      kind: 'match',
      phase: 'not_found',
      resolution: resolution(0, {
        status: 'not_found',
        candidate: null,
        scan: null,
        engineAvailable: false,
      }),
      resolverOpen: true,
    });
    renderWithApp(<ResolverSheet />);
    const dialog = await screen.findByRole('dialog', { name: 'Encontrar canal' });
    expect(within(dialog).getByText('No hemos encontrado el canal')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'Revisamos tus listas, pero el buscador AceStream no estaba disponible. Puedes introducirlo manualmente.',
      ),
    ).toBeInTheDocument();
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
  });
});

/* IPTV en el selector (docs/iptv.md §8.1-8.3): distintivo, sin hash, nunca
   plegada, y sin «Favorito», «Copiar hash» ni «Abrir en…». */
describe('IPTV', () => {
  function prepareWithIptv(activeIptv: boolean) {
    prepare(['failed', 'working', 'queued', 'failed']);
    const iptv = entryFromCandidate(
      candidate(100, {
        title: 'M+ Liga de Campeones --> Casa',
        source: 'iptv',
        listaId: 'p_Ab3dE5gH',
        iptv: { provider: 'Casa', quality: 'fhd', backup: false, guide: false },
      }),
    );
    act(() =>
      sessionStore.set((s) => ({
        ...s,
        // Sin veredicto del comprobador y con un fallo del reproductor: aun así, visible.
        entries: [
          {
            ...iptv,
            playerVerdict: { state: 'failed', reason: 'player_failed', at: Date.now() },
          },
          ...s.entries,
        ],
        activeHash: activeIptv ? hash(100) : hash(3),
      })),
    );
  }

  it('cartel con «IPTV», el proveedor y la calidad; sin hash y nunca plegado', () => {
    prepareWithIptv(false);
    renderWithApp(<SourcesPanel variant="list" />);
    const list = screen.getByRole('list', { name: 'Fuentes del partido' });
    const iptv = within(list).getAllByRole('button')[0]!;
    expect(iptv).toHaveAttribute('data-origin', 'iptv');
    expect(iptv.querySelector('.src-poster__tile')).toHaveTextContent('IPTV');
    expect(iptv.querySelector('.dorsal__abbrev')).toHaveTextContent(/^Casa$/);
    expect(iptv.querySelector('.src-poster__name')).toHaveTextContent(/^M\+ Liga de Campeones$/);
    const tags = [...iptv.querySelectorAll('.src-poster__tags .src-poster__tag')];
    expect(tags.map((tag) => tag.textContent)).toEqual(['1080p', 'IPTV']);
    expect(iptv.getAttribute('aria-label')).toMatch(
      /^Fuente 1: M\+ Liga de Campeones · IPTV · Casa · 1080p · no arrancó en el reproductor/,
    );
    expect(iptv.getAttribute('aria-label')).not.toMatch(/Hash/);
  });

  it('su menú no ofrece «Copiar hash» ni «Abrir en la app de AceStream»', () => {
    prepareWithIptv(false);
    renderWithApp(<SourcesPanel variant="list" />);
    const list = screen.getByRole('list', { name: 'Fuentes del partido' });
    fireEvent.contextMenu(within(list).getAllByRole('button')[0]!, { clientX: 10, clientY: 10 });
    const items = screen.getAllByRole('menuitem').map((item) => item.textContent);
    expect(items).toContain('Ver esta fuente');
    expect(items).toContain('Reportar…');
    expect(items).not.toContain('Copiar hash');
    expect(items).not.toContain('Abrir en la app de AceStream');
  });

  it('con la IPTV en pantalla, el inspector no tiene «Favorito», «Copiar hash» ni «Abrir en…»', () => {
    prepareWithIptv(true);
    renderWithApp(<SourcesPanel variant="rack" />, { kind: 'wide' });
    const group = screen.getByRole('group', { name: 'Acciones de la fuente' });
    const names = within(group)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(names).toEqual(['Rebuscar', 'Pegar hash', 'Es el canal correcto', 'Reportar']);
  });
});
