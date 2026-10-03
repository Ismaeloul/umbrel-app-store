/* Guía XMLTV sintética para las pruebas de la Guía TV (docs/iptv.md §20.9):
   N canales × D días con programas de 20 a 90 min, sinopsis, categoría,
   episodio, año, edad, nota, reparto e imagen en parte de ellos, y la forma
   de una guía de verdad (`<channel>` con logo delante, fechas con zona).
   Determinista (un generador con semilla) y en trozos de unos 64 KiB, para
   no tener la guía entera en memoria ni siquiera en la prueba.

   La usan la prueba @lento de la guía grande (3 000 canales × 3 días, unos
   250 000 programas) y el proveedor falso con `guiaCompleta` (para ver la
   parrilla con el backend de verdad). Todo inventado. */

const MINUTE = 60_000;

export interface FakeGuideOptions {
  /** Canales: `tvg-id` = `${prefix}${i}.es` (i desde 1). */
  readonly channels: number;
  /** Primer instante (epoch ms) y días que cubre. */
  readonly from: number;
  readonly days: number;
  readonly prefix?: string;
  /** Con sinopsis, reparto, etc. (por defecto sí). */
  readonly details?: boolean;
  readonly seed?: number;
  /** Cuántos canales llevan logo (cada `logoEvery`; 0 = ninguno). */
  readonly logoEvery?: number;
  /** `tvg-id` de los canales tal cual (en vez de `${prefix}${i}.es`; entonces `channels` no cuenta). */
  readonly ids?: readonly string[];
  /** Sin la cabecera ni el `</tv>` del final (para seguir otra guía); por defecto, con ellos. */
  readonly wrap?: boolean;
  /**
   * Ningún programa empieza en este instante o después (el último puede
   * acabar algo más tarde). Para una guía que solo cubre hoy, como la del
   * panel de Isma (Paso 0 del 3-oct).
   */
  readonly until?: number;
}

/** `20261003183000 +0000`. */
export function xmltvDateOf(ms: number, zone = '+0000'): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(
    d.getUTCMinutes(),
  )}00 ${zone}`;
}

function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TITLES = [
  'Noticias',
  'El tiempo',
  'Cine: La ciudad dormida',
  'Documental: Océanos',
  'Serie: Comisaría Centro',
  'Concurso: La gran pregunta',
  'Deportes en directo',
  'Magacín de tarde',
  'Dibujos animados',
  'Fútbol: Sevilla - Valencia',
];
const CATEGORIES = ['Informativo', 'Cine', 'Documental', 'Serie', 'Deportes', 'Infantil'];
const DESC =
  'Una historia inventada para la prueba de la guía grande, con algo de texto para que pese como una sinopsis de verdad.';

function idsOf(options: FakeGuideOptions): readonly string[] {
  const prefix = options.prefix ?? 'Canal';
  return options.ids ?? Array.from({ length: options.channels }, (_, i) => `${prefix}${i + 1}.es`);
}

/** Número de programas que dará (aprox.) para dimensionar las pruebas. */
export function fakeGuideEstimate(options: FakeGuideOptions): number {
  return Math.round(idsOf(options).length * options.days * ((24 * 60) / 55));
}

/** La guía en trozos de ~64 KiB (`Readable.from` la sirve sin tenerla entera). */
export function* fakeGuideChunks(options: FakeGuideOptions): Generator<Buffer> {
  const ids = idsOf(options);
  const details = options.details ?? true;
  const wrap = options.wrap ?? true;
  const next = random(options.seed ?? 42);
  const end = Math.min(
    options.from + options.days * 24 * 60 * MINUTE,
    options.until ?? Number.POSITIVE_INFINITY,
  );
  const logoEvery = options.logoEvery ?? 10;
  let parts: string[] = [];
  let size = 0;
  const push = (text: string): Buffer | null => {
    parts.push(text);
    size += text.length;
    if (size < 64 * 1024) return null;
    const out = Buffer.from(parts.join(''), 'utf8');
    parts = [];
    size = 0;
    return out;
  };
  let out = wrap
    ? push(
        '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE tv SYSTEM "xmltv.dtd">\n<tv generator-info-name="guia-falsa">\n',
      )
    : null;
  if (out) yield out;
  for (const [index, id] of ids.entries()) {
    const number = index + 1;
    const icon =
      logoEvery > 0 && number % logoEvery === 0
        ? `<icon src="https://logos.example/${number}.png"/>`
        : '';
    out = push(
      `  <channel id="${id}"><display-name>Canal ${number}</display-name>${icon}</channel>\n`,
    );
    if (out) yield out;
  }
  for (const [channelIndex, id] of ids.entries()) {
    const channel = channelIndex + 1;
    let at = options.from;
    let index = 0;
    while (at < end) {
      const minutes = 20 + 5 * Math.floor(next() * 15);
      const stop = at + minutes * MINUTE;
      const title = TITLES[Math.floor(next() * TITLES.length)] as string;
      let body = `    <title lang="es">${title}</title>\n`;
      if (details) {
        const pick = next();
        body += `    <desc lang="es">${DESC} (${channel}-${index})</desc>\n`;
        body += `    <category lang="es">${CATEGORIES[Math.floor(pick * CATEGORIES.length)]}</category>\n`;
        if (pick < 0.3) {
          body += `    <episode-num system="xmltv_ns">${Math.floor(pick * 10)}.${index % 20}.0/1</episode-num>\n`;
        }
        if (pick > 0.8) {
          body += `    <date>${1990 + (index % 30)}</date>\n    <credits><director>Ana Pérez</director><actor>Luis Gómez</actor><actor>Marta Ruiz</actor></credits>\n`;
          body += `    <icon src="https://imagenes.example/p/${channel}/${index}.jpg"/>\n`;
        }
        if (pick > 0.5) body += '    <rating system="ES"><value>+7</value></rating>\n';
      }
      out = push(
        `  <programme start="${xmltvDateOf(at)}" stop="${xmltvDateOf(stop)}" channel="${id}">\n${body}  </programme>\n`,
      );
      if (out) yield out;
      at = stop;
      index += 1;
    }
  }
  if (wrap) parts.push('</tv>\n');
  if (parts.length) yield Buffer.from(parts.join(''), 'utf8');
}

/** La guía entera en un texto (solo para guías pequeñas). */
export function fakeGuideText(options: FakeGuideOptions): string {
  return [...fakeGuideChunks(options)].map((chunk) => chunk.toString('utf8')).join('');
}
