/* Vectores de las reglas comunes de la app (b-arquitectura §3.3, M2): color y equipos (lib/color.ts,
   lib/teams.ts), dorsal de canal (ui/ChannelMark.tsx), gestos (lib/gestures.ts), texto y números en
   español (library/model.ts, agenda/domain.ts, health/model.ts, player/NerdPanel.tsx, ui/Num.tsx,
   `toLocaleString('es-ES')` e `Intl.ListFormat`) y fechas (agenda/domain.ts, health/model.ts,
   devices/model.ts, library/model.ts, directories/model.ts, where-playing/model.ts), con TZ=Europe/Madrid.
   Las pruebas de Swift de Tests/AceNeoTests/Puros/Comunes exigen que el port dé exactamente lo mismo. */

import type { Area } from '../generar-vectores.ts';
import { web } from './_cargador.ts';

type Fn = (...args: never[]) => unknown;
type Modulo = Record<string, Fn>;

/** Clubes de la agenda de muestra (agenda/demo-data.ts) con sus colores. */
const CLUBES: Array<[string, string, string | null]> = [
  ['Real Madrid', '#febe10', '#1a1a5e'],
  ['FC Barcelona', '#a50044', '#004d98'],
  ['Juventus', '#101010', '#ffffff'],
  ['Inter', '#010e80', '#101010'],
  ['AC Milan', '#fb090b', '#101010'],
  ['Manchester City', '#6cabdd', '#1c2c5b'],
  ['Arsenal', '#ef0107', '#063672'],
  ['Liverpool', '#c8102e', '#00b2a9'],
  ['Atlético de Madrid', '#cb3524', '#272e61'],
  ['Real Sociedad', '#0067b1', '#ffffff'],
  ['Villarreal', '#ffe667', '#005187'],
  ['Sevilla', '#d4021d', '#ffffff'],
  ['Girona', '#cd2534', '#ffffff'],
  ['Mallorca', '#e20613', '#1b1b1b'],
  ['Espanyol', '#007fc8', '#ffffff'],
  ['Real Betis', '#00954c', '#ffffff'],
  ['Athletic Club', '#ee2523', '#101010'],
  ['España', '#aa151b', '#f1bf00'],
  ['Marruecos', '#c1272d', '#006233'],
  ['Portugal', '#006600', '#ff0000'],
  ['Barcelona SC', '#f9d616', '#101010'],
  ['Emelec', '#0033a0', '#9ea3a8'],
  ['Tottenham', '#ffffff', '#132257'],
  ['Getafe', '#005999', null],
];

const SIN_COLOR = ['Equipo Local', 'Central Córdoba Reserva', 'Atlético Tucumán Reserva', 'Ñandú FC', 'Borussia Mönchengladbach'];

const CANALES = [
  'DAZN 1', 'M+ LaLiga', 'DAZN', 'Canal de prueba', 'DAZN LaLiga', 'M+ LaLiga 2', 'M+ Liga de Campeones',
  'M+ Liga de Campeones 2', 'Zapping', 'La 1 HD', 'GOL Play', 'DAZN LaLiga 2', 'Amazon Prime Video', 'DAZN 1 HD',
  'Eurosport', 'Eurosport 2', 'Teledeporte', 'La 1', 'El Toro TV', 'Los 40', 'las noticias', 'Ñ TV', 'Érase TV',
  '', '   ', '1', '12345 TV', 'Canal 4K 1080', 'beIN SPORTS 1 HD', 'M+ #2', 'LIGA DE CAMPEONES --> ELCANO',
  '東京 FC', 'Ωmega Σport',
];

const HEXES = [
  '#febe10', 'febe10', '#FFF', 'abc', '#000000', '#ffffff', '#123456', 'ABCDEF', ' #a50044 ', '#12345', '#1234567',
  'zzzzzz', '', '#ggg', '#0a0d12', '#6cabdd', '#ffe667', '#808080',
];

const OKLCHS: Array<[number, number, number]> = [
  [0.46, 0.11, 200], [0.56, 0.13, 110], [0.5, 0.12, 0], [0.5, 0.12, 355], [0.93, 0.03, 40], [0.58, 0.06, 255],
  [0.12, 0.2, 30], [1, 0, 0], [0, 0, 0], [0.7, 0.3, 145], [0.9, 0.4, 280],
];

const COMPETICIONES = [
  '', 'Champions League', 'UEFA Champions League', 'Europa League', 'Conference League', 'Nations League',
  'Premier League', 'LaLiga', 'La Liga EA Sports', 'LaLiga Hypermotion', 'Segunda División', 'Copa del Rey',
  'Serie A', 'Bundesliga', 'Ligue 1', 'Mundial de Clubes', 'World Cup', 'Eurocopa', 'Euro 2028', 'Amistoso',
  'Nations League', 'Torneo Proyección', 'Liga Profesional Argentina', 'Copa Libertadores de América',
  'Supercopa de España', 'Major League Soccer', '  Primera RFEF  ', 'A-League Men', 'de la del y',
];

const INICIALES: Array<[string, string | null]> = [
  ['Atlético de Madrid', null], ['Tottenham', null], ['Real Madrid', null], ['Real Madrid', 'rma'],
  ['FC Barcelona', null], ['Barcelona SC', ' bsc '], ['Paris Saint-Germain', null], ['St. Pauli', null],
  ['Borussia Mönchengladbach', null], ['de la', null], ['', null], ['Club Atlético de San Luis', null],
  ['Ñandú FC', null], ['Inter', 'INTERNAZIONALE'], ['A.C. Milan', null], ['Wolverhampton Wanderers FC', null],
];

const DESLIZAMIENTOS: Array<[number, number, number]> = [
  [0, 0, 100], [56, 0, 1000], [55, 0, 1000], [-56, 0, 1000], [0, 56, 1000], [0, -56, 1000], [30, 0, 50],
  [24, 0, 50], [23, 0, 10], [-30, 5, 60], [40, 30, 50], [40, 28, 50], [100, 71, 400], [100, 72, 400],
  [10, 80, 400], [-72, 10, 300], [72, -40, 900], [0, 24, 53], [0, 24, 54], [-200, -150, 100],
];

const DECIMALES: Array<[number, number, number]> = [
  [2.3, 0, 1], [0.8, 0, 1], [14, 0, 1], [1.05, 0, 1], [1.25, 0, 1], [1.005, 2, 2], [4.8, 1, 1], [4.85, 1, 1],
  [0.05, 1, 1], [0.95, 0, 1], [1234.5, 0, 1], [12345.678, 0, 2], [1234567, 0, 0], [0.0004, 0, 1], [9.999, 2, 2],
  [-2.5, 0, 1], [-0.04, 0, 1], [1.87890625, 2, 2], [100, 2, 2], [99999.95, 0, 1],
];

const FECHAS_DIA = ['2026-09-24', '2026-09-23', '2026-09-25', '2026-09-28', '2026-01-01', '2026-02-28', '2024-02-29', '2026-12-31', '2026-03-29', '2026-10-25'];

/** Instantes (ISO) y «ahora» para formatWhen y las fechas cortas. */
const INSTANTES = [
  '2026-09-24T17:00:00.000Z', '2026-09-24T16:59:30.000Z', '2026-09-24T16:55:00.000Z', '2026-09-24T16:00:01.000Z',
  '2026-09-24T15:00:00.000Z', '2026-09-23T22:30:00.000Z', '2026-09-23T21:59:00.000Z', '2026-09-23T18:30:00.000Z',
  '2026-09-22T10:00:00.000Z', '2026-01-05T09:05:00.000Z', '2026-03-29T00:30:00.000Z', '2026-10-25T01:30:00.000Z',
  'no-es-una-fecha', '2026-09-24T18:00:00.000Z',
];
const AHORA = Date.parse('2026-09-24T17:00:00.000Z');

const LISTAS: string[][] = [
  [], ['LaLiga'], ['LaLiga', 'Premier League'], ['España', 'Italia'], ['España', 'Hierro'], ['a', 'hielo'],
  ['a', 'higo'], ['a', 'Hi'], ['a', 'iota'], ['a', 'Íñigo'], ['LaLiga', 'Champions League', 'Serie A'],
  ['1 liga', '2 equipos', '3 selecciones'], ['Real Madrid', 'Inter'], ['x', 'hiato'], ['x', 'hiena'], ['x', 'I+D'],
];

const TEXTOS = [
  'Fútbol', '  ÁÉÍÓÚ ñ Ü  ', 'En 2 h 28 min', 'En 48 min', 'En 1 h 18 min', '90 min', '2 horas', '12 minutos',
  'Faltan 3 h', 'Emitiendo ahora', 'señal', 'ÇA VA', 'x2 h', 'a 5 min.', '10 min, 20 min', '',
];

const CIFRAS = ["90+4'", '1-0', '12:30', '', 'HT', '2ª parte', '45', "72'", '٣', '1 080p'];

async function generar(): Promise<unknown> {
  const color = await web<Modulo>('lib/color.ts');
  const teams = await web<Modulo>('lib/teams.ts');
  const marca = await web<Modulo>('ui/ChannelMark.tsx');
  const gestos = await web<Modulo>('lib/gestures.ts');
  const num = await web<Modulo>('ui/Num.tsx');
  const agenda = await web<Modulo>('features/agenda/domain.ts');
  const salud = await web<Modulo>('features/health/model.ts');
  const biblioteca = await web<Modulo>('features/library/model.ts');
  const dispositivos = await web<Modulo>('features/devices/model.ts');
  const listas = await web<Modulo>('features/directories/model.ts');
  const donde = await web<Modulo>('features/where-playing/model.ts');
  const nerd = await web<Modulo>('player/NerdPanel.tsx');
  const f = <T>(m: Modulo, nombre: string) => m[nombre] as unknown as T;

  const parseHex = f<(v: string) => unknown>(color, 'parseHex');
  const rgbToHex = f<(v: unknown) => string>(color, 'rgbToHex');
  const rgbToOklch = f<(v: unknown) => unknown>(color, 'rgbToOklch');
  const oklchToRgb = f<(v: unknown) => unknown>(color, 'oklchToRgb');
  const listaEs = new Intl.ListFormat('es-ES', { type: 'conjunction' });

  const nombres = [...CLUBES.map(([n]) => n), ...SIN_COLOR, ...CANALES];
  const paletas = [
    ...CLUBES.map(([name, primary, secondary]) => ({ name, colors: { primary, secondary } })),
    ...SIN_COLOR.map((name) => ({ name, colors: null })),
    { name: 'Raro', colors: { primary: 'nada', secondary: '#fff' } },
    { name: 'Corto', colors: { primary: '#f00', secondary: null } },
  ];
  const pares: Array<[number, number]> = [];
  for (let i = 0; i < paletas.length; i += 1) for (let j = 0; j < paletas.length; j += 3) pares.push([i, j]);

  return {
    aviso: 'Generado por apps/ios/scripts/generar-vectores.ts (vectores/comunes.ts) desde apps/web/src. No se edita a mano.',
    color: {
      hex: HEXES.map((valor) => {
        const rgb = parseHex(valor);
        return { valor, rgb, hex: rgb ? rgbToHex(rgb) : null, oklch: rgb ? rgbToOklch(rgb) : null };
      }),
      oklch: OKLCHS.map(([l, c, h]) => {
        const rgb = oklchToRgb({ l, c, h });
        return { oklch: { l, c, h }, rgb, hex: rgbToHex(rgb), css: f<(v: unknown, a?: number) => string>(color, 'oklchCss')({ l, c, h }, 0.5) };
      }),
      leerOklch: ['oklch(0.83 0.12 222)', 'oklch(83% 0.12 222deg / 0.5)', 'OKLCH( 0.5 0.1 10 )', 'rgb(1,2,3)', 'oklch(0.5 0.1)'].map(
        (texto) => ({ texto, oklch: f<(v: string) => unknown>(color, 'parseOklch')(texto) }),
      ),
      contraste: HEXES.slice(0, 10).flatMap((a) =>
        ['#000000', '#ffffff', '#ffd60a'].map((b) => {
          const x = parseHex(a);
          const y = parseHex(b);
          return { a, b, contraste: x && y ? f<(a: unknown, b: unknown) => number>(color, 'contrastRatio')(x, y) : null };
        }),
      ),
      hash: nombres.map((nombre) => ({ nombre, hash: f<(t: string) => number>(color, 'hashText')(nombre) })),
      tonoVetado: Array.from({ length: 73 }, (_, i) => i * 5 - 5).map((tono) => ({
        tono,
        vetado: f<(h: number) => boolean>(color, 'isForbiddenHue')(tono),
      })),
      tonoDeNombre: nombres.map((nombre) => ({ nombre, tono: f<(n: string) => number>(color, 'hueFromName')(nombre) })),
      luzEquipo: CLUBES.flatMap(([, primario, secundario]) =>
        ['light', 'dark'].map((tema) => ({
          primario,
          secundario,
          oscuro: tema === 'dark',
          luz: f<(p: string, s: string | null, t: string) => unknown>(color, 'teamLight')(primario, secundario, tema),
        })),
      ).concat([{ primario: 'nada', secundario: null, oscuro: false, luz: null }]),
    },
    canal: CANALES.map((nombre) => ({
      nombre,
      tono: f<(n: string) => unknown>(color, 'channelTone')(nombre),
      dorsal: f<(n: string) => string>(marca, 'channelDorsal')(nombre),
      sigla: f<(n: string) => string>(marca, 'channelAbbrev')(nombre),
    })),
    equipos: {
      iniciales: INICIALES.map(([nombre, corto]) => ({
        nombre,
        corto,
        iniciales: f<(n: string, s?: string | null) => string>(teams, 'teamInitials')(nombre, corto),
      })),
      competicion: COMPETICIONES.map((nombre) => ({
        nombre,
        corta: f<(n: string) => string>(teams, 'competitionShort')(nombre),
      })),
      tonoNombre: nombres.map((nombre) => ({ nombre, tono: f<(n: string) => unknown>(teams, 'nameTone')(nombre) })),
      paletas: paletas.map((equipo) => ({ equipo, paleta: f<(e: unknown) => unknown>(teams, 'paletteOf')(equipo) })),
      versus: pares.map(([i, j]) => {
        const local = f<(e: unknown) => { primary: string; secondary: string | null; source: string }>(teams, 'paletteOf')(paletas[i]);
        const visitante = f<(e: unknown) => { primary: string; secondary: string | null; source: string }>(teams, 'paletteOf')(paletas[j]);
        return {
          local,
          visitante,
          distancia: f<(a: string, b: string) => number>(teams, 'colorDistance')(local.primary, visitante.primary),
          par: f<(a: unknown, b: unknown) => unknown>(teams, 'versusPair')(local, visitante),
        };
      }),
    },
    gestos: DESLIZAMIENTOS.flatMap(([dx, dy, ms]) =>
      (['x', 'y', 'both'] as const).flatMap((axis) =>
        [56, 72].map((threshold) => ({
          dx,
          dy,
          ms,
          eje: axis,
          umbral: threshold,
          resultado: f<(dx: number, dy: number, ms: number, o: object) => string | null>(gestos, 'classifySwipe')(dx, dy, ms, {
            axis,
            threshold,
          }),
        })),
      ),
    ),
    texto: TEXTOS.map((texto) => ({
      texto,
      plegado: f<(t: string) => string>(biblioteca, 'foldText')(texto),
      unidadesJuntas: f<(t: string) => string>(agenda, 'keepUnitsTogether')(texto),
      frase: f<(t: string) => string>(salud, 'sentence')(texto),
    })),
    plural: [0, 1, 2, 21].map((cuenta) => ({ cuenta, texto: f<(n: number, a: string, b: string) => string>(salud, 'plural')(cuenta, 'partido', 'partidos') })),
    listas: LISTAS.map((partes) => ({ partes, texto: listaEs.format(partes) })),
    numeros: {
      decimal: DECIMALES.map(([valor, minimo, maximo]) => ({
        valor,
        minimo,
        maximo,
        texto: valor.toLocaleString('es-ES', { minimumFractionDigits: minimo, maximumFractionDigits: maximo }),
      })),
      segundos: [2300, 800, 0, 49, 50, 1049, 1050, 61234, 999_950].map((ms) => ({
        ms,
        texto: f<(ms: number) => string>(salud, 'seconds')(ms),
      })),
      velocidad: [null, 0, 214.4, 214.5, 999, 999.6, 1000, 1966, 2399, 10240, 123456].map((kbs) => ({
        kbs,
        texto: f<(k: number | null) => string>(nerd, 'formatSpeed')(kbs),
      })),
      cifras: CIFRAS.map((texto) => ({ texto, trozos: f<(t: string) => unknown>(num, 'splitDigits')(texto) })),
    },
    fechas: {
      dias: FECHAS_DIA.map((dia) => ({
        dia,
        etiqueta: f<(d: string, hoy: string) => unknown>(agenda, 'dayLabel')(dia, '2026-09-24'),
        mas1: f<(d: string, n: number) => string>(agenda, 'addDays')(dia, 1),
        menos30: f<(d: string, n: number) => string>(agenda, 'addDays')(dia, -30),
      })),
      instantes: INSTANTES.map((iso) => ({
        iso,
        cuando: f<(i: string, n: number) => unknown>(salud, 'formatWhen')(iso, AHORA),
        horaMadrid: f<(v: string) => string | null>(agenda, 'madridHour')(iso),
        fechaCorta: f<(v: string) => string | null>(biblioteca, 'shortDate')(iso),
        emparejado: f<(d: object) => string>(dispositivos, 'pairedText')({ createdAt: iso }),
        fechaYHora: f<(v: string) => string>(listas, 'sourceDate')(iso),
        horaAbierta: f<(v: string) => string>(donde, 'openedClock')(iso),
      })),
      ahora: new Date(AHORA).toISOString(),
    },
  };
}

const area: Area = { destino: 'vectores-comunes.json', generar };
export default area;
