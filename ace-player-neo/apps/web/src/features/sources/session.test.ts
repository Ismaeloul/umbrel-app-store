/* El controlador de las fuentes: resolución, comprobador (SSE y respaldo de
   sondeo), arranque automático, política única de cambio de fuente (P16),
   reportes, «Rebuscar», vínculos y el modo canal. Sin red: fetch simulado. */

import type { ScanJob } from '@ace/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetMode, setMode } from '../../api/mode.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import { dispatchSse } from '../../api/sse.ts';
import { resetToasts, toastStore } from '../../notices/toasts.ts';
import {
  getPlayer,
  notifySourceFailed,
  playerStore,
  resetPlayerApi,
  stop,
} from '../../player/api.ts';
import { json, mockFetch, type MockCall } from '../../test/fetch.ts';
import {
  addManualSource,
  bindManual,
  chooseCandidate,
  confirmSource,
  endSession,
  enterChannel,
  enterMatch,
  getSession,
  leaveSession,
  reportSource,
  research,
  resetSessionForTests,
  selectSource,
  stepSource,
} from './session.ts';
import { INVALID_HASH_TEXT } from './model.ts';
import { hash, JOB, REPORT_JOB, resolution, scanJob, testMatch } from './test-utils.ts';

const flush = () => vi.advanceTimersByTimeAsync(0);
const toasts = () => toastStore.get().map((t) => t.text);

let scan: ScanJob;
let net: ReturnType<typeof mockFetch>;

function install(routes: Record<string, unknown> = {}) {
  net = mockFetch({
    'GET /api/v1/football/resolve': () => json(resolution(3)),
    [`GET /api/v1/football/scans/${JOB}`]: () => json(scan),
    ...(routes as Record<string, never>),
  });
}

const calls = (path: string): MockCall[] => net.calls.filter((call) => call.url.startsWith(path));

beforeEach(() => {
  vi.useFakeTimers();
  setMode('live', 'bootstrap');
  realtimeStore.set({ status: 'fallback', lastEventId: null, attempts: 0 });
  resetPlayerApi();
  resetSessionForTests();
  resetToasts();
  scan = scanJob(['checking', 'checking', 'queued']);
  install();
});

afterEach(() => {
  endSession();
  net.restore();
  resetMode();
  realtimeStore.set({ status: 'idle', lastEventId: null, attempts: 0 });
  vi.useRealTimers();
});

describe('entrar al partido', () => {
  it('resuelve con los canales del partido y el cliente de esta pestaña', async () => {
    enterMatch(testMatch());
    await flush();
    const [call] = calls('/api/v1/football/resolve');
    const query = new URLSearchParams(call!.url.split('?')[1]);
    expect(query.get('match')).toBe('m1');
    expect(query.getAll('channel')).toEqual(['M+ Liga de Campeones']);
    expect(query.get('client')).toMatch(/^v_/);
    expect(getSession()).toMatchObject({ phase: 'ready', autoVerified: true });
    expect(getSession().entries).toHaveLength(3);
    // Mientras tanto, el vídeo lo dice.
    expect(getPlayer().waiting).toMatch(/Comprobando (3 fuentes|fuentes…)/);
  });

  it('arranca sola la primera verificada y lo avisa', async () => {
    enterMatch(testMatch());
    await flush();
    expect(getPlayer().channel).toBeNull();
    scan = scanJob(['failed', 'working', 'checking']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().channel?.hash).toBe(hash(2));
    expect(getPlayer().origin).toBe('auto');
    expect(getPlayer().channel?.subtitle).toBe('Fuente 2, Faro');
    expect(getPlayer().channel?.title).toBe('M+ Liga de Campeones');
    expect(getPlayer().waiting).toBeNull();
    expect(toasts()).toContain('Fuente 2 verificada: arrancando');
  });

  it('con el comprobador terminado y sin verificadas, prueba la floja', async () => {
    enterMatch(testMatch());
    await flush();
    scan = scanJob(['failed', 'weak', 'failed']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().channel?.hash).toBe(hash(2));
    expect(toasts()).toContain(
      'Ninguna verificada del todo; probamos la fuente 2, que da señal floja',
    );
  });

  it('en reposo sin ninguna viva dice a qué hora reintenta; terminado sin ninguna, lo dice', async () => {
    enterMatch(testMatch());
    await flush();
    scan = scanJob(['failed', 'failed', 'failed'], {
      status: 'waiting',
      retryAt: '2026-09-23T18:51:00.000Z',
    });
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().waiting).toBe(
      'Ninguna de las 3 fuentes da señal todavía. Las vuelvo a probar a las 20:51 y arranco la primera que responda.',
    );
    scan = scanJob(['failed', 'failed', 'failed']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getSession().failureText).toBe(
      'Ninguna de las 3 fuentes da señal ahora mismo. Prueba "Rebuscar" o pega un Content ID.',
    );
    expect(getSession().autoVerified).toBe(false);
    expect(getPlayer().channel).toBeNull();
  });

  it('sin comprobador reproduce la mejor colocada', async () => {
    install({ 'GET /api/v1/football/resolve': () => json(resolution(2, { scan: null })) });
    enterMatch(testMatch());
    await flush();
    expect(getPlayer().channel?.hash).toBe(hash(1));
    expect(getPlayer().origin).toBe('user');
  });

  it('sin canales anunciados no pregunta nada', async () => {
    enterMatch(testMatch({ channels: [] }));
    await flush();
    expect(getSession().phase).toBe('no_channels');
    expect(toasts()).toContain('El canal todavía no está anunciado');
    expect(net.calls).toHaveLength(0);
  });

  it('varias coincidencias o ninguna: «Encontrar canal»; sin red, como no encontrado y sin buscador', async () => {
    install({
      'GET /api/v1/football/resolve': () =>
        json(resolution(2, { status: 'choices', candidate: null, scan: null })),
    });
    enterMatch(testMatch());
    await flush();
    expect(getSession()).toMatchObject({ phase: 'choices', resolverOpen: true });
    expect(getPlayer().channel).toBeNull();

    endSession();
    install({ 'GET /api/v1/football/resolve': () => Promise.reject(new TypeError('sin red')) });
    enterMatch(testMatch({ id: 'm2' }));
    await flush();
    expect(getSession()).toMatchObject({ phase: 'not_found', resolverOpen: true });
    expect(getSession().resolution?.engineAvailable).toBe(false);
  });

  it('volver al mismo partido mientras suena no vuelve a resolver', async () => {
    enterMatch(testMatch());
    await flush();
    scan = scanJob(['working', 'checking', 'queued']);
    await vi.advanceTimersByTimeAsync(1500);
    leaveSession();
    enterMatch(testMatch());
    await flush();
    expect(calls('/api/v1/football/resolve')).toHaveLength(1);
  });

  it('salir antes de que arranque nada apaga el automatismo', async () => {
    enterMatch(testMatch());
    await flush();
    leaveSession();
    scan = scanJob(['working', 'working', 'queued']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(getPlayer().channel).toBeNull();
    expect(getSession().autoVerified).toBe(false);
  });
});

describe('comprobador: SSE y respaldo de sondeo', () => {
  it('con el SSE abierto no se sondea: cada scan.progress pide el estado', async () => {
    realtimeStore.set({ status: 'open', lastEventId: null, attempts: 0 });
    enterMatch(testMatch());
    await flush();
    const before = calls(`/api/v1/football/scans/${JOB}`).length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(calls(`/api/v1/football/scans/${JOB}`).length).toBe(before);
    scan = scanJob(['working', 'checking', 'queued']);
    dispatchSse(
      'scan.progress',
      {
        jobId: JOB,
        kind: 'interactive',
        status: 'running',
        total: 3,
        checked: 1,
        playable: 1,
        failed: 0,
        waiting: 0,
        retryAt: null,
        matchId: 'm1',
      },
      { id: '1', synthetic: false },
    );
    await flush();
    expect(calls(`/api/v1/football/scans/${JOB}`).length).toBe(before + 1);
    expect(getPlayer().channel?.hash).toBe(hash(1));
  });

  it('un scan.verdict cambia la fuente al momento', async () => {
    realtimeStore.set({ status: 'open', lastEventId: null, attempts: 0 });
    enterMatch(testMatch());
    await flush();
    dispatchSse(
      'scan.verdict',
      {
        jobId: JOB,
        hash: hash(3),
        state: 'weak',
        reason: 'starved',
        by: 'scanner',
        checkedAt: '2026-09-23T18:30:00.000Z',
      },
      { id: '2', synthetic: false },
    );
    expect(getSession().entries[2]?.probe).toMatchObject({ state: 'weak', reason: 'starved' });
  });

  it('tres fallos seguidos: «El comprobador no responde» y se enseñan todas', async () => {
    install({
      [`GET /api/v1/football/scans/${JOB}`]: () =>
        json({ error: { code: 'scan_not_found', message: 'No', requestId: 'r' } }, 404),
    });
    enterMatch(testMatch());
    await flush();
    await vi.advanceTimersByTimeAsync(3100);
    expect(toasts()).toContain('El comprobador no responde; se muestran todas las fuentes');
    expect(getSession().scan).toBeNull();
    expect(getSession().entries.every((entry) => entry.probe === null)).toBe(true);
    // Sin comprobador y sin nada en pantalla: la mejor colocada.
    expect(getPlayer().channel?.hash).toBe(hash(1));
  });
});

describe('política única de cambio de fuente (P16)', () => {
  async function playingAuto() {
    enterMatch(testMatch());
    await flush();
    scan = scanJob(['working', 'working', 'checking']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().channel?.hash).toBe(hash(1));
  }

  it('en automático, si la fuente se cae pasa a la siguiente verificada', async () => {
    await playingAuto();
    const reply = notifySourceFailed({
      channel: getPlayer().channel!,
      origin: 'auto',
      outcome: 'cayo',
      seconds: 90,
      reason: 'La imagen se ha quedado parada',
    });
    expect(reply.next).toBe(true);
    expect(getPlayer().channel?.hash).toBe(hash(2));
    // Se vio 90 s: queda floja y visible (regla 21).
    expect(getSession().entries[0]?.playerVerdict).toMatchObject({
      state: 'weak',
      reason: 'player_dropped',
    });
  });

  it('agotadas mientras sigue comprobando: espera a la siguiente', async () => {
    await playingAuto();
    notifySourceFailed({
      channel: getPlayer().channel!,
      origin: 'auto',
      outcome: 'fallo',
      seconds: 0,
      reason: 'x',
    });
    const reply = notifySourceFailed({
      channel: getPlayer().channel!,
      origin: 'auto',
      outcome: 'fallo',
      seconds: 0,
      reason: 'x',
    });
    expect(reply).toEqual({
      next: false,
      message:
        'Esta fuente no responde. Sigo comprobando las demás y arranco la primera que funcione.',
    });
  });

  it('en cuanto eliges una, todo es manual: nunca salta sola', async () => {
    await playingAuto();
    selectSource(hash(2));
    expect(getSession()).toMatchObject({
      autoVerified: false,
      manualChosen: true,
      activeHash: hash(2),
    });
    expect(getPlayer().origin).toBe('user');
    const reply = notifySourceFailed({
      channel: getPlayer().channel!,
      origin: 'user',
      outcome: 'fallo',
      seconds: 0,
      reason: 'x',
    });
    expect(reply.next).toBe(false);
    // Cuentan las que no han fallado (la 1 verificada y la 3, que aún se comprueba).
    expect(reply.message).toBe(
      'Esta señal no responde. Tienes 2 fuentes más para este partido: prueba otra en el selector.',
    );
    expect(getPlayer().channel?.hash).toBe(hash(2));
  });

  it('pulsar la activa no hace nada; deslizar pasa a la siguiente de las que se ven', async () => {
    await playingAuto();
    const before = getPlayer();
    selectSource(hash(1));
    expect(getPlayer()).toBe(before);
    stepSource(1, [hash(1), hash(2)]);
    expect(getPlayer().channel?.hash).toBe(hash(2));
    stepSource(1, [hash(1), hash(2)]);
    expect(getPlayer().channel?.hash).toBe(hash(1));
  });

  it('detener apaga todo lo automático (regla 17)', async () => {
    await playingAuto();
    stop();
    expect(getSession()).toMatchObject({ stopped: true, autoVerified: false });
    scan = scanJob(['working', 'working', 'working']);
    await vi.advanceTimersByTimeAsync(3000);
    expect(getPlayer().channel).toBeNull();
  });

  it('reproducir algo que no es de la lista termina la sesión', async () => {
    await playingAuto();
    const { play } = await import('../../player/api.ts');
    play({ hash: hash(77), title: 'Otro canal' });
    expect(getSession().key).toBeNull();
  });
});

describe('acciones', () => {
  it('pegar un hash lo añade como fuente manual del partido y lo reproduce', async () => {
    enterMatch(testMatch());
    await flush();
    expect(addManualSource('no vale')).toBe(false);
    expect(addManualSource(`acestream://${hash(42)}`)).toBe(true);
    const entry = getSession().entries.at(-1);
    expect(entry).toMatchObject({ id: hash(42), origin: 'manual', ih: null });
    expect(getPlayer().channel).toMatchObject({
      hash: hash(42),
      title: 'M+ Liga de Campeones',
      kind: 'auto',
    });
    expect(getSession().autoVerified).toBe(false);
    expect(toasts()).toContain('Hash externo añadido y reproduciendo');
  });

  it('rebuscar reúne las nuevas y da el veredicto al terminar el comprobador', async () => {
    enterMatch(testMatch());
    await flush();
    scan = scanJob(['working', 'failed', 'failed']);
    await vi.advanceTimersByTimeAsync(1500);
    install({
      'GET /api/v1/football/resolve': () => json(resolution(4, { research: true })),
    });
    scan = scanJob(['working', 'failed', 'failed', 'checking']);
    await research();
    const [call] = calls('/api/v1/football/resolve');
    const query = new URLSearchParams(call!.url.split('?')[1]);
    expect(query.get('research')).toBe('1');
    expect(query.get('current')).toBe(hash(1));
    expect(query.get('currentIh')).toBe('0');
    expect(toasts()).toContain(
      'Rebúsqueda: 4 señales reunidas, 1 sin probar antes · comprobándolas…',
    );
    scan = scanJob(['working', 'failed', 'failed', 'working']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(toasts()).toContain('Rebúsqueda terminada · 1 fuente nueva que funciona');
  });

  it('rebuscar: sin nada nuevo y con plazo agotado', async () => {
    enterMatch(testMatch());
    await flush();
    install({
      'GET /api/v1/football/resolve': () => json(resolution(0, { candidate: null, scan: null })),
    });
    await research();
    expect(toasts()).toContain('No han aparecido fuentes nuevas para este partido');
    // Un servidor que no contesta: solo acaba cuando el cliente aborta por plazo.
    install({
      'GET /api/v1/football/resolve': (call: MockCall) =>
        new Promise<Response>((_, reject) =>
          call.signal?.addEventListener('abort', () => reject(call.signal?.reason)),
        ),
    });
    const pending = research();
    await vi.advanceTimersByTimeAsync(30_000);
    await pending;
    expect(toasts()).toContain('La rebúsqueda está tardando demasiado; vuelve a intentarlo');
    expect(getSession().researching).toBe(false);
  });

  it('reportar aparta la fuente sin cambiarla y sigue al comprobador', async () => {
    let report = scanJob(['checking'], { kind: 'report' }, REPORT_JOB);
    install({
      'POST /api/v1/sources/report': (call: MockCall) =>
        json({
          report: {
            reportId: 'rep_1',
            id: (call.body as { id: string }).id,
            channel: 'M+ Liga de Campeones',
            matchId: 'm1',
            reason: 'not_starting',
            state: 'checking',
            checkReason: '',
            reportedAt: '2026-09-23T18:30:00.000Z',
            lastCheckedAt: null,
            quarantineUntil: '2099-01-01T00:00:00.000Z',
          },
          scan: {
            id: REPORT_JOB,
            statusUrl: `/api/v1/football/scans/${REPORT_JOB}`,
            total: 1,
            initialCount: 1,
          },
        }),
      [`GET /api/v1/football/scans/${REPORT_JOB}`]: () => json(report),
    });
    enterMatch(testMatch());
    await flush();
    scan = scanJob(['working', 'working', 'queued']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(await reportSource(hash(1), 'not_starting')).toBe(true);
    const [call] = calls('/api/v1/sources/report');
    expect(call!.body).toMatchObject({
      id: hash(1),
      reason: 'not_starting',
      matchId: 'm1',
      channel: 'M+ Liga de Campeones',
      source: 'Elcano',
      ih: false,
    });
    expect(getSession().entries[0]?.reported?.reason).toBe('not_starting');
    expect(getPlayer().channel?.hash).toBe(hash(1));
    expect(toasts()).toContain('Fuente apartada; el segundo motor ya la está comprobando');
    report = { ...scanJob(['working'], { kind: 'report' }, REPORT_JOB) };
    await vi.advanceTimersByTimeAsync(1500);
    expect(toasts()).toContain('El segundo motor confirma que la fuente vuelve a funcionar');
    expect(getSession().entries[0]?.reported).toBeNull();
  });

  it('si el reporte falla, lo dice', async () => {
    install({
      'POST /api/v1/sources/report': () =>
        json({ error: { code: 'bad_request', message: 'No', requestId: 'r' } }, 400),
    });
    enterMatch(testMatch());
    await flush();
    expect(await reportSource(hash(2), 'audio')).toBe(false);
    expect(toasts()).toContain('No se pudo enviar el reporte');
  });

  it('«Es el canal correcto» manda el aprendizaje con el canal del partido', async () => {
    install({
      'POST /api/v1/sources/feedback': () =>
        json({
          feedback: {
            id: hash(1),
            title: 'x',
            channel: 'M+ Liga de Campeones',
            channelKey: 'liga campeones',
            verdict: 'correct',
            reason: 'not_starting',
            corrections: 1,
            updatedAt: '2026-09-23T18:30:00.000Z',
          },
          learningCount: 1,
        }),
    });
    enterMatch(testMatch());
    await flush();
    expect(await confirmSource(hash(1))).toBe(true);
    expect(calls('/api/v1/sources/feedback')[0]?.body).toMatchObject({
      id: hash(1),
      verdict: 'correct',
      channel: 'M+ Liga de Campeones',
      reason: 'not_starting',
    });
    expect(getSession().entries[0]?.learned).toBe('correct');
    expect(toasts()).toContain('La asociación queda aprendida en el NAS');
  });
});

describe('«Encontrar canal»', () => {
  beforeEach(async () => {
    install({
      'GET /api/v1/football/resolve': () =>
        json(resolution(2, { status: 'choices', candidate: null, scan: null })),
      'POST /api/v1/football/bindings': (call: MockCall) => {
        const body = call.body as { channel: string; id: string; title: string; ih: boolean };
        const binding = {
          ...body,
          channelKey: 'liga campeones',
          updatedAt: '2026-09-23T18:30:00.000Z',
        };
        return json({ binding, channelBindings: [binding] });
      },
    });
    enterMatch(testMatch());
    await flush();
  });

  it('elegir con «Recordar» vincula y reproduce directamente', async () => {
    await chooseCandidate(
      { id: hash(2), title: 'M+ Liga de Campeones --> Faro', ih: false, source: 'm3u' },
      true,
    );
    expect(calls('/api/v1/football/bindings')[0]?.body).toMatchObject({
      channel: 'M+ Liga de Campeones',
      id: hash(2),
      ih: false,
    });
    expect(getPlayer().channel?.hash).toBe(hash(2));
    expect(getSession()).toMatchObject({ resolverOpen: false, phase: 'ready' });
  });

  it('sin «Recordar» no vincula; si vincular falla, suena igual con aviso', async () => {
    await chooseCandidate({ id: hash(1), title: 'x', ih: false, source: 'm3u' }, false);
    expect(calls('/api/v1/football/bindings')).toHaveLength(0);
    install({ 'POST /api/v1/football/bindings': () => Promise.reject(new TypeError('sin red')) });
    await chooseCandidate({ id: hash(2), title: 'x', ih: false, source: 'm3u' }, true);
    expect(getPlayer().channel?.hash).toBe(hash(2));
    expect(toasts()).toContain('El canal se reproduce, pero no pudimos recordar la asociación');
  });

  it('vincular a mano valida el Content ID', async () => {
    expect(await bindManual('hola')).toBe(INVALID_HASH_TEXT);
    expect(await bindManual(`acestream://${hash(9)}`)).toBeNull();
    expect(getPlayer().channel?.hash).toBe(hash(9));
  });
});

describe('canal de la biblioteca', () => {
  const item = (n: number, title: string) => ({
    id: hash(n),
    title,
    type: 'web' as const,
    category: 'Deportes',
    date: '2026-09-23T18:30:00.000Z',
    fromWebSync: true,
    ih: false,
  });

  it('abre sus hermanas y, si nada suena, lo reproduce; tras detener no lo relanza', async () => {
    enterChannel({
      hash: hash(1),
      title: 'DAZN 1',
      siblings: [item(1, 'DAZN 1'), item(2, 'DAZN 1 FHD')],
      activeListId: 'principal',
    });
    expect(getSession()).toMatchObject({ kind: 'channel', activeHash: hash(1) });
    expect(getSession().entries).toHaveLength(2);
    expect(getPlayer()).toMatchObject({ origin: 'library' });
    expect(getPlayer().channel?.hash).toBe(hash(1));
    stop();
    endSession();
    enterChannel({ hash: hash(1), title: 'DAZN 1', siblings: [], activeListId: null });
    expect(getPlayer().channel).toBeNull();
    // Sin hermanas no hay selector.
    expect(getSession().entries).toHaveLength(0);
  });

  it('en un canal nunca se salta de fuente sola', async () => {
    enterChannel({
      hash: hash(1),
      title: 'DAZN 1',
      siblings: [item(1, 'DAZN 1'), item(2, 'DAZN 1 FHD')],
      activeListId: null,
    });
    const reply = notifySourceFailed({
      channel: getPlayer().channel!,
      origin: 'library',
      outcome: 'fallo',
      seconds: 0,
      reason: 'x',
    });
    expect(reply.next).toBe(false);
    expect(reply.message).toContain('para este canal');
  });
});

/* Lo que faltaba por probar del inventario §7.3, §7.6 y §7.8 (verificación
   del inventario, docs/verificacion-web.md). */
describe('inventario: salto de entrada, rebúsqueda con IA y fallos de las acciones', () => {
  it('salto de entrada (B-080): la elegida en «Encontrar canal» sale fallida y no suena → UNA vez a la primera viva', async () => {
    install({
      'GET /api/v1/football/resolve': () =>
        json(resolution(3, { status: 'choices', candidate: null })),
    });
    enterMatch(testMatch());
    await flush();
    expect(getSession().resolverOpen).toBe(true);
    await chooseCandidate(
      { id: hash(1), title: 'M+ Liga de Campeones --> Elcano', ih: false, source: 'm3u' },
      false,
    );
    expect(getPlayer().channel?.hash).toBe(hash(1));
    // Se reproduce directamente, sin esperar al comprobador (§5.2).
    expect(getSession().autoVerified).toBe(false);
    scan = scanJob(['failed', 'working', 'checking']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().channel?.hash).toBe(hash(2));
    expect(getPlayer().origin).toBe('auto');
    expect(toasts()).toContain(
      'La señal inicial no responde; probamos automáticamente la fuente 2',
    );
    expect(getSession().switchArmed).toBe(false);
    // Solo una vez: si la segunda también sale fallida, ya no salta sola.
    scan = scanJob(['failed', 'failed', 'working']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().channel?.hash).toBe(hash(2));
  });

  it('salto de entrada: si la elegida ya suena, no salta aunque el comprobador la dé por caída', async () => {
    install({
      'GET /api/v1/football/resolve': () =>
        json(resolution(3, { status: 'choices', candidate: null })),
    });
    enterMatch(testMatch());
    await flush();
    await chooseCandidate({ id: hash(1), title: 'x', ih: false, source: 'm3u' }, false);
    // El reproductor da la primera imagen: el salto se desarma.
    playerStore.set((state) => ({ ...state, phase: 'reproduciendo', started: true }));
    await flush();
    expect(getSession().switchArmed).toBe(false);
    scan = scanJob(['failed', 'working', 'checking']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(getPlayer().channel?.hash).toBe(hash(1));
    expect(toasts()).not.toContain(
      'La señal inicial no responde; probamos automáticamente la fuente 2',
    );
  });

  it('rebuscar con la IA (B-215): «· revisadas por la IA» al reunir y en el veredicto', async () => {
    enterMatch(testMatch());
    await flush();
    scan = scanJob(['working', 'failed', 'failed']);
    await vi.advanceTimersByTimeAsync(1500);
    install({
      'GET /api/v1/football/resolve': () =>
        json(
          resolution(4, {
            research: true,
            ai: { enabled: true, used: true, model: 'qwen2.5:3b', catalogSize: 40, error: null },
          }),
        ),
    });
    scan = scanJob(['working', 'failed', 'failed', 'checking']);
    await research();
    expect(toasts()).toContain(
      'Rebúsqueda: 4 señales reunidas, 1 sin probar antes · comprobándolas… · revisadas por la IA',
    );
    scan = scanJob(['working', 'failed', 'failed', 'failed']);
    await vi.advanceTimersByTimeAsync(1500);
    expect(toasts()).toContain(
      'Rebúsqueda terminada · ninguna fuente nueva funciona · revisadas por la IA',
    );
  });

  it('rebuscar sin canales anunciados no pregunta nada', async () => {
    enterMatch(testMatch({ channels: [] }));
    await flush();
    await research();
    expect(calls('/api/v1/football/resolve')).toHaveLength(0);
    expect(toasts()).toContain('Este partido todavía no tiene canales anunciados');
  });

  it('rebuscar con otro fallo: «No se pudo completar la rebúsqueda ahora mismo»', async () => {
    enterMatch(testMatch());
    await flush();
    install({
      'GET /api/v1/football/resolve': () =>
        json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500),
    });
    await research();
    expect(toasts()).toContain('No se pudo completar la rebúsqueda ahora mismo');
    expect(getSession().researching).toBe(false);
  });

  it('«Es el canal correcto» que falla lo dice y no marca nada', async () => {
    install({
      'POST /api/v1/sources/feedback': () =>
        json({ error: { code: 'internal', message: 'x', requestId: 'r' } }, 500),
    });
    enterMatch(testMatch());
    await flush();
    expect(await confirmSource(hash(1))).toBe(false);
    expect(toasts()).toContain('No se pudo guardar esta corrección');
    expect(getSession().entries[0]?.learned ?? null).toBeNull();
  });
});
