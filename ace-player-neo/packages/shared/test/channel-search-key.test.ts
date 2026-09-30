/* `channelSearchKey` (docs/diagnostico-iptv-0.8.2.md, E3): la clave con la que filtran por nombre la web y el
   servidor. La grafía de Movistar y LaLiga, sin tildes ni mayúsculas y sin calidad. */

import { describe, expect, it } from 'vitest';
import { channelSearchKey } from '../src/index.js';

describe('channelSearchKey', () => {
  it.each([
    ['m+ laliga', 'movistar laliga'],
    ['M. LALIGA 1', 'movistar laliga 1'],
    ['M+ LaLiga TV 2 --> NEW ERA', 'movistar laliga tv 2'],
    ['m laliga', 'movistar laliga'],
    ['mov laliga', 'movistar laliga'],
    ['Movistar Plus+ La Liga', 'movistar laliga'],
    ['La Sexta HD', 'lasexta'],
    ['Fútbol', 'futbol'],
    ['M6', 'm6'],
  ])('«%s» → «%s»', (value, key) => {
    expect(channelSearchKey(value)).toBe(key);
  });

  it('«m+ laliga» está dentro de la clave de «M. LALIGA 1»', () => {
    expect(channelSearchKey('M. LALIGA 1').includes(channelSearchKey('m+ laliga'))).toBe(true);
  });
});
