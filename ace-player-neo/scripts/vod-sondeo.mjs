#!/usr/bin/env node
// Paso 0 de Películas y series (docs/vod.md §3): mide el panel Xtream de Isma
// antes de escribir la reproducción. SOLO LECTURA: pide listas, unas fichas y
// trozos de unos pocos ficheros; nunca escribe nada en el panel ni en disco.
//
// Qué mide (cada punto es una fase; se pueden elegir con --fases):
//   listas  bytes, tiempo y número de elementos de las 4 listas VOD; reparto
//           de `container_extension`; objetos que se saltarían con 16, 64 y
//           256 KiB por objeto; títulos que dicen VOSE.
//   codecs  50 `get_vod_info` al azar (códec, altura, 10 bits, audio,
//           canales) y, en 30 películas, las pistas REALES leyendo solo la
//           cabecera y el índice (~1 MB cada una): lenguas de audio,
//           subtítulos de texto o de imagen, MKV con o sin Cues, moov al final.
//   range   en un MKV, un MP4 y un episodio: `bytes=0-65535` (estado,
//           Accept-Ranges, Content-Range, saltos de redirección, si cambia de
//           host o lleva token) y `bytes=<50 %>-`; si el destino de la
//           redirección admite Range por sí solo.
//   plaza   con `max_connections = 1`: 5 ciclos de leer 1 MB, cerrar y
//           reabrir enseguida, a los 2 s y a los 5 s; `active_cons` antes y
//           después; si da «ocupado», cuánto tarda en soltarse.
//   pausa   una conexión parada (sin leer) 60, 180 y 300 s: ¿la corta el panel?
//   token   cuánto dura el token del destino de la redirección (1, 5, 15, 30 y
//           60 min después de resolverla).
//
// Uso, en el Umbrel, CON LA APP DE IPTV DEL PC CERRADA (usa su única plaza):
//   VOD_SERVIDOR='http://proveedor:8080' VOD_USUARIO='…' VOD_CLAVE='…' \
//     node scripts/vod-sondeo.mjs [--fases listas,codecs,range,plaza,pausa,token] [--json]
// Dura como una hora (sobre todo la pausa y el token). Con --rapido las
// esperas se acortan (solo para probar el guion, no mide bien).
//
// Solo imprime AGREGADOS: nunca URLs, usuario, contraseña, hosts ni tokens.
// Antes de imprimir, todo el informe pasa por un filtro que tapa esos datos
// por si alguno se colara. El resultado se copia en docs/vod.md §3.

import http from 'node:http';
import https from 'node:https';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import zlib from 'node:zlib';

/* El mismo agente que usa el relé IPTV (IPTV_USER_AGENT de @ace/shared). */
const USER_AGENT = 'VLC/3.0.21 LibVLC/3.0.21';
/* Estados de «ocupado» de los paneles (IPTV_BUSY_STATUSES de @ace/shared). */
const BUSY_STATUSES = new Set([403, 429, 456, 458, 509]);
const KIB = 1024;
const MIB = 1024 * KIB;
/* Topes por objeto que se comparan (docs/vod.md §4.2 y T5). */
const OBJECT_LIMITS = [16 * KIB, 64 * KIB, 256 * KIB];
const EXTENSIONS = ['mp4', 'mkv', 'm4v', 'mov', 'avi', 'ts', 'webm'];
export const ALL_PHASES = ['listas', 'codecs', 'range', 'plaza', 'pausa', 'token'];

/**
 * @typedef {{ status: number, sameHost: boolean, hasQuery: boolean, hasToken: boolean }} Hop
 * @typedef {{ res: http.IncomingMessage, status: number, hops: Hop[], finalUrl: string }} Opened
 * @typedef {{ body: Buffer, bytes: number, reason: string }} ReadResult
 * @typedef {{ type: string | null, codec: string | null, lang: string | null, name?: string | null, height: number | null, channels: number | null }} Track
 * @typedef {{ id: number, start: number, end: number, complete: boolean, unknown: boolean }} EbmlElement
 * @typedef {{ type: string, start: number, end: number, offset: number, size: number, complete: boolean }} Mp4Box
 * @typedef {{ gapMs: number, infoGapMs: number, requestMs: number, listMs: number, cycles: number, cycleDelaysMs: number[], cycleRestMs: number, busyWaitMaxMs: number, pausesS: number[], tokenMarksMin: number[], infoSamples: number, trackSamples: number }} Timings
 * @typedef {Record<string, any>} Report  Informe: solo agregados (números, estados y sí/no).
 */

/** Esperas de verdad (una hora en total) y las de --rapido. @type {Record<'normal' | 'rapido', Timings>} */
export const TIMINGS = {
  normal: {
    gapMs: 3_000,
    infoGapMs: 1_000,
    requestMs: 20_000,
    listMs: 300_000,
    cycles: 5,
    cycleDelaysMs: [0, 2_000, 5_000],
    cycleRestMs: 10_000,
    busyWaitMaxMs: 30_000,
    pausesS: [60, 180, 300],
    tokenMarksMin: [1, 5, 15, 30, 60],
    infoSamples: 50,
    trackSamples: 30,
  },
  rapido: {
    gapMs: 50,
    infoGapMs: 10,
    requestMs: 5_000,
    listMs: 30_000,
    cycles: 1,
    cycleDelaysMs: [0, 50],
    cycleRestMs: 50,
    busyWaitMaxMs: 500,
    pausesS: [0.2],
    tokenMarksMin: [0.005],
    infoSamples: 3,
    trackSamples: 2,
  },
};

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// --- Red: una conexión por petición, redirecciones a mano -------------------

/**
 * Abre `url` con una conexión propia (sin keep-alive: al cerrarla, la plaza
 * se suelta) y sigue hasta 5 redirecciones a mano para poder contarlas.
 * Devuelve la respuesta sin leer y lo que se sabe de los saltos (sin URLs).
 * @param {string} url
 * @param {{ headers?: Record<string, string>, timeoutMs?: number, follow?: boolean }} [options]
 * @returns {Promise<Opened>}
 */
export function open(url, { headers = {}, timeoutMs = 20_000, follow = true } = {}) {
  /** @type {Hop[]} */
  const hops = [];
  const firstHost = new URL(url).host;
  /** @type {(target: string, left: number) => Promise<Opened>} */
  const attempt = (target, left) =>
    new Promise((resolve, reject) => {
      const parsed = new URL(target);
      const get = parsed.protocol === 'https:' ? https.get : http.get;
      const req = get(
        parsed,
        {
          agent: false,
          headers: { 'User-Agent': USER_AGENT, Connection: 'close', ...headers },
        },
        (res) => {
          const status = res.statusCode ?? 0;
          const location = res.headers.location;
          if (follow && status >= 300 && status < 400 && location) {
            clearTimeout(timer);
            res.destroy();
            if (left <= 0) return reject(new Error('demasiadas redirecciones'));
            const next = new URL(location, parsed);
            hops.push({
              status,
              sameHost: next.host === firstHost,
              hasQuery: next.search.length > 1,
              hasToken: /(?:^|[?&])(?:token|t|auth|key|sig|signature|expires?)=/i.test(next.search),
            });
            resolve(attempt(next.href, left - 1));
            return;
          }
          clearTimeout(timer);
          resolve({ res, status, hops, finalUrl: target });
        },
      );
      const timer = setTimeout(() => req.destroy(new Error('tiempo agotado')), timeoutMs);
      req.on('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  return attempt(url, 5);
}

/**
 * Lee como mucho `maxBytes` del cuerpo y cierra la conexión.
 * @param {http.IncomingMessage} res
 * @param {number} maxBytes
 * @param {number} [timeoutMs]
 * @returns {Promise<ReadResult>}
 */
export function readSome(res, maxBytes, timeoutMs = 20_000) {
  return new Promise((resolve) => {
    /** @type {Buffer[]} */
    const chunks = [];
    let total = 0;
    let settled = false;
    /** @param {string} reason */
    const done = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      res.destroy();
      resolve({ body: Buffer.concat(chunks), bytes: total, reason });
    };
    const timer = setTimeout(() => done('tiempo'), timeoutMs);
    res.on('data', (/** @type {Buffer} */ chunk) => {
      const room = maxBytes - total;
      if (room > 0) chunks.push(chunk.subarray(0, room));
      total += chunk.length;
      if (total >= maxBytes) done('tope');
    });
    res.on('end', () => done('fin'));
    res.on('error', () => done('error'));
    res.on('close', () => done('cerrada'));
  });
}

/**
 * `Content-Range: bytes a-b/total` → `{start, end, total}`.
 * @param {unknown} value
 */
export function parseContentRange(value) {
  const match = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(String(value ?? '').trim());
  if (!match) return null;
  return {
    start: Number(match[1]),
    end: Number(match[2]),
    total: match[3] === '*' ? null : Number(match[3]),
  };
}

// --- Listas en streaming --------------------------------------------------

/**
 * Troceador de un array JSON de primer nivel que mide cada elemento en bytes
 * sin guardar el array entero. A cada elemento de hasta `keepMax` bytes le
 * pasa su texto; a los mayores, solo su tamaño. Si lo de fuera no es un
 * array, `shape` lo dice (`object`: paneles con el VOD apagado).
 */
export class ArraySplitter {
  /**
   * @param {(size: number, text: string | null) => void} onElement
   * @param {number} [keepMax]
   */
  constructor(onElement, keepMax = 256 * KIB) {
    this.onElement = onElement;
    this.keepMax = keepMax;
    /** `array`, `object` u `other`; null hasta ver el primer carácter. @type {string | null} */
    this.shape = null;
    /** Lo de fuera ya se cerró (`]`): lo que venga después se ignora. */
    this.closed = false;
    this.outerText = '';
    this.inElement = false;
    /** El elemento es un objeto o un array (acaba al cerrar su llave), no un escalar. */
    this.container = false;
    this.depth = 0;
    this.inString = false;
    this.escape = false;
    this.size = 0;
    this.kept = 0;
    /** @type {Buffer[]} */
    this.parts = [];
  }

  /** @param {Buffer} chunk */
  write(chunk) {
    let start = this.inElement ? 0 : -1;
    for (let i = 0; i < chunk.length; i += 1) {
      const c = /** @type {number} */ (chunk[i]);
      if (this.shape === null) {
        if (c <= 0x20) continue;
        this.shape = c === 0x5b ? 'array' : c === 0x7b ? 'object' : 'other';
        if (this.shape !== 'array') this.outerText += String.fromCharCode(c);
        continue;
      }
      if (this.shape !== 'array') {
        if (this.outerText.length < 4096) this.outerText += String.fromCharCode(c);
        continue;
      }
      if (this.closed) return;
      if (!this.inElement) {
        if (c <= 0x20 || c === 0x2c) continue;
        if (c === 0x5d) {
          this.closed = true;
          return;
        }
        this.begin();
        start = i;
        if (c === 0x7b || c === 0x5b) {
          this.container = true;
          this.depth = 1;
        } else if (c === 0x22) {
          this.inString = true;
        }
        continue;
      }
      if (this.inString) {
        if (this.escape) this.escape = false;
        else if (c === 0x5c) this.escape = true;
        else if (c === 0x22) {
          this.inString = false;
          if (!this.container) {
            /* Un texto suelto acaba en su comilla. */
            this.take(chunk, start, i + 1);
            this.finish();
            start = -1;
          }
        }
        continue;
      }
      if (this.container) {
        if (c === 0x22) this.inString = true;
        else if (c === 0x7b || c === 0x5b) this.depth += 1;
        else if (c === 0x7d || c === 0x5d) {
          this.depth -= 1;
          if (this.depth === 0) {
            this.take(chunk, start, i + 1);
            this.finish();
            start = -1;
          }
        }
        continue;
      }
      /* Un escalar (número, true, null…) acaba en la coma, el corchete o un espacio. */
      if (c <= 0x20 || c === 0x2c || c === 0x5d) {
        this.take(chunk, start, i);
        this.finish();
        start = -1;
        if (c === 0x5d) {
          this.closed = true;
          return;
        }
      }
    }
    if (this.inElement && start >= 0) this.take(chunk, start, chunk.length);
  }

  begin() {
    this.inElement = true;
    this.container = false;
    this.depth = 0;
    this.inString = false;
    this.escape = false;
    this.size = 0;
    this.kept = 0;
    this.parts = [];
  }

  /**
   * @param {Buffer} chunk
   * @param {number} from
   * @param {number} to
   */
  take(chunk, from, to) {
    if (to <= from) return;
    this.size += to - from;
    if (this.kept <= this.keepMax) {
      const piece = chunk.subarray(from, to);
      this.parts.push(piece);
      this.kept += piece.length;
    }
  }

  finish() {
    this.inElement = false;
    const text = this.size <= this.keepMax ? Buffer.concat(this.parts).toString('utf8') : null;
    this.parts = [];
    this.onElement(this.size, text);
  }
}

const VOSE_RE = /\bvos(?:e)?\b|subtitulad[ao]s?|\bsub(?:s|titles)?\b/i;

/**
 * Reservorio: `k` elementos al azar de un flujo de longitud desconocida.
 * @param {number} k
 * @returns {{ add: (item: any) => void, items: any[] }}
 */
export function reservoir(k) {
  /** @type {any[]} */
  const items = [];
  let seen = 0;
  return {
    add(item) {
      seen += 1;
      if (items.length < k) items.push(item);
      else {
        const j = Math.floor(Math.random() * seen);
        if (j < k) items[j] = item;
      }
    },
    items,
  };
}

/**
 * @param {Record<string, number>} map
 * @param {string} key
 * @param {number} [by]
 */
function bump(map, key, by = 1) {
  map[key] = (map[key] ?? 0) + by;
}

/**
 * Descarga una lista en streaming y la resume (sin guardarla).
 * @param {(action: string) => string} api
 * @param {string} action
 * @param {Timings} t
 * @param {((item: any, ext: string) => void) | null} sampler
 * @returns {Promise<Report>}
 */
async function measureList(api, action, t, sampler) {
  const started = Date.now();
  /** @type {Report} */
  const out = {
    accion: action,
    estado: null,
    bytesCable: 0,
    bytes: 0,
    ms: 0,
    forma: null,
    elementos: 0,
    ids: 0,
    saltados: Object.fromEntries(OBJECT_LIMITS.map((limit) => [`${limit / KIB}KiB`, 0])),
    mayorKiB: 0,
    extensiones: {},
    vose: 0,
    adultos: 0,
    gzip: false,
    error: null,
  };
  try {
    const { res, status } = await open(api(action), {
      headers: { 'Accept-Encoding': 'gzip' },
      timeoutMs: t.requestMs,
    });
    out.estado = status;
    out.gzip = /gzip/i.test(String(res.headers['content-encoding'] ?? ''));
    const splitter = new ArraySplitter((size, text) => {
      out.elementos += 1;
      out.mayorKiB = Math.max(out.mayorKiB, Math.ceil(size / KIB));
      for (const limit of OBJECT_LIMITS) if (size > limit) out.saltados[`${limit / KIB}KiB`] += 1;
      if (text === null) return;
      let item;
      try {
        item = JSON.parse(text);
      } catch {
        return;
      }
      if (!item || typeof item !== 'object') return;
      const id = Number(item.stream_id ?? item.series_id ?? item.category_id);
      if (Number.isInteger(id) && id > 0) out.ids += 1;
      const ext = String(item.container_extension ?? '').toLowerCase();
      if (action === 'get_vod_streams') {
        bump(out.extensiones, EXTENSIONS.includes(ext) ? ext : ext ? 'otra' : 'sin');
      }
      const name = String(item.name ?? item.title ?? item.category_name ?? '');
      if (VOSE_RE.test(name)) out.vose += 1;
      if ([1, '1', true].includes(item.is_adult)) out.adultos += 1;
      sampler?.(item, ext);
    });
    const source = out.gzip ? res.pipe(zlib.createGunzip()) : res;
    res.on('data', (/** @type {Buffer} */ chunk) => {
      out.bytesCable += chunk.length;
    });
    await /** @type {Promise<void>} */ (
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          res.destroy();
          reject(new Error('tiempo agotado'));
        }, t.listMs);
        source.on('data', (/** @type {Buffer} */ chunk) => {
          out.bytes += chunk.length;
          splitter.write(chunk);
        });
        source.on('end', () => {
          clearTimeout(timer);
          resolve();
        });
        source.on('error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      })
    );
    out.forma = splitter.shape === 'array' ? 'array' : splitter.shape;
    if (splitter.shape === 'object' && /user_info/.test(splitter.outerText))
      out.forma = 'user_info';
  } catch (error) {
    out.error = describeError(error);
  }
  out.ms = Date.now() - started;
  return out;
}

// --- Cabeceras de fichero: MKV (EBML) y MP4 (cajas) --------------------------

/**
 * @param {Buffer} buf
 * @param {number} pos
 * @param {boolean} keepMarker
 */
function readVint(buf, pos, keepMarker) {
  const first = buf[pos];
  if (first === undefined || first === 0) return null;
  let length = 1;
  while (length <= 8 && !(first & (0x80 >> (length - 1)))) length += 1;
  if (length > 8 || pos + length > buf.length) return null;
  let value = keepMarker ? first : first & (0xff >> length);
  let allOnes = (first & (0xff >> length)) === 0xff >> length;
  for (let i = 1; i < length; i += 1) {
    const byte = buf[pos + i] ?? 0;
    value = value * 256 + byte;
    if (byte !== 0xff) allOnes = false;
  }
  return { value, length, unknown: !keepMarker && allOnes };
}

/**
 * @param {Buffer} buf
 * @param {number} from
 * @param {number} to
 */
function readUint(buf, from, to) {
  let value = 0;
  for (let i = from; i < to; i += 1) value = value * 256 + (buf[i] ?? 0);
  return value;
}

const EBML = {
  segment: 0x18538067,
  seekHead: 0x114d9b74,
  seek: 0x4dbb,
  seekId: 0x53ab,
  tracks: 0x1654ae6b,
  trackEntry: 0xae,
  trackType: 0x83,
  codecId: 0x86,
  language: 0x22b59c,
  languageBcp47: 0x22b59d,
  name: 0x536e,
  video: 0xe0,
  pixelHeight: 0xba,
  audio: 0xe1,
  channels: 0x9f,
  cues: 0x1c53bb6b,
  cluster: 0x1f43b675,
};

/**
 * Hijos de un elemento EBML entre `from` y `to` (los que caben en el trozo leído).
 * @param {Buffer} buf
 * @param {number} from
 * @param {number} to
 * @returns {Generator<EbmlElement>}
 */
function* ebmlChildren(buf, from, to) {
  let pos = from;
  while (pos < to) {
    const id = readVint(buf, pos, true);
    if (!id) return;
    const size = readVint(buf, pos + id.length, false);
    if (!size) return;
    const start = pos + id.length + size.length;
    const end = size.unknown ? to : start + size.value;
    yield {
      id: id.value,
      start,
      end: Math.min(end, to),
      complete: end <= to,
      unknown: size.unknown,
    };
    if (size.unknown) return;
    pos = end;
  }
}

/**
 * Pistas de un MKV a partir de su cabecera: tipo, códec, lengua, nombre,
 * altura y canales; y si el SeekHead apunta a unos Cues (o se ven).
 * @param {Buffer} buf
 */
export function parseMkvHead(buf) {
  /** @type {{ tracks: Track[], hasCues: boolean, tracksFound: boolean }} */
  const out = { tracks: [], hasCues: false, tracksFound: false };
  const top = [...ebmlChildren(buf, 0, buf.length)];
  const segment = top.find((element) => element.id === EBML.segment);
  if (!segment) return out;
  for (const element of ebmlChildren(buf, segment.start, segment.end)) {
    if (element.id === EBML.cluster) break;
    if (element.id === EBML.cues) out.hasCues = true;
    if (element.id === EBML.seekHead) {
      for (const seek of ebmlChildren(buf, element.start, element.end)) {
        if (seek.id !== EBML.seek) continue;
        for (const field of ebmlChildren(buf, seek.start, seek.end)) {
          if (field.id === EBML.seekId && readUint(buf, field.start, field.end) === EBML.cues) {
            out.hasCues = true;
          }
        }
      }
    }
    if (element.id === EBML.tracks && element.complete) {
      out.tracksFound = true;
      for (const entry of ebmlChildren(buf, element.start, element.end)) {
        if (entry.id !== EBML.trackEntry) continue;
        /** @type {Track} */
        const track = {
          type: null,
          codec: null,
          lang: 'eng',
          name: null,
          height: null,
          channels: null,
        };
        for (const field of ebmlChildren(buf, entry.start, entry.end)) {
          const text = () =>
            buf.subarray(field.start, field.end).toString('utf8').replace(/\0+$/, '');
          if (field.id === EBML.trackType) {
            const kind = readUint(buf, field.start, field.end);
            track.type =
              kind === 1 ? 'video' : kind === 2 ? 'audio' : kind === 17 ? 'subtitle' : 'otra';
          } else if (field.id === EBML.codecId) track.codec = text();
          else if (field.id === EBML.language) track.lang = text();
          else if (field.id === EBML.languageBcp47) track.lang = text();
          else if (field.id === EBML.name) track.name = text();
          else if (field.id === EBML.video) {
            for (const sub of ebmlChildren(buf, field.start, field.end)) {
              if (sub.id === EBML.pixelHeight) track.height = readUint(buf, sub.start, sub.end);
            }
          } else if (field.id === EBML.audio) {
            for (const sub of ebmlChildren(buf, field.start, field.end)) {
              if (sub.id === EBML.channels) track.channels = readUint(buf, sub.start, sub.end);
            }
          }
        }
        out.tracks.push(track);
      }
    }
  }
  return out;
}

/**
 * Cajas MP4 de primer nivel dentro de `buf` (tamaños de 32 y 64 bits).
 * @param {Buffer} buf
 * @param {number} [from]
 * @param {number} [to]
 * @param {number} [base]
 * @returns {Generator<Mp4Box>}
 */
export function* mp4Boxes(buf, from = 0, to = buf.length, base = 0) {
  let pos = from;
  while (pos + 8 <= to) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('latin1', pos + 4, pos + 8);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > to) return;
      size = Number(buf.readBigUInt64BE(pos + 8));
      header = 16;
    } else if (size === 0) size = to - pos;
    if (size < header) return;
    yield {
      type,
      start: pos + header,
      end: Math.min(pos + size, to),
      offset: base + pos,
      size,
      complete: pos + size <= to,
    };
    pos += size;
  }
}

/**
 * @param {Buffer} buf
 * @param {{ start: number, end: number }} parent
 * @param {string} type
 */
function childBox(buf, parent, type) {
  for (const box of mp4Boxes(buf, parent.start, parent.end)) if (box.type === type) return box;
  return null;
}

/**
 * Lengua ISO 639-2 empaquetada de `mdhd` (3 × 5 bits).
 * @param {Buffer} buf
 * @param {Mp4Box} mdhd
 */
function mdhdLanguage(buf, mdhd) {
  const version = buf[mdhd.start];
  const at = mdhd.start + 4 + (version === 1 ? 28 : 16);
  if (at + 2 > mdhd.end) return null;
  const packed = buf.readUInt16BE(at);
  const code = [10, 5, 0].map((shift) => String.fromCharCode(((packed >> shift) & 0x1f) + 0x60));
  return code.join('');
}

/**
 * Pistas de un `moov` completo: manejador, formato, lengua, altura y canales; y si es fragmentado.
 * @param {Buffer} buf
 * @param {{ start: number, end: number }} moov
 */
export function parseMoov(buf, moov) {
  /** @type {{ tracks: Track[], fragmented: boolean }} */
  const out = { tracks: [], fragmented: false };
  for (const box of mp4Boxes(buf, moov.start, moov.end)) {
    if (box.type === 'mvex') out.fragmented = true;
    if (box.type !== 'trak') continue;
    const mdia = childBox(buf, box, 'mdia');
    if (!mdia) continue;
    const hdlr = childBox(buf, mdia, 'hdlr');
    const mdhd = childBox(buf, mdia, 'mdhd');
    const handler = hdlr ? buf.toString('latin1', hdlr.start + 8, hdlr.start + 12) : null;
    const stsd = (() => {
      const minf = childBox(buf, mdia, 'minf');
      const stbl = minf && childBox(buf, minf, 'stbl');
      return stbl && childBox(buf, stbl, 'stsd');
    })();
    /** @type {string | null} */
    let codec = null;
    /** @type {number | null} */
    let height = null;
    /** @type {number | null} */
    let channels = null;
    if (stsd && stsd.start + 16 <= stsd.end) {
      const entry = stsd.start + 8;
      codec = buf.toString('latin1', entry + 4, entry + 8);
      if (handler === 'vide' && entry + 36 <= stsd.end) height = buf.readUInt16BE(entry + 34);
      if (handler === 'soun' && entry + 26 <= stsd.end) channels = buf.readUInt16BE(entry + 24);
    }
    const type =
      handler === 'vide'
        ? 'video'
        : handler === 'soun'
          ? 'audio'
          : ['sbtl', 'subt', 'text', 'clcp'].includes(handler ?? '')
            ? 'subtitle'
            : 'otra';
    out.tracks.push({ type, codec, lang: mdhd ? mdhdLanguage(buf, mdhd) : null, height, channels });
  }
  return out;
}

/**
 * Contenedor por los bytes mágicos.
 * @param {Buffer} buf
 */
export function sniffContainer(buf) {
  if (buf.length >= 4 && buf.readUInt32BE(0) === 0x1a45dfa3) return 'mkv';
  if (buf.length >= 8 && buf.toString('latin1', 4, 8) === 'ftyp') return 'mp4';
  if (buf.length >= 12 && buf.toString('latin1', 0, 4) === 'RIFF') return 'avi';
  if (buf.length >= 189 && buf[0] === 0x47 && buf[188] === 0x47) return 'ts';
  return 'otro';
}

const TEXT_SUBS = /^(?:S_TEXT\/|tx3g|wvtt|stpp|c608)|mov_text/i;
const IMAGE_SUBS = /^(?:S_HDMV\/PGS|S_VOBSUB|S_DVBSUB|S_IMAGE)/i;
const SPANISH = /^(?:spa|es|esp|es-es)$/i;
const LATAM = /^(?:es-419|es-mx|es-ar|es-us)$/i;

// --- El sondeo --------------------------------------------------------------

/** @param {unknown} error */
function describeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  /* Solo el código o el mensaje genérico: un mensaje de error puede llevar la URL. */
  if (code) return code;
  if (/tiempo agotado|demasiadas redirecciones/.test(message)) return message;
  return 'error';
}

/**
 * Lanza las fases elegidas y devuelve el informe (solo agregados). `log`
 * recibe líneas de progreso (sin datos sensibles).
 * @param {{ server: string, username: string, password: string, phases?: string[], fast?: boolean, log?: (line: string) => void }} options
 * @returns {Promise<Report>}
 */
export async function runProbe({
  server,
  username,
  password,
  phases = ALL_PHASES,
  fast = false,
  log = () => {},
}) {
  const t = fast ? TIMINGS.rapido : TIMINGS.normal;
  const base = new URL(server.replace(/\/+$/, '') + '/');
  /** @type {(action: string | null, extra?: Record<string, string | number>) => string} */
  const api = (action, extra = {}) => {
    const url = new URL('player_api.php', base);
    url.searchParams.set('username', username);
    url.searchParams.set('password', password);
    if (action) url.searchParams.set('action', action);
    for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, String(value));
    return url.href;
  };
  /** @type {(kind: string, id: number, ext: string) => string} */
  const media = (kind, id, ext) =>
    new URL(
      `${kind}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.${ext}`,
      base,
    ).href;
  /** @type {(url: string, maxBytes?: number) => Promise<{ status: number, json: any }>} */
  const getJson = async (url, maxBytes = 8 * MIB) => {
    const { res, status } = await open(url, { timeoutMs: t.requestMs });
    const { body } = await readSome(res, maxBytes, t.requestMs);
    return { status, json: JSON.parse(body.toString('utf8') || 'null') };
  };
  const account = async () => {
    try {
      const { json } = await getJson(api(null), 256 * KIB);
      const info = json?.user_info ?? {};
      return {
        activas: Number(info.active_cons ?? NaN),
        maximas: Number(info.max_connections ?? NaN),
        estado: typeof info.status === 'string' ? info.status : null,
      };
    } catch (error) {
      return { error: describeError(error) };
    }
  };

  /** @type {Report} */
  const report = { fecha: new Date().toISOString(), fases: phases, rapido: fast };
  const movies = reservoir(Math.max(t.infoSamples, t.trackSamples) * 3);
  const series = reservoir(10);
  const byExt = { mkv: reservoir(8), mp4: reservoir(8) };

  report.cuenta = await account();
  log(
    `cuenta: ${report.cuenta.estado ?? '?'}, conexiones ${report.cuenta.activas}/${report.cuenta.maximas}`,
  );

  {
    /* Todas las fases necesitan ids al azar: las listas se leen siempre, pero
       solo se informa de ellas con la fase `listas`. */
    /** @type {Report[]} */
    const lists = [];
    for (const action of [
      'get_vod_categories',
      'get_vod_streams',
      'get_series_categories',
      'get_series',
    ]) {
      log(`lista ${action}…`);
      /** @type {((item: any, ext: string) => void) | null} */
      const sampler =
        action === 'get_vod_streams'
          ? (item, ext) => {
              const id = Number(item.stream_id);
              if (!Number.isInteger(id) || id <= 0) return;
              movies.add({ id, ext });
              if (ext === 'mkv' || ext === 'mp4') byExt[ext].add({ id, ext });
            }
          : action === 'get_series'
            ? (item) => {
                const id = Number(item.series_id);
                if (Number.isInteger(id) && id > 0) series.add({ id });
              }
            : null;
      lists.push(await measureList(api, action, t, sampler));
      await sleep(t.gapMs);
    }
    if (phases.includes('listas')) report.listas = lists;
  }

  if (phases.includes('codecs')) {
    log('fichas y pistas…');
    /** @type {Report} */
    const info = {
      pedidas: 0,
      fallidas: 0,
      videoCodec: {},
      altura: {},
      diezBits: 0,
      audioCodec: {},
      canales: {},
    };
    for (const { id } of movies.items.slice(0, t.infoSamples)) {
      info.pedidas += 1;
      try {
        const { json } = await getJson(api('get_vod_info', { vod_id: id }), 512 * KIB);
        const video =
          json?.info?.video && typeof json.info.video === 'object' ? json.info.video : {};
        const audio =
          json?.info?.audio && typeof json.info.audio === 'object' ? json.info.audio : {};
        bump(info.videoCodec, String(video.codec_name ?? 'sin dato'));
        const height = Number(video.height);
        bump(
          info.altura,
          !Number.isFinite(height) || height <= 0
            ? 'sin dato'
            : height >= 2000
              ? '2160'
              : height >= 1000
                ? '1080'
                : height >= 700
                  ? '720'
                  : 'menos',
        );
        if (
          String(video.pix_fmt ?? '').includes('10') ||
          String(video.bits_per_raw_sample ?? '') === '10' ||
          /main 10|high 10/i.test(String(video.profile ?? ''))
        ) {
          info.diezBits += 1;
        }
        bump(info.audioCodec, String(audio.codec_name ?? 'sin dato'));
        bump(info.canales, String(audio.channels ?? 'sin dato'));
      } catch {
        info.fallidas += 1;
      }
      await sleep(t.infoGapMs);
    }
    report.fichas = info;

    /** @type {Report} */
    const tracks = {
      leidas: 0,
      fallidas: 0,
      contenedorReal: {},
      noCoincideExtension: 0,
      mkvSinCues: 0,
      mp4MoovAlFinal: 0,
      mp4Fragmentado: 0,
      variosAudios: 0,
      conCastellano: 0,
      soloLatino: 0,
      lenguasAudio: {},
      subsTexto: 0,
      subsImagen: 0,
      bytesLeidos: 0,
      ocupado: 0,
    };
    const candidates = movies.items.filter((item) => item.ext === 'mkv' || item.ext === 'mp4');
    for (const { id, ext } of candidates.slice(0, t.trackSamples)) {
      try {
        const { res, status } = await open(media('movie', id, ext), {
          headers: { Range: `bytes=0-${MIB - 1}` },
          timeoutMs: t.requestMs,
        });
        if (BUSY_STATUSES.has(status)) tracks.ocupado += 1;
        const { body } = await readSome(res, MIB, t.requestMs);
        tracks.bytesLeidos += body.length;
        const range = parseContentRange(res.headers['content-range']);
        const container = sniffContainer(body);
        bump(tracks.contenedorReal, container);
        if (container !== ext && !(container === 'mp4' && ext === 'm4v'))
          tracks.noCoincideExtension += 1;
        /** @type {{ tracks: Track[], hasCues?: boolean, fragmented?: boolean } | null} */
        let parsed = null;
        if (container === 'mkv') {
          parsed = parseMkvHead(body);
          if (!parsed.hasCues) tracks.mkvSinCues += 1;
        } else if (container === 'mp4') {
          /** @type {Mp4Box | null} */
          let moov = null;
          let moovBuf = body;
          /** @type {number | null} */
          let afterMdat = null;
          for (const box of mp4Boxes(body)) {
            if (box.type === 'moov' && box.complete) moov = box;
            if (box.type === 'mdat') afterMdat = box.offset + box.size;
          }
          if (!moov && afterMdat !== null && range?.total && afterMdat < range.total) {
            tracks.mp4MoovAlFinal += 1;
            const want = Math.min(range.total - afterMdat, 32 * MIB);
            await sleep(t.gapMs);
            const tail = await open(media('movie', id, ext), {
              headers: { Range: `bytes=${afterMdat}-${afterMdat + want - 1}` },
              timeoutMs: t.requestMs,
            });
            const read = await readSome(tail.res, want, t.requestMs * 3);
            tracks.bytesLeidos += read.body.length;
            moovBuf = read.body;
            for (const box of mp4Boxes(moovBuf))
              if (box.type === 'moov' && box.complete) moov = box;
          }
          if (moov) {
            parsed = parseMoov(moovBuf, moov);
            if (parsed.fragmented) tracks.mp4Fragmentado += 1;
          }
        }
        if (parsed) {
          tracks.leidas += 1;
          const audios = parsed.tracks.filter((track) => track.type === 'audio');
          if (audios.length > 1) tracks.variosAudios += 1;
          const langs = audios.map((track) => String(track.lang ?? 'und').toLowerCase());
          for (const lang of new Set(langs)) bump(tracks.lenguasAudio, lang);
          const castellano = audios.some(
            (track) =>
              (SPANISH.test(String(track.lang ?? '')) &&
                !/latino/i.test(String(track.name ?? ''))) ||
              /castellano|español/i.test(String(track.name ?? '')),
          );
          if (castellano) tracks.conCastellano += 1;
          else if (
            audios.some(
              (track) =>
                LATAM.test(String(track.lang ?? '')) || /latino/i.test(String(track.name ?? '')),
            )
          ) {
            tracks.soloLatino += 1;
          }
          const subs = parsed.tracks.filter((track) => track.type === 'subtitle');
          if (subs.some((track) => TEXT_SUBS.test(String(track.codec ?? ''))))
            tracks.subsTexto += 1;
          if (subs.some((track) => IMAGE_SUBS.test(String(track.codec ?? ''))))
            tracks.subsImagen += 1;
        } else tracks.fallidas += 1;
      } catch {
        tracks.fallidas += 1;
      }
      await sleep(t.gapMs);
    }
    report.pistas = tracks;
  }

  /* Tres títulos para Range, plaza, pausa y token: un MKV, un MP4 y un episodio. */
  /** @type {{ etiqueta: string, url: string }[]} */
  const targets = [];
  if (phases.some((phase) => ['range', 'plaza', 'pausa', 'token'].includes(phase))) {
    const mkv = byExt.mkv.items[0];
    const mp4 = byExt.mp4.items[0];
    if (mkv) targets.push({ etiqueta: 'MKV', url: media('movie', mkv.id, 'mkv') });
    if (mp4) targets.push({ etiqueta: 'MP4', url: media('movie', mp4.id, 'mp4') });
    for (const { id } of series.items) {
      try {
        const { json } = await getJson(api('get_series_info', { series_id: id }));
        const seasons = json?.episodes;
        const list = Array.isArray(seasons) ? seasons.flat() : Object.values(seasons ?? {}).flat();
        const episode = list.find((item) => item && Number(item.id) > 0);
        if (episode) {
          const ext = String(episode.container_extension ?? 'mp4').toLowerCase();
          targets.push({
            etiqueta: `episodio (${EXTENSIONS.includes(ext) ? ext : 'otra'})`,
            url: media('series', Number(episode.id), EXTENSIONS.includes(ext) ? ext : 'mp4'),
          });
          break;
        }
      } catch {}
      await sleep(t.infoGapMs);
    }
  }
  /** @type {{ etiqueta: string, url: string, at: number }[]} */
  const redirects = [];

  if (phases.includes('range')) {
    log('Range…');
    report.range = [];
    for (const target of targets) {
      /** @type {Report} */
      const row = { titulo: target.etiqueta };
      try {
        const first = await open(target.url, {
          headers: { Range: 'bytes=0-65535' },
          timeoutMs: t.requestMs,
        });
        const range = parseContentRange(first.res.headers['content-range']);
        row.inicio = {
          estado: first.status,
          acceptRanges: first.res.headers['accept-ranges'] ?? null,
          contentRange: range !== null,
          tamanoMiB: range?.total ? Math.round(range.total / MIB) : null,
          saltos: first.hops.length,
          cambiaDeHost: first.hops.some((hop) => !hop.sameHost),
          llevaToken: first.hops.some((hop) => hop.hasToken),
          llevaQuery: first.hops.some((hop) => hop.hasQuery),
          estadosSalto: first.hops.map((hop) => hop.status),
        };
        await readSome(first.res, 64 * KIB, t.requestMs);
        if (first.hops.length > 0)
          redirects.push({ etiqueta: target.etiqueta, url: first.finalUrl, at: Date.now() });
        await sleep(t.gapMs);
        if (range?.total) {
          const half = Math.floor(range.total / 2);
          const second = await open(target.url, {
            headers: { Range: `bytes=${half}-` },
            timeoutMs: t.requestMs,
          });
          const got = parseContentRange(second.res.headers['content-range']);
          row.mitad = { estado: second.status, empiezaDonde: got?.start === half };
          await readSome(second.res, 64 * KIB, t.requestMs);
          await sleep(t.gapMs);
        }
        if (first.hops.length > 0) {
          const direct = await open(first.finalUrl, {
            headers: { Range: 'bytes=100-199' },
            timeoutMs: t.requestMs,
            follow: false,
          });
          row.destinoDirecto = {
            estado: direct.status,
            contentRange: parseContentRange(direct.res.headers['content-range'])?.start === 100,
          };
          await readSome(direct.res, 1 * KIB, t.requestMs);
          await sleep(t.gapMs);
        }
      } catch (error) {
        row.error = describeError(error);
      }
      report.range.push(row);
    }
  }

  if (phases.includes('plaza') && targets[0]) {
    log('plaza tras cerrar…');
    const target = targets[0];
    /** @type {Report[]} */
    const cycles = [];
    for (let cycle = 0; cycle < t.cycles; cycle += 1) {
      await sleep(t.cycleRestMs);
      /** @type {Report} */
      const row = { antes: await account(), reaperturas: [] };
      try {
        const { res, status } = await open(target.url, {
          headers: { Range: `bytes=${cycle * 2 * MIB}-` },
          timeoutMs: t.requestMs,
        });
        row.primera = status;
        await readSome(res, MIB, t.requestMs);
        for (const delay of t.cycleDelaysMs) {
          await sleep(delay);
          const started = Date.now();
          let again = await open(target.url, {
            headers: { Range: `bytes=${(cycle * 2 + 1) * MIB}-` },
            timeoutMs: t.requestMs,
          });
          const firstStatus = again.status;
          let freeAfterMs = null;
          /* «Ocupado»: se reintenta cada segundo para ver cuánto tarda en soltarse. */
          while (BUSY_STATUSES.has(again.status) && Date.now() - started < t.busyWaitMaxMs) {
            again.res.destroy();
            await sleep(Math.min(1_000, t.busyWaitMaxMs));
            again = await open(target.url, {
              headers: { Range: `bytes=${(cycle * 2 + 1) * MIB}-` },
              timeoutMs: t.requestMs,
            });
            if (!BUSY_STATUSES.has(again.status)) freeAfterMs = Date.now() - started;
          }
          await readSome(again.res, 64 * KIB, t.requestMs);
          row.reaperturas.push({
            esperaMs: delay,
            estado: firstStatus,
            libreTrasMs: BUSY_STATUSES.has(firstStatus) ? freeAfterMs : 0,
          });
        }
      } catch (error) {
        row.error = describeError(error);
      }
      row.despues = await account();
      cycles.push(row);
    }
    report.plaza = cycles;
  }

  if (phases.includes('pausa') && targets[0]) {
    log('pausas…');
    const target = targets[0];
    report.pausa = [];
    for (const seconds of t.pausesS) {
      await sleep(t.gapMs);
      /** @type {Report} */
      const row = { segundos: seconds };
      try {
        const { res, status } = await open(target.url, {
          headers: { Range: 'bytes=0-' },
          timeoutMs: t.requestMs,
        });
        row.estado = status;
        /** @type {number | null} */
        let cutAtMs = null;
        const started = Date.now();
        res.socket?.on('close', () => {
          if (cutAtMs === null) cutAtMs = Date.now() - started;
        });
        /* Lee 256 KiB y se para: la contrapresión deja de leer del panel. */
        await /** @type {Promise<void>} */ (
          new Promise((resolve) => {
            let got = 0;
            /** @param {Buffer} chunk */
            const onData = (chunk) => {
              got += chunk.length;
              if (got >= 256 * KIB) {
                res.pause();
                res.off('data', onData);
                resolve();
              }
            };
            res.on('data', onData);
            res.on('error', () => resolve());
            res.on('end', () => resolve());
          })
        );
        await sleep(seconds * 1000);
        /* Al seguir: si llega mucho más que lo que cabe en los búferes, la conexión seguía viva. */
        const after = await readSome(res, 8 * MIB, t.requestMs);
        row.sigueViva = after.bytes >= 8 * MIB;
        row.cortadaDuranteLaPausa = cutAtMs !== null && cutAtMs < seconds * 1000;
        row.cortadaALosS = row.cortadaDuranteLaPausa ? Math.round(Number(cutAtMs) / 1000) : null;
        row.motivoFin = after.reason;
      } catch (error) {
        row.error = describeError(error);
      }
      report.pausa.push(row);
    }
  }

  if (phases.includes('token')) {
    log('duración del token…');
    report.token = [];
    if (redirects.length === 0 && targets[0]) {
      /* Sin la fase de Range: se resuelve aquí la redirección del primer título. */
      try {
        const first = await open(targets[0].url, {
          headers: { Range: 'bytes=0-1023' },
          timeoutMs: t.requestMs,
        });
        await readSome(first.res, KIB, t.requestMs);
        if (first.hops.length > 0)
          redirects.push({ etiqueta: targets[0].etiqueta, url: first.finalUrl, at: Date.now() });
      } catch {}
    }
    if (redirects.length === 0) report.token.push({ nota: 'sin redirección: no aplica' });
    const target = redirects[0];
    if (target) {
      for (const minutes of t.tokenMarksMin) {
        const wait = target.at + minutes * 60_000 - Date.now();
        if (wait > 0) await sleep(wait);
        try {
          const direct = await open(target.url, {
            headers: { Range: 'bytes=0-1023' },
            timeoutMs: t.requestMs,
            follow: false,
          });
          await readSome(direct.res, KIB, t.requestMs);
          report.token.push({ minutos: minutes, estado: direct.status });
        } catch (error) {
          report.token.push({ minutos: minutes, error: describeError(error) });
        }
      }
    }
  }

  report.lectura = conclusions(report);
  return report;
}

// --- Lectura: lo que decide cada resultado (docs/vod.md §3) ------------------

/**
 * @param {number} part
 * @param {number} whole
 */
function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** @param {Report} report */
export function conclusions(report) {
  /** @type {string[]} */
  const out = [];
  /** @type {Report[]} */
  const ranges = report.range ?? [];
  if (ranges.length > 0) {
    const all206 = ranges.every(
      (row) => row.inicio?.estado === 206 && (row.mitad?.estado ?? 206) === 206,
    );
    const any200 = ranges.some((row) => row.inicio?.estado === 200 || row.mitad?.estado === 200);
    if (all206) out.push('Range: 206 en todo → estrategia C tal cual.');
    else if (any200)
      out.push(
        'Range: algún 200 ignorando Range → vod_unsupported (sin_saltos) para ese proveedor; adelantar el modo sin índice.',
      );
    else out.push('Range: resultados mezclados; revisar la tabla.');
    const direct = ranges.filter((row) => row.destinoDirecto);
    if (direct.length > 0) {
      const ok = direct.every((row) => row.destinoDirecto.estado === 206);
      out.push(
        ok
          ? 'Redirección: el destino admite Range por sí solo; mirar la duración del token para reuseRedirect.'
          : 'Redirección: el destino no admite Range por sí solo → reuseRedirect: false.',
      );
    }
  }
  const token = /** @type {Report[]} */ (report.token ?? []).filter(
    (row) => typeof row.minutos === 'number',
  );
  if (token.length > 0) {
    const firstBad = token.find((row) => row.estado !== 206 && row.estado !== 200);
    out.push(
      firstBad
        ? `Token: deja de valer antes de ${firstBad.minutos} min → reuseRedirect: false.`
        : `Token: sigue valiendo a los ${token.at(-1)?.minutos} min.`,
    );
  }
  /** @type {Report[]} */
  const reopenings = /** @type {Report[]} */ (report.plaza ?? []).flatMap(
    (row) => row.reaperturas ?? [],
  );
  if (reopenings.length > 0) {
    const busy = reopenings.filter((row) => BUSY_STATUSES.has(row.estado));
    const slowest = Math.max(0, ...busy.map((row) => row.libreTrasMs ?? Infinity));
    if (busy.length === 0) out.push('Plaza: reabrir enseguida nunca dio «ocupado».');
    else if (slowest > 14_000)
      out.push(
        'Plaza: «ocupado» más de 14 s tras cerrar → vod_busy con retryAfterS y subir forwardSkipBytes.',
      );
    else
      out.push(
        `Plaza: «ocupado» ${busy.length} veces, libre en ≤ ${Math.round(slowest / 1000)} s (dentro de 2 + 4 + 8 s).`,
      );
  }
  /** @type {Report[]} */
  const pauses = report.pausa ?? [];
  if (pauses.length > 0) {
    const cut = pauses.filter((row) => row.sigueViva === false);
    out.push(
      cut.length === 0
        ? 'Pausa: el panel no corta la conexión parada; idleReleaseMs se queda en 5 min.'
        : `Pausa: el panel corta la conexión parada (desde ${Math.min(...cut.map((row) => row.segundos))} s); lo cubre la reapertura perezosa.`,
    );
  }
  /** @type {Report[]} */
  const lists = report.listas ?? [];
  const big = lists.filter((row) => row.bytes > 160 * MIB || row.ms > 240_000 || row.error);
  if (lists.length > 0) {
    out.push(
      big.length > 0
        ? 'Listas: alguna pasa de 160 MiB, tarda más de 240 s o falla → empezar por el modo por categorías.'
        : 'Listas: caben en los topes (160 MiB y 240 s).',
    );
    const none = lists
      .filter((row) => row.accion === 'get_vod_streams' || row.accion === 'get_series')
      .every((row) => row.forma !== 'array' || row.elementos === 0);
    if (none) out.push('Sin VOD: las listas llegan vacías o como objeto → estado none.');
    const movies = lists.find((row) => row.accion === 'get_vod_streams');
    if (movies && movies.elementos > 0) {
      const odd = (movies.extensiones.ts ?? 0) + (movies.extensiones.avi ?? 0);
      if (pct(odd, movies.elementos) > 10)
        out.push('Más del 10 % de .ts o .avi → adelantar el modo sin índice.');
    }
  }
  const tracks = report.pistas;
  if (tracks && tracks.leidas > 0) {
    const mkv = tracks.contenedorReal.mkv ?? 0;
    if (mkv > 0 && pct(tracks.mkvSinCues, mkv) > 10)
      out.push('Más del 10 % de MKV sin Cues → adelantar el modo sin índice.');
    if (pct(tracks.subsTexto, tracks.leidas) > 20)
      out.push('Más del 20 % con subtítulos de texto → valorar los subtítulos en la 0.9.0.');
  }
  const info = report.fichas;
  if (info && info.pedidas > 0) {
    const hevc = Object.entries(info.videoCodec)
      .filter(([codec]) => /hevc|h265/i.test(codec))
      .reduce((sum, [, count]) => sum + count, 0);
    if (pct(hevc, info.pedidas) > 30)
      out.push('Más del 30 % de HEVC → avisar a Isma (Chrome de escritorio puede no verlo).');
  }
  return out;
}

// --- Informe --------------------------------------------------------------

/**
 * Tapa lo que nunca debe salir: usuario, contraseña, host del servidor y
 * cualquier URL. Se aplica al texto final, por si algo se colara.
 * @param {string} text
 * @param {{ server: string, username: string, password: string }} secrets
 */
export function scrub(text, { server, username, password }) {
  let out = text.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>)]+/gi, '[url oculta]');
  const secrets = [username, password];
  try {
    const host = new URL(server).hostname;
    if (host) secrets.push(host);
  } catch {}
  for (const secret of secrets) {
    if (!secret || String(secret).length < 3) continue;
    out = out.split(String(secret)).join('[oculto]');
    const encoded = encodeURIComponent(String(secret));
    if (encoded !== secret) out = out.split(encoded).join('[oculto]');
  }
  return out;
}

/** @param {Record<string, number> | undefined} map */
function table(map) {
  const entries = Object.entries(map ?? {}).sort((a, b) => b[1] - a[1]);
  return entries.length === 0 ? '—' : entries.map(([key, count]) => `${key} ${count}`).join(' · ');
}

/** @param {Report} report */
export function renderReport(report) {
  /** @type {string[]} */
  const lines = [];
  lines.push(
    `# Paso 0 de Películas y series (${report.fecha}${report.rapido ? ', RÁPIDO: no vale como medida' : ''})`,
  );
  const account = report.cuenta ?? {};
  lines.push(
    `Cuenta: ${account.estado ?? '?'}; conexiones ${account.activas ?? '?'} de ${account.maximas ?? '?'}.`,
  );
  if (report.listas) {
    lines.push('', '## 1. Listas');
    for (const row of report.listas) {
      lines.push(
        `- ${row.accion}: estado ${row.estado ?? '—'}, forma ${row.forma ?? '—'}, ${row.elementos} elementos, ` +
          `${(row.bytes / MIB).toFixed(1)} MiB (${(row.bytesCable / MIB).toFixed(1)} MiB por el cable${row.gzip ? ', gzip' : ''}) en ${(row.ms / 1000).toFixed(1)} s; ` +
          `el mayor ${row.mayorKiB} KiB; se saltarían con 16/64/256 KiB: ${row.saltados['16KiB']}/${row.saltados['64KiB']}/${row.saltados['256KiB']}` +
          (row.accion.endsWith('categories')
            ? ''
            : `; VOSE ${pct(row.vose, row.elementos)} %; adultos ${row.adultos}`) +
          (row.error ? `; ERROR ${row.error}` : ''),
      );
      if (row.accion === 'get_vod_streams')
        lines.push(`  - extensiones: ${table(row.extensiones)}`);
    }
  }
  if (report.fichas) {
    const info = report.fichas;
    lines.push('', `## 2. Códecs (${info.pedidas} fichas, ${info.fallidas} fallidas)`);
    lines.push(`- vídeo: ${table(info.videoCodec)}`);
    lines.push(`- altura: ${table(info.altura)}; 10 bits: ${info.diezBits}`);
    lines.push(`- audio: ${table(info.audioCodec)}; canales: ${table(info.canales)}`);
  }
  if (report.pistas) {
    const tracks = report.pistas;
    lines.push(
      '',
      `## 2b. Pistas reales (${tracks.leidas} leídas, ${tracks.fallidas} fallidas, ${(tracks.bytesLeidos / MIB).toFixed(1)} MiB)`,
    );
    lines.push(
      `- contenedor por los bytes: ${table(tracks.contenedorReal)}; no coincide con la extensión: ${tracks.noCoincideExtension}`,
    );
    lines.push(
      `- MKV sin Cues: ${tracks.mkvSinCues}; MP4 con moov al final: ${tracks.mp4MoovAlFinal}; MP4 fragmentado: ${tracks.mp4Fragmentado}`,
    );
    lines.push(
      `- con varios audios: ${tracks.variosAudios}; con castellano: ${tracks.conCastellano}; solo latino: ${tracks.soloLatino}; lenguas: ${table(tracks.lenguasAudio)}`,
    );
    lines.push(
      `- subtítulos de texto: ${tracks.subsTexto}; de imagen: ${tracks.subsImagen}; «ocupado» al leer: ${tracks.ocupado}`,
    );
  }
  if (report.range) {
    lines.push('', '## 3. Range');
    for (const row of report.range) {
      if (row.error) {
        lines.push(`- ${row.titulo}: ERROR ${row.error}`);
        continue;
      }
      const first = row.inicio ?? {};
      lines.push(
        `- ${row.titulo}: bytes=0-65535 → ${first.estado}, Accept-Ranges ${first.acceptRanges ?? '—'}, Content-Range ${first.contentRange ? 'sí' : 'no'}, ` +
          `${first.tamanoMiB ?? '?'} MiB; ${first.saltos} saltos (${(first.estadosSalto ?? []).join(', ') || '—'}), ` +
          `cambia de host: ${first.cambiaDeHost ? 'sí' : 'no'}, token: ${first.llevaToken ? 'sí' : 'no'}` +
          (row.mitad
            ? `; bytes=50 %- → ${row.mitad.estado}${row.mitad.empiezaDonde ? ' (empieza donde se pidió)' : ''}`
            : '') +
          (row.destinoDirecto ? `; destino directo con Range → ${row.destinoDirecto.estado}` : ''),
      );
    }
  }
  if (report.plaza) {
    lines.push('', '## 4. Plaza tras cerrar');
    /** @type {Report[]} */ (report.plaza).forEach((row, index) => {
      const reopen = /** @type {Report[]} */ (row.reaperturas ?? [])
        .map(
          (item) =>
            `${item.esperaMs / 1000} s → ${item.estado}${item.libreTrasMs ? ` (libre a los ${(item.libreTrasMs / 1000).toFixed(1)} s)` : ''}`,
        )
        .join('; ');
      lines.push(
        `- ciclo ${index + 1}: active_cons ${row.antes?.activas ?? '?'} → ${row.despues?.activas ?? '?'}; primera ${row.primera ?? '—'}; reabrir: ${reopen || '—'}` +
          (row.error ? `; ERROR ${row.error}` : ''),
      );
    });
  }
  if (report.pausa) {
    lines.push('', '## 5. Pausa');
    for (const row of report.pausa) {
      lines.push(
        `- ${row.segundos} s parada: ${row.error ? `ERROR ${row.error}` : row.sigueViva ? 'sigue viva' : `cortada${row.cortadaALosS !== null ? ` (a los ${row.cortadaALosS} s)` : ''}`}`,
      );
    }
  }
  if (report.token) {
    lines.push('', '## 6. Token de la redirección');
    for (const row of report.token) {
      lines.push(
        row.nota
          ? `- ${row.nota}`
          : `- a los ${row.minutos} min: ${row.estado ?? `ERROR ${row.error}`}`,
      );
    }
  }
  lines.push('', '## Qué decide (docs/vod.md §3)');
  for (const line of report.lectura ?? []) lines.push(`- ${line}`);
  return lines.join('\n');
}

// --- Entrada ----------------------------------------------------------------

async function main() {
  const { values } = parseArgs({
    options: {
      fases: { type: 'string' },
      json: { type: 'boolean', default: false },
      rapido: { type: 'boolean', default: false },
      ayuda: { type: 'boolean', default: false },
    },
  });
  if (values.ayuda) {
    console.log(
      'Uso: VOD_SERVIDOR=http://host:puerto VOD_USUARIO=… VOD_CLAVE=… node scripts/vod-sondeo.mjs [--fases listas,codecs,range,plaza,pausa,token] [--json] [--rapido]',
    );
    return;
  }
  const server = process.env.VOD_SERVIDOR ?? '';
  const username = process.env.VOD_USUARIO ?? '';
  const password = process.env.VOD_CLAVE ?? '';
  if (!/^https?:\/\//i.test(server) || !username || !password) {
    console.error(
      'Faltan VOD_SERVIDOR (http(s)://host[:puerto]), VOD_USUARIO o VOD_CLAVE en el entorno.',
    );
    process.exit(2);
  }
  const phases = values.fases ? values.fases.split(',').map((phase) => phase.trim()) : ALL_PHASES;
  const unknown = phases.filter((phase) => !ALL_PHASES.includes(phase));
  if (unknown.length > 0) {
    console.error(`Fases desconocidas: ${unknown.join(', ')}. Hay: ${ALL_PHASES.join(', ')}.`);
    process.exit(2);
  }
  const secrets = { server, username, password };
  /** @param {string} line */
  const log = (line) =>
    console.error(scrub(`[${new Date().toISOString().slice(11, 19)}] ${line}`, secrets));
  log('Recuerda: con la app de IPTV del PC cerrada. Solo lectura; solo se imprimen agregados.');
  const report = await runProbe({ server, username, password, phases, fast: values.rapido, log });
  const text = values.json ? JSON.stringify(report, null, 2) : renderReport(report);
  console.log(scrub(text, secrets));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`El sondeo ha fallado: ${describeError(error)}`);
    process.exit(1);
  });
}
