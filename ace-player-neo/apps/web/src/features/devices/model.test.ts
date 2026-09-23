import type { Device } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import {
  countdown,
  groupCode,
  lastSeenText,
  originKind,
  pairedText,
  qrImageSrc,
  spellCode,
  splitDevices,
} from './model.ts';

const NOW = Date.parse('2026-09-23T18:30:00.000Z');

function device(over: Partial<Device>): Device {
  return {
    id: 'dev_aaaa',
    name: 'iPhone',
    platform: 'ios',
    createdAt: '2026-09-01T10:00:00.000Z',
    lastSeenAt: null,
    revokedAt: null,
    ...over,
  };
}

describe('dispositivos', () => {
  it('última vez en claro (el backend la apunta como mucho cada minuto)', () => {
    expect(lastSeenText(device({}), NOW)).toBe('Aún no se ha conectado');
    expect(lastSeenText(device({ lastSeenAt: new Date(NOW - 60_000).toISOString() }), NOW)).toBe(
      'Conectado ahora mismo',
    );
    expect(
      lastSeenText(device({ lastSeenAt: new Date(NOW - 12 * 60_000).toISOString() }), NOW),
    ).toBe('Visto hace 12 min');
    expect(
      lastSeenText(device({ lastSeenAt: new Date(NOW - 5 * 86400_000).toISOString() }), NOW),
    ).toMatch(/^Visto el \d+ \w+, a las \d\d:\d\d$/);
    expect(pairedText(device({}))).toMatch(/^Emparejado el 1 sept 2026$/);
  });

  it('activos por última conexión; revocados aparte', () => {
    const list = splitDevices([
      device({ id: 'dev_viejo', lastSeenAt: '2026-09-20T10:00:00.000Z' }),
      device({ id: 'dev_nuevo', lastSeenAt: '2026-09-23T10:00:00.000Z' }),
      device({ id: 'dev_nunca', createdAt: '2026-09-22T10:00:00.000Z' }),
      device({ id: 'dev_fuera', revokedAt: '2026-09-21T10:00:00.000Z' }),
    ]);
    expect(list.active.map((d) => d.id)).toEqual(['dev_nuevo', 'dev_nunca', 'dev_viejo']);
    expect(list.revoked.map((d) => d.id)).toEqual(['dev_fuera']);
  });

  it('código en dos grupos, cifra a cifra para lectores y cuenta atrás', () => {
    expect(groupCode('482913')).toBe('482 913');
    expect(spellCode('482913')).toBe('4 8 2 9 1 3');
    expect(countdown(300_000)).toBe('5:00');
    expect(countdown(299_001)).toBe('5:00');
    expect(countdown(59_000)).toBe('0:59');
    expect(countdown(-5)).toBe('0:00');
  });

  it('qué dirección le sirve al iPhone', () => {
    expect(originKind('localhost')).toBe('local');
    expect(originKind('127.0.0.1')).toBe('local');
    expect(originKind('[::1]')).toBe('local');
    expect(originKind('umbrel.tail1234.ts.net')).toBe('tailscale');
    expect(originKind('100.101.102.103')).toBe('tailscale');
    expect(originKind('umbrel.local')).toBe('lan');
    expect(originKind('192.168.1.40')).toBe('lan');
    expect(originKind('10.0.0.5')).toBe('lan');
    expect(originKind('umbrel')).toBe('lan');
    expect(originKind('mi-casa.example.com')).toBe('other');
  });

  it('el QR se pinta como imagen (data:), nunca como HTML', () => {
    const src = qrImageSrc(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect(src.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(src).not.toContain('<');
  });
});
