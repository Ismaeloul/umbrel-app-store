/* El reparto de los 4 carteles IPTV por canal pedido y el sitio de los huecos
   de evento en la capa (docs/iptv.md §4.8 y §4.9). */

import { describe, expect, it } from 'vitest';
import { CANONICAL_MATCHER, scoreResolutionCandidate } from '../football/resolution.js';
import { Catalog, type RawChannel } from './catalog.js';
import { matchEventChannels } from './event-match.js';
import { mergeIptvMatches } from './layer.js';
import { matchIptvChannels, type ChannelScorer } from './match.js';

const scorer: ChannelScorer = (channels, item) =>
  scoreResolutionCandidate(channels, item, 'iptv', CANONICAL_MATCHER);

let seq = 0;
function raw(title: string, group = ''): RawChannel {
  seq += 1;
  return {
    id: seq.toString(16).padStart(40, '0'),
    title,
    group,
    tvgId: '',
    ref: String(seq),
    tvgShift: null,
    userAgent: null,
    referrer: null,
  };
}

const catalog = new Catalog('p_Ab3dE5gH', 1, 'xtream', 0, [], 'ts', [
  raw('DAZN 2 4K', 'ES| DAZN ESPAÑA VIP'),
  raw('DAZN 2 HD', 'ES| DAZN ESPAÑA VIP'),
  raw('DAZN 2 SD', 'ES| DAZN ESPAÑA VIP'),
  raw('M+: DAZN 2', 'ES| MOVISTAR SPORT'),
  raw('VAMOS 2', 'ES| M+ VAMOS VIP'),
  raw('M+ LALIGA TV ³', 'ES| CABEL TV SPORTS'),
  raw(
    'Next Athletic Femenino vs. Sevilla FC Femenino Liga F 2026-10-24 10:00 (GMT) 8K EXCLUSIVE ES: DAZN PPV 3',
    'ES| DAZN PPV',
  ),
]);

describe('allotPosters · un cartel por canal pedido', () => {
  it('Liga F: «VAMOS 2» no se queda sin cartel detrás de cuatro «DAZN 2»', () => {
    const byName = matchIptvChannels(catalog, ['DAZN 2', 'M+ Vamos 2', 'DAZN 2 Bar'], { scorer });
    const layer = mergeIptvMatches([], byName);
    const posters = layer.matches.flatMap((match) =>
      match.posters.map((entry) => [entry.title, match.matchedChannel]),
    );
    expect(posters).toHaveLength(4);
    expect(posters).toContainEqual(['VAMOS 2', 'M+ Vamos 2']);
    expect(
      posters.filter(([, channel]) => channel === 'DAZN 2' || channel === 'DAZN 2 Bar'),
    ).toHaveLength(3);
  });

  it('el ³ de la lista no es parte del nombre: «M+ LALIGA TV ³» es M+ LaLiga TV', () => {
    const byName = matchIptvChannels(catalog, ['M+ LALIGA'], { scorer });
    expect(byName.map((match) => match.best.display)).toEqual(['M+ LALIGA TV']);
  });
});

describe('mergeIptvMatches · los huecos de evento', () => {
  const program = {
    id: 'fltv-1',
    home: 'Athletic Femenino',
    away: 'Sevilla FC Femenino',
    competition: 'Liga F',
    title: 'Athletic Femenino - Sevilla FC Femenino',
    start: Date.UTC(2026, 9, 24, 10, 0),
    channels: ['DAZN', 'M+ Vamos 2'],
  };

  it('van detrás de la guía y delante del nombre, y no dan pistas para AceStream', () => {
    const byName = matchIptvChannels(catalog, program.channels, { scorer });
    const byEvent = matchEventChannels(catalog, program);
    expect(byEvent.map((match) => match.matchedChannel)).toEqual(['DAZN PPV 3']);
    const layer = mergeIptvMatches([], byName, byEvent);
    expect(layer.matches[0]?.matchedChannel).toBe('DAZN PPV 3');
    expect(layer.matches[0]?.event).toBe(true);
    expect(layer.matches.some((match) => match.matchedChannel === 'M+ Vamos 2')).toBe(true);
    expect(layer.hints).toEqual([]);
  });
});
