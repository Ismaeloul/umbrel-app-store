/* Tokenizador XMLTV en streaming, propio y mínimo (docs/iptv.md §3.6).

   Sin dependencias. Entiende `<channel id>` con `<display-name>` y
   `<programme start stop channel>` con `<title>`, `<sub-title>`, `<desc>`,
   `<category>`, `<previously-shown/>`, `<new/>` y `<live/>`; entidades (las 5
   con nombre y las numéricas), CDATA y comentarios. El resto se salta sin
   guardarlo.

   Defensas ante guías hostiles:
   - `<!DOCTYPE>` y las entidades declaradas se IGNORAN (nada de «billion
     laughs»): solo valen las 5 con nombre y las numéricas; una desconocida
     se deja tal cual;
   - tope de 8 KiB por texto y por atributo: lo que pase se descarta sin
     acumularlo;
   - profundidad máxima de 8 niveles y 64 atributos por elemento: si se pasa,
     se salta el elemento entero.
   Fechas `YYYYMMDDhhmmss ±hhmm`; sin zona, UTC más el `tvg-shift` que diga
   quien llama. */

import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';
import { IPTV_GUIDE_LIMITS } from '@ace/shared';

export interface XmltvProgramme {
  readonly channel: string;
  /** Epoch ms (null si la fecha no se entiende). */
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
}

export interface XmltvChannel {
  readonly id: string;
  readonly names: readonly string[];
}

export interface XmltvHandlers {
  onChannel?(channel: XmltvChannel): void;
  onProgramme?(programme: XmltvProgramme): void;
}

export interface XmltvOptions {
  readonly maxTextBytes?: number;
  readonly maxDepth?: number;
  readonly maxAttributes?: number;
  readonly signal?: AbortSignal;
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
 * Fecha XMLTV (`20260926183000 +0200`, con o sin segundos, con o sin zona).
 * Sin zona se toma UTC y se suman `shiftHours` (el `tvg-shift`).
 */
export function parseXmltvDate(
  value: string,
  shiftHours = 0,
): { readonly at: number; readonly naive: boolean } | null {
  const match =
    /^\s*(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*(?:([+-])(\d{2}):?(\d{2}))?/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s, sign, zh, zm] = match;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (!Number.isFinite(utc)) return null;
  if (sign) {
    const offset = (Number(zh) * 60 + Number(zm)) * 60_000;
    return { at: sign === '+' ? utc - offset : utc + offset, naive: false };
  }
  /* Como el tvg-shift de Kodi: horas que se ADELANTA la guía. */
  return { at: utc + shiftHours * 3_600_000, naive: true };
}

interface Frame {
  readonly name: string;
  /** Texto que se captura (título, descripción…); null si este elemento no interesa. */
  text: string[] | null;
  textBytes: number;
  overflow: boolean;
}

interface ProgrammeDraft {
  channel: string;
  start: string;
  stop: string;
  title: string;
  subTitle: string;
  desc: string;
  categories: string[];
  previouslyShown: boolean;
  isNew: boolean;
  live: boolean;
}

const CAPTURED = new Set(['title', 'sub-title', 'desc', 'category', 'display-name']);

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
): Promise<{ readonly programmes: number; readonly channels: number }> {
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
  let channel: { id: string; names: string[] } | null = null;
  let programmes = 0;
  let channels = 0;
  let firstChunk = true;
  /* Resto de una etiqueta gigante que empezó en un trozo anterior. */
  let skipTagTail = false;

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
        subTitle: '',
        desc: '',
        categories: [],
        previouslyShown: false,
        isNew: false,
        live: false,
      };
      if (selfClosing) finishProgramme();
    } else if (name === 'channel' && parent === 'tv') {
      channel = { id: attributes.get('id') ?? '', names: [] };
      if (selfClosing) finishChannel();
    } else if (programme && parent === 'programme') {
      if (name === 'previously-shown') programme.previouslyShown = true;
      else if (name === 'new') programme.isNew = true;
      else if (name === 'live') programme.live = true;
    }
    if (!selfClosing) {
      const capture =
        CAPTURED.has(name) &&
        (parent === 'programme' || (parent === 'channel' && name === 'display-name'));
      stack.push({ name, text: capture ? [] : null, textBytes: 0, overflow: false });
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
    });
  };

  const finishChannel = (): void => {
    const draft = channel;
    channel = null;
    if (!draft || !draft.id) return;
    channels += 1;
    handlers.onChannel?.({ id: draft.id, names: draft.names });
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
    const text = closed.text && !closed.overflow ? decodeEntities(closed.text.join('')).trim() : '';
    const parent = top()?.name;
    if (programme && parent === 'programme' && closed.text) {
      if (name === 'title' && !programme.title) programme.title = text;
      else if (name === 'sub-title' && !programme.subTitle) programme.subTitle = text;
      else if (name === 'desc' && !programme.desc) programme.desc = text;
      else if (name === 'category' && text && programme.categories.length < 8) {
        programme.categories.push(text);
      }
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
        closeElement(tag.slice(1).trim().toLowerCase());
        continue;
      }
      const selfClosing = tag.endsWith('/');
      const inner = selfClosing ? tag.slice(0, -1) : tag;
      const nameMatch = /^([A-Za-z_:][A-Za-z0-9_.:-]*)/.exec(inner);
      if (!nameMatch) continue;
      const name = (nameMatch[1] as string).toLowerCase();
      openElement(name, inner.slice(name.length), selfClosing);
    }
    buffer = final ? '' : buffer.slice(index);
  };

  try {
    for await (const value of body as AsyncIterable<Buffer | string>) {
      if (options.signal?.aborted) throw options.signal.reason ?? new Error('aborted');
      const chunk = typeof value === 'string' ? Buffer.from(value) : value;
      if (firstChunk) {
        firstChunk = false;
        const head = chunk.subarray(0, 200).toString('latin1');
        latin1 = /encoding\s*=\s*["'](?:iso-8859-1|latin-?1|windows-1252|cp1252)["']/i.test(head);
        decoder = latin1 ? null : new StringDecoder('utf8');
      }
      let text = latin1 ? chunk.toString('latin1') : (decoder as StringDecoder).write(chunk);
      if (skipTagTail) {
        const close = text.indexOf('>');
        if (close < 0) continue;
        skipTagTail = false;
        skipDepth += 1;
        text = text.slice(close + 1);
      }
      buffer += text;
      pump(false);
    }
    if (decoder) buffer += decoder.end();
    pump(true);
  } finally {
    body.destroy();
  }
  return { programmes, channels };
}
