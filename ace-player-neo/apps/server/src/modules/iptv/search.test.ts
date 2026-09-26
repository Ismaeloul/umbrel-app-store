/* El buscador de la IPTV (docs/iptv.md §14.3, §14.9 y §17): prefijos en
   cualquier orden, grafías de la IPTV, sin tildes, orden, una fila por canal
   (las variantes de resolución juntas; otro país, otra fila), todo
   desbloqueado (cualquier país y los grupos para adultos), `total` y
   `capped`, `library` con la regla única de «es el mismo canal» y 100 000
   canales en menos de 50 ms. */

import { describe, expect, it } from 'vitest';
import { IPTV_SEARCH } from '@ace/shared';
import { scoreResolutionCandidate } from '../football/resolution.js';
import { Catalog, type RawChannel } from './catalog.js';
import type { ChannelScorer } from './match.js';
import { cleanChannelsQuery, libraryCandidates, libraryMatches, searchCatalog } from './search.js';

const scorer: ChannelScorer = (channels, item) => scoreResolutionCandidate(channels, item, 'iptv');

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

function catalog(channels: readonly (string | RawChannel)[]): Catalog {
  return new Catalog(
    'p_Ab3dE5gH',
    1,
    'xtream',
    0,
    [],
    'ts',
    channels.map((channel) => (typeof channel === 'string' ? raw(channel) : channel)),
  );
}

const titles = (c: Catalog, q: string): string[] =>
  searchCatalog(c, q).groups.map((group) => group.best.display);

const LIST = catalog([
  'ES: M+ LaLiga TV FHD',
  'ES: M+ LaLiga TV HD',
  'ES: M+ LaLiga TV 2 FHD',
  'ES: DAZN LaLiga FHD',
  'ES: DAZN LA LIGA HD',
  'ES: La 1 HD',
  'ES: La 1 FHD',
  'ES: Antena 3 FHD',
  'ES: Antena 3 Internacional',
  'ES: Telecinco HD',
  'ES: Teledeporte HD',
  'ES: laSexta HD',
  'Cuatro',
  'UK: DAZN 1',
  'IT: Telecinco Italia',
  raw('ES: Tele Noche HD', 'XXX'),
  raw('ES: Tele Rosa', 'Adultos'),
  raw('Tele Porno 24', ''),
  raw('ES: Canal Película', 'ES | CINE'),
]);

describe('searchCatalog (§14.3)', () => {
  it('prefijos en cualquier orden: «liga m+» encuentra «M+ LaLiga TV»', () => {
    expect(titles(LIST, 'liga m+')).toContain('M+ LaLiga TV');
    expect(titles(LIST, 'm+ la liga')).toContain('M+ LaLiga TV');
    expect(titles(LIST, 'tv lali')).toContain('M+ LaLiga TV 2');
  });

  it('«la liga» = «laliga»; sin tildes ni mayúsculas', () => {
    expect(titles(LIST, 'dazn la liga')).toEqual(['DAZN LaLiga']);
    expect(titles(LIST, 'DAZN LALIGA')).toEqual(['DAZN LaLiga']);
    expect(titles(LIST, 'antená')).toEqual(['Antena 3', 'Antena 3 Internacional']);
    expect(titles(LIST, 'pelicula')).toEqual(['Canal Película']);
  });

  it('orden: clave igual → empieza por → en orden → el resto; dentro, la más corta', () => {
    expect(titles(LIST, 'la 1')[0]).toBe('La 1');
    expect(titles(LIST, 'antena 3')).toEqual(['Antena 3', 'Antena 3 Internacional']);
    /* «tele»: todos empiezan por «tele…»; primero la clave más corta (y, con la misma, España antes). */
    expect(titles(LIST, 'teled')).toEqual(['Teledeporte']);
    const tele = titles(LIST, 'tele');
    expect(tele.slice(0, 2)).toEqual(['Telecinco', 'Tele Rosa']);
    expect(tele.indexOf('Teledeporte')).toBeLessThan(tele.indexOf('Telecinco Italia'));
    expect(titles(LIST, 'sexta')).toEqual(['laSexta']);
    expect(titles(LIST, 'la sexta')).toEqual(['laSexta']);
  });

  it('una fila por grupo, con la mejor variante (FHD antes que HD)', () => {
    const found = searchCatalog(LIST, 'la 1');
    const la1 = found.groups.filter((group) => group.best.display === 'La 1');
    expect(la1).toHaveLength(1);
    expect(la1[0]?.best.quality).toBe('fhd');
    expect(la1[0]?.best.title).toBe('ES: La 1 FHD');
  });

  it('todo desbloqueado: cualquier país sale, con su país; «Cuatro» (sin país) también', () => {
    const dazn = searchCatalog(LIST, 'dazn 1').groups;
    expect(dazn.map((group) => [group.best.display, group.bucket])).toEqual([['DAZN 1', 'UK']]);
    expect(titles(LIST, 'italia')).toEqual(['Telecinco Italia']);
    expect(titles(LIST, 'cuatro')).toEqual(['Cuatro']);
  });

  it('todo desbloqueado: los grupos «XXX» y «Adultos» y los nombres «porno» también salen', () => {
    expect(titles(LIST, 'tele noche')).toEqual(['Tele Noche']);
    expect(titles(LIST, 'rosa')).toEqual(['Tele Rosa']);
    expect(titles(LIST, 'porno')).toEqual(['Tele Porno 24']);
  });

  it('una fila por canal: las 5 variantes de «DAZN 1» son una fila; otro país, otra fila detrás', () => {
    const c = catalog([
      'DE: DAZN 1 HD',
      'ES: DAZN 1 FHD',
      'ES: DAZN 1 HD',
      'DAZN 1 SD',
      '|ES| DAZN 1 4K',
      'ES: DAZN 1 (backup)',
      'ES: DAZN 2 FHD',
      'ES: DAZN F1 FHD',
    ]);
    const found = searchCatalog(c, 'dazn 1').groups;
    expect(found.map((group) => [group.best.display, group.bucket, group.entries.length])).toEqual([
      ['DAZN 1', '', 5],
      ['DAZN 1', 'DE', 1],
    ]);
    /* «DAZN 2» y «DAZN F1» son otros canales (otras filas con «dazn»). Dentro de la familia (§18), España
       o sin país antes que otro país: el «DAZN 1» alemán va detrás de «DAZN 2». */
    expect(searchCatalog(c, 'dazn').groups.map((group) => [group.key, group.bucket])).toEqual([
      ['dazn 1', ''],
      ['dazn 2', ''],
      ['dazn 1', 'DE'],
      ['dazn f1', ''],
    ]);
  });

  it('total y capped con 250 coincidencias; la respuesta, 50 como mucho', () => {
    const many = catalog(Array.from({ length: 250 }, (_, i) => `ES: Deportes ${i + 1}`));
    const found = searchCatalog(many, 'deportes');
    expect(found.total).toBe(IPTV_SEARCH.totalCap);
    expect(found.capped).toBe(true);
    expect(found.groups).toHaveLength(IPTV_SEARCH.limit);
    const few = searchCatalog(many, 'deportes 24');
    expect(few.capped).toBe(false);
    expect(few.groups[0]?.best.display).toBe('Deportes 24');
  });

  it('nada que buscar tras limpiar («hd») no casa con todo', () => {
    expect(searchCatalog(LIST, 'hd').groups).toEqual([]);
    expect(searchCatalog(LIST, 'hd').total).toBe(0);
  });

  it('la consulta se limpia como la del motor; menos de 2 letras, empty_query', () => {
    expect(cleanChannelsQuery('  la   1  ')).toBe('la 1');
    expect(cleanChannelsQuery('x'.repeat(90))).toHaveLength(80);
    expect(() => cleanChannelsQuery(' a ')).toThrow(
      expect.objectContaining({ code: 'empty_query' }),
    );
  });
});

describe('library de cada fila (§14.3, regla 5)', () => {
  const A = 'a'.repeat(40);
  const B = 'b'.repeat(40);
  const C = 'c'.repeat(40);
  const D = 'd'.repeat(40);
  const IPTV_OWN = 'f'.repeat(40);

  it('favorito, reciente y canal de la lista que son ese canal; «LaLiga TV» no es «LaLiga TV Hypermotion»', () => {
    const c = catalog(['ES: Antena 3 FHD', 'ES: LaLiga TV Hypermotion FHD']);
    const items = [
      { id: A, title: 'Antena 3 HD', category: 'Guardado' },
      { id: B, title: 'antena 3 --> ELCANO', category: '' },
      { id: C, title: 'Antena 3 Internacional', category: 'Generalistas' },
      { id: D, title: 'LaLiga TV', category: 'Deportes' },
    ];
    const antena = searchCatalog(c, 'antena').groups[0]!;
    const options = { scorer, isIptvId: () => false, channelOf: () => null };
    expect(libraryMatches(antena, libraryCandidates(items, 'antena'), options).sort()).toEqual(
      [A, B].sort(),
    );
    const hyper = searchCatalog(c, 'laliga').groups[0]!;
    expect(hyper.best.display).toBe('LaLiga TV Hypermotion');
    expect(libraryMatches(hyper, libraryCandidates(items, 'laliga'), options)).toEqual([]);
  });

  it('un id IPTV de la biblioteca cuenta si es del mismo canal (grupo y país)', () => {
    const c = catalog(['ES: Telecinco HD']);
    const group = searchCatalog(c, 'tele').groups[0]!;
    const items = [{ id: IPTV_OWN, title: 'Tele 5 (mío)', category: 'IPTV' }];
    expect(
      libraryMatches(group, libraryCandidates(items, 'tele'), {
        scorer,
        isIptvId: (id) => id === IPTV_OWN,
        channelOf: () => group.channel,
      }),
    ).toEqual([IPTV_OWN]);
  });

  it('solo se miran los que contienen la consulta, sin repetir y 200 como mucho', () => {
    const items = Array.from({ length: 300 }, (_, i) => ({
      id: i.toString(16).padStart(40, '0'),
      title: `Tele ${i}`,
      category: '',
    }));
    expect(libraryCandidates([...items, ...items], 'tele')).toHaveLength(200);
    expect(libraryCandidates(items, 'nada')).toEqual([]);
    expect(
      libraryCandidates([{ id: A, title: 'Otro', category: 'Teledeportes' }], 'tele'),
    ).toHaveLength(1);
  });

  it('la categoría «IPTV» es una marca: casa con «iptv», no con «tv»', () => {
    const items = [{ id: IPTV_OWN, title: 'Mi tele', category: 'IPTV' }];
    expect(libraryCandidates(items, 'tv')).toEqual([]);
    expect(libraryCandidates(items, 'iptv')).toHaveLength(1);
    expect(libraryCandidates(items, 'mi te')).toHaveLength(1);
  });
});

describe('@lento rendimiento (§14.7)', () => {
  it('100 000 canales: una búsqueda en menos de 50 ms (índice ya montado)', () => {
    const words = ['Sport', 'Cine', 'Noticias', 'Música', 'Infantil', 'Series', 'Docu', 'Liga'];
    const channels: RawChannel[] = [];
    for (let i = 0; i < 100_000; i += 1) {
      const word = words[i % words.length] as string;
      channels.push(raw(`ES: ${word} ${Math.floor(i / 8)} HD`, `ES | ${word.toUpperCase()}`));
    }
    const big = catalog(channels);
    searchCatalog(big, 'calentar');
    const queries = ['sport 12', 'liga', 'cine 999', 'noti', 'musica 4', 'docu 12345', 'la liga'];
    const times: number[] = [];
    for (const q of queries) {
      const start = performance.now();
      const found = searchCatalog(big, q);
      times.push(performance.now() - start);
      expect(found.groups.length).toBeLessThanOrEqual(IPTV_SEARCH.limit);
    }
    /* Con margen en la CI (máquinas lentas): la mediana, por debajo de 50 ms. */
    const sorted = [...times].sort((a, b) => a - b);
    expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThan(50);
  });
});
