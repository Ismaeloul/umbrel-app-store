/* Agenda híbrida con el servicio de verdad y el proveedor falso
   (docs/iptv.md §4.7): con la guía descargada confirma el partido de la demo
   en M+ LaLiga TV 2; sin IPTV, en pausa o sin guía responde null (y la
   agenda queda como siempre). */

import { afterEach, describe, expect, it } from 'vitest';
import { FAKE_IPTV_HOST } from '../../../test/fake-iptv/net.js';
import { isoDateInMadrid } from '../football/time.js';
import type { GuideAgendaRequest } from './guide-agenda.js';
import { IPTV_TEST_MATCH_OFFSET_MS, createIptvTestRig, type IptvTestRig } from './test-support.js';

const rigs: IptvTestRig[] = [];
afterEach(async () => {
  while (rigs.length) await rigs.pop()?.close();
});

async function rig(): Promise<IptvTestRig> {
  const created = await createIptvTestRig();
  rigs.push(created);
  return created;
}

const signal = () => new AbortController().signal;
const SERVER = `http://${FAKE_IPTV_HOST}`;

function request(r: IptvTestRig, key = 'agenda-1'): GuideAgendaRequest {
  const now = r.core.clock.now();
  const start = now + IPTV_TEST_MATCH_OFFSET_MS;
  return {
    matches: [
      {
        id: 'demo-4',
        date: isoDateInMadrid(start),
        home: 'Real Sociedad',
        away: 'Villarreal',
        competition: 'LaLiga',
        title: 'Real Sociedad vs Villarreal',
        start,
        channels: ['DAZN LaLiga'],
      },
    ],
    dates: [isoDateInMadrid(now), isoDateInMadrid(now + 86_400_000)],
    dateOf: isoDateInMadrid,
    key,
  };
}

describe('IptvService.guideAgenda', () => {
  it('sin IPTV: null', async () => {
    const r = await rig();
    expect(r.service.guideAgenda(request(r))).toBe(null);
  });

  it('con guía: confirma el partido en M+ LaLiga TV 2 (lo mismo que pone primero la resolución); en pausa, null', async () => {
    const r = await rig();
    await r.service.save({ kind: 'm3u', name: 'Casa', url: `${SERVER}/lista.m3u.gz` }, signal());
    await r.service.idle();
    /* Sin guía todavía: null. */
    expect(r.service.guideAgenda(request(r))).toBe(null);
    await r.service['startGuide']();
    await r.service.idle();
    const result = r.service.guideAgenda(request(r));
    expect(result?.confirmations).toEqual([
      {
        matchId: 'demo-4',
        channels: ['M+ LaLiga TV 2'],
        start: r.core.clock.now() + IPTV_TEST_MATCH_OFFSET_MS,
        moved: false,
      },
    ]);
    /* La guía del proveedor falso no trae ningún partido que no esté en la agenda. */
    expect(result?.additions).toEqual([]);
    /* El mismo objeto mientras no cambie nada (la agenda lo compara para no rehacer nada). */
    expect(r.service.guideAgenda(request(r))).toBe(result);
    expect(r.service.guideAgenda(request(r, 'agenda-2'))).not.toBe(result);
    await r.service.update({ enabled: false });
    expect(r.service.guideAgenda(request(r))).toBe(null);
    await r.service.update({ enabled: true });
    expect(r.service.guideAgenda(request(r))?.confirmations).toHaveLength(1);
  });
});
