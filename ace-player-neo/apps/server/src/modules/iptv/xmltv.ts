/* Tokenizador XMLTV en streaming, propio y mínimo (docs/iptv.md §3.6 y §20.3).

   Sin dependencias. Entiende `<channel id>` con `<display-name>` e `<icon>`
   y `<programme start stop channel clumpidx>` con `<title>`, `<sub-title>`,
   `<desc>` (de cada uno, el de `lang="es"` si lo hay; si no, el primero),
   `<category>`, `<episode-num system>`, `<date>`, `<rating><value>`,
   `<star-rating><value>`, `<credits>` (`<director>` y `<actor>`), `<icon>`,
   `<previously-shown/>`, `<new/>` y `<live/>`; entidades (las 5 con nombre
   y las numéricas), CDATA y comentarios. El resto se salta sin guardarlo.

   Texto: si la guía dice latin1 pero trae UTF-8 («FÃºtbol»), cada texto se
   vuelve a leer como UTF-8; y si dice UTF-8 (o nada) pero trae bytes que no
   lo son, se pasa a latin1 desde ese trozo.

   Defensas ante guías hostiles:
   - `<!DOCTYPE>` y las entidades declaradas se IGNORAN (nada de «billion
     laughs»): solo valen las 5 con nombre y las numéricas; una desconocida
     se deja tal cual;
   - tope de 8 KiB por texto y por atributo: lo que pase se descarta sin
     acumularlo;
   - profundidad máxima de 8 niveles y 64 atributos por elemento: si se pasa,
     se salta el elemento entero.
   Fechas `YYYYMMDDhhmmss ±hhmm` (también `±hh:mm` y las abreviaturas
   europeas y de EE. UU. que no dan lugar a dudas: `UTC`, `GMT`, `BST`,
   `CET`, `CEST`, `EST`…); sin zona (o con una que no se entiende), UTC más
   el `tvg-shift` que diga quien llama. */

import { isUtf8 } from 'node:buffer';
import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { IPTV_GUIDE_LIMITS } from '@ace/shared';

/** Un `<episode-num>` tal cual (`xmltv_ns`, `onscreen`…). */
export interface XmltvEpisodeNum {
  readonly system: string;
  readonly value: string;
}

export interface XmltvProgramme {
  readonly channel: string;
  /** Epoch ms (null si la fecha no se entiende o falta). */
  readonly start: number | null;
  readonly stop: number | null;
  /** `true` si la fecha no traía zona (se le aplica el `tvg-shift`). */
  readonly naiveTime: boolean;
  readonly title: string;
  readonly subTitle: string;
  readonly desc: string;
  readonly categories: readonly string[];
  readonly previouslyShown: boolean;
  readonly isNew: boolean;
  readonly live: boolean;
  /** `clumpidx="0/2"`: varios programas que comparten franja («Noticias» y «El tiempo»). */
  readonly clump?: { readonly index: number; readonly total: number } | null;
  readonly episodeNums?: readonly XmltvEpisodeNum[];
  /** `<date>` tal cual («2019», «20190512»). */
  readonly date?: string;
  /** Primer `<rating><value>` (edad: «+7», «TP») y primer `<star-rating><value>` («3/5»). */
  readonly rating?: string;
  readonly stars?: string;
  readonly directors?: readonly string[];
  readonly actors?: readonly string[];
  /** `src` del primer `<icon>`. */
  readonly icon?: string;
}

export interface XmltvChannel {
  readonly id: string;
  readonly names: readonly string[];
  /** `src` del primer `<icon>` del canal (su logo). */
  readonly icon?: string;
}

export interface XmltvHandlers {
  onChannel?(channel: XmltvChannel): void;
  onProgramme?(programme: XmltvProgramme): void;
}

export interface XmltvStreamResult {
  readonly programmes: number;
  readonly channels: number;
  /**
   * Llegó entera: se vio el cierre `</tv>`. Un `xmltv.php` que se pasa de
   * tiempo o de memoria (PHP: «Fatal error: Maximum execution time…») cierra
   * la respuesta como si nada, sin error de red y sin `</tv>`: false.
   */
  readonly complete: boolean;
}

export interface XmltvOptions {
  readonly maxTextBytes?: number;
  readonly maxDepth?: number;
  readonly maxAttributes?: number;
  readonly signal?: AbortSignal;
  /**
   * Cede el hilo (`setImmediate`) cuando lleva tantos ms trabajando sin
   * parar entre trozos: con la guía completa cada programa se guarda en
   * disco, y la IPTV que alguien está viendo no puede esperar (§20.3).
   */
  readonly sliceMs?: number;
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  lt: '<',
  gt: '>',
  amp: '&',
  quot: '"',
  apos: "'",
};

/** Entidades: solo las 5 con nombre y las numéricas; las demás, tal cual. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(
    /&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|[A-Za-z][A-Za-z0-9]{0,31});/g,
    (match, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (
          !Number.isFinite(code) ||
          code <= 0 ||
          code > 0x10ffff ||
          (code >= 0xd800 && code <= 0xdfff)
        ) {
          return match;
        }
        return String.fromCodePoint(code);
      }
      return NAMED_ENTITIES[body] ?? match;
    },
  );
}

/**
 * Abreviaturas de zona que no dan lugar a dudas, en minutos respecto a UTC.
 * Fuera quedan las ambiguas (`CST`, `IST`…): se toman como sin zona.
 */
const ZONE_ABBREVIATIONS: Readonly<Record<string, number>> = {
  UTC: 0,
  UT: 0,
  GMT: 0,
  Z: 0,
  WET: 0,
  WEST: 60,
  BST: 60,
  CET: 60,
  CEST: 120,
  MET: 60,
  MEST: 120,
  EET: 120,
  EEST: 180,
  MSK: 180,
  EST: -300,
  EDT: -240,
  CDT: -300,
  MST: -420,
  MDT: -360,
  PST: -480,
  PDT: -420,
};

/**
 * Fecha XMLTV (`20260926183000 +0200`, con o sin segundos, con zona en
 * número, `±hh:mm` o abreviatura). Sin zona (o con una que no se entiende)
 * se toma UTC y se suman `shiftHours` (el `tvg-shift`). Una fecha imposible
 * (mes 13, hora 25…) da null.
 */
export function parseXmltvDate(
  value: string,
  shiftHours = 0,
): { readonly at: number; readonly naive: boolean } | null {
  const match =
    /^\s*(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2})|([A-Za-z]{1,5})(?![A-Za-z]))?/.exec(
      value,
    );
  if (!match) return null;
  const [, y, mo, d, h, mi, s, sign, zh, zm, abbreviation] = match;
  const month = Number(mo);
  const day = Number(d);
  const hour = Number(h);
  const minute = Number(mi);
  const second = Number(s ?? 0);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 60) {
    return null;
  }
  const utc = Date.UTC(Number(y), month - 1, day, hour, minute, second);
  if (!Number.isFinite(utc)) return null;
  if (sign) {
    const offset = (Number(zh) * 60 + Number(zm)) * 60_000;
    return { at: sign === '+' ? utc - offset : utc + offset, naive: false };
  }
  const zone = abbreviation ? ZONE_ABBREVIATIONS[abbreviation.toUpperCase()] : undefined;
  if (zone !== undefined) return { at: utc - zone * 60_000, naive: false };
  /* Como el tvg-shift de Kodi: horas que se ADELANTA la guía. */
  return { at: utc + shiftHours * 3_600_000, naive: true };
}

/** ¿El texto huele a UTF-8 leído como latin1 («FÃºtbol», «Â¿»)? */
const MOJIBAKE_RE = /[Â-ô][\u0080-¿]/;

/**
 * Una guía que dice latin1 pero trae UTF-8: el texto se vuelve a leer como
 * UTF-8 si así queda bien (sin caracteres rotos); si no, tal cual.
 */
export function repairMojibake(text: string): string {
  if (!MOJIBAKE_RE.test(text)) return text;
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) > 0xff) return text;
  }
  const bytes = Buffer.from(text, 'latin1');
  if (!isUtf8(bytes)) return text;
  return bytes.toString('utf8');
}

interface Frame {
  readonly name: string;
  /** Texto que se captura (título, descripción…); null si este elemento no interesa. */
  text: string[] | null;
  textBytes: number;
  overflow: boolean;
  /** `lang` (título, subtítulo y descripción) o `system` (`<episode-num>`). */
  attr: string;
}

interface ProgrammeDraft {
  channel: string;
  start: string;
  stop: string;
  title: string;
  titleSpanish: boolean;
  subTitle: string;
  subTitleSpanish: boolean;
  desc: string;
  descSpanish: boolean;
  categories: string[];
  previouslyShown: boolean;
  isNew: boolean;
  live: boolean;
  clump: { index: number; total: number } | null;
  episodeNums: XmltvEpisodeNum[];
  date: string;
  rating: string;
  stars: string;
  directors: string[];
  actors: string[];
  icon: string;
}

/** `lang` de español: «es», «es-ES», «spa». */
function isSpanish(lang: string): boolean {
  return /^(?:es|spa|esp)(?:[-_].*)?$/i.test(lang.trim());
}

/** `clumpidx="0/2"` → { index: 0, total: 2 }; null si no se entiende. */
function parseClump(value: string | undefined): { index: number; total: number } | null {
  const match = value ? /^\s*(\d{1,2})\s*\/\s*(\d{1,2})\s*$/.exec(value) : null;
  if (!match) return null;
  const index = Number(match[1]);
  const total = Number(match[2]);
  return total > 1 && index < total ? { index, total } : null;
}

/** Topes de lo que se junta de un programa (lo demás se ignora). */
const MAX_EPISODE_NUMS = 3;
const MAX_DIRECTORS = 3;
const MAX_ACTORS = 5;
const MAX_CATEGORIES = 8;

/** Elementos de `<programme>` cuyo texto se guarda. */
const PROGRAMME_TEXT = new Set(['title', 'sub-title', 'desc', 'category', 'episode-num', 'date']);

/** ¿Se guarda el texto de este elemento? (según su padre). */
function captures(name: string, parent: string | undefined): boolean {
  if (parent === 'programme') return PROGRAMME_TEXT.has(name);
  if (parent === 'credits') return name === 'director' || name === 'actor';
  if (parent === 'rating' || parent === 'star-rating') return name === 'value';
  return parent === 'channel' && name === 'display-name';
}

/* Atributos de una etiqueta: `nombre="valor"` o `nombre='valor'`. */
function parseTagAttributes(
  text: string,
  maxAttributes: number,
  maxBytes: number,
): Map<string, string> | null {
  const attributes = new Map<string, string>();
  const re = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  for (let match = re.exec(text); match; match = re.exec(text)) {
    if (attributes.size >= maxAttributes) return null;
    const value = match[2] ?? match[3] ?? '';
    if (value.length > maxBytes) continue;
    attributes.set((match[1] as string).toLowerCase(), decodeEntities(value));
  }
  return attributes;
}

/**
 * Parsea una guía XMLTV en streaming y llama a los manejadores con cada canal
 * y cada programa. Solo lanza si se aborta.
 */
export async function parseXmltvStream(
  body: Readable,
  handlers: XmltvHandlers,
  options: XmltvOptions = {},
): Promise<XmltvStreamResult> {
  const maxText = options.maxTextBytes ?? IPTV_GUIDE_LIMITS.maxTextBytes;
  const maxDepth = options.maxDepth ?? IPTV_GUIDE_LIMITS.maxDepth;
  const maxAttributes = options.maxAttributes ?? IPTV_GUIDE_LIMITS.maxAttributes;
  const maxTag = maxText * 2 + 1024;

  let decoder: StringDecoder | null = null;
  let latin1 = false;
  let buffer = '';
  const stack: Frame[] = [];
  /* >0: dentro de un elemento que se salta entero (demasiado hondo o raro). */
  let skipDepth = 0;
  let programme: ProgrammeDraft | null = null;
  let channel: { id: string; names: string[]; icon: string } | null = null;
  let programmes = 0;
  let channels = 0;
  let firstChunk = true;
  /* Resto de una etiqueta gigante que empezó en un trozo anterior. */
  let skipTagTail = false;
  /* Se vio el cierre `</tv>` (o un `<tv/>` vacío) y ningún canal ni programa detrás. */
  let ended = false;

  const top = (): Frame | undefined => stack[stack.length - 1];

  const addText = (raw: string): void => {
    const frame = top();
    if (!frame?.text || frame.overflow || skipDepth > 0) return;
    frame.textBytes += raw.length;
    if (frame.textBytes > maxText) {
      frame.overflow = true;
      frame.text = [];
      return;
    }
    frame.text.push(raw);
  };

  const openElement = (name: string, attrText: string, selfClosing: boolean): void => {
    if (skipDepth > 0) {
      if (!selfClosing) skipDepth += 1;
      return;
    }
    if (stack.length >= maxDepth) {
      if (!selfClosing) skipDepth = 1;
      return;
    }
    const attributes = parseTagAttributes(attrText, maxAttributes, maxText);
    if (!attributes) {
      if (!selfClosing) skipDepth = 1;
      return;
    }
    const parent = top()?.name;
    if (name === 'programme' && parent === 'tv') {
      programme = {
        channel: attributes.get('channel') ?? '',
        start: attributes.get('start') ?? '',
        stop: attributes.get('stop') ?? '',
        title: '',
        titleSpanish: false,
        subTitle: '',
        subTitleSpanish: false,
        desc: '',
        descSpanish: false,
        categories: [],
        previouslyShown: false,
        isNew: false,
        live: false,
        clump: parseClump(attributes.get('clumpidx')),
        episodeNums: [],
        date: '',
        rating: '',
        stars: '',
        directors: [],
        actors: [],
        icon: '',
      };
      if (selfClosing) finishProgramme();
    } else if (name === 'channel' && parent === 'tv') {
      channel = { id: attributes.get('id') ?? '', names: [], icon: '' };
      if (selfClosing) finishChannel();
    } else if (programme && parent === 'programme') {
      if (name === 'previously-shown') programme.previouslyShown = true;
      else if (name === 'new') programme.isNew = true;
      else if (name === 'live') programme.live = true;
      else if (name === 'icon' && !programme.icon) programme.icon = attributes.get('src') ?? '';
    } else if (channel && parent === 'channel' && name === 'icon' && !channel.icon) {
      channel.icon = attributes.get('src') ?? '';
    }
    if (!selfClosing) {
      const capture = captures(name, parent);
      const attr = capture
        ? name === 'episode-num'
          ? (attributes.get('system') ?? '')
          : (attributes.get('lang') ?? '')
        : '';
      stack.push({ name, text: capture ? [] : null, textBytes: 0, overflow: false, attr });
    }
  };

  const finishProgramme = (): void => {
    const draft = programme;
    programme = null;
    if (!draft || !draft.channel) return;
    const start = parseXmltvDate(draft.start);
    const stop = parseXmltvDate(draft.stop);
    programmes += 1;
    handlers.onProgramme?.({
      channel: draft.channel,
      start: start?.at ?? null,
      stop: stop?.at ?? null,
      naiveTime: Boolean(start?.naive),
      title: draft.title,
      subTitle: draft.subTitle,
      desc: draft.desc,
      categories: draft.categories,
      previouslyShown: draft.previouslyShown,
      isNew: draft.isNew,
      live: draft.live,
      clump: draft.clump,
      episodeNums: draft.episodeNums,
      date: draft.date,
      rating: draft.rating,
      stars: draft.stars,
      directors: draft.directors,
      actors: draft.actors,
      icon: draft.icon,
    });
  };

  const finishChannel = (): void => {
    const draft = channel;
    channel = null;
    if (!draft || !draft.id) return;
    channels += 1;
    handlers.onChannel?.({
      id: draft.id,
      names: draft.names,
      ...(draft.icon ? { icon: draft.icon } : {}),
    });
  };

  /* Título, subtítulo o descripción: el primero, salvo que llegue luego uno en español. */
  const pickLanguage = (
    draft: ProgrammeDraft,
    field: 'title' | 'subTitle' | 'desc',
    text: string,
    lang: string,
  ): void => {
    if (!text) return;
    const spanishKey = `${field}Spanish` as 'titleSpanish' | 'subTitleSpanish' | 'descSpanish';
    const spanish = lang !== '' && isSpanish(lang);
    if (!draft[field] || (spanish && !draft[spanishKey])) {
      draft[field] = text;
      draft[spanishKey] = spanish;
    }
  };

  const closeElement = (name: string): void => {
    if (skipDepth > 0) {
      skipDepth -= 1;
      return;
    }
    const frame = top();
    if (!frame || frame.name !== name) {
      /* XML mal cerrado: se busca el elemento en la pila y se cierra hasta él. */
      const index = stack.map((item) => item.name).lastIndexOf(name);
      if (index < 0) return;
      while (stack.length > index + 1) stack.pop();
    }
    const closed = stack.pop() as Frame;
    let text = closed.text && !closed.overflow ? decodeEntities(closed.text.join('')).trim() : '';
    if (latin1 && text) text = repairMojibake(text);
    const parent = top()?.name;
    if (programme && parent === 'programme' && closed.text) {
      if (name === 'title') pickLanguage(programme, 'title', text, closed.attr);
      else if (name === 'sub-title') pickLanguage(programme, 'subTitle', text, closed.attr);
      else if (name === 'desc') pickLanguage(programme, 'desc', text, closed.attr);
      else if (name === 'category' && text && programme.categories.length < MAX_CATEGORIES) {
        programme.categories.push(text);
      } else if (name === 'episode-num' && text) {
        if (programme.episodeNums.length < MAX_EPISODE_NUMS) {
          programme.episodeNums.push({ system: closed.attr.trim().toLowerCase(), value: text });
        }
      } else if (name === 'date' && text && !programme.date) programme.date = text;
    } else if (programme && closed.text && text) {
      if (parent === 'credits') {
        if (name === 'director' && programme.directors.length < MAX_DIRECTORS) {
          programme.directors.push(text);
        } else if (name === 'actor' && programme.actors.length < MAX_ACTORS) {
          programme.actors.push(text);
        }
      } else if (parent === 'rating' && !programme.rating) programme.rating = text;
      else if (parent === 'star-rating' && !programme.stars) programme.stars = text;
    } else if (channel && parent === 'channel' && name === 'display-name' && text) {
      if (channel.names.length < 4) channel.names.push(text);
    }
    if (name === 'programme' && parent === 'tv') finishProgramme();
    if (name === 'channel' && parent === 'tv') finishChannel();
  };

  /* Procesa lo que haya en `buffer`; deja al final lo incompleto. */
  const pump = (final: boolean): void => {
    let index = 0;
    for (;;) {
      const lt = buffer.indexOf('<', index);
      if (lt < 0) {
        addText(buffer.slice(index));
        index = buffer.length;
        break;
      }
      if (lt > index) addText(buffer.slice(index, lt));
      index = lt;
      if (buffer.startsWith('<!--', index)) {
        const end = buffer.indexOf('-->', index + 4);
        if (end < 0) break;
        index = end + 3;
        continue;
      }
      if (buffer.startsWith('<![CDATA[', index)) {
        const end = buffer.indexOf(']]>', index + 9);
        if (end < 0) {
          /* Un CDATA enorme: se añade lo que hay (addText lo topa) y se sigue esperando. */
          if (buffer.length - index > maxTag) {
            addText(buffer.slice(index + 9));
            buffer = '<![CDATA[';
            return;
          }
          break;
        }
        addText(buffer.slice(index + 9, end));
        index = end + 3;
        continue;
      }
      if (buffer.startsWith('<?', index)) {
        const end = buffer.indexOf('?>', index + 2);
        if (end < 0) break;
        index = end + 2;
        continue;
      }
      if (buffer.startsWith('<!', index)) {
        /* DOCTYPE y otras declaraciones: se saltan, con su subconjunto interno [..]. */
        let depth = 0;
        let end = -1;
        for (let cursor = index + 2; cursor < buffer.length; cursor += 1) {
          const char = buffer[cursor];
          if (char === '[') depth += 1;
          else if (char === ']') depth = Math.max(0, depth - 1);
          else if (char === '>' && depth === 0) {
            end = cursor;
            break;
          }
        }
        if (end < 0) {
          if (buffer.length - index > maxTag * 8) {
            /* Declaración gigante: se descarta lo leído y se sigue saltando. */
            buffer = '<!';
            return;
          }
          break;
        }
        index = end + 1;
        continue;
      }
      /* Etiqueta normal: hasta el '>' que no esté entre comillas. */
      let quote: string | null = null;
      let end = -1;
      for (let cursor = index + 1; cursor < buffer.length; cursor += 1) {
        const char = buffer[cursor];
        if (quote) {
          if (char === quote) quote = null;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === '>') {
          end = cursor;
          break;
        }
        if (cursor - index > maxTag) break;
      }
      if (end < 0) {
        if (buffer.length - index > maxTag) {
          /* Etiqueta enorme (atributos gigantes): se salta hasta su '>' y el elemento entero. */
          const close = buffer.indexOf('>', index + maxTag);
          if (close < 0) {
            buffer = '';
            skipTagTail = true;
            return;
          }
          if (buffer[close - 1] !== '/' && buffer[index + 1] !== '/') skipDepth += 1;
          index = close + 1;
          continue;
        }
        break;
      }
      const tag = buffer.slice(index + 1, end);
      index = end + 1;
      if (tag.startsWith('/')) {
        const closing = tag.slice(1).trim().toLowerCase();
        if (closing === 'tv') ended = true;
        closeElement(closing);
        continue;
      }
      const selfClosing = tag.endsWith('/');
      const inner = selfClosing ? tag.slice(0, -1) : tag;
      const nameMatch = /^([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(inner);
      if (!nameMatch) continue;
      const name = (nameMatch[1] as string).toLowerCase();
      /* Lo que venga tras el cierre (avisos de PHP: `<br />`, `<b>`) no cuenta; otra guía, sí. */
      if (name === 'tv' || name === 'programme' || name === 'channel') {
        ended = name === 'tv' && selfClosing;
      }
      openElement(name, inner.slice(name.length), selfClosing);
    }
    buffer = final ? '' : buffer.slice(index);
  };

  /* La codificación se decide con los primeros 200 bytes (aunque lleguen en trozos de 1). */
  let head: Buffer[] = [];
  let headBytes = 0;
  const decide = (): Buffer => {
    const start = Buffer.concat(head);
    head = [];
    firstChunk = false;
    const declared = start.subarray(0, 200).toString('latin1');
    latin1 = /encoding\s*=\s*["'](?:iso-8859-1|latin-?1|windows-1252|cp1252)["']/i.test(declared);
    decoder = latin1 ? null : new StringDecoder('utf8');
    return start;
  };

  const feed = (chunk: Buffer): void => {
    let text: string;
    if (latin1) text = chunk.toString('latin1');
    else {
      text = (decoder as StringDecoder).write(chunk);
      /* Dice UTF-8 (o nada) pero trae bytes que no lo son: desde aquí, latin1. */
      if (text.includes('�') && !chunk.includes(REPLACEMENT_BYTES)) {
        latin1 = true;
        decoder = null;
        text = chunk.toString('latin1');
      }
    }
    if (skipTagTail) {
      const close = text.indexOf('>');
      if (close < 0) return;
      skipTagTail = false;
      skipDepth += 1;
      text = text.slice(close + 1);
    }
    buffer += text;
    pump(false);
  };

  const flushDecoder = (): void => {
    if (decoder) buffer += decoder.end();
  };

  const sliceMs = options.sliceMs ?? 0;
  let sliceStart = performance.now();

  try {
    for await (const value of body as AsyncIterable<Buffer | string>) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
      const whole = typeof value === 'string' ? Buffer.from(value) : value;
      /* Un trozo enorme (un fichero entero de golpe) se procesa en pedazos de 64 KiB. */
      for (let offset = 0; offset < whole.length; offset += PIECE_BYTES) {
        const chunk =
          whole.length <= PIECE_BYTES ? whole : whole.subarray(offset, offset + PIECE_BYTES);
        if (firstChunk) {
          head.push(chunk);
          headBytes += chunk.length;
          if (headBytes < 200) continue;
          feed(decide());
        } else feed(chunk);
        if (sliceMs > 0 && performance.now() - sliceStart >= sliceMs) {
          await nextTurn();
          if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
          sliceStart = performance.now();
        }
      }
    }
    if (firstChunk) feed(decide());
    flushDecoder();
    pump(true);
  } finally {
    body.destroy();
  }
  return { programmes, channels, complete: ended };
}

/** Pedazo máximo que se procesa de una vez. */
const PIECE_BYTES = 64 * 1024;

/** U+FFFD tal cual en UTF-8: si la guía lo trae escrito, no es un byte roto. */
const REPLACEMENT_BYTES = Buffer.from([0xef, 0xbf, 0xbd]);
