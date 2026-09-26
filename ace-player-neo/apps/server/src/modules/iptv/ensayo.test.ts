/* Ensayo de la IPTV (docs/iptv.md §9.2): con el catálogo y la guía
   guardados dice qué IPTV saldría en cada partido, sin URLs ni credenciales
   y sin pedir ningún stream. */

import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { FootballSchedule } from '@ace/shared';
import { FAKE_IPTV_PASSWORD, FAKE_IPTV_USER } from '../../../test/fake-iptv/provider.js';
import { FAKE_IPTV_HOST } from '../../../test/fake-iptv/net.js';
import { isoDateInMadrid } from '../football/time.js';
import { runIptvEnsayo } from './ensayo.js';
import { IPTV_TEST_MATCH_OFFSET_MS, createIptvTestRig, type IptvTestRig } from './test-support.js';

let rig: IptvTestRig | null = null;
afterEach(async () => {
  await rig?.close();
  rig = null;
});

function schedule(start: number): FootballSchedule {
  const date = isoDateInMadrid(start);
  const match = (
    id: string,
    home: string,
    away: string,
    competition: string,
    channels: string[],
  ) => ({
    id,
    date,
    time: '03:00',
    start,
    title: `${home} vs ${away}`,
    home,
    away,
    competition,
    country: 'España',
    channels: channels.map((name, index) => ({ id: `c${index}`, name })),
  });
  return {
    generatedAt: new Date(start).toISOString(),
    timezone: 'Europe/Madrid',
    country: 'Spain',
    source: 'demo',
    attribution: 'Datos de muestra',
    demo: true,
    limited: false,
    partial: false,
    days: [
      {
        date,
        matches: [
          match('demo-4', 'Real Sociedad', 'Villarreal', 'LaLiga', ['DAZN LaLiga']),
          match('demo-x', 'Equipo Uno', 'Equipo Dos', 'Amistoso', ['Canal Que No Existe']),
        ],
      },
    ],
  } as FootballSchedule;
}

describe('iptv-ensayo', () => {
  it('dice la IPTV de cada partido (guía primero), tapado y sin pedir streams', async () => {
    rig = await createIptvTestRig();
    await rig.service.save(
      {
        kind: 'xtream',
        name: 'Casa',
        server: `http://${FAKE_IPTV_HOST}`,
        username: FAKE_IPTV_USER,
        password: FAKE_IPTV_PASSWORD,
      },
      new AbortController().signal,
    );
    await rig.service.idle();
    await (rig.service as unknown as { startGuide(): Promise<void> }).startGuide();
    await rig.service.idle();
    rig.fake.limpiarPeticiones();
    const lines: string[] = [];
    const now = rig.core.clock.now();
    const code = await runIptvEnsayo({
      env: { DATA_DIR: rig.core.config.dataDir, ACE_SEED: 'semilla-de-prueba-0123456789' },
      now,
      fetchJson: async () => schedule(now + IPTV_TEST_MATCH_OFFSET_MS),
      print: (line) => lines.push(line),
    });
    const text = lines.join('\n');
    expect(code, text).toBe(0);
    expect(text).toContain('IPTV «Casa» (Xtream');
    expect(text).toContain('1. M+ LaLiga TV 2 [guía] · 100');
    expect(text).toContain('2. DAZN LaLiga · 100 · 1080p');
    expect(text).toContain('pistas para AceStream: M+ LaLiga TV 2');
    expect(text).toContain('sin IPTV');
    expect(text).toContain('1 de 2 partidos');
    expect(text).not.toContain(FAKE_IPTV_PASSWORD);
    expect(text).not.toContain(FAKE_IPTV_USER);
    expect(text).not.toContain('http');
    expect(rig.fake.peticiones()).toEqual([]);
  });

  it('sin IPTV guardada o con otra semilla: lo dice y sale con 1', async () => {
    rig = await createIptvTestRig();
    const lines: string[] = [];
    const empty = await runIptvEnsayo({
      env: { DATA_DIR: rig.core.config.dataDir, ACE_SEED: 'semilla-de-prueba-0123456789' },
      fetchJson: async () => ({}),
      print: (line) => lines.push(line),
    });
    expect(empty).toBe(1);
    await rig.service.save(
      {
        kind: 'xtream',
        server: `http://${FAKE_IPTV_HOST}`,
        username: FAKE_IPTV_USER,
        password: FAKE_IPTV_PASSWORD,
      },
      new AbortController().signal,
    );
    await rig.service.idle();
    const other = await runIptvEnsayo({
      env: { DATA_DIR: rig.core.config.dataDir, ACE_SEED: 'otra-semilla-distinta-00000000' },
      fetchJson: async () => ({}),
      print: (line) => lines.push(line),
    });
    expect(other).toBe(1);
    expect(lines.join('\n')).toContain('no se puede descifrar');
    /* Solo lectura: el catálogo que no pudo leer sigue ahí. */
    expect(existsSync(rig.core.config.paths.iptvCatalogFile)).toBe(true);
  });
});
