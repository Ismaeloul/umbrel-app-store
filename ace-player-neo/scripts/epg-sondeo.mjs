#!/usr/bin/env node
// Mide la guía EPG (XMLTV) del panel Xtream de Isma para la Guía TV de la 0.9.0
// (docs/pendiente.md, punto 11). SOLO LECTURA: descarga `xmltv.php` una vez, la
// recorre en streaming y la tira; no guarda nada en disco.
//
// Uso, en el Umbrel, con las mismas variables que scripts/vod-sondeo.mjs:
//   VOD_SERVIDOR='http://proveedor:8080' VOD_USUARIO='…' VOD_CLAVE='…' node scripts/epg-sondeo.mjs > epg.json
//
// Solo imprime AGREGADOS (números y porcentajes): nunca URLs, usuario,
// contraseña, hosts, nombres de canal ni títulos de programa.

import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const USER_AGENT = 'VLC/3.0.21 LibVLC/3.0.21';
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const TIMEOUT_MS = 600_000;

const server = (process.env.VOD_SERVIDOR ?? '').replace(/\/+$/, '');
const username = process.env.VOD_USUARIO ?? '';
const password = process.env.VOD_CLAVE ?? '';
if (!server || !username || !password) {
  console.error('Faltan VOD_SERVIDOR, VOD_USUARIO o VOD_CLAVE.');
  process.exit(2);
}

/* El host y el nombre también: los errores de red los citan («connect ECONNREFUSED 1.2.3.4:8080»). */
const host = (() => {
  try {
    const url = new URL(server);
    return [url.host, url.hostname];
  } catch {
    return [];
  }
})();

/** @param {unknown} text */
function scrub(text) {
  let out = String(text);
  for (const secret of [server, ...host, username, password])
    if (secret) out = out.split(secret).join('***');
  return out.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '***');
}

/* La marca de directo como la entiende la app (hasLiveMark de apps/server/src/modules/iptv/guide-match.ts):
   el elemento `<live/>` o «directo», «en vivo», «live» o «(L)» en el título o el subtítulo. La agenda
   híbrida solo mueve horas y añade partidos con esa marca: este número dice si con la guía de Isma
   ocurre. */
const LIVE_MARK_RE = /\b(?:directo|en vivo|live)\b|\(l\)/;
/* «X - Y», «X vs Y», «X v Y» o «X contra Y» en el título o el subtítulo: lo que parece un partido. */
const MATCHUP_RE = /\S\s+(?:-|–|—|vs\.?|v\.?|contra)\s+\S/i;

/**
 * @param {unknown} value
 * @returns {string}
 */
function decodeXml(value) {
  return String(value ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, /** @type {string} */ hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, /** @type {string} */ dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Como normalizeGuideText de la app: minúsculas y sin tildes.
 * @param {unknown} value
 * @returns {string}
 */
function normalize(value) {
  return decodeXml(value).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/**
 * @param {string} inner
 * @param {string} name
 * @returns {string}
 */
function element(inner, name) {
  return new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`).exec(inner)?.[1] ?? '';
}

/**
 * XMLTV: `20261003213000 +0200` → ms.
 * @param {string | undefined} value
 * @returns {number | null}
 */
function parseXmltvDate(value) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(value ?? '');
  if (!m) return null;
  const [, y = '', mo = '', d = '', h = '', mi = '', s = '00', tz = '+0000'] = m;
  const offset = (tz[0] === '-' ? -1 : 1) * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)));
  return Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - offset * 60_000;
}

/**
 * @param {string} url
 * @returns {Promise<http.IncomingMessage>}
 */
function get(url, hops = 0) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https:') ? https : http;
    const req = lib.get(
      url,
      { headers: { 'User-Agent': USER_AGENT, 'Accept-Encoding': 'gzip' } },
      (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location && hops < 5) {
          res.resume();
          resolve(get(new URL(res.headers.location, url).toString(), hops + 1));
          return;
        }
        resolve(res);
      },
    );
    req.setTimeout(30_000, () => req.destroy(new Error('sin respuesta en 30 s')));
    req.on('error', reject);
  });
}

const started = Date.now();
/** @type {Record<string, unknown>} */
const report = { fecha: new Date().toISOString() };
try {
  const res = await get(
    `${server}/xmltv.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`,
  );
  report.estado = res.statusCode;
  report.tipo = res.headers['content-type'] ?? null;
  report.comprimida = /gzip/i.test(res.headers['content-encoding'] ?? '');
  let wire = 0;
  res.on('data', (/** @type {Buffer} */ chunk) => (wire += chunk.length));
  const body = report.comprimida ? res.pipe(zlib.createGunzip()) : res;

  const channels = new Set();
  const perChannel = new Map();
  const counts = {
    programas: 0,
    desc: 0,
    categoria: 0,
    icono: 0,
    episodio: 0,
    subtitulo: 0,
    nota: 0,
    edad: 0,
    directo: 0,
    directoEnTitulo: 0,
    directoCualquiera: 0,
    partidos: 0,
    partidosConDirecto: 0,
  };
  let minStart = Infinity;
  let maxStop = -Infinity;
  let bytes = 0;
  let tail = '';
  const now = Date.now();
  const window = { pasado: 0, hoy: 0, manana: 0, mas: 0 };

  await /** @type {Promise<void>} */ (
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('más de 10 min descargando')), TIMEOUT_MS);
      body.on('data', (/** @type {Buffer} */ chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_BYTES) {
          body.destroy();
          reject(new Error('más de 2 GiB'));
          return;
        }
        let text = tail + chunk.toString('utf8');
        for (const m of text.matchAll(/<channel\s[^>]*id="([^"]*)"/g)) channels.add(m[1]);
        let last = 0;
        for (const m of text.matchAll(/<programme\b([^>]*)>([\s\S]*?)<\/programme>/g)) {
          last = m.index + m[0].length;
          const attrs = m[1] ?? '';
          const inner = m[2] ?? '';
          counts.programas += 1;
          const ch = /channel="([^"]*)"/.exec(attrs)?.[1] ?? '';
          perChannel.set(ch, (perChannel.get(ch) ?? 0) + 1);
          const start = parseXmltvDate(/start="([^"]*)"/.exec(attrs)?.[1]);
          const stop = parseXmltvDate(/stop="([^"]*)"/.exec(attrs)?.[1]);
          if (start !== null) {
            minStart = Math.min(minStart, start);
            const days = (start - now) / 86_400_000;
            if (start < now - 3_600_000) window.pasado += 1;
            else if (days < 1) window.hoy += 1;
            else if (days < 2) window.manana += 1;
            else window.mas += 1;
          }
          if (stop !== null) maxStop = Math.max(maxStop, stop);
          if (/<desc\b/.test(inner)) counts.desc += 1;
          if (/<category\b/.test(inner)) counts.categoria += 1;
          if (/<icon\b/.test(inner)) counts.icono += 1;
          if (/<episode-num\b/.test(inner)) counts.episodio += 1;
          if (/<sub-title\b/.test(inner)) counts.subtitulo += 1;
          if (/<star-rating\b/.test(inner)) counts.nota += 1;
          if (/<rating\b/.test(inner)) counts.edad += 1;
          const liveElement = /<live\b/.test(inner);
          if (liveElement) counts.directo += 1;
          const title = normalize(element(inner, 'title'));
          const subTitle = normalize(element(inner, 'sub-title'));
          const liveInText = LIVE_MARK_RE.test(title) || LIVE_MARK_RE.test(subTitle);
          if (liveInText) counts.directoEnTitulo += 1;
          if (liveElement || liveInText) counts.directoCualquiera += 1;
          /* Parece un partido: «X - Y» en el título o el subtítulo y dura lo de un partido (80-240 min). */
          const minutes = start !== null && stop !== null ? (stop - start) / 60_000 : 0;
          if (
            minutes >= 80 &&
            minutes <= 240 &&
            (MATCHUP_RE.test(title) || MATCHUP_RE.test(subTitle))
          ) {
            counts.partidos += 1;
            if (liveElement || liveInText) counts.partidosConDirecto += 1;
          }
        }
        /* Lo que queda tras el último programa completo: un programa a medias o, si no hay, solo el final (para un
         `<channel` partido). Nunca un programa ya contado. */
        const open = text.lastIndexOf('<programme');
        tail = open > last ? text.slice(open) : text.slice(Math.max(last, text.length - 4096));
        if (tail.length > 1_000_000) tail = '';
      });
      body.on('end', () => {
        clearTimeout(timer);
        resolve();
      });
      body.on('error', (/** @type {Error} */ error) => {
        clearTimeout(timer);
        reject(error);
      });
    })
  );

  const per = [...perChannel.values()].sort((a, b) => a - b);
  const pct = (/** @type {number} */ n) =>
    counts.programas ? Math.round((1000 * n) / counts.programas) / 10 : 0;
  Object.assign(report, {
    segundos: Math.round((Date.now() - started) / 1000),
    bytesCable: wire,
    bytes,
    canalesDeclarados: channels.size,
    canalesConProgramas: perChannel.size,
    programas: counts.programas,
    programasPorCanal: per.length
      ? { min: per[0], mediana: per[Math.floor(per.length / 2)], max: per.at(-1) }
      : null,
    desdeHoras: Number.isFinite(minStart) ? Math.round((minStart - now) / 3_600_000) : null,
    hastaHoras: Number.isFinite(maxStop) ? Math.round((maxStop - now) / 3_600_000) : null,
    reparto: window,
    conCampo: {
      descripcion: pct(counts.desc),
      categoria: pct(counts.categoria),
      imagen: pct(counts.icono),
      episodio: pct(counts.episodio),
      subtitulo: pct(counts.subtitulo),
      nota: pct(counts.nota),
      edad: pct(counts.edad),
      /* Solo el elemento `<live/>`. */
      directo: pct(counts.directo),
      /* «Directo», «en vivo», «live» o «(L)» en el título o el subtítulo. */
      directoEnTitulo: pct(counts.directoEnTitulo),
      /* Lo uno o lo otro: la marca que usa la app (hasLiveMark). */
      directoCualquiera: pct(counts.directoCualquiera),
    },
    /* Lo que decide la agenda híbrida: de los programas que parecen un partido («X - Y», 80-240
       min), cuántos llevan la marca de directo. Si es ~0 %, la guía solo confirma partido y canal
       (no mueve horas ni añade partidos). */
    pareceUnPartido: counts.partidos,
    pareceUnPartidoConDirecto: counts.partidos
      ? Math.round((1000 * counts.partidosConDirecto) / counts.partidos) / 10
      : 0,
  });
} catch (error) {
  report.error = scrub(error instanceof Error ? error.message : String(error));
}
console.log(scrub(JSON.stringify(report, null, 2)));
