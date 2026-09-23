import { PairingCreateResponseSchema } from '@ace/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { api } from '../../api/client.ts';
import { resetMode, setMode } from '../../api/mode.ts';
import { demoPairing, demoQrSvg, registerDevicesDemo } from './demo.ts';

afterEach(() => resetMode());

describe('emparejar en la demo', () => {
  it('QR de muestra: SVG con fondo blanco, módulos negros y siempre el mismo para el mismo código', () => {
    const svg = demoQrSvg('482913');
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('fill="#ffffff"');
    expect(svg).toContain('fill="#000000"');
    expect(demoQrSvg('482913')).toBe(svg);
    expect(demoQrSvg('000001')).not.toBe(svg);
    // Las tres marcas de posición (aro de 7×7 en cada esquina menos la de abajo a la derecha).
    expect(svg.match(/h7v7h-7z/g)).toHaveLength(3);
  });

  it('cumple el contrato y el código cambia cada vez', async () => {
    const one = PairingCreateResponseSchema.parse(demoPairing());
    expect(one.ttlMs).toBe(300_000);
    expect(one.pairUri).toContain(`c=${one.code}`);
    registerDevicesDemo();
    setMode('demo', 'param');
    const codes = new Set<string>();
    for (let i = 0; i < 4; i += 1) codes.add((await api('pairingCreate', { body: {} })).code);
    expect(codes.size).toBeGreaterThan(1);
  });
});
