/* Qué lee cada visor (docs/multidispositivo.md §4.6, C.4). */

import { describe, expect, it } from 'vitest';
import { SHARE_VIA_REMUX, consumesFor, type ShareInput } from './sharing.js';

const H = 'a'.repeat(40);
const base: ShareInput = {
  client: 'web',
  source: 'engine',
  hash: H,
  previous: null,
  session: null,
  shareViaRemux: true,
};
const iphoneFirst = { mode: 'progressive' as const, remux: true, direct: false };

describe('consumesFor', () => {
  it('apagado por defecto (D-L3)', () => {
    expect(SHARE_VIA_REMUX).toBe(false);
  });

  it('iPhone e IPTV, siempre el remux', () => {
    expect(consumesFor({ ...base, client: 'ios' })).toBe('remux');
    expect(consumesFor({ ...base, source: 'iptv' })).toBe('remux');
  });

  it('iPhone primero + web → la web lee el remux (el motor sigue en progresivo con un lector)', () => {
    expect(consumesFor({ ...base, session: iphoneFirst })).toBe('remux');
  });

  it('con SHARE_VIA_REMUX apagado, como hoy', () => {
    expect(consumesFor({ ...base, session: iphoneFirst, shareViaRemux: false })).toBe('direct');
  });

  it('web primero + iPhone, dos webs, sesión ya en HLS o sin remux: como hoy (direct, D5.3)', () => {
    expect(consumesFor({ ...base, session: { ...iphoneFirst, direct: true } })).toBe('direct');
    expect(consumesFor({ ...base, session: { ...iphoneFirst, mode: 'hls' } })).toBe('direct');
    expect(consumesFor({ ...base, session: { ...iphoneFirst, remux: false } })).toBe('direct');
    expect(consumesFor(base)).toBe('direct');
  });

  it('una reconexión conserva lo que leía (no se suelta ni se vuelve a colocar)', () => {
    const previous = { hash: H, consumes: 'remux' as const, sessionAlive: true };
    /* Aunque el iPhone ya se haya ido y el cálculo de nuevo diera `direct`. */
    expect(consumesFor({ ...base, previous, session: { ...iphoneFirst, remux: true } })).toBe(
      'remux',
    );
    expect(consumesFor({ ...base, previous, shareViaRemux: false })).toBe('remux');
    /* Otro canal o sesión cerrada: se decide de nuevo. */
    expect(consumesFor({ ...base, previous: { ...previous, hash: 'b'.repeat(40) } })).toBe(
      'direct',
    );
    expect(consumesFor({ ...base, previous: { ...previous, sessionAlive: false } })).toBe('direct');
    expect(
      consumesFor({ ...base, previous: { ...previous, consumes: 'direct' }, session: iphoneFirst }),
    ).toBe('direct');
  });
});
