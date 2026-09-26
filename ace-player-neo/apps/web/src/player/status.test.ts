import { describe, expect, it } from 'vitest';
import { INITIAL_PLAYER_STATE, type PlayerState } from './api.ts';
import { acestreamLink, externalStreamUrl } from './clipboard.ts';
import { miniKicker } from './MiniPlayer.tsx';
import { formatSpeed, nerdRows } from './NerdPanel.tsx';
import { liveButton, stageMessage, statusFor } from './status.ts';
import { zappingList, zapTarget } from './zapping.ts';

const HASH = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function playing(patch: Partial<PlayerState> = {}): PlayerState {
  return {
    ...INITIAL_PLAYER_STATE,
    phase: 'reproduciendo',
    conn: 'activa',
    channel: { hash: HASH, title: 'M+ Liga de Campeones', lead: 'Fuente 1 verificada.' },
    started: true,
    desiredPlaying: true,
    live: { available: true, atLive: true, behindS: 1, delayS: 6 },
    ...patch,
  };
}

describe('línea de estado bajo el vídeo', () => {
  it('en directo: frase humana con la fuente y el retraso a la derecha (maqueta)', () => {
    expect(statusFor(playing())).toEqual({
      text: 'Fuente 1 verificada. Vas en directo.',
      signal: 'ok',
      meta: '6 s de retraso',
    });
  });

  it('por detrás del directo: lo dice con los segundos (sin la frase de la fuente, que no cabe en el móvil)', () => {
    const status = statusFor(
      playing({ live: { available: true, atLive: false, behindS: 36, delayS: 42 } }),
    );
    expect(status?.text).toBe('Vas por detrás del directo.');
    expect(status?.meta).toBe('−36 s');
  });

  it('rellenando: medidor flojo y cuánto falta', () => {
    const status = statusFor(
      playing({ phase: 'buffer', bufferAheadS: 3.4, rebuffering: { targetS: 8 } }),
    );
    expect(status?.signal).toBe('weak');
    expect(status?.meta).toBe('3 de 8 s');
  });

  it('reconectando y error', () => {
    expect(
      statusFor(
        playing({
          phase: 'reconectando',
          message: 'La señal se ha cortado: reconectando (1/3)…',
          attempt: { n: 1, max: 3 },
        }),
      ),
    ).toEqual({
      text: 'La señal se ha cortado: reconectando (1/3)…',
      signal: 'checking',
      tone: 'warn',
    });
    expect(statusFor(playing({ phase: 'error', message: 'Sin pares.' }))).toMatchObject({
      text: 'Sin pares.',
      signal: 'fail',
      tone: 'err',
    });
  });

  it('en reposo solo habla si hay algo que decir (el centro de partido pone lo suyo)', () => {
    expect(statusFor(INITIAL_PLAYER_STATE)).toBeNull();
    expect(statusFor({ ...INITIAL_PLAYER_STATE, waiting: 'Comprobando 5 fuentes…' })).toEqual({
      text: 'Comprobando 5 fuentes…',
      signal: 'checking',
    });
    /* La frase final (un id IPTV que no está en ningún sitio): sin «Comprobando». */
    const done = 'Has eliminado tu IPTV y este canal no está en AceStream.';
    expect(statusFor({ ...INITIAL_PLAYER_STATE, waiting: done, waitingFinal: true })).toEqual({
      text: done,
      signal: 'fail',
      tone: 'err',
    });
    expect(stageMessage({ ...INITIAL_PLAYER_STATE, waiting: done, waitingFinal: true })).toEqual({
      title: 'Sin señal',
      text: done,
      tone: 'idle',
    });
  });
});

describe('botón de directo (injerto B4)', () => {
  it('relleno «Directo» en el borde', () => {
    expect(liveButton(playing())).toMatchObject({ mode: 'live', text: 'Directo' });
  });
  it('contorno «Ir al directo · −34 s» por detrás', () => {
    const button = liveButton(
      playing({ live: { available: true, atLive: false, behindS: 34, delayS: 40 } }),
    );
    expect(button.mode).toBe('behind');
    expect(button.prefix + button.text).toBe('Ir al directo · −34 s');
  });
  it('«Reanudar» en pausa o bloqueado estando en el borde', () => {
    expect(liveButton(playing({ phase: 'pausado' })).text).toBe('Reanudar');
    expect(liveButton(playing({ phase: 'bloqueado' })).text).toBe('Reanudar');
  });
  it('sin canal, apagado', () => {
    expect(liveButton(INITIAL_PLAYER_STATE).mode).toBe('off');
  });
});

describe('panel del vídeo', () => {
  it('reposo, conectando, reconectando y error (textos del inventario §8.1)', () => {
    expect(stageMessage(INITIAL_PLAYER_STATE)?.title).toBe('Sin señal');
    expect(
      stageMessage({
        ...INITIAL_PLAYER_STATE,
        phase: 'cargando',
        conn: 'pidiendo',
        message: 'Conectando con AceStream…',
      }),
    ).toEqual({ title: 'Conectando', text: 'Conectando con AceStream…', tone: 'busy' });
    expect(stageMessage(playing({ phase: 'reconectando', conn: 'reconectando' }))?.title).toBe(
      'Reconectando',
    );
    expect(stageMessage(playing({ phase: 'error', conn: 'error', message: 'x' }))).toMatchObject({
      title: 'No se pudo abrir',
      tone: 'error',
    });
  });
  it('reanudar tras una pausa (hay imagen) no tapa el vídeo', () => {
    expect(stageMessage(playing({ phase: 'cargando', conn: 'activa' }))).toBeNull();
    expect(stageMessage(playing())).toBeNull();
  });
});

describe('mini-reproductor y datos técnicos', () => {
  it('rótulo del mini según la fase', () => {
    expect(miniKicker(playing())).toBe('Sonando');
    expect(miniKicker(playing({ phase: 'pausado' }))).toBe('En pausa');
    expect(miniKicker(playing({ phase: 'cargando' }))).toBe('Conectando…');
  });
  it('velocidades como la 0.6.59 y filas del panel', () => {
    expect(formatSpeed(214)).toBe('214 KB/s');
    expect(formatSpeed(1966)).toBe('1,92 MB/s');
    expect(formatSpeed(null)).toBe('—');
    const rows = Object.fromEntries(
      nerdRows(
        playing({
          engine: 'mpegts',
          protocol: 'mpegts',
          stats: {
            status: 'dl',
            peers: 48,
            speedDown: 1966,
            speedUp: 214,
            downloaded: null,
            at: '',
          },
        }),
        'en línea',
      ),
    );
    expect(rows).toMatchObject({
      Motor: 'en línea',
      Reproductor: 'mpegts.js',
      Entrega: 'progresivo (MPEG-TS)',
      Pares: '48',
      Bajada: '1,92 MB/s',
      Subida: '214 KB/s',
    });
  });
});

describe('zapping (B-092)', () => {
  const item = (id: string, title: string, category = '') => ({ id, title, category });
  const library = {
    favorites: [item('f1', 'Fav 1'), item('w2', 'Web 2 (fav)')],
    web: [
      item('w1', 'Web 1', 'Deportes'),
      item('w2', 'Web 2', 'Cine'),
      item('w3', 'Web 3', 'Deportes'),
    ],
  };

  it('favoritos y luego el directorio por categorías en su orden de llegada, sin repetidos', () => {
    expect(zappingList(library).map((i) => i.id)).toEqual(['f1', 'w2', 'w1', 'w3']);
  });

  it('← y → dan la vuelta; si el canal no está, empieza por el primero', () => {
    const list = zappingList(library);
    expect(zapTarget(list, 'f1', 1)?.id).toBe('w2');
    expect(zapTarget(list, 'f1', -1)?.id).toBe('w3');
    expect(zapTarget(list, 'desconocido', 1)?.id).toBe('f1');
    expect(zapTarget([], 'f1', 1)).toBeNull();
  });
});

describe('«Abrir en…» (D7)', () => {
  it('enlace acestream:// y URL del stream para VLC', () => {
    expect(acestreamLink(HASH)).toBe(`acestream://${HASH}`);
    expect(externalStreamUrl(HASH, 'auto', 'http://umbrel.local:8765')).toBe(
      `http://umbrel.local:8765/ace/getstream?id=${HASH}`,
    );
    expect(externalStreamUrl(HASH, 'infohash', '')).toBe(`/ace/getstream?infohash=${HASH}`);
  });
});
