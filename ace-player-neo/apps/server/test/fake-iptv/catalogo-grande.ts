/* Catálogo grande del proveedor IPTV falso (docs/iptv.md §16.9): categorías
   y nombres con la forma de los de la lista real de Isma (27 687 canales en
   Xtream: «DAZN 1», «DAZN F1», «DAZN ACB 1…7», «LA LIGA 1», «LALIGA+ PPV
   1…9», «LA LIGA TV BAR», «MOVISTAR PLUS +2», «ANTENA 3 INTERNACIONAL»,
   «DIRECTO ANTENA 3 ᴿᴬᵂ» con letras en superíndice…), más otros países,
   idiomas, adultos y 4K, y relleno hasta el total pedido.

   Lo usan el proveedor falso (`createFakeIptv({ grande })`, CLI
   `--grande 30000`), la integración y las pruebas del índice. Todo es
   inventado salvo la FORMA de los nombres. */

export interface BigChannel {
  readonly streamId: number;
  readonly name: string;
  /** Nombre de la categoría (en Xtream, la de su `category_id`). */
  readonly category: string;
  readonly epg: string;
  /** Solo en la M3U. */
  readonly tvgCountry?: string;
  readonly tvgLanguage?: string;
}

export interface BigCategory {
  readonly id: string;
  readonly name: string;
}

export interface BigCatalog {
  /** En el orden del panel (`get_live_categories`). */
  readonly categories: readonly BigCategory[];
  readonly channels: readonly BigChannel[];
}

/** Categorías con nombre real, en el orden del panel. Dos repiten nombre con las del catálogo pequeño. */
export const BIG_CATEGORIES: readonly BigCategory[] = [
  { id: '10', name: 'ES | DEPORTES' },
  { id: '11', name: 'ES | DAZN' },
  { id: '12', name: 'ES | LALIGA' },
  { id: '13', name: 'ES | MOVISTAR' },
  { id: '14', name: 'ES | GENERALISTAS' },
  { id: '15', name: 'UK | SPORTS' },
  { id: '16', name: '|FR| SPORT' },
  { id: '17', name: '[IT] CALCIO' },
  { id: '18', name: 'LATINO DEPORTES' },
  { id: '19', name: 'AR | BEIN' },
  { id: '20', name: 'XXX | ADULTS' },
  { id: '21', name: '4K | UHD' },
  { id: '22', name: 'ES | INFANTIL' },
  { id: '23', name: 'ES | NOTICIAS' },
  { id: '24', name: 'Deportes' },
  { id: '25', name: 'VIP' },
];

type Named = readonly [category: string, name: string, extra?: Partial<BigChannel>];

/** Los canales con nombre real (van primero, en este orden). */
export const BIG_NAMED: readonly Named[] = [
  ['ES | DAZN', 'DAZN 1 ᶠᴴᴰ'],
  ['ES | DAZN', 'DAZN 1 ᴴᴰ'],
  ['ES | DAZN', 'DAZN F1 ᶠᴴᴰ'],
  ['ES | DAZN', 'DAZN F1 ᴴᴰ'],
  ...[1, 2, 3, 4, 5, 6, 7].map((n): Named => ['ES | DAZN', `DAZN ACB ${n} ᴴᴰ`]),
  ['ES | DEPORTES', 'DAZN 1'],
  ['ES | DEPORTES', 'LA LIGA 1'],
  ['ES | DEPORTES', 'PREMIER PADEL 1'],
  ['ES | DEPORTES', 'REAL MADRID TV EN'],
  ['ES | DEPORTES', 'TDP HD'],
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n): Named => ['ES | LALIGA', `LALIGA+ PPV ${n}`]),
  ['ES | LALIGA', 'LA LIGA TV BAR ᴴᴰ'],
  ['ES | MOVISTAR', 'MOVISTAR'],
  ['ES | MOVISTAR', 'MOVISTAR PLUS +2'],
  ['ES | MOVISTAR', 'MOVISTAR 2022 1'],
  ['ES | GENERALISTAS', 'ANTENA 3 ᴴᴰ'],
  ['ES | GENERALISTAS', 'ANTENA 3 INTERNACIONAL'],
  ['ES | GENERALISTAS', 'DIRECTO ANTENA 3 ᴿᴬᵂ'],
  ['UK | SPORTS', 'UK: SKY SPORTS F1 ᶠᴴᴰ'],
  ['UK | SPORTS', 'UK: SKY SPORTS PREMIER LEAGUE'],
  ['|FR| SPORT', '|FR| CANAL+ SPORT 360'],
  ['|FR| SPORT', '|FR| RMC SPORT 1'],
  ['[IT] CALCIO', '[IT] SKY CALCIO 1 HD'],
  ['[IT] CALCIO', '[IT] DAZN 1'],
  ['LATINO DEPORTES', 'LAT | ESPN 2'],
  ['LATINO DEPORTES', 'LAT | ESPN 3'],
  ['AR | BEIN', 'AR | BEIN SPORTS 1'],
  ['AR | BEIN', 'AR | BEIN SPORTS 2'],
  ['XXX | ADULTS', 'XXX: HOT 1'],
  ['XXX | ADULTS', 'XXX: HOT 2'],
  ['4K | UHD', '4K: DAZN LALIGA UHD'],
  ['4K | UHD', '4K: MOVISTAR LALIGA ᵁᴴᴰ'],
  ['ES | INFANTIL', 'CLAN'],
  ['ES | NOTICIAS', 'CANAL 24 HORAS'],
  ['Deportes', 'Teledeporte', { tvgCountry: 'ES', tvgLanguage: 'Spanish;English' }],
  ['VIP', 'VIP | DAZN 1'],
];

const FILLER_COUNTRIES = [
  'ES',
  'UK',
  'FR',
  'IT',
  'DE',
  'PT',
  'US',
  'LAT',
  'PL',
  'RO',
  'TR',
  'AL',
  'EXYU',
  'NL',
  'GR',
] as const;
const FILLER_WORDS = [
  'SPORTS',
  'CINE',
  'NEWS',
  'KIDS',
  'MUSIC',
  'DOCU',
  'SERIES',
  'TV',
  'ENTERTAINMENT',
  'RELIGION',
] as const;
const FILLER_QUALITIES = ['', ' HD', ' FHD', ' SD', ' ᴴᴰ', ' 4K'] as const;
/** Categorías de relleno (además de las de nombre real). */
export const FILLER_CATEGORY_COUNT = 150;

function slug(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9]+/g, '')
    .slice(0, 40);
}

/**
 * El catálogo grande con `total` canales (los de nombre real primero y
 * relleno hasta `total`). `firstStreamId` separa sus `stream_id` de los del
 * catálogo pequeño (101…111).
 */
export function bigCatalog(total: number, firstStreamId = 200_000): BigCatalog {
  const categories: BigCategory[] = [...BIG_CATEGORIES];
  for (let i = 0; i < FILLER_CATEGORY_COUNT; i += 1) {
    const country = FILLER_COUNTRIES[i % FILLER_COUNTRIES.length] as string;
    const word = FILLER_WORDS[i % FILLER_WORDS.length] as string;
    categories.push({
      id: String(100 + i),
      name: `${country} | ${word} ${Math.floor(i / 10) + 1}`,
    });
  }
  const channels: BigChannel[] = [];
  let streamId = firstStreamId;
  for (const [category, name, extra] of BIG_NAMED) {
    if (channels.length >= total) break;
    channels.push({ streamId: streamId++, name, category, epg: `${slug(name)}.big`, ...extra });
  }
  let n = 0;
  while (channels.length < total) {
    /* Uno de cada diez repite el anterior con otra calidad (otra variante de la misma fila). */
    const number = n % 10 === 9 ? n - 1 : n;
    const filler = categories[
      BIG_CATEGORIES.length + (number % FILLER_CATEGORY_COUNT)
    ] as BigCategory;
    const [country, rest] = filler.name.split(' | ') as [string, string];
    const word = rest.replace(/ \d+$/, '');
    const quality = FILLER_QUALITIES[n % FILLER_QUALITIES.length] as string;
    const name = `${country}: ${word} CANAL ${number}${quality}`;
    channels.push({
      streamId: streamId++,
      name,
      category: filler.name,
      epg: `relleno${number}.big`,
    });
    n += 1;
  }
  return { categories, channels };
}
