import { afterEach, describe, expect, it } from 'vitest';
import { autoMayUseIptv, autoStartWithoutIptv } from './auto-iptv.ts';

afterEach(() => autoStartWithoutIptv(null));

describe('lo que la Agenda de escritorio abre sola no arranca por tu IPTV', () => {
  it('solo ese partido; los demás y lo abierto a mano, como siempre', () => {
    expect(autoMayUseIptv('m:rayo-celta')).toBe(true);
    autoStartWithoutIptv('rayo-celta');
    expect(autoMayUseIptv('m:rayo-celta')).toBe(false);
    expect(autoMayUseIptv('m:otro')).toBe(true);
    expect(autoMayUseIptv('c:abc')).toBe(true);
    autoStartWithoutIptv(null);
    expect(autoMayUseIptv('m:rayo-celta')).toBe(true);
  });
});
