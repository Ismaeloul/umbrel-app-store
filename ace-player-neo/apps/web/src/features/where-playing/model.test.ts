import type { SessionSummary, SessionViewer } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  countText,
  deviceKind,
  openedClock,
  otherDevicesWatching,
  playState,
  sessionTitle,
  summaryText,
  visibleSessions,
} from './model.ts';

const AT = '2026-09-23T18:30:00.000Z';

function viewer(over: Partial<SessionViewer> = {}): SessionViewer {
  return {
    client: 'web',
    deviceId: 'web_pc',
    lastBeatAt: AT,
    viewerId: 'v_pc',
    deviceName: 'Chrome · Windows',
    platform: 'web',
    playing: true,
    ...over,
  };
}

function session(over: Partial<SessionSummary> = {}): SessionSummary {
  return {
    id: 's_uno',
    hash: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
    mode: 'progressive',
    openedAt: AT,
    viewers: [viewer()],
    title: 'DAZN 1',
    protocol: 'mpegts',
    ...over,
  };
}

describe('deviceKind', () => {
  it.each([
    [{ platform: 'web', deviceName: 'Chrome · Windows' }, 'ordenador'],
    [{ platform: 'web', deviceName: 'Safari · Mac' }, 'ordenador'],
    [{ platform: 'web', deviceName: 'Safari · iPhone' }, 'movil'],
    [{ platform: 'web', deviceName: 'Chrome · Android' }, 'movil'],
    [{ platform: 'web', deviceName: 'Navegador · Smart TV' }, 'tele'],
    [{ platform: 'web', deviceName: 'Navegador' }, 'ordenador'],
    [{ platform: 'ios', deviceName: 'iPhone de Isma' }, 'movil'],
    [{ platform: 'ios', deviceName: 'MacBook de Isma' }, 'ordenador'],
    [{ platform: 'legacy', deviceName: 'App antigua (0.6)' }, 'movil'],
  ] as const)('%o → %s', (input, expected) => {
    expect(deviceKind(input)).toBe(expected);
  });
});

describe('playState', () => {
  it('reproduciendo, en pausa o conectado (sin latido todavía)', () => {
    expect(playState({ playing: true })).toBe('reproduciendo');
    expect(playState({ playing: false })).toBe('pausa');
    expect(playState({ playing: null })).toBe('conectado');
  });
});

describe('textos', () => {
  it('título de respaldo con el principio del id', () => {
    expect(sessionTitle({ title: 'DAZN 1', hash: 'abc' })).toBe('DAZN 1');
    expect(sessionTitle({ title: '  ', hash: 'a1b2c3d4e5f6' })).toBe('Canal a1b2c3d4');
  });

  it('cuenta en singular y plural', () => {
    expect(countText(1)).toBe('1 dispositivo');
    expect(countText(3)).toBe('3 dispositivos');
  });

  it('hora de inicio en hh:mm; vacía si la fecha no vale', () => {
    expect(openedClock(AT)).toMatch(/^\d{2}:\d{2}$/);
    expect(openedClock('ayer')).toBe('');
  });

  it('resumen para lectores de pantalla', () => {
    expect(summaryText([])).toBe('No se está reproduciendo nada.');
    expect(summaryText([session()])).toBe('«DAZN 1» en 1 dispositivo.');
  });
});

describe('visibleSessions', () => {
  it('quita las sesiones sin visores y pone este dispositivo primero', () => {
    const other = viewer({ viewerId: 'v_ios', deviceId: 'dev_iphone', platform: 'ios' });
    const mine = viewer({ viewerId: 'v_mio', deviceId: 'web_mio' });
    const list = visibleSessions(
      [
        session({ id: 's_vacia', viewers: [] }),
        session({ id: 's_otra', openedAt: '2026-09-23T19:00:00.000Z', viewers: [other] }),
        session({ id: 's_mia', viewers: [other, mine] }),
      ],
      'web_mio',
    );
    expect(list.map((s) => s.id)).toEqual(['s_mia', 's_otra']);
    expect(list[0]?.viewers.map((v) => v.viewerId)).toEqual(['v_mio', 'v_ios']);
  });

  it('sin datos, lista vacía', () => {
    expect(visibleSessions(undefined, 'web_mio')).toEqual([]);
  });
});

describe('otherDevicesWatching', () => {
  it('cuenta los OTROS dispositivos de la sesión de este visor', () => {
    const sessions = [
      session({
        viewers: [
          viewer({ viewerId: 'v_mio', deviceId: 'web_mio' }),
          viewer({ viewerId: 'v_otra_pestana', deviceId: 'web_mio' }),
          viewer({ viewerId: 'v_ios', deviceId: 'dev_iphone', platform: 'ios' }),
        ],
      }),
    ];
    expect(otherDevicesWatching(sessions, 'v_mio', 'web_mio')).toBe(1);
    expect(otherDevicesWatching(sessions, 'v_nadie', 'web_mio')).toBe(0);
    expect(otherDevicesWatching(undefined, 'v_mio', 'web_mio')).toBe(0);
  });
});
