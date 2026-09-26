/* `iptvBrowse` en el modo demo (docs/iptv.md §16.10): la «IPTV de ejemplo»
   (812 canales, como dice Ajustes → IPTV en la demo) con categorías y nombres
   como los de una lista real («ES | DAZN» con «DAZN F1» y «DAZN ACB 1…7»,
   «ES | LALIGA» con «LALIGA+ PPV 1…9», «UK | SPORTS», «AR | BEIN», «XXX |
   ADULTS»…), para que la pestaña se pueda usar y probar sin servidor.

   Hace lo mismo que el servidor, a lo sencillo (812 canales): categoría,
   texto (cada palabra, principio de alguna palabra del nombre), filtros (O
   dentro de uno, Y entre ellos), facetas disyuntivas, recuentos por
   categoría y páginas con cursor. Los canales que también están en el
   buscador de la demo («DAZN 1», «M+ LaLiga TV»…) llevan su mismo id, así
   que al tocarlos suenan como allí. Solo se descarga en demo. */

import {
  IPTV_BROWSE,
  type IptvBrowseChannel,
  type IptvBrowseQuery,
  type IptvBrowseResponse,
  type IptvCategory,
  type IptvFacetName,
  type IptvFacets,
  type IptvFacetValue,
  type IptvQuality,
} from '@ace/shared';
import { DEMO_IPTV_SEARCH, demoIptvId } from '../../search/demo.ts';
import { foldText } from '../model.ts';
import { FACET_NAMES } from './model.ts';

const CATALOG = 'demo1';
const PROVIDER = 'IPTV de ejemplo';
export const DEMO_BROWSE_TOTAL = 812;

interface DemoRow {
  id: string;
  title: string;
  words: string[];
  category: string;
  country: string | null;
  language: string[];
  type: string[];
  sport: string[];
  quality: IptvQuality[];
}

interface Seed {
  category: string;
  country: string | null;
  language: string[];
  type: string[];
  /** [nombre, deportes, calidades, tipos propios] */
  channels: Array<[string, string[]?, IptvQuality[]?, string[]?]>;
  /** Relleno numerado hasta este número de canales en la categoría. */
  fill?: { prefix: string; to: number; sport?: string[]; type?: string[] };
}

const FHD_HD: IptvQuality[] = ['fhd', 'hd'];
const HD: IptvQuality[] = ['hd'];
const FHD: IptvQuality[] = ['fhd'];
const SD: IptvQuality[] = ['sd'];
const UHD: IptvQuality[] = ['uhd', 'fhd'];
const numbered = (name: string, n: number, sport?: string[], q?: IptvQuality[]) =>
  Array.from(
    { length: n },
    (_, i) => [`${name} ${i + 1}`, sport, q] as [string, string[]?, IptvQuality[]?],
  );

const SEEDS: Seed[] = [
  {
    category: 'ES | DEPORTES',
    country: 'ES',
    language: ['es'],
    type: ['deportes'],
    channels: [
      ['Teledeporte', [], FHD_HD],
      ['Eurosport 1', [], FHD_HD],
      ['Eurosport 2', [], HD],
      ['REAL MADRID TV', ['futbol'], HD],
      ['BARÇA TV', ['futbol'], HD],
      ['GOL PLAY', ['futbol'], HD],
      ['PREMIER PADEL 1', ['padel'], FHD],
      ['PREMIER PADEL 2', ['padel'], HD],
      ['TOROS TV', ['toros'], SD],
      ['LA LIGA 1', ['futbol'], FHD_HD],
    ],
    fill: { prefix: 'ES DEPORTES', to: 60 },
  },
  {
    category: 'ES | DAZN',
    country: 'ES',
    language: ['es'],
    type: ['deportes'],
    channels: [
      ['DAZN 1', [], FHD_HD],
      ['DAZN 2', [], FHD_HD],
      ['DAZN 3', [], HD],
      ['DAZN 4', [], HD],
      ['DAZN F1', ['f1'], FHD_HD],
      ...numbered('DAZN ACB', 7, ['baloncesto'], HD),
      ['DAZN LaLiga', ['futbol'], FHD_HD],
      ['DAZN LaLiga 2', ['futbol'], HD],
      ['DAZN MotoGP', ['motos'], FHD],
    ],
  },
  {
    category: 'ES | LALIGA',
    country: 'ES',
    language: ['es'],
    type: ['deportes'],
    channels: [
      ...numbered('LALIGA+ PPV', 9, ['futbol'], HD),
      ['LA LIGA TV BAR', ['futbol'], FHD],
      ['LaLiga TV Hypermotion', ['futbol'], HD],
      ['M+ LaLiga TV', ['futbol'], FHD_HD],
    ],
  },
  {
    category: 'ES | MOVISTAR',
    country: 'ES',
    language: ['es'],
    type: [],
    channels: [
      ['MOVISTAR', [], FHD],
      ['MOVISTAR PLUS +2', [], HD, ['entretenimiento']],
      ['MOVISTAR 2022 1', [], HD],
      ['M+ Liga de Campeones', ['futbol'], FHD_HD, ['deportes']],
      ['M+ Liga de Campeones 2', ['futbol'], HD, ['deportes']],
      ['M+ Vamos', [], HD, ['deportes']],
      ['M+ Golf', ['golf'], HD, ['deportes']],
      ['M+ Estrenos', [], FHD, ['cine']],
      ...numbered('M+ Deportes', 3, [], HD).map(
        ([n, s, q]) => [n, s, q, ['deportes']] as [string, string[], IptvQuality[], string[]],
      ),
    ],
  },
  {
    category: 'ES | GENERALISTAS',
    country: 'ES',
    language: ['es'],
    type: ['generalistas'],
    channels: [
      ['La 1', [], FHD_HD],
      ['La 2', [], HD],
      ['ANTENA 3', [], FHD_HD],
      ['ANTENA 3 INTERNACIONAL', [], HD],
      ['DIRECTO ANTENA 3 RAW', [], []],
      ['Cuatro', [], HD],
      ['Telecinco', [], HD],
      ['laSexta', [], HD],
      ['Telemadrid', [], SD],
      ['TV3', [], HD],
      ['ETB 1', [], SD],
      ['Canal Sur', [], SD],
    ],
    fill: { prefix: 'TV LOCAL', to: 70 },
  },
  {
    category: 'ES | CINE',
    country: 'ES',
    language: ['es'],
    type: ['cine'],
    channels: [
      ['TCM', [], HD],
      ['Hollywood', [], HD],
      ['XTRM', [], SD],
    ],
    fill: { prefix: 'CINE 24H', to: 40 },
  },
  {
    category: 'ES | INFANTIL',
    country: 'ES',
    language: ['es'],
    type: ['infantil'],
    channels: [
      ['Clan', [], HD],
      ['Boing', [], SD],
      ['Disney Junior', [], HD],
    ],
    fill: { prefix: 'DIBUJOS', to: 20 },
  },
  {
    category: 'ES | NOTICIAS',
    country: 'ES',
    language: ['es'],
    type: ['noticias'],
    channels: [
      ['CANAL 24 HORAS', [], HD],
      ['Euronews', [], SD],
    ],
    fill: { prefix: 'NOTICIAS', to: 12 },
  },
  {
    category: 'ES | DOCUMENTALES',
    country: 'ES',
    language: ['es'],
    type: ['documentales'],
    channels: [
      ['Discovery', [], HD],
      ['National Geographic', [], HD],
      ['Odisea', [], SD],
    ],
    fill: { prefix: 'DOCUMENTALES', to: 18 },
  },
  {
    category: 'UK | SPORTS',
    country: 'UK',
    language: ['en'],
    type: ['deportes'],
    channels: [
      ['SKY SPORTS F1', ['f1'], FHD],
      ['SKY SPORTS PREMIER LEAGUE', ['futbol'], FHD_HD],
      ['SKY SPORTS MAIN EVENT', [], FHD],
      ...numbered('TNT SPORTS', 4, [], FHD_HD),
      ['DAZN 1', [], HD],
      ['SKY SPORTS GOLF', ['golf'], HD],
      ['SKY SPORTS CRICKET', [], HD],
    ],
    fill: { prefix: 'UK SPORTS EVENT', to: 90 },
  },
  {
    category: '|FR| SPORT',
    country: 'FR',
    language: ['fr'],
    type: ['deportes'],
    channels: [
      ['CANAL+ SPORT 360', [], FHD],
      ['RMC SPORT 1', ['futbol'], FHD],
      ['RMC SPORT 2', ['futbol'], HD],
      ['BEIN SPORTS 1', ['futbol'], HD],
    ],
    fill: { prefix: 'FR SPORT', to: 50 },
  },
  {
    category: '[IT] CALCIO',
    country: 'IT',
    language: ['it'],
    type: ['deportes'],
    channels: numbered('SKY CALCIO', 7, ['futbol'], HD),
    fill: { prefix: 'IT CALCIO', to: 40, sport: ['futbol'] },
  },
  {
    category: 'LATINO DEPORTES',
    country: 'LAT',
    language: ['es'],
    type: ['deportes'],
    channels: [
      ...numbered('ESPN', 3, [], HD),
      ['FOX SPORTS 1', [], HD],
      ['TUDN', ['futbol'], HD],
      ['TYC SPORTS', ['futbol'], SD],
      ['WIN SPORTS', ['futbol'], SD],
    ],
    fill: { prefix: 'LATINO SPORTS', to: 60 },
  },
  {
    category: 'AR | BEIN',
    country: null,
    language: ['ar'],
    type: ['deportes'],
    channels: numbered('BEIN SPORTS', 6, [], FHD_HD),
    fill: { prefix: 'BEIN MAX', to: 40 },
  },
  {
    category: 'PT | DESPORTO',
    country: 'PT',
    language: ['pt'],
    type: ['deportes'],
    channels: [...numbered('SPORT TV', 5, [], FHD_HD), ...numbered('ELEVEN', 3, [], HD)],
    fill: { prefix: 'PT DESPORTO', to: 30 },
  },
  {
    category: 'DE | SPORT',
    country: 'DE',
    language: ['de'],
    type: ['deportes'],
    channels: [
      ...numbered('SKY BUNDESLIGA', 5, ['futbol'], FHD_HD),
      ['SKY SPORT F1', ['f1'], FHD],
      ['DAZN 1', [], HD],
    ],
    fill: { prefix: 'DE SPORT', to: 40 },
  },
  {
    category: 'US | NEWS',
    country: 'US',
    language: ['en'],
    type: ['noticias'],
    channels: [
      ['CNN', [], HD],
      ['FOX NEWS', [], HD],
      ['CNBC', [], SD],
      ['BLOOMBERG', [], SD],
    ],
    fill: { prefix: 'US NEWS', to: 25 },
  },
  {
    category: '4K | UHD',
    country: null,
    language: [],
    type: ['deportes'],
    channels: [
      ['DAZN LALIGA UHD', ['futbol'], UHD],
      ['M+ LaLiga 4K', ['futbol'], UHD],
      ['SKY SPORTS F1 UHD', ['f1'], UHD],
    ],
  },
  {
    category: 'XXX | ADULTS',
    country: null,
    language: [],
    type: ['adultos'],
    channels: numbered('HOT', 5, [], SD),
  },
  {
    category: '',
    country: null,
    language: [],
    type: [],
    channels: [['CANAL SIN GRUPO', [], []]],
    fill: { prefix: 'SIN GRUPO', to: 9 },
  },
];

function categoryIdOf(name: string): string {
  if (!name) return 'none';
  let h = 2166136261;
  let out = '';
  for (let round = 0; out.length < 12; round += 1)
    for (const ch of `cat|${name}#${round}`) {
      h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
      if (out.length < 12) out += (h & 15).toString(16);
    }
  return out.slice(0, 12);
}

const IN_SEARCH = new Set(DEMO_IPTV_SEARCH.map(([title]) => title));
const FILL_QUALITIES: IptvQuality[][] = [FHD_HD, HD, SD, [], HD, FHD];

let built: { rows: DemoRow[]; categories: Array<{ id: string; name: string }> } | null = null;

function build() {
  if (built) return built;
  const rows: DemoRow[] = [];
  const categories: Array<{ id: string; name: string }> = [];
  const push = (
    seed: Seed,
    title: string,
    sport: string[] = [],
    quality: IptvQuality[] = [],
    ownType?: string[],
  ) => {
    const category = categoryIdOf(seed.category);
    const adult = seed.type.includes('adultos');
    const baseType = ownType ?? seed.type;
    const type = adult
      ? ['adultos']
      : [...new Set([...baseType, ...(sport.length > 0 ? ['deportes'] : [])])];
    const id =
      seed.country === 'ES' && IN_SEARCH.has(title)
        ? demoIptvId(title)
        : demoIptvId(`${seed.country ?? '-'} ${seed.category} ${title}`);
    rows.push({
      id,
      title,
      words: foldText(title)
        .split(/[^a-z0-9+]+/)
        .filter(Boolean),
      category,
      country: seed.country,
      language: seed.language,
      type,
      sport: adult ? [] : sport,
      quality,
    });
  };
  for (const seed of SEEDS) {
    const id = categoryIdOf(seed.category);
    categories.push({ id, name: seed.category });
    for (const [title, sport, quality, ownType] of seed.channels)
      push(seed, title, sport, quality, ownType);
    const count = () => rows.filter((row) => row.category === id).length;
    if (seed.fill)
      for (let n = count() + 1; count() < seed.fill.to; n += 1)
        push(
          seed,
          `${seed.fill.prefix} ${n}`,
          seed.fill.sport ?? [],
          FILL_QUALITIES[n % FILL_QUALITIES.length],
          seed.fill.type,
        );
  }
  // Relleno hasta los 812 de la IPTV de ejemplo: más eventos deportivos de España.
  const extra = SEEDS[0]!;
  for (let n = 1; rows.length < DEMO_BROWSE_TOTAL; n += 1)
    push(extra, `ES EVENTOS ${n}`, n % 3 === 0 ? ['futbol'] : [], FILL_QUALITIES[n % 6]);
  // «Sin categoría», al final.
  categories.sort((a, b) => (a.id === 'none' ? 1 : 0) - (b.id === 'none' ? 1 : 0));
  built = { rows: rows.slice(0, DEMO_BROWSE_TOTAL), categories };
  return built;
}

function valuesOf(row: DemoRow, facet: IptvFacetName): string[] {
  switch (facet) {
    case 'country':
      return [row.country ?? 'none'];
    case 'language':
      return row.language.length > 0 ? row.language : ['none'];
    case 'type':
      return row.type.length > 0 ? row.type : ['none'];
    case 'sport':
      return row.sport;
    case 'quality':
      return row.quality.length > 0 ? row.quality : ['none'];
  }
}

function textMatches(row: DemoRow, words: string[]): boolean {
  return words.every((word) =>
    row.words.some((w) => w.startsWith(word) || (word.length >= 3 && w.includes(word))),
  );
}

const QUALITY_FIXED = ['uhd', 'fhd', 'hd', 'sd', 'none'];

function encodeCursor(offset: number): string {
  return btoa(`${CATALOG}.${offset}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeCursor(cursor: string): { catalog: string; offset: number } | null {
  try {
    const [catalog, offset] = atob(cursor.replace(/-/g, '+').replace(/_/g, '/')).split('.');
    const n = Number(offset);
    return catalog && Number.isInteger(n) && n >= 0 ? { catalog, offset: n } : null;
  } catch {
    return null;
  }
}

/** La respuesta de `iptvBrowse` sobre la IPTV de ejemplo. */
export function demoIptvBrowse(query: Partial<IptvBrowseQuery>): IptvBrowseResponse {
  const { rows, categories } = build();
  const q = foldText(String(query.q ?? '').replace(/\s+/g, ' ')).slice(0, 80);
  const words = q.length >= 2 ? q.split(' ').filter(Boolean) : [];
  const limit = query.limit ?? IPTV_BROWSE.limit;
  const selected = Object.fromEntries(
    FACET_NAMES.map((facet) => [
      facet,
      String(query[facet] ?? '')
        .split(',')
        .filter(Boolean),
    ]),
  ) as Record<IptvFacetName, string[]>;
  const categoryId = query.category ?? null;
  const categoryKnown = categoryId === null || categories.some((c) => c.id === categoryId);
  const cursor = query.cursor ? decodeCursor(query.cursor) : null;
  const stale = cursor !== null && cursor.catalog !== CATALOG;
  const firstPage = !cursor || stale;
  const base = rows.filter(
    (row) =>
      categoryKnown &&
      (categoryId === null || row.category === categoryId) &&
      (words.length === 0 || textMatches(row, words)),
  );
  const passes = (row: DemoRow, except: IptvFacetName | null) =>
    FACET_NAMES.every(
      (facet) =>
        facet === except ||
        selected[facet].length === 0 ||
        valuesOf(row, facet).some((v) => selected[facet].includes(v)),
    );
  const result = base.filter((row) => passes(row, null));
  if (words.length > 0) {
    const exact = (row: DemoRow) => row.words.join(' ') === words.join(' ');
    const starts = (row: DemoRow) => row.words[0]?.startsWith(words[0] ?? '') ?? false;
    const rank = (row: DemoRow) => (exact(row) ? 0 : starts(row) ? 1 : 2);
    result.sort((a, b) => rank(a) - rank(b));
  }
  const offset = firstPage ? 0 : (cursor?.offset ?? 0);
  const page = limit === 0 ? [] : result.slice(offset, offset + limit);
  const next = offset + page.length;
  const channels: IptvBrowseChannel[] = page.map((row) => ({
    id: row.id,
    title: row.title,
    qualities: row.quality,
    country: row.country,
    category: row.category,
  }));
  const response: IptvBrowseResponse = {
    active: true,
    provider: PROVIDER,
    catalog: CATALOG,
    query: words.length > 0 ? q : '',
    category: null,
    total: categoryKnown ? result.length : 0,
    catalogTotal: rows.length,
    channels,
    nextCursor: limit > 0 && next < result.length ? encodeCursor(next) : null,
    stale,
  };
  if (categoryId !== null && categoryKnown) {
    const name = categories.find((c) => c.id === categoryId)?.name ?? '';
    response.category = { id: categoryId, name, count: result.length };
  }
  if (firstPage) {
    const facets = {} as IptvFacets;
    for (const facet of FACET_NAMES) {
      const counts = new Map<string, number>();
      for (const row of base)
        if (passes(row, facet))
          for (const value of valuesOf(row, facet)) counts.set(value, (counts.get(value) ?? 0) + 1);
      for (const value of selected[facet]) if (!counts.has(value)) counts.set(value, 0);
      let values: IptvFacetValue[] = [...counts.entries()]
        .filter(([value, count]) => count > 0 || selected[facet].includes(value))
        .map(([value, count]) => ({ value, count, selected: selected[facet].includes(value) }));
      if (facet === 'quality')
        values.sort((a, b) => QUALITY_FIXED.indexOf(a.value) - QUALITY_FIXED.indexOf(b.value));
      else
        values.sort(
          (a, b) =>
            (a.value === 'none' ? 1 : 0) - (b.value === 'none' ? 1 : 0) || b.count - a.count,
        );
      values = values.slice(0, IPTV_BROWSE.facetValuesMax);
      facets[facet] = values;
    }
    response.facets = facets;
    if (categoryId === null) {
      const perCategory = new Map<string, number>();
      for (const row of result)
        perCategory.set(row.category, (perCategory.get(row.category) ?? 0) + 1);
      response.categories = categories
        .map((c): IptvCategory => ({ id: c.id, name: c.name, count: perCategory.get(c.id) ?? 0 }))
        .filter(
          (c) =>
            c.count > 0 ||
            (words.length > 0 && foldText(c.name).includes(q) && !hasSelection(selected)),
        );
    }
  }
  return response;
}

function hasSelection(selected: Record<IptvFacetName, string[]>): boolean {
  return FACET_NAMES.some((facet) => selected[facet].length > 0);
}

/** Solo para los tests: el id de categoría de un nombre de la demo. */
export const demoCategoryId = categoryIdOf;
