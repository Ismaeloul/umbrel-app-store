/* Corpus de nombres de canales de listas IPTV/Xtream para las pruebas del
   buscador (0.9.0, equipo buscador-iptv; docs/buscador.md).

   NO sale de la lista real de Isma (no la tenemos ni la pedimos): está
   escrito a mano con la FORMA de las listas españolas e internacionales que
   circulan (y la de su lista del 26-sep, docs/iptv.md §18):

   - prefijos de país en todas sus formas: «ES: », «ES| », «|ES| », «ES - »,
     «[ES] », «ES► », «ES ► », «ES┃», «ESPAÑA - », «ES 4K », «ES ★ … ★»,
     «◉ ES: », «VIP ES: », «ES-» pegado, «ES TI - »;
   - calidades y códecs: 4K, UHD, FHD, HD, SD, HEVC, H265, 50FPS, «4K HDR»,
     superíndices (ᴴᴰ ᶠᴴᴰ ᵁᴴᴰ), «⁺», 1080p, 720p;
   - adornos: VIP, PPV, emojis, ◉ ┃ ★ ✪, «(backup)», «#2», «(2)», ᴿᴬᵂ;
   - los canales que se confunden: La 1 / La 1 Catalunya / La 1 Canarias /
     La 10 / LaLiga TV 1 / LALIGA+ PPV 1 / LA LIGA 1 (Rakuten) / LATINO
     SPORTS 1; Tele 5 / Telecinco / el TELE 5 alemán; A3 / Antena 3 / el
     ANTENA 3 CNN rumano; M+ LaLiga / Movistar LaLiga / LaLiga TV
     Hypermotion; DAZN 1 / DAZN 2 / DAZN LaLiga y los DAZN de otros países;
     #Vamos, #0, Cuatro, La Sexta / laSexta, TV3 (y los TV3 de Suecia,
     Dinamarca, Noruega y Lituania), Movistar Plus+, RAI 1 / RAI UNO, LA 7
     (Castilla y León) / LA 7 (Italia)…;
   - cabeceras «##### … #####», filas de evento con horario, adultos y
     nombres en otros alfabetos.

   `corpusIptv()` devuelve ~1 500 filas con nombre propio (siempre las
   mismas, en el mismo orden); `corpusIptvGrande(n)` las completa con
   relleno realista (otros países y temas, también con «la», «1» y «tele»
   por medio) hasta `n` filas, para las pruebas de rendimiento. Pseudoaleatorio
   con semilla: siempre sale lo mismo. */

export interface CanalCorpus {
  /** El nombre tal cual lo da el panel. */
  readonly title: string;
  /** La categoría del panel (Xtream: la de su `category_id`). */
  readonly group: string;
}

/* --- Generador pseudoaleatorio con semilla (mulberry32) --- */

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* --- Formas de escribir el país, la calidad y los adornos --- */

/** Prefijos de España, como los escriben los paneles. `{n}` es el nombre. */
export const ES_STYLES: readonly string[] = [
  'ES: {n}',
  'ES| {n}',
  '|ES| {n}',
  'ES - {n}',
  '[ES] {n}',
  'ES► {n}',
  'ES ► {n}',
  'ES┃{n}',
  'ESPAÑA - {n}',
  'ES ★ {n} ★',
  '◉ ES: {n}',
  'VIP ES: {n}',
  'ES-{n}',
  'ES TI - {n}',
  'ES ✪ {n}',
  'ES » {n}',
  '{n}',
];

/** Calidades y códecs detrás del nombre (vacío = sin marca). */
export const QUALITY_TAILS: readonly string[] = [
  ' FHD',
  ' HD',
  ' 4K',
  ' UHD',
  ' SD',
  ' HEVC',
  ' H265',
  ' 50FPS',
  ' 4K HDR',
  ' FHD⁺',
  ' ᴴᴰ',
  ' ᶠᴴᴰ',
  ' ᵁᴴᴰ',
  ' 1080p',
  ' 720p',
  ' HD+',
  '',
];

/** Adornos y reservas del final (vacío = nada). */
export const DECOR_TAILS: readonly string[] = [
  '',
  '',
  '',
  ' (backup)',
  ' #2',
  ' (2)',
  ' ᴿᴬᵂ',
  ' ⚽',
  ' 🔴',
  ' ◉',
  ' VIP',
];

/* --- Canales con nombre propio --- */

const TDT = 'EU | ES | TDT ESPAÑA';
const DEP = 'EU | ES | DEPORTES';
const MOV = 'EU | ES | MOVISTAR+';
const DAZN = 'EU | ES | DAZN';
const AUTO = 'EU | ES | AUTONOMICAS';
const CINE = 'EU | ES | CINE Y SERIES';

/**
 * Canales de España con su categoría: cada uno sale en varias formas
 * (prefijo, calidad y adorno de las tablas de arriba), como en una lista que
 * junta varios paneles.
 */
export const SPAIN: readonly (readonly [name: string, group: string, copies: number])[] = [
  ['LA 1', TDT, 8],
  ['LA 2', TDT, 4],
  ['ANTENA 3', TDT, 6],
  ['CUATRO', TDT, 5],
  ['TELECINCO', TDT, 6],
  ['LA SEXTA', TDT, 4],
  ['TELEDEPORTE', DEP, 5],
  ['CLAN', TDT, 3],
  ['24H', TDT, 3],
  ['NEOX', TDT, 3],
  ['NOVA', TDT, 3],
  ['MEGA', TDT, 2],
  ['FDF', TDT, 2],
  ['ENERGY', TDT, 2],
  ['DIVINITY', TDT, 2],
  ['BOING', TDT, 2],
  ['ATRESERIES', TDT, 2],
  ['BE MAD', TDT, 2],
  ['DMAX', TDT, 3],
  ['TEN', TDT, 2],
  ['PARAMOUNT NETWORK', TDT, 2],
  ['TRECE', TDT, 2],
  ['GOL PLAY', DEP, 3],
  ['REAL MADRID TV', DEP, 3],
  ['BARÇA TV', DEP, 2],
  ['BETIS TV', DEP, 1],
  ['EUROSPORT 1', DEP, 4],
  ['EUROSPORT 2', DEP, 3],
  ['GOL', DEP, 2],
  ['TV3', AUTO, 4],
  ['3/24', AUTO, 2],
  ['ESPORT3', AUTO, 2],
  ['SUPER3/33', AUTO, 1],
  ['LA 1 CATALUNYA', AUTO, 3],
  ['LA 2 CATALUNYA', AUTO, 2],
  ['LA 1 CANARIAS', AUTO, 2],
  ['TELEMADRID', AUTO, 3],
  ['LA OTRA', AUTO, 2],
  ['CANAL SUR', AUTO, 3],
  ['ANDALUCIA TV', AUTO, 1],
  ['TVG', AUTO, 2],
  ['TVG 2', AUTO, 1],
  ['ETB 1', AUTO, 2],
  ['ETB 2', AUTO, 2],
  ['ARAGON TV', AUTO, 2],
  ['À PUNT', AUTO, 2],
  ['IB3', AUTO, 2],
  ['CMM', AUTO, 2],
  ['TPA7', AUTO, 2],
  ['CANAL EXTREMADURA', AUTO, 1],
  ['NAVARRA TV', AUTO, 1],
  ['7RM', AUTO, 1],
  ['LA 7', AUTO, 2],
  ['LA 8', AUTO, 1],
  ['LA 10', TDT, 2],
  ['TVE INTERNACIONAL', TDT, 2],
  ['M+ LALIGA TV', MOV, 7],
  ['M+ LALIGA TV 2', MOV, 4],
  ['M+ LALIGA TV 3', MOV, 3],
  ['M+ LALIGA TV 4', MOV, 2],
  ['M+ LALIGA TV BAR', MOV, 2],
  ['LALIGA TV HYPERMOTION', MOV, 4],
  ['LALIGA TV HYPERMOTION 2', MOV, 3],
  ['LALIGA TV HYPERMOTION 3', MOV, 2],
  ['LALIGA TV BAR', DEP, 2],
  ['M+ LIGA DE CAMPEONES', MOV, 5],
  ['M+ LIGA DE CAMPEONES 2', MOV, 3],
  ['M+ LIGA DE CAMPEONES 3', MOV, 2],
  ['M+ LIGA DE CAMPEONES 4', MOV, 1],
  ['M+ DEPORTES', MOV, 4],
  ['M+ DEPORTES 2', MOV, 2],
  ['M+ DEPORTES 3', MOV, 1],
  ['M+ VAMOS', MOV, 3],
  ['M+ #0', MOV, 2],
  ['M+ ELLAS V', MOV, 1],
  ['M+ GOLF', MOV, 2],
  ['M+ GOLF 2', MOV, 1],
  ['M+ COPA DEL REY', MOV, 1],
  ['M+ EUROLIGA', MOV, 1],
  ['MOVISTAR PLUS+', MOV, 4],
  ['M+ ESTRENOS', CINE, 2],
  ['M+ SERIES', CINE, 2],
  ['M+ CINE ESPAÑOL', CINE, 1],
  ['M+ DOCUMENTALES', CINE, 1],
  ['DAZN 1', DAZN, 7],
  ['DAZN 2', DAZN, 5],
  ['DAZN 3', DAZN, 3],
  ['DAZN 4', DAZN, 2],
  ['DAZN LALIGA', DAZN, 5],
  ['DAZN LALIGA 2', DAZN, 3],
  ['DAZN F1', DAZN, 4],
  ['DAZN 1 BAR', DAZN, 1],
  ['DAZN BALONCESTO', DAZN, 1],
  ['BEIN SPORTS Ñ', DEP, 2],
];

/**
 * Filas escritas a mano: las otras grafías de los mismos canales (las que
 * más confunden al buscador) y canales con el mismo nombre en otros países.
 */
export const HANDWRITTEN: readonly (readonly [title: string, group: string])[] = [
  /* La 1, como la escribe Isma que la ve en su lista. */
  ['ES 4K LA 1', 'EU | ES | 4K UHD'],
  ['ES: LA 1 4K', 'EU | ES | 4K UHD'],
  ['|ES| LA 1 FHD', TDT],
  ['ES: LA 1 TVE HD', TDT],
  ['TVE - LA 1', TDT],
  ['ES: LA 1 ⁺', TDT],
  ['La 1 HD', 'ES | GENERALISTAS'],
  /* Lo que no es La 1 y lleva «la» y «1». */
  ['ES: LALIGA TV 1 FHD', 'EU | ES | LALIGA'],
  ['ES: LALIGA TV 1 HD', 'EU | ES | LALIGA'],
  ['ES - LALIGA+ PPV 1', 'EU | ES | LALIGA+ PPV'],
  ['ES - LALIGA+ PPV 10', 'EU | ES | LALIGA+ PPV'],
  ['LA LIGA 1', 'EU | ES | RAKUTEN TV'],
  ['LA LIGA 2', 'EU | ES | RAKUTEN TV'],
  ['LAT: LATINO SPORTS 1', 'LATINO DEPORTES'],
  ['LAT: LATINO SPORTS 10', 'LATINO DEPORTES'],
  ['LAT: LATINO SPORTS 11', 'LATINO DEPORTES'],
  ['ES: LA 100 RADIO', 'EU | ES | RADIO'],
  /* Tele 5 / Telecinco. */
  ['ES: TELE 5 HD', TDT],
  ['ES: TELE5 SD', TDT],
  ['ES - TELE CINCO', TDT],
  ['DE: TELE 5 HD', 'EU | DE | ALLGEMEIN'],
  ['IT: CANALE 5 HD', 'EU | IT | GENERALI'],
  /* A3 / Antena 3. */
  ['ES: A3 HD', TDT],
  ['ES: ANTENA3 FHD', TDT],
  ['ES: ANTENA 3 INTERNACIONAL', TDT],
  ['ES: A3 SERIES HD', TDT],
  ['RO: ANTENA 3 CNN', 'EU | RO | STIRI'],
  ['RO: ANTENA 1 HD', 'EU | RO | GENERAL'],
  /* Movistar con otras grafías. */
  ['ES: MOVISTAR LALIGA FHD', MOV],
  ['ES - M. LALIGA HD', MOV],
  ['ES-M.LALIGA 2 HD', MOV],
  ['ES: M+ LALIGA TV UHD', 'EU | ES | 4K UHD'],
  ['VIP - MOVISTAR LALIGA 4K', 'VIP | 4K ULTRA HD'],
  ['ES: #VAMOS FHD', MOV],
  ['ES: M+ #VAMOS HD', MOV],
  ['ES: #0 HD', MOV],
  ['ES: MOVISTAR PLUS+ 4K', 'EU | ES | 4K UHD'],
  ['ES: M+ PLUS HD', MOV],
  ['ES: M. LIGA DE CAMPEONES 2 HD', MOV],
  ['ES: M+ LIGA DE CAMPEONES UHD', 'EU | ES | 4K UHD'],
  ['ES: LALIGA HYPERMOTION 2 FHD', MOV],
  /* LaLiga y DAZN de otros países (mismos nombres cortos). */
  ['UK: LALIGA TV HD', 'EU | UK | SPORTS'],
  ['UK: SKY SPORTS LALIGA', 'EU | UK | SPORTS'],
  ['MX: SKY SPORTS LALIGA', 'AM | MX | DEPORTES'],
  ['ES: DAZN LA LIGA HD', DAZN],
  ['ES 4K DAZN 1', 'EU | ES | 4K UHD'],
  ['DE: DAZN 1 HD', 'EU | DE | SPORT'],
  ['DE: DAZN 2 HD', 'EU | DE | SPORT'],
  ['IT: DAZN 1', 'EU | IT | SPORT'],
  ['IT: ZONA DAZN', 'EU | IT | SPORT'],
  ['PT: DAZN 1 HD', 'EU | PT | DESPORTO'],
  ['PT: DAZN 2 HD', 'EU | PT | DESPORTO'],
  /* La Sexta / laSexta. */
  ['ES: LASEXTA FHD', TDT],
  ['ES: laSexta 4K', 'EU | ES | 4K UHD'],
  ['|ES| LA SEXTA ᴿᴬᵂ', TDT],
  /* TV3 de aquí y de fuera. */
  ['ES: TV3 CAT FHD', AUTO],
  ['SE: TV3 HD', 'EU | SE | ALLMÄNT'],
  ['DK: TV3 HD', 'EU | DK | GENEREL'],
  ['NO: TV3', 'EU | NO | GENERELL'],
  ['LT: TV3', 'EU | LT | BENDRI'],
  ['DK: TV3 SPORT HD', 'EU | DK | SPORT'],
  /* LA 7 de Castilla y León y la italiana; RAI 1 escrita con letra. */
  ['IT: LA 7 HD', 'EU | IT | GENERALI'],
  ['IT: LA7 D', 'EU | IT | GENERALI'],
  ['IT: RAI 1 HD', 'EU | IT | GENERALI'],
  ['IT: RAI UNO SD', 'EU | IT | GENERALI'],
  ['IT: RAI 2 HD', 'EU | IT | GENERALI'],
  ['IT: RAI 3 HD', 'EU | IT | GENERALI'],
  ['IT: ITALIA 1 HD', 'EU | IT | GENERALI'],
  ['IT: SKY SPORT UNO', 'EU | IT | SPORT'],
  ['IT: SKY SPORT CALCIO', 'EU | IT | SPORT'],
  /* Bélgica y Latinoamérica con «la». */
  ['BE: LA UNE HD', 'EU | BE | GENERAL'],
  ['BE: LA DEUX HD', 'EU | BE | GENERAL'],
  ['BE: LA TROIS', 'EU | BE | GENERAL'],
  ['CL: LA RED HD', 'AM | CL | NACIONALES'],
  ['MX: LAS ESTRELLAS HD', 'AM | MX | NACIONALES'],
  ['MX: CANAL 5 HD', 'AM | MX | NACIONALES'],
  ['MX: AZTECA 7', 'AM | MX | NACIONALES'],
  ['AR: TV PUBLICA', 'AM | ARG | NACIONALES'],
  ['AR: TELEFE HD', 'AM | ARG | NACIONALES'],
  ['LAT: TVE INTERNACIONAL', 'LATINO GENERAL'],
  ['LAT: ESPN', 'LATINO DEPORTES'],
  ['LAT: ESPN 2', 'LATINO DEPORTES'],
  /* Reino Unido, Alemania, Francia, Portugal, Rumanía, EE. UU. */
  ['UK: BBC ONE HD', 'EU | UK | GENERAL'],
  ['UK: BBC TWO HD', 'EU | UK | GENERAL'],
  ['UK: ITV 1 HD', 'EU | UK | GENERAL'],
  ['UK: CHANNEL 4 HD', 'EU | UK | GENERAL'],
  ['UK: CHANNEL 5 HD', 'EU | UK | GENERAL'],
  ['UK: SKY SPORTS MAIN EVENT', 'EU | UK | SPORTS'],
  ['UK: SKY SPORTS PREMIER LEAGUE', 'EU | UK | SPORTS'],
  ['UK: SKY SPORTS F1', 'EU | UK | SPORTS'],
  ['UK: TNT SPORTS 1', 'EU | UK | SPORTS'],
  ['UK: TNT SPORTS 2', 'EU | UK | SPORTS'],
  ['DE: DAS ERSTE HD', 'EU | DE | ALLGEMEIN'],
  ['DE: ZDF HD', 'EU | DE | ALLGEMEIN'],
  ['DE: RTL HD', 'EU | DE | ALLGEMEIN'],
  ['DE: SAT 1 HD', 'EU | DE | ALLGEMEIN'],
  ['DE: SPORT 1 HD', 'EU | DE | SPORT'],
  ['DE: SKY SPORT BUNDESLIGA 1', 'EU | DE | SPORT'],
  ['FR: TF1 HD', 'EU | FR | GENERALISTE'],
  ['FR: FRANCE 2 HD', 'EU | FR | GENERALISTE'],
  ['FR: M6 HD', 'EU | FR | GENERALISTE'],
  ['FR: CANAL+ SPORT', 'EU | FR | SPORT'],
  ['FR: BEIN SPORTS 1', 'EU | FR | SPORT'],
  ['FR: RMC SPORT 1', 'EU | FR | SPORT'],
  ['PT: RTP 1 HD', 'EU | PT | GENERALISTAS'],
  ['PT: SIC HD', 'EU | PT | GENERALISTAS'],
  ['PT: SPORT TV 1', 'EU | PT | DESPORTO'],
  ['PT: SPORT TV 2', 'EU | PT | DESPORTO'],
  ['RO: PRO TV HD', 'EU | RO | GENERAL'],
  ['RO: DIGI SPORT 1', 'EU | RO | SPORT'],
  ['US: ESPN HD', 'AM | USA | SPORTS'],
  ['US: ESPN 2 HD', 'AM | USA | SPORTS'],
  ['AR: BEIN SPORTS 1 HD', 'AR | SPORTS'],
  ['AR: MBC 1', 'AR | GENERAL'],
  ['RU: ПЕРВЫЙ КАНАЛ', 'EU | RU | ОБЩИЕ'],
  ['RU: РОССИЯ 1', 'EU | RU | ОБЩИЕ'],
  /* Lo que no es un canal o va al final. */
  ['##### ES DEPORTES #####', DEP],
  ['##### ES - M. LALIGA #####', MOV],
  ['ES - NO MATCH', 'VIP | LA LIGA'],
  [
    'ESPN PLUS 12 : SOCCER: REAL MADRID B @ X SEP 25 – 3:00 PM ET / 8:00 PM UK',
    'AM | USA | ESPN PLUS',
  ],
  ['XXX: CANAL ADULTO 1', 'XXX | ADULTS'],
  ['XXX: CANAL ADULTO 2', 'XXX | ADULTS'],
];

function render(style: string, name: string): string {
  return style.replace('{n}', name);
}

/**
 * El corpus con nombre propio (~1 500 filas, siempre igual): los canales de
 * España en varias formas cada uno y las filas escritas a mano, mezclados
 * como en un panel que junta varias fuentes.
 */
export function corpusIptv(): CanalCorpus[] {
  const random = seeded(20261003);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const out: CanalCorpus[] = [];
  for (const [name, group, copies] of SPAIN) {
    for (let copy = 0; copy < copies; copy += 1) {
      /* La primera, la forma más común («ES: … FHD»); las demás, cualquiera. */
      const style = copy === 0 ? 'ES: {n}' : pick(ES_STYLES);
      const quality = copy === 0 ? ' FHD' : pick(QUALITY_TAILS);
      const decor = copy === 0 ? '' : pick(DECOR_TAILS);
      out.push({ title: render(style, `${name}${quality}${decor}`), group });
    }
  }
  for (const [title, group] of HANDWRITTEN) out.push({ title, group });
  /* Relleno con nombre (otros temas de España), para que el corpus pese como una lista. */
  const themes = ['CINE', 'SERIES', 'DOCUMENTALES', 'INFANTIL', 'MUSICA', 'NOTICIAS'];
  for (let i = 0; i < 1100; i += 1) {
    const theme = pick(themes);
    const style = pick(ES_STYLES);
    out.push({
      title: render(style, `${theme} ${i + 1}${pick(QUALITY_TAILS)}`),
      group: `EU | ES | ${theme}`,
    });
  }
  return out;
}

/* Relleno de otros países para el corpus grande: temas y siglas con trampas («LA», «1», «TELE»). */
const FILL_COUNTRIES: readonly (readonly [code: string, prefix: string])[] = [
  ['UK', 'UK: '],
  ['DE', 'DE: '],
  ['FR', '|FR| '],
  ['IT', 'IT: '],
  ['PT', 'PT - '],
  ['NL', 'NL: '],
  ['PL', 'PL| '],
  ['RO', 'RO: '],
  ['TR', 'TR: '],
  ['AR', 'AR: '],
  ['LAT', 'LAT: '],
  ['MX', 'MX: '],
  ['US', 'US: '],
  ['EXYU', 'EXYU: '],
];
const FILL_WORDS: readonly string[] = [
  'SPORT',
  'SPORTS',
  'CINEMA',
  'MOVIES',
  'NEWS',
  'KIDS',
  'MUSIC',
  'TELE',
  'LA',
  'LIGA',
  'LATINO',
  'LIFE',
  'DOCU',
  'NATURE',
  'ACTION',
  'COMEDY',
  'SERIES',
  'PREMIUM',
  'GOLD',
  'PLUS',
];

/**
 * El corpus con nombre propio y relleno de otros países hasta `total` filas
 * (20 000 por defecto): para medir que buscar al teclear no se traba.
 */
export function corpusIptvGrande(total = 20_000): CanalCorpus[] {
  const random = seeded(31415926);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
  const out = corpusIptv();
  let n = 0;
  while (out.length < total) {
    n += 1;
    const [code, prefix] = pick(FILL_COUNTRIES);
    const words = random() < 0.5 ? `${pick(FILL_WORDS)} ${pick(FILL_WORDS)}` : pick(FILL_WORDS);
    out.push({
      title: `${prefix}${words} ${1 + (n % 120)}${pick(QUALITY_TAILS)}`,
      group: `${code} | ${pick(FILL_WORDS)}`,
    });
  }
  return out.slice(0, total);
}
