const http = require("http");
const https = require("https");
const crypto = require("crypto");
const dns = require("dns");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const ACESTREAM_HOST = String(process.env.ACESTREAM_HOST || "ismaeloul-ace-player-neo_acestream_1")
  .trim().replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 253) || "ismaeloul-ace-player-neo_acestream_1";
const ACESTREAM_SCANNER_HOST = String(process.env.ACESTREAM_SCANNER_HOST || "").trim().slice(0, 253);
const ACESTREAM_SCANNER_PORT = Math.min(65535, Math.max(1, Number.parseInt(process.env.ACESTREAM_SCANNER_PORT, 10) || 6878));
const ENGINE_CONTROL_HOST = process.env.ENGINE_CONTROL_HOST || "ismaeloul-ace-player-neo_engine_control_1";
const HASH_RE = /^[a-fA-F0-9]{40}$/;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_HISTORY = 60;
const MAX_WEB_STREAMS = 500;
const MAX_WEB_SOURCES = 8;
const MAX_FOOTBALL_LEAGUES = 12;
const MAX_FOOTBALL_TEAMS = 24;
const MAX_FOOTBALL_NATIONALITIES = 24;
const MAX_CHANNEL_BINDINGS = 120;
const MAX_SOURCE_REPORTS = 300;
const MAX_CHANNEL_FEEDBACK = 300;
const MAX_REMUX_SESSIONS = 3;
const RESTART_COOLDOWN_MS = 15000;
const RELEASE_TOMBSTONE_MS = 60 * 1000;
const MAX_REDIRECTS = 5;
const FETCH_TOTAL_TIMEOUT_MS = 45000;
const REMUX_IDLE_MS = 90 * 1000;
const DEFAULT_WEB_SYNC_URL = process.env.DEFAULT_WEB_SYNC_URL || "https://ipfs.io/ipns/k51qzi5uqu5di462t7j4vu4akwfhvtjhy88qbupktvoacqfqe9uforjvhyi4wr/hashes_acestream.m3u";
const DEFAULT_WEB_SOURCE_ID = "principal";
const WEB_SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;
const ALLOW_PRIVATE_SYNC_URLS = process.env.ALLOW_PRIVATE_SYNC_URLS === "true";
const FOOTBALL_API_KEY = String(process.env.THESPORTSDB_API_KEY || "123")
  .trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "123";
const FOOTBALL_COUNTRY = String(process.env.FOOTBALL_COUNTRY || "Spain")
  .replace(/[^a-zA-Z _-]/g, "").trim().slice(0, 40) || "Spain";
// futbolenlatv publica ~15 dias por delante, asi que el tope sube a 14
const FOOTBALL_DAYS = Math.min(14, Math.max(3, Number.parseInt(process.env.FOOTBALL_DAYS, 10) || 7));
const FOOTBALL_CACHE_MS = 30 * 60 * 1000;
const FOOTBALL_TIMEZONE = "Europe/Madrid";
const FOOTBALL_FALLBACK_COMPETITION = "Fútbol";
const FOOTBALL_DEMO_ONLY = process.env.FOOTBALL_DEMO_ONLY === "true";
const SCANNER_INITIAL_SOURCES = 3;
const SCANNER_MAX_CANDIDATES = 100;
const SCANNER_PROBE_TIMEOUT_MS = Math.min(30000, Math.max(6000, Number.parseInt(process.env.ACESTREAM_SCANNER_TIMEOUT_MS, 10) || 18000));
const SCANNER_SAMPLE_BYTES = Math.min(1024 * 1024, Math.max(32 * 1024, Number.parseInt(process.env.ACESTREAM_SCANNER_SAMPLE_BYTES, 10) || 128 * 1024));
const SCANNER_MEDIA_PROBE_MS = Math.min(12000, Math.max(2500, Number.parseInt(process.env.ACESTREAM_SCANNER_MEDIA_PROBE_MS, 10) || 7000));
const SCANNER_RETRY_DELAY_MS = Math.min(30 * 60 * 1000, Math.max(60 * 1000,
  Number.parseInt(process.env.ACESTREAM_SCANNER_RETRY_DELAY_MS, 10) || 10 * 60 * 1000));
const SCANNER_JOB_TTL_MS = SCANNER_RETRY_DELAY_MS + 15 * 60 * 1000;
const SCANNER_GOOD_TTL_MS = 3 * 60 * 1000;
const SCANNER_BAD_TTL_MS = SCANNER_RETRY_DELAY_MS;
const SOURCE_REPORT_QUARANTINE_MS = 30 * 60 * 1000;
const SOURCE_QUALITY_QUARANTINE_MS = 10 * 60 * 1000;
const SOURCE_WRONG_CHANNEL_QUARANTINE_MS = 30 * 24 * 60 * 60 * 1000;
const PREHEAT_DISCOVERY_MS = 45 * 60 * 1000;
const PREHEAT_SCAN_MS = 15 * 60 * 1000;
const PREHEAT_KICKOFF_GRACE_MS = 3 * 60 * 1000;
const PREHEAT_RESULT_TTL_MS = 20 * 60 * 1000;
const PREHEAT_TICK_MS = 60 * 1000;
const APP_VERSION = "0.6.51";
const OLLAMA_BASE_URL = String(process.env.OLLAMA_BASE_URL || "").trim().replace(/\/+$/, "");
const OLLAMA_EMBED_MODEL = String(process.env.OLLAMA_EMBED_MODEL || "embeddinggemma:300m-qat-q4_0")
  .trim().replace(/[^a-zA-Z0-9_.:/-]/g, "").slice(0, 120) || "embeddinggemma:300m-qat-q4_0";
const OLLAMA_TIMEOUT_MS = Math.min(15000, Math.max(1500, Number.parseInt(process.env.OLLAMA_TIMEOUT_MS, 10) || 6500));
const OLLAMA_EMBED_BATCH = 96;
const OLLAMA_EMBED_CACHE_MAX = 2400;
/* 0,86 y no 0,82. Medido contra el modelo instalado, "liga campeones" y
   "laliga" -que son competiciones distintas- dan 0,8154: con el suelo en 0,82
   quedaban a cinco milesimas de cruzarlo. Con 0,86 hay holgura de verdad. */
/* "Es ese canal, sin duda". Este numero decidia siete cosas distintas estando
   escrito a pelo en siete sitios: el nivel maximo de resolutionTier, si existe
   el canal exacto -y por tanto si se descartan las hermanas numeradas-, el
   filtro de los vinculos guardados, su puntuacion minima, que entradas del
   catalogo cuentan como pedidas y cual es la cabecera de candidatos. Cambiar
   uno solo y dejar los otros seis en silencio es un fallo esperando su turno.

   OJO al acoplamiento con la IA: semanticScore llega a 94, por encima de este
   umbral, asi que una promocion semantica cuenta como prueba de canal exacto y
   descarta la familia. Hoy es lo que se quiere -si la IA confirma el canal, es
   el canal- y el caso marca-paraguas tipo DAZN esta protegido porque la guarda
   de numeros descarta las hermanas antes de comparar. Si alguna vez se toca
   semanticScore, hay un test que lo sujeta. */
const RESOLUTION_EXACT_SCORE = 92;
const SEMANTIC_MAX_SCORE = 94;
const SEMANTIC_MIN_SIMILARITY = 0.86;
const SEMANTIC_OTHER_CHANNEL_MARGIN = 0.035;

const PRIVATE_IPV6 = new net.BlockList();
for (const [address, prefix] of [
  ["::", 128], ["::1", 128], ["::ffff:0:0", 96],
  ["64:ff9b::", 96], ["64:ff9b:1::", 48],
  ["2001:db8::", 32], ["fc00::", 7], ["fe80::", 10],
  ["fec0::", 10], ["ff00::", 8],
]) PRIVATE_IPV6.addSubnet(address, prefix, "ipv6");

let lastRestartAt = 0;
const releasedClaims = new Map();
const footballCache = { payload: null, expiresAt: 0, pending: null };
const scannerJobs = new Map();
const scannerClients = new Map();
const scannerCache = new Map();
const scannerQueue = [];
let scannerBusy = false;
let preheatBusy = false;
const preheatMatches = new Map();
const semanticEmbeddingCache = new Map();
const footballProgramming = {
  channels: [],
  matches: new Map(),
  signature: "",
  warmPending: null,
};

/* ---------- remux HEVC->fMP4 para iOS ----------
   El player web de Apple rechaza HEVC dentro de segmentos TS (exige fMP4).
   ffmpeg re-empaqueta SIN transcodificar (-c copy): CPU minima.
   Sesiones con reaper por inactividad (90 s sin pedir segmentos). */
const REMUX_DIR = path.join(DATA_DIR, "remux");
const remuxSessions = new Map();

function remuxCleanup(key) {
  const s = remuxSessions.get(key);
  if (!s) return;
  remuxSessions.delete(key);
  try { s.proc?.kill("SIGKILL"); } catch {}
  try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch {}
}

function reapRemuxSessions() {
  const now = Date.now();
  for (const [key, s] of remuxSessions) {
    if (now - s.lastAccess > REMUX_IDLE_MS) remuxCleanup(key);
  }
}

function ensureRemux(idParam, id, deviceId = "") {
  const key = id.toLowerCase();
  let s = remuxSessions.get(key);
  if (s && !s.exited && s.idParam === idParam) {
    s.lastAccess = Date.now();
    if (deviceId) s.clients.add(deviceId);
    return s;
  }
  if (s) remuxCleanup(key);
  while (remuxSessions.size >= MAX_REMUX_SESSIONS) {
    const oldest = [...remuxSessions.entries()].sort((a, b) => a[1].lastAccess - b[1].lastAccess)[0];
    if (!oldest) break;
    remuxCleanup(oldest[0]);
  }
  const dir = path.join(REMUX_DIR, key);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(dir, { recursive: true });
  const src = `http://${ACESTREAM_HOST}:6878/ace/getstream?${idParam}=${id}`;
  const logFd = fs.openSync(path.join(dir, "ffmpeg.log"), "w");
  const proc = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "warning", "-nostdin",
    "-fflags", "+genpts+discardcorrupt",
    "-probesize", "5000000", "-analyzeduration", "5000000",
    "-thread_queue_size", "512",
    "-i", src,
    "-map", "0:v:0", "-map", "0:a:0?",
    // video sin transcodificar; audio SIEMPRE recodificado a AAC estandar:
    // arregla el ADTS de los TS y los canales con MP2/AC-3 que iOS no decodifica.
    /* El audio se sincroniza con async=1000, no con async=1. Segun la propia
       documentacion de ffmpeg:
         -async  0(disabled), 1(filling and trimming),
                 >1(maximum stretch/squeeze in samples per second)
       Es decir, async=1 SOLO rellena o recorta, y ademas solo cuando el desfase
       supera min_hard_comp (0,1 s). En un TS de P2P, que llega con jitter
       constante, eso significa que la deriva por debajo de 100 ms no se corrige
       nunca -se va acumulando- y al pasar de 100 ms se arregla de golpe. De ahi
       que en el iPhone el audio se adelantara y se atrasara respecto a los
       labios: el ordenador no lo sufre porque no pasa por este remux.
       Con >1 el resampler puede estirar y encoger de forma continua: 1000
       muestras por segundo son un 2% a 48 kHz, de sobra para seguir la deriva
       e imperceptible al oido. */
    /* -copyinkf: la clave del desfase en iOS.
       Al engancharse a un directo casi nunca caes en un fotograma clave. Con
       -c:v copy, ffmpeg TIRA todos los fotogramas de video hasta el siguiente
       clave... pero conserva el audio de ese tramo. Resultado: la salida
       empieza con audio a solas y el sonido queda por delante de la imagen
       durante toda la sesion, tanto como dure el GOP.
       Medido con un enganche a mitad de GOP: el audio salia 2,111 s adelantado.
       Ninguna bandera de tiempos lo arregla -se probaron copyts, start_at_zero,
       avoid_negative_ts y max_interleave_delta, las cuatro dieron 2,111- porque
       no es un error de marcas: ese audio existe de verdad y el video no.
       Con -copyinkf se conservan esos fotogramas iniciales aunque no sean
       claves, asi que ambas pistas empiezan juntas: 2,111 s -> 0,071 s. El
       decodificador descarta esas primeras imagenes por su cuenta.
       Se elige esto y no recodificar el video -que daria 0,021 s- porque copy
       no cuesta CPU ni añade un solo milisegundo de latencia. */
    "-c:v", "copy", "-copyinkf", "-c:a", "aac", "-b:a", "160k", "-ac", "2",
    "-af", "aresample=async=1000:min_hard_comp=0.100:first_pts=0",
    "-f", "hls", "-hls_time", "4", "-hls_list_size", "8",
    "-hls_delete_threshold", "2",
    "-hls_flags", "delete_segments+independent_segments+temp_file",
    "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
    path.join(dir, "index.m3u8"),
  ], { stdio: ["ignore", "ignore", logFd] });
  try { fs.closeSync(logFd); } catch {}
  s = { proc, dir, idParam, clients: new Set(deviceId ? [deviceId] : []), lastAccess: Date.now(), exited: false, exitCode: null };
  proc.on("error", () => { if (remuxSessions.get(key) === s) remuxCleanup(key); });
  proc.on("exit", (code) => {
    if (remuxSessions.get(key) !== s) return;
    // Conserva los ultimos segmentos durante el periodo de gracia para que
    // el reproductor termine sus peticiones. El reaper elimina despues todo.
    s.proc = null;
    s.exited = true;
    s.exitCode = code;
    s.lastAccess = Date.now();
  });
  remuxSessions.set(key, s);
  return s;
}

const REMUX_TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".ts": "video/mp2t",
};

function parseByteRange(value, size) {
  if (!value) return null;
  if (String(value).includes(",")) return false;
  const match = String(value).match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2]) || size <= 0) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

async function serveRemuxFile(req, res, file) {
  let stat;
  try {
    stat = await fs.promises.stat(file);
    if (!stat.isFile()) throw new Error("not_file");
  } catch {
    res.writeHead(404, { "Cache-Control": "no-store" });
    res.end();
    return;
  }
  if (stat.size === 0 && !req.headers.range) {
    res.writeHead(200, {
      "Content-Type": REMUX_TYPES[path.extname(file)] || "application/octet-stream",
      "Content-Length": "0",
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end();
    return;
  }
  const range = parseByteRange(req.headers.range, stat.size);
  if (range === false) {
    res.writeHead(416, { "Content-Range": `bytes */${stat.size}`, "Cache-Control": "no-store" });
    res.end();
    return;
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? stat.size - 1;
  const headers = {
    "Content-Type": REMUX_TYPES[path.extname(file)] || "application/octet-stream",
    "Content-Length": String(Math.max(0, end - start + 1)),
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;
  res.writeHead(range ? 206 : 200, headers);
  if (req.method === "HEAD") return res.end();
  const stream = fs.createReadStream(file, { start, end });
  stream.on("error", () => res.destroy());
  stream.pipe(res);
}

function ensureState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({
      favorites: [], history: [], web: [], webSyncedAt: null,
      webSources: [], activeWebSourceId: null,
      preferences: normalizePreferences(null), channelBindings: [],
      sourceReports: [], channelFeedback: [], sourceStats: normalizeSourceStats(null),
    }, null, 2));
  }
}

function normalizeHash(value) {
  const raw = String(value || "").trim();
  const aceMatch = raw.match(/acestream:\/\/([a-fA-F0-9]{40})/);
  if (aceMatch) return aceMatch[1].toLowerCase();
  try {
    const parsed = new URL(raw);
    const id = parsed.searchParams.get("id") || parsed.searchParams.get("content_id");
    if (id && HASH_RE.test(id)) return id.toLowerCase();
  } catch {}
  const hashMatch = raw.match(/[a-fA-F0-9]{40}/);
  return hashMatch ? hashMatch[0].toLowerCase() : "";
}

function normalizeItem(item, fallbackType = "recent") {
  const id = normalizeHash(item?.id || item?.hash || item?.url);
  if (!id) return null;
  const title = String(item?.title || item?.name || `Stream ${id.slice(0, 8)}`).replace(/\s+/g, " ").trim().slice(0, 120);
  const type = ["fav", "recent", "web"].includes(item?.type) ? item.type : fallbackType;
  const category = String(item?.category || (type === "web" ? "Importado" : "General")).replace(/\s+/g, " ").trim().slice(0, 48);
  const date = typeof item?.date === "string" && Number.isFinite(Date.parse(item.date))
    ? new Date(item.date).toISOString() : new Date().toISOString();
  // nombre canonico del canal (tvg-id del M3U); solo se usa para emparejar
  const alias = String(item?.alias || "").replace(/\s+/g, " ").trim().slice(0, 120);
  return {
    id,
    title,
    ...(alias && alias !== title ? { alias } : {}),
    type,
    category,
    date,
    fromWebSync: item?.fromWebSync === true,
    // true si el id es un infohash (resultados del buscador): se reproduce con ?infohash=
    ih: item?.ih === true,
  };
}

function normalizeItems(items, type, max) {
  const output = [];
  const seen = new Set();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeItem({ ...item, type }, type);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    output.push(normalized);
    if (output.length >= max) break;
  }
  return output;
}

function normalizePreferenceList(values, max, maxLength) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const value = cleanTitle(raw, "").slice(0, maxLength);
    const key = value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= max) break;
  }
  return output;
}

function normalizePreferences(value) {
  return {
    onboardingComplete: value?.onboardingComplete === true,
    country: cleanTitle(value?.country, FOOTBALL_COUNTRY).slice(0, 40),
    leagues: normalizePreferenceList(value?.leagues, MAX_FOOTBALL_LEAGUES, 60),
    teams: normalizePreferenceList(value?.teams, MAX_FOOTBALL_TEAMS, 80),
    nationalities: normalizePreferenceList(value?.nationalities, MAX_FOOTBALL_NATIONALITIES, 60),
  };
}

function normalizeChannelKey(value) {
  return String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    /* "LIGA DE CAMPEONES --> ELCANO": lo que va tras la flecha es QUIEN lo
       sirve, no que canal es. Y los asteriscos solo marcan la copia. Tratarlo
       como parte del nombre convertia al proveedor en palabra distintiva y
       topaba la puntuacion en 58, dejando fuera media biblioteca. */
    .replace(/\s*(?:--?>|={1,2}>|[→⇒➜➝⟶⟹])\s*.*$/, " ")
    .replace(/[*#]+/g, " ")
    .replace(/\bm\s*\+/g, " movistar ")
    .replace(/\bmovistar\s*plus\+?\b/g, " movistar ")
    .replace(/\b(full\s*hd|fhd|uhd|hd|sd|4k|1080p|720p)\b/g, " ")
    .replace(/\b(espana|spain)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

// Palabras que sobran o faltan sin cambiar de que canal hablamos.
const CHANNEL_FILLER_TOKENS = new Set([
  "tv", "canal", "channel", "de", "del", "la", "el", "los", "las",
  "y", "and", "en", "the", "directo", "live", "senal", "opcion",
  /* El operador dice por donde te llega, no que estas viendo: "M+ Liga de
     Campeones" y "LIGA DE CAMPEONES" son el mismo canal. Contarlo como
     palabra propia topaba la puntuacion en 58 y dejaba fuera media
     biblioteca. Ojo: aqui van PLATAFORMAS, no marcas de canal. DAZN no entra:
     ahi la marca si es el canal. */
  "movistar", "m", "orange", "vodafone", "telecable", "plus",
]);
// Techo para nombres que difieren en una palabra propia: quedan por debajo
// de recomendar (70) y de reproducir solo (92), pero siguen siendo elegibles.
const CHANNEL_VARIANT_MAX_SCORE = 58;
/* Pedir "DAZN" a secas no es pedir un canal, es pedir la familia entera: la
   agenda anuncia asi 151 de 661 partidos. Se puntua 78, que pasa el umbral de
   recomendado (70) pero NO el de reproducir a ciegas (92), asi que se ofrecen
   todos los DAZN y eliges tu cual. */
const CHANNEL_FAMILY_SCORE = 78;
// Para ofrecer un canal de TU biblioteca hace falta superar el techo de
// variante: si no, cualquier canal de la misma familia se cuela.
const LIBRARY_MIN_SCORE = 70;

/* Un token presente en un nombre y ausente en el otro, si no es relleno, es
   justo lo que separa dos canales de la misma familia: "LaLiga TV" es Primera
   y "LaLiga TV Hypermotion" es Segunda. Solo se vigilaban las cifras, asi que
   Eurosport 1/2 quedaba bien pero las variantes por palabra puntuaban 74 y se
   recomendaban. Ojo: "LaLiga TV" es SUBCADENA de "LaLiga TV Hypermotion", asi
   que tambien se colaban por la rama de includes(). */
function distinctiveTokens(from, other) {
  const known = new Set(other);
  return from.filter((token) => !known.has(token) && !CHANNEL_FILLER_TOKENS.has(token));
}

/* Familia: un nombre es el otro mas un numero de canal -"DAZN" y "DAZN 1"-.
   Si lo que sobra es una PALABRA -"Hypermotion"- no es familia sino otra
   competicion. Se saca aparte porque hace falta saber si un candidato entro
   SOLO por parecido de familia: eso decide si se ofrece o no. */
function esCoincidenciaDeFamilia(a, b, tokensA, tokensB) {
  if (!(a.includes(b) || b.includes(a))) return false;
  const soloSobranNumeros = (from, other) => {
    const known = new Set(other);
    const extra = from.filter((token) => !known.has(token));
    return extra.length > 0 && extra.every((token) => /^[0-9]+$/.test(token));
  };
  return soloSobranNumeros(tokensA, tokensB) || soloSobranNumeros(tokensB, tokensA);
}

function esFamiliaDe(left, right) {
  const a = normalizeChannelKey(left), b = normalizeChannelKey(right);
  if (!a || !b || a === b) return false;
  return esCoincidenciaDeFamilia(a, b, a.split(" "), b.split(" "));
}

function channelMatchScore(left, right) {
  const a = normalizeChannelKey(left);
  const b = normalizeChannelKey(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const numsA = (a.match(/\d+/g) || []).join(",");
  const numsB = (b.match(/\d+/g) || []).join(",");
  /* Dos canales numerados distintos nunca son el mismo: DAZN 1 no es DAZN 2.
     Pero antes bastaba con que UN lado llevara numero para descartar, y eso
     tumbaba "DAZN" contra los 59 canales DAZN de la biblioteca: el partido
     salia como si no hubiera canal. */
  if (numsA && numsB && numsA !== numsB) return 0;
  const tokensA = a.split(" ");
  const tokensB = b.split(" ");
  /* futbolenlatv usa el nombre comercial ("M+ Liga de Campeones"), mientras
     que las listas lo escriben como "M. Liga de Campeones" o directamente
     "Liga de Campeones". Si al quitar articulos y el operador queda el mismo
     nucleo, es el mismo canal al 100 %. Los numeros siguen dentro del nucleo,
     de modo que el 2 o el 3 nunca se confunden con el canal principal. */
  const coreA = tokensA.filter((token) => !CHANNEL_FILLER_TOKENS.has(token)).join(" ");
  const coreB = tokensB.filter((token) => !CHANNEL_FILLER_TOKENS.has(token)).join(" ");
  if (coreA && coreA === coreB) return 100;
  if (esCoincidenciaDeFamilia(a, b, tokensA, tokensB)) return CHANNEL_FAMILY_SCORE;
  const variant = distinctiveTokens(tokensA, tokensB).length || distinctiveTokens(tokensB, tokensA).length;
  let score;
  if (a.includes(b) || b.includes(a)) {
    const shortest = Math.min(tokensA.length, tokensB.length);
    score = shortest >= 2 ? 86 - Math.min(14, Math.abs(a.length - b.length)) : 58;
  } else {
    const setB = new Set(tokensB);
    const shared = tokensA.filter((token) => token.length > 1 && setB.has(token)).length;
    const ratio = shared / Math.max(tokensA.length, tokensB.length);
    score = shared >= 2 && ratio >= 0.6 ? Math.round(58 + ratio * 24) : 0;
  }
  /* Sin descartarlo: "DAZN Eventos" sigue siendo una opcion valida cuando
     buscas "DAZN". Pero al topar en 58 no alcanza ni el umbral de recomendado
     (70) ni el de reproducir solo (92), asi que Hypermotion ya no puede
     colarse como Primera: como mucho aparece entre las opciones a confirmar. */
  return variant ? Math.min(score, CHANNEL_VARIANT_MAX_SCORE) : score;
}

/* La IA no decide si un 1 es un 3. Su trabajo es reconocer la familia del
   canal aunque el rotulo sea raro; las cifras siguen bajo una regla exacta.
   Para el embedding se quitan operador, articulos, calidad, proveedor y dial:
   "M+ LIGA DE CAMPEONES 1 FHD --> ELCANO" queda "liga campeones". */
function semanticChannelText(value) {
  return normalizeChannelKey(value).split(" ")
    .filter((token) => token && !CHANNEL_FILLER_TOKENS.has(token) && !/^\d+$/.test(token))
    .join(" ");
}

function channelDialNumbers(value) {
  return normalizeChannelKey(value).split(" ").filter((token) => /^\d+$/.test(token));
}

function semanticNumbersCompatible(programChannel, candidateName) {
  const wanted = channelDialNumbers(programChannel);
  const offered = channelDialNumbers(candidateName);
  if (wanted.length && offered.length) return wanted.join(",") === offered.join(",");
  /* Un nombre programado sin dial es el canal principal. La IA nunca puede
     convertirlo en el 2 o el 3; los casos de familia generica como "DAZN"
     siguen cubiertos por la regla determinista existente. */
  if (!wanted.length && offered.length) return false;
  /* "... 1" y el rotulo sin numero suelen ser la misma señal principal. */
  if (wanted.length && !offered.length) return wanted.every((number) => number === "1");
  return true;
}

function channelAllowsFamilyFallback(value) {
  /* futbolenlatv usa "DAZN" como marca paraguas sin indicar dial. En cambio
     "M+ LALIGA" o "M+ Liga de Campeones" son canales principales concretos:
     su 2 y su 3 emiten otros partidos y no son un sustituto valido. */
  return semanticChannelText(value) === "dazn";
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 2 || left.length !== right.length) return -1;
  let product = 0, normLeft = 0, normRight = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = Number(left[index]), b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return -1;
    product += a * b;
    normLeft += a * a;
    normRight += b * b;
  }
  return normLeft > 0 && normRight > 0 ? product / Math.sqrt(normLeft * normRight) : -1;
}

function ollamaConfigured() {
  if (!OLLAMA_BASE_URL || !OLLAMA_EMBED_MODEL) return false;
  try {
    const parsed = new URL(OLLAMA_BASE_URL);
    return ["http:", "https:"].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

async function ollamaEmbedBatch(texts) {
  if (!ollamaConfigured()) throw new Error("ollama_unavailable");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: OLLAMA_EMBED_MODEL,
        input: texts,
        truncate: true,
        keep_alive: "2m",
      }),
      signal: controller.signal,
    });
    const body = await response.text();
    if (body.length > 24 * 1024 * 1024) throw new Error("ollama_response_too_large");
    if (!response.ok) throw new Error("ollama_unavailable");
    let parsed;
    try { parsed = JSON.parse(body); }
    catch { throw new Error("ollama_bad_response"); }
    if (!Array.isArray(parsed.embeddings) || parsed.embeddings.length !== texts.length) {
      throw new Error("ollama_bad_response");
    }
    return parsed.embeddings;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("ollama_timeout");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function rememberSemanticEmbedding(cache, key, vector) {
  if (!key || !Array.isArray(vector) || vector.length < 2) return;
  cache.delete(key);
  cache.set(key, vector);
  while (cache.size > OLLAMA_EMBED_CACHE_MAX) cache.delete(cache.keys().next().value);
}

async function semanticEmbeddingMap(values, options = {}) {
  const cache = options.cache || semanticEmbeddingCache;
  const embed = options.embed || ollamaEmbedBatch;
  const keys = [...new Set((Array.isArray(values) ? values : [])
    .map((value) => cleanTitle(value, "").slice(0, 120)).filter(Boolean))];
  const missing = keys.filter((key) => !cache.has(key));
  for (let index = 0; index < missing.length; index += OLLAMA_EMBED_BATCH) {
    const batch = missing.slice(index, index + OLLAMA_EMBED_BATCH);
    const vectors = await embed(batch);
    if (!Array.isArray(vectors) || vectors.length !== batch.length) throw new Error("ollama_bad_response");
    batch.forEach((key, position) => rememberSemanticEmbedding(cache, key, vectors[position]));
  }
  return new Map(keys.map((key) => [key, cache.get(key)]).filter((entry) => Array.isArray(entry[1])));
}

function semanticCatalog(requestedChannels, programChannels) {
  const entries = new Map();
  for (const raw of [...requestedChannels, ...(Array.isArray(programChannels) ? programChannels : [])]) {
    const name = cleanTitle(raw, "");
    const key = normalizeChannelKey(name);
    const text = semanticChannelText(name);
    if (!name || !key || !text) continue;
    const requested = requestedChannels.some((channel) => channelMatchScore(channel, name) >= RESOLUTION_EXACT_SCORE);
    const previous = entries.get(key);
    entries.set(key, { name, key, text, requested: requested || previous?.requested === true });
  }
  return [...entries.values()];
}

function semanticScore(similarity) {
  if (similarity >= 0.96) return SEMANTIC_MAX_SCORE;
  if (similarity >= 0.90) return 88;
  return 74 + Math.max(0, Math.round((similarity - SEMANTIC_MIN_SIMILARITY) * 50));
}

/* Compara cada nombre encontrado con TODOS los canales de la programacion.
   Asi "M+ LALIGA" no gana por parecerse vagamente a Champions: si aparece en
   la agenda, su vecino mas cercano es su propio canal y queda fuera del
   partido actual. La capa solo SUBE candidatos que el buscador clasico no
   entendio; nunca rebaja ni elimina sus aciertos. */
async function applySemanticCandidateScores(requestedChannels, candidates, programChannels, options = {}) {
  const enabled = options.enabled ?? ollamaConfigured();
  if (!enabled || !candidates.length) return { candidates, used: false, error: null, catalogSize: 0 };
  const catalog = semanticCatalog(requestedChannels, programChannels);
  if (!catalog.some((entry) => entry.requested)) {
    return { candidates, used: false, error: null, catalogSize: catalog.length };
  }
  const candidateNames = candidates.flatMap((candidate) => [candidate.title, candidate.alias].filter(Boolean));
  const texts = [
    ...catalog.map((entry) => entry.text),
    ...candidateNames.map(semanticChannelText).filter(Boolean),
  ];
  let vectors;
  try {
    vectors = await semanticEmbeddingMap(texts, options);
  } catch (error) {
    return { candidates, used: false, error: error.message || "ollama_unavailable", catalogSize: catalog.length };
  }

  const scored = candidates.map((candidate) => {
    let bestRequested = { similarity: -1, channel: "" };
    let bestOther = -1;
    for (const rawName of [candidate.title, candidate.alias].filter(Boolean)) {
      const candidateText = semanticChannelText(rawName);
      const candidateVector = vectors.get(candidateText);
      if (!candidateVector) continue;
      for (const entry of catalog) {
        if (!semanticNumbersCompatible(entry.name, rawName)) continue;
        const similarity = cosineSimilarity(vectors.get(entry.text), candidateVector);
        if (entry.requested) {
          if (similarity > bestRequested.similarity) bestRequested = { similarity, channel: entry.name };
        } else if (similarity > bestOther) bestOther = similarity;
      }
    }
    /* Sin ningun otro canal con el que contrastar no hay margen competitivo que
       valga, y ese es justo el momento con menos informacion: se exige entonces
       practicamente identidad en vez de dar el visto bueno por defecto. */
    const sinRival = bestOther < 0;
    const clearWinner = sinRival
      ? bestRequested.similarity >= 0.96
      : (bestRequested.similarity >= 0.96
        || bestRequested.similarity - bestOther >= SEMANTIC_OTHER_CHANNEL_MARGIN);
    if (bestRequested.similarity < SEMANTIC_MIN_SIMILARITY || !clearWinner) return candidate;
    const aiScore = semanticScore(bestRequested.similarity);
    if (aiScore <= candidate.score) return {
      ...candidate,
      semanticSimilarity: Number(bestRequested.similarity.toFixed(4)),
    };
    return {
      ...candidate,
      score: aiScore,
      matchedChannel: requestedChannels.find((channel) => channelMatchScore(channel, bestRequested.channel) >= RESOLUTION_EXACT_SCORE)
        || requestedChannels[0],
      soloFamilia: false,
      semantic: true,
      semanticSimilarity: Number(bestRequested.similarity.toFixed(4)),
    };
  });
  return { candidates: scored, used: true, error: null, catalogSize: catalog.length };
}

function normalizeChannelBinding(value) {
  const channel = cleanTitle(value?.channel, "");
  const channelKey = normalizeChannelKey(channel);
  const id = normalizeHash(value?.id);
  if (!channel || !channelKey || !id) return null;
  return {
    channel,
    channelKey,
    id,
    title: cleanTitle(value?.title, channel),
    ih: value?.ih === true,
    updatedAt: typeof value?.updatedAt === "string" && Number.isFinite(Date.parse(value.updatedAt))
      ? new Date(value.updatedAt).toISOString() : new Date().toISOString(),
  };
}

function normalizeChannelBindings(values) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const binding = normalizeChannelBinding(raw);
    if (!binding || seen.has(binding.channelKey)) continue;
    seen.add(binding.channelKey);
    output.push(binding);
    if (output.length >= MAX_CHANNEL_BINDINGS) break;
  }
  return output;
}

function normalizeWebUrl(value) {
  try {
    const parsed = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeSourceRenames(value) {
  const output = {};
  if (!value || typeof value !== "object" || Array.isArray(value)) return output;
  for (const [rawId, rawTitle] of Object.entries(value)) {
    const id = normalizeHash(rawId);
    const title = cleanTitle(rawTitle, "");
    if (!id || !title) continue;
    output[id] = title;
    if (Object.keys(output).length >= MAX_WEB_STREAMS) break;
  }
  return output;
}

function normalizeHiddenHashes(value) {
  const output = [];
  const seen = new Set();
  for (const rawId of Array.isArray(value) ? value : []) {
    const id = normalizeHash(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(id);
    if (output.length >= MAX_WEB_STREAMS) break;
  }
  return output;
}

function applySourceOverrides(streams, renames, hidden) {
  const hiddenIds = new Set(hidden);
  return streams
    .filter((stream) => !hiddenIds.has(stream.id))
    .map((stream) => renames[stream.id] ? { ...stream, title: renames[stream.id] } : stream);
}

function normalizeWebSource(source, index = 0, fallbackStreams = [], fallbackSyncedAt = null) {
  const url = normalizeWebUrl(source?.url || (index === 0 ? DEFAULT_WEB_SYNC_URL : ""));
  if (!url) return null;
  const type = source?.type === "html" ? "html" : "m3u";
  let id = String(source?.id || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  if (!id) id = index === 0 ? DEFAULT_WEB_SOURCE_ID : `directorio-${index + 1}`;
  let fallbackName = `Directorio ${index + 1}`;
  try { fallbackName = new URL(url).hostname.replace(/^www\./, "") || fallbackName; } catch {}
  const name = String(source?.name || fallbackName).replace(/\s+/g, " ").trim().slice(0, 60) || fallbackName;
  const renames = normalizeSourceRenames(source?.renames);
  const hidden = normalizeHiddenHashes(source?.hidden);
  const streams = applySourceOverrides(
    normalizeItems(source?.streams || fallbackStreams, "web", MAX_WEB_STREAMS),
    renames,
    hidden,
  );
  return {
    id,
    name,
    url,
    type,
    streams,
    renames,
    hidden,
    syncedAt: typeof source?.syncedAt === "string" ? source.syncedAt
      : typeof fallbackSyncedAt === "string" ? fallbackSyncedAt : null,
    lastErrorAt: typeof source?.lastErrorAt === "string" ? source.lastErrorAt : null,
  };
}

function sourceSummaries(sources) {
  return sources.map(({ id, name, url, type, streams, syncedAt, lastErrorAt }) => ({
    id, name, url, type, count: streams.length, syncedAt, lastErrorAt,
  }));
}

function publicState(state) {
  return {
    ...state,
    webSources: sourceSummaries(state.webSources),
    channelFeedback: undefined,
    learningCount: state.channelFeedback.length,
  };
}

function directoryResponse(state) {
  return {
    success: true,
    web: state.web,
    streams: state.web,
    webSyncedAt: state.webSyncedAt,
    webSources: sourceSummaries(state.webSources),
    activeWebSourceId: state.activeWebSourceId,
  };
}

// quién está reproduciendo ahora (traspaso de mando entre dispositivos)
function normalizeNowPlaying(np) {
  if (!np || typeof np !== "object") return null;
  const id = normalizeHash(np.id);
  const at = Number(np.at) || 0;
  if (!id || !at) return null;
  return {
    id,
    title: String(np.title || "").replace(/\s+/g, " ").trim().slice(0, 120),
    dev: String(np.dev || "").trim().slice(0, 40),
    token: String(np.token || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64),
    at,
  };
}

function pruneReleasedClaims() {
  const cutoff = Date.now() - RELEASE_TOMBSTONE_MS;
  for (const [token, releasedAt] of releasedClaims) {
    if (releasedAt < cutoff) releasedClaims.delete(token);
  }
}

function readState() {
  ensureState();
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    const legacyWeb = normalizeItems(parsed.web, "web", MAX_WEB_STREAMS);
    let webSources = Array.isArray(parsed.webSources)
      ? parsed.webSources.map((source, index) => normalizeWebSource(source, index)).filter(Boolean).slice(0, MAX_WEB_SOURCES)
      : [];
    if (!webSources.length) {
      webSources = [normalizeWebSource({
        id: DEFAULT_WEB_SOURCE_ID,
        name: "Directorio principal",
        url: DEFAULT_WEB_SYNC_URL,
        type: "m3u",
      }, 0, legacyWeb, parsed.webSyncedAt)].filter(Boolean);
    }
    const ids = new Set();
    webSources = webSources.filter((source) => {
      if (ids.has(source.id)) return false;
      ids.add(source.id);
      return true;
    });
    const activeWebSourceId = webSources.some((source) => source.id === parsed.activeWebSourceId)
      ? parsed.activeWebSourceId : webSources[0].id;
    const activeSource = webSources.find((source) => source.id === activeWebSourceId) || webSources[0];
    return {
      favorites: normalizeItems(parsed.favorites, "fav", MAX_HISTORY),
      history: normalizeItems(parsed.history, "recent", MAX_HISTORY),
      web: activeSource.streams,
      webSyncedAt: activeSource.syncedAt,
      webSources,
      activeWebSourceId,
      preferences: normalizePreferences(parsed.preferences),
      channelBindings: normalizeChannelBindings(parsed.channelBindings),
      sourceReports: normalizeSourceReports(parsed.sourceReports),
      channelFeedback: normalizeChannelFeedbacks(parsed.channelFeedback),
      sourceStats: normalizeSourceStats(parsed.sourceStats),
      nowPlaying: normalizeNowPlaying(parsed.nowPlaying),
    };
  } catch {
    const source = normalizeWebSource({ id: DEFAULT_WEB_SOURCE_ID, name: "Directorio principal", url: DEFAULT_WEB_SYNC_URL }, 0);
    return {
      favorites: [], history: [], web: [], webSyncedAt: null,
      webSources: source ? [source] : [], activeWebSourceId: source?.id || null,
      preferences: normalizePreferences(null), channelBindings: [],
      sourceReports: [], channelFeedback: [], sourceStats: normalizeSourceStats(null),
      nowPlaying: null,
    };
  }
}

function writeState(nextState) {
  let webSources = Array.isArray(nextState.webSources)
    ? nextState.webSources.map((source, index) => normalizeWebSource(source, index)).filter(Boolean).slice(0, MAX_WEB_SOURCES)
    : [];
  if (!webSources.length) {
    webSources = [normalizeWebSource({
      id: DEFAULT_WEB_SOURCE_ID,
      name: "Directorio principal",
      url: DEFAULT_WEB_SYNC_URL,
      type: "m3u",
    }, 0, nextState.web, nextState.webSyncedAt)].filter(Boolean);
  }
  const ids = new Set();
  webSources = webSources.filter((source) => {
    if (ids.has(source.id)) return false;
    ids.add(source.id);
    return true;
  });
  const activeWebSourceId = webSources.some((source) => source.id === nextState.activeWebSourceId)
    ? nextState.activeWebSourceId : webSources[0].id;
  const activeSource = webSources.find((source) => source.id === activeWebSourceId) || webSources[0];
  const state = {
    favorites: normalizeItems(nextState.favorites, "fav", MAX_HISTORY),
    history: normalizeItems(nextState.history, "recent", MAX_HISTORY),
    web: activeSource.streams,
    webSyncedAt: activeSource.syncedAt,
    webSources,
    activeWebSourceId,
    preferences: normalizePreferences(nextState.preferences),
    channelBindings: normalizeChannelBindings(nextState.channelBindings),
    sourceReports: normalizeSourceReports(nextState.sourceReports),
    channelFeedback: normalizeChannelFeedbacks(nextState.channelFeedback),
    sourceStats: normalizeSourceStats(nextState.sourceStats),
    nowPlaying: normalizeNowPlaying(nextState.nowPlaying),
  };
  const tempFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2));
  fs.renameSync(tempFile, STATE_FILE);
  return state;
}

function libraryResponse(state, collection) {
  if (collection === "favorites") return { success: true, favorites: state.favorites };
  if (collection === "history") return { success: true, history: state.history };
  return directoryResponse(state);
}

function mergeLegacyItems(incoming, current, type) {
  const currentIds = new Set(current.map((item) => item.id));
  const additions = normalizeItems(incoming, type, MAX_HISTORY).filter((item) => !currentIds.has(item.id));
  return normalizeItems([...additions, ...current], type, MAX_HISTORY);
}

function mutateLibrary(current, body) {
  const action = String(body?.action || "");
  if (action === "history-upsert" || action === "favorite-upsert") {
    const collection = action === "history-upsert" ? "history" : "favorites";
    const type = collection === "history" ? "recent" : "fav";
    const item = normalizeItem({ ...body.item, type }, type);
    if (!item) throw new Error("bad_request");
    const items = [item, ...current[collection].filter((entry) => entry.id !== item.id)].slice(0, MAX_HISTORY);
    const state = writeState({ ...current, [collection]: items });
    return libraryResponse(state, collection);
  }

  if (!['rename', 'delete'].includes(action)) throw new Error("bad_action");
  const collection = String(body.collection || "");
  if (!['favorites', 'history', 'web'].includes(collection)) throw new Error("bad_collection");
  const id = normalizeHash(body.id);
  if (!id) throw new Error("bad_request");

  if (collection === "web") {
    const sourceId = String(body.sourceId || current.activeWebSourceId || "");
    const source = current.webSources.find((entry) => entry.id === sourceId);
    if (!source) throw new Error("source_not_found");
    let updated;
    if (action === "rename") {
      const title = cleanTitle(body.title, "");
      if (!title) throw new Error("bad_title");
      updated = {
        ...source,
        renames: { ...source.renames, [id]: title },
        hidden: source.hidden.filter((entry) => entry !== id),
        streams: source.streams.map((entry) => entry.id === id ? { ...entry, title } : entry),
      };
    } else {
      updated = {
        ...source,
        hidden: [id, ...source.hidden.filter((entry) => entry !== id)].slice(0, MAX_WEB_STREAMS),
        streams: source.streams.filter((entry) => entry.id !== id),
      };
    }
    const webSources = current.webSources.map((entry) => entry.id === sourceId ? updated : entry);
    return directoryResponse(writeState({ ...current, webSources }));
  }

  let items;
  if (action === "rename") {
    const title = cleanTitle(body.title, "");
    if (!title) throw new Error("bad_title");
    items = current[collection].map((entry) => entry.id === id ? { ...entry, title } : entry);
  } else {
    items = current[collection].filter((entry) => entry.id !== id);
  }
  return libraryResponse(writeState({ ...current, [collection]: items }), collection);
}

function claimPlayback(current, body) {
  const id = normalizeHash(body?.id);
  const dev = String(body?.dev || "").trim().slice(0, 40);
  if (!id || !dev) throw new Error("bad_request");
  pruneReleasedClaims();
  const token = String(body?.token || `${dev}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`)
    .trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (!token) throw new Error("bad_request");
  // Si la pestaña se cerró mientras la petición de claim estaba en vuelo,
  // release puede llegar primero. La lápida impide resucitar ese claim tarde.
  if (releasedClaims.has(token)) return { success: true, nowPlaying: null, ignored: true };
  const previousAt = Number(current.nowPlaying?.at) || 0;
  const nowPlaying = {
    id,
    title: cleanTitle(body?.title, `Stream ${id.slice(0, 8)}`),
    dev,
    token,
    at: Math.max(Date.now(), previousAt + 1),
  };
  const state = writeState({ ...current, nowPlaying });
  return { success: true, nowPlaying: state.nowPlaying };
}

function releasePlayback(current, body) {
  const id = normalizeHash(body?.id);
  const dev = String(body?.dev || "").trim().slice(0, 40);
  if (!id || !dev) throw new Error("bad_request");
  pruneReleasedClaims();
  const token = String(body?.token || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
  if (token) releasedClaims.set(token, Date.now());
  if (!current.nowPlaying || current.nowPlaying.id !== id || current.nowPlaying.dev !== dev
      || (token && current.nowPlaying.token && current.nowPlaying.token !== token)) {
    return { success: true, released: false };
  }
  writeState({ ...current, nowPlaying: null });
  return { success: true, released: true };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    let bytes = 0;
    let done = false;
    const onData = (chunk) => {
      if (done) return;
      bytes += chunk.length;
      if (bytes > MAX_BODY) {
        done = true;
        const error = new Error("body_too_large");
        error.statusCode = 413;
        req.removeListener("data", onData);
        req.resume();
        reject(error);
        return;
      }
      body += chunk;
    };
    req.on("data", onData);
    req.on("end", () => {
      if (done) return;
      done = true;
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("bad_json"));
      }
    });
    req.on("error", (error) => { if (!done) { done = true; reject(error); } });
  });
}

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function isAllowedMutation(req) {
  const sideEffectGet = req.method === "GET" && (
    req.url === "/api/remux" || req.url.startsWith("/api/remux?")
    || req.url === "/api/football/resolve" || req.url.startsWith("/api/football/resolve?")
  );
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) && !sideEffectGet) return true;
  const fetchSite = String(req.headers["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite === "cross-site") return false;
  if (fetchSite === "same-origin") return true;
  const origin = String(req.headers.origin || "");
  if (!origin) return true;
  const hosts = new Set([
    String(req.headers.host || ""),
    String(req.headers["x-forwarded-host"] || "").split(",")[0].trim(),
  ].filter(Boolean));
  try { return hosts.has(new URL(origin).host); }
  catch { return false; }
}

function normalizedIp(value) {
  return String(value || "").replace(/^\[|\]$/g, "").split("%")[0].toLowerCase();
}

function isPrivateAddress(value) {
  const address = normalizedIp(value);
  const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddress(mapped[1]);
  if (net.isIP(address) === 4) {
    const [a, b, c] = address.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && c === 0)
      || (a === 192 && b === 0 && c === 2)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113);
  }
  if (net.isIP(address) === 6) {
    return PRIVATE_IPV6.check(address, "ipv6");
  }
  return false;
}

function isPrivateHostname(hostname) {
  const value = normalizedIp(hostname).replace(/\.$/, "");
  return value === "localhost" || value.endsWith(".localhost")
    || value.endsWith(".local") || value.endsWith(".internal")
    || value === "home.arpa" || value.endsWith(".home.arpa");
}

async function resolveFetchAddresses(parsed) {
  const hostname = normalizedIp(parsed.hostname);
  if (ALLOW_PRIVATE_SYNC_URLS) return null;
  if (isPrivateHostname(hostname) || isPrivateAddress(hostname)) throw new Error("private_url");
  if (net.isIP(hostname)) return [{ address: hostname, family: net.isIP(hostname) }];
  let addresses;
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error("dns_failed");
  }
  if (!addresses.length) throw new Error("dns_failed");
  if (addresses.some((entry) => isPrivateAddress(entry.address))) throw new Error("private_url");
  return addresses;
}

function pinnedLookup(addresses) {
  if (!addresses) return undefined;
  return (_hostname, options, callback) => {
    const config = typeof options === "object" ? options : { family: options };
    const family = Number(config?.family) || 0;
    const candidates = family ? addresses.filter((entry) => entry.family === family) : addresses;
    if (!candidates.length) return callback(new Error("dns_failed"));
    if (config?.all) return callback(null, candidates);
    return callback(null, candidates[0].address, candidates[0].family);
  };
}

// maxBytes es configurable porque la agenda de futbolenlatv ronda 1,4 MB y no
// conviene subir MAX_BODY, que ademas acota los cuerpos entrantes de la API
async function fetchText(url, redirects = 0, visited = new Set(), deadline = Date.now() + FETCH_TOTAL_TIMEOUT_MS, maxBytes = MAX_BODY) {
  if (Date.now() >= deadline) throw new Error("fetch_timeout");
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("bad_url");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error("bad_url");
  }
  const canonical = parsed.toString();
  if (visited.has(canonical)) throw new Error("redirect_loop");
  visited.add(canonical);
  const addresses = await resolveFetchAddresses(parsed);
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("fetch_timeout");

  return new Promise((resolve, reject) => {
    let settled = false;
    let totalTimer;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      callback(value);
    };
    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(parsed, {
      timeout: Math.min(12000, remaining),
      lookup: pinnedLookup(addresses),
      headers: {
        "User-Agent": "AcePlayerNeo/0.6.9",
        Accept: "application/json,text/plain,text/html,application/x-mpegURL,*/*;q=0.2",
        "Accept-Encoding": "identity",
      },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) return finish(reject, new Error("redirect_limit"));
        let nextUrl;
        try { nextUrl = new URL(response.headers.location, parsed).toString(); }
        catch { return finish(reject, new Error("bad_url")); }
        clearTimeout(totalTimer);
        fetchText(nextUrl, redirects + 1, visited, deadline, maxBytes)
          .then((value) => finish(resolve, value), (error) => finish(reject, error));
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        finish(reject, new Error("fetch_failed"));
        return;
      }
      const encoding = String(response.headers["content-encoding"] || "identity").toLowerCase();
      if (encoding !== "identity") {
        response.resume();
        finish(reject, new Error("unsupported_encoding"));
        return;
      }
      let body = "";
      let bytes = 0;
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        bytes += Buffer.byteLength(chunk);
        if (bytes > maxBytes) {
          response.destroy(new Error("response_too_large"));
          return;
        }
        body += chunk;
      });
      response.on("end", () => finish(resolve, body));
      response.on("error", (error) => finish(reject, error));
    });
    req.on("timeout", () => req.destroy(new Error("fetch_timeout")));
    req.on("error", (error) => finish(reject, error));
    totalTimer = setTimeout(() => req.destroy(new Error("fetch_timeout")), remaining);
  });
}

function cleanTitle(value, fallback) {
  const title = String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
  return (title || fallback).slice(0, 120);
}

function isoDateInMadrid(value = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: FOOTBALL_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function addIsoDays(value, amount) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + amount, 12));
  return date.toISOString().slice(0, 10);
}

/* TheSportsDB entrega dateEvent y strTime en UTC (su strTimeLocal, que no
   viene en eventstv.php, confirma el desfase: 19:30 UTC = 21:30 en Madrid).
   Se pintaban tal cual bajo la etiqueta "horario peninsular", asi que TODOS
   los partidos salian 2 h antes en verano y 1 h antes en invierno. Ademas un
   partido a las 22:30 UTC son las 00:30 de Madrid: cambia de dia. */
function madridDateTime(dateEvent, strTime) {
  const day = String(dateEvent || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!day) return null;
  const clock = String(strTime || "").match(/^(\d{1,2}):(\d{2})/);
  const hour = clock ? Number(clock[1]) : NaN;
  const minute = clock ? Number(clock[2]) : NaN;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute > 59) {
    return { date: `${day[1]}-${day[2]}-${day[3]}`, time: "Por confirmar" };
  }
  const utc = new Date(Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]), hour, minute));
  if (Number.isNaN(utc.getTime())) return { date: `${day[1]}-${day[2]}-${day[3]}`, time: "Por confirmar" };
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: FOOTBALL_TIMEZONE,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(utc);
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const hh = get("hour") === "24" ? "00" : get("hour");
  return { date: `${get("year")}-${get("month")}-${get("day")}`, time: `${hh}:${get("minute")}` };
}

function splitFootballEvent(value) {
  const title = cleanTitle(value, "Partido por confirmar");
  const match = title.match(/^(.*?)\s+(?:vs\.?|v)\s+(.*?)$/i);
  return {
    title,
    home: cleanTitle(match?.[1], title),
    away: cleanTitle(match?.[2], ""),
  };
}

function normalizeFootballRows(rows) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const sport = String(row?.strSport || "Soccer").toLowerCase();
    if (!sport.includes("soccer") && !sport.includes("football")) continue;
    const local = madridDateTime(row?.dateEvent, row?.strTime);
    if (!local) continue;
    const { date, time } = local;
    const event = splitFootballEvent(row?.strEvent);
    const rawId = String(row?.idEvent || row?.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80);
    const id = rawId || `${date}-${time}-${event.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 80);
    const key = `${id}|${date}|${time}`;
    let match = grouped.get(key);
    if (!match) {
      match = {
        id,
        date,
        time,
        title: event.title,
        home: event.home,
        away: event.away,
        competition: cleanTitle(row?.strLeague || row?.strCompetition, FOOTBALL_FALLBACK_COMPETITION),
        country: cleanTitle(row?.strCountry, FOOTBALL_COUNTRY),
        channels: [],
      };
      grouped.set(key, match);
    }
    const name = cleanTitle(row?.strChannel, "");
    if (name && !match.channels.some((channel) => channel.name.toLowerCase() === name.toLowerCase())) {
      match.channels.push({
        id: String(row?.idChannel || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80),
        name,
      });
    }
  }
  return [...grouped.values()].sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

function footballDaysFromMatches(startDate, matches) {
  return Array.from({ length: FOOTBALL_DAYS }, (_, index) => {
    const date = addIsoDays(startDate, index);
    return { date, matches: matches.filter((match) => match.date === date) };
  });
}

function buildFootballDemoSchedule(startDate = isoDateInMadrid()) {
  const samples = [
    { offset: 0, time: "20:00", home: "FC Barcelona", away: "Juventus", competition: "Amistoso", channels: ["DAZN"] },
    { offset: 0, time: "20:15", home: "Barcelona SC", away: "Emelec", competition: "Amistoso", channels: ["Zapping"] },
    { offset: 0, time: "22:00", home: "España", away: "Marruecos", competition: "Amistoso", channels: ["La 1 HD"] },
    { offset: 0, time: "18:30", home: "Real Sociedad", away: "Villarreal", competition: "LaLiga", channels: ["DAZN LaLiga"] },
    { offset: 0, time: "21:00", home: "Real Madrid", away: "Manchester City", competition: "Champions League", channels: ["M+ Liga de Campeones"] },
    { offset: 1, time: "19:00", home: "Real Betis", away: "Athletic Club", competition: "LaLiga", channels: ["GOL Play"] },
    { offset: 1, time: "21:30", home: "Barcelona", away: "Atlético de Madrid", competition: "LaLiga", channels: ["DAZN LaLiga 2"] },
    { offset: 2, time: "20:45", home: "Inter", away: "AC Milan", competition: "Champions League", channels: ["M+ Liga de Campeones"] },
    { offset: 2, time: "21:00", home: "España", away: "Portugal", competition: "Nations League", channels: ["La 1 HD"] },
    { offset: 3, time: "18:30", home: "Arsenal", away: "Liverpool", competition: "Premier League", channels: ["DAZN"] },
  ];
  const matches = samples.map((sample, index) => ({
    id: `demo-${index + 1}`,
    date: addIsoDays(startDate, sample.offset),
    time: sample.time,
    title: `${sample.home} vs ${sample.away}`,
    home: sample.home,
    away: sample.away,
    competition: sample.competition,
    country: "España",
    channels: sample.channels.map((name, channelIndex) => ({ id: `demo-channel-${index}-${channelIndex}`, name })),
  }));
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    timezone: FOOTBALL_TIMEZONE,
    country: "España",
    source: "demo",
    attribution: "Datos de muestra",
    demo: true,
    limited: false,
    partial: false,
    days: footballDaysFromMatches(startDate, matches),
  };
}

/* eventstv.php no devuelve strLeague ni strCompetition: el codigo leia esos
   dos campos inexistentes y la competicion quedaba SIEMPRE en "Futbol", lo que
   ademas dejaba mudo el filtro por liga de las preferencias. intDivision no
   sirve como sustituto (99 en Champions, 0 en LaLiga, 2 en Segunda), asi que
   la liga se pide por evento. Es opcional: si falla, se queda en "Futbol". */
const FOOTBALL_LEAGUE_LOOKUP_MAX = 40;
const FOOTBALL_LEAGUE_LOOKUP_BATCH = 5;

async function lookupFootballLeague(idEvent) {
  const url = `https://www.thesportsdb.com/api/v1/json/${FOOTBALL_API_KEY}/lookupevent.php?id=${encodeURIComponent(idEvent)}`;
  const data = JSON.parse(await fetchText(url));
  const event = Array.isArray(data?.events) ? data.events[0] : null;
  return cleanTitle(event?.strLeague, "");
}

async function enrichFootballLeagues(matches, lookup = lookupFootballLeague) {
  const pending = matches
    .filter((match) => match.competition === FOOTBALL_FALLBACK_COMPETITION && /^\d+$/.test(match.id))
    .slice(0, FOOTBALL_LEAGUE_LOOKUP_MAX);
  for (let index = 0; index < pending.length; index += FOOTBALL_LEAGUE_LOOKUP_BATCH) {
    const batch = pending.slice(index, index + FOOTBALL_LEAGUE_LOOKUP_BATCH);
    const settled = await Promise.allSettled(batch.map((match) => lookup(match.id)));
    settled.forEach((result, offset) => {
      if (result.status === "fulfilled" && result.value) batch[offset].competition = result.value;
    });
  }
  return matches;
}

/* ---------- futbolenlatv.com : fuente principal de la agenda ----------
   Es de donde saca su agenda la gente de NEW ERA (se les ve por los escudos,
   que sirven desde static.futbolenlatv.com). Cubre TODOS los operadores y no
   solo la parrilla de Movistar: 649 partidos en 15 dias frente a 33 en 5.
   Cada fila trae microdatos schema.org, asi que la hora sale de startDate en
   ISO y no de raspar texto. Ante cualquier fallo se cae a la EPG de Movistar
   y, si tampoco, a TheSportsDB. */
const FLTV_URL = "https://www.futbolenlatv.com/";
const FLTV_MAX_BYTES = 6 * 1024 * 1024;

const HTML_ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú",
  ntilde: "ñ", Ntilde: "Ñ", uuml: "ü", Uuml: "Ü", ccedil: "ç", Ccedil: "Ç",
};

function decodeHtml(value) {
  return String(value || "")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) => HTML_ENTITIES[name] ?? whole)
    .replace(/\s+/g, " ")
    .trim();
}

/* El documento son bloques planos: cabecera de competicion y luego sus filas.
   Se recorre en orden arrastrando la competicion vigente.
   Ojo con la cabecera: unas competiciones van enlazadas con <a class=
   "internalLink"> y otras aparecen como texto suelto tras el <img>. Lo unico
   comun a ambas es el title del <img>, asi que se ancla ahi; usar el enlace
   solo capturaba 9 de 217 y el resto heredaba la competicion anterior. */
function parseFutbolEnLaTv(html, window) {
  const airings = [];
  let competition = "";
  const blocks = /<tr class="cabeceraCompericion">[\s\S]*?title="([^"]+)"|<td class="hora\s*">\s*([\d:]+)\s*<\/td>([\s\S]*?)<\/tr>/g;
  let block;
  while ((block = blocks.exec(String(html || "")))) {
    if (block[1]) { competition = decodeHtml(block[1]); continue; }
    const row = block[3] || "";
    const startDate = row.match(/itemprop="startDate" content="([^"]+)"/)?.[1];
    if (!startDate) continue;
    // startDate viene en UTC sin sufijo de zona
    const start = Date.parse(`${startDate}Z`);
    if (!Number.isFinite(start)) continue;
    const date = isoDateInMadrid(start);
    if (window && !window.has(date)) continue;

    const home = decodeHtml(row.match(/<td class="local">[\s\S]*?<span title="([^"]*)"/)?.[1]);
    const away = decodeHtml(row.match(/<td class="visitante">[\s\S]*?<span title="([^"]*)"/)?.[1]);
    if (!home || !away) continue;

    /* Los canales llevan el dial pegado: "M+ Liga de Campeones (M60 O115)" e
       incluso "(M56 O120): VER PARTIDO". Se recorta todo desde el parentesis
       para dejar el nombre que casa con las listas M3U. */
    const channels = [...row.matchAll(/<li[^>]*title="([^"]+)"/g)]
      .map((entry) => decodeHtml(entry[1]).replace(/\s*\(.*$/, "").trim())
      .filter(Boolean);

    airings.push({
      start, date, time: madridClock(start),
      home, away, competition: competition || FOOTBALL_FALLBACK_COMPETITION,
      channels: [...new Set(channels)],
    });
  }
  return airings;
}

async function fetchFutbolEnLaTvSchedule() {
  const startDate = isoDateInMadrid();
  const window = new Set(Array.from({ length: FOOTBALL_DAYS }, (_, index) => addIsoDays(startDate, index)));
  const html = await fetchText(FLTV_URL, 0, new Set(), Date.now() + FETCH_TOTAL_TIMEOUT_MS, FLTV_MAX_BYTES);
  const airings = parseFutbolEnLaTv(html, window);
  if (!airings.length) throw new Error("fltv_empty");

  const matches = airings
    .sort((a, b) => a.start - b.start)
    .map((airing, index) => ({
      id: `fltv-${airing.date}-${index}`,
      date: airing.date,
      time: airing.time,
      start: airing.start,
      title: `${airing.home} - ${airing.away}`,
      home: airing.home,
      away: airing.away,
      competition: airing.competition,
      country: "España",
      channels: airing.channels.map((name, position) => ({ id: `fltv-${index}-${position}`, name })),
    }));

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    timezone: FOOTBALL_TIMEZONE,
    country: "España",
    source: "futbolenlatv",
    attribution: "futbolenlatv.com",
    demo: false,
    limited: false,
    partial: false,
    days: footballDaysFromMatches(startDate, matches),
  };
}


/* ================================================================
   MARCADORES EN VIVO - API publica de ESPN
   ----------------------------------------------------------------
   Por que ESPN y no la pagina de resultados de futbolenlatv: medido,
   13 KB por liga frente a 1,19 MB de la pagina entera, y su propio
   Cache-Control declara max-age de 1 a 8 s, o sea que sirve el dato
   practicamente en vivo. No pide clave ni registro.

   La union se hace por hora de saque MAS parecido de nombres. Solo con
   el nombre no basta -"O. Lyonnais" alli es "Lyon" aqui- y solo con la
   hora tampoco, porque a las 21:00 juegan diez equipos a la vez.
   ================================================================ */
const ESPN_BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";
const SCORES_CACHE_MS = 8000;      // lo que declara su propio Cache-Control
const SCORES_FETCH_MS = 6000;      // si una liga tarda mas, se sirve sin ella
const SCORES_MAX_LEAGUES = 8;      // techo por consulta, para no barrer 59 ligas
const SCORES_WINDOW_BEFORE_MS = 15 * 60 * 1000;      // ya interesa un cuarto antes
const SCORES_WINDOW_AFTER_MS = 3.5 * 60 * 60 * 1000; // y hasta bien acabado

/* Competicion tal como la rotula futbolenlatv -> codigo de liga en ESPN.
   Todos comprobados uno por uno contra el endpoint: los que no resolvian
   -uefa.conference, por ejemplo, que alli es uefa.europa.conf- no estan. */
const ESPN_LEAGUES = {
  "la liga ea sports": ["esp.1"],
  "laliga": ["esp.1"],
  "laliga hypermotion": ["esp.2"],
  "copa del rey": ["esp.copa_del_rey"],
  "premier league": ["eng.1"],
  "championship": ["eng.2"],
  "national league": ["eng.5"],
  "serie a italiana": ["ita.1"],
  "serie b italiana": ["ita.2"],
  "bundesliga": ["ger.1"],
  "2. liga": ["ger.2"],
  "copa de alemania": ["ger.dfb_pokal"],
  "francia ligue 1": ["fra.1"],
  "ligue 1": ["fra.1"],
  "eredivisie": ["ned.1"],
  "primeira liga": ["por.1"],
  "mls": ["usa.1"],
  "primera division argentina": ["arg.1"],
  "serie a brasil": ["bra.1"],
  "liga pro ecuador": ["ecu.1"],
  "liga 1 peru": ["per.1"],
  "champions league": ["uefa.champions", "uefa.champions_qual"],
  "europa league": ["uefa.europa", "uefa.europa_qual"],
  "conference league": ["uefa.europa.conf"],
  "liga mx": ["mex.1"],
  "primera a colombia": ["col.1"],
  "primera division uruguay": ["uru.1"],
  "premiership escocesa": ["sco.1"],
  "superliga turca": ["tur.1"],
};

const scoresCache = new Map();     // codigo de liga -> { payload, expiresAt, pending }

function espnLeaguesFor(competition) {
  const key = String(competition || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/\s+/g, " ").trim();
  return ESPN_LEAGUES[key] || null;
}

/* Nombres de equipo: se quitan tildes y las coletillas de club -FC, CF, SC...-
   que cada web pone donde quiere, y se compara por palabras compartidas. */
function teamTokens(value) {
  const flat = String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/\b(fc|cf|sc|ac|cd|ud|sd|afc|if|fk|sk|club|de|del|la|el|los|las)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
  return new Set(flat.split(" ").filter((word) => word.length > 2));
}

/* Los clubes que cada web escribe de forma irreconciliable por palabras:
   "O. Lyonnais" y "Lyon" no comparten ninguna. Solo van aqui los que no
   salen por parecido; el resto -Fenerbahce/Fenerbahce, Atletico de Madrid/
   Atletico Madrid, GNK Dinamo Zagreb/Dinamo Zagreb- ya casan solos. */
const TEAM_ALIASES = {
  lyonnais: "lyon", olympiquelyonnais: "lyon",
  interdemilan: "internazionale", inter: "internazionale",
  bayernmunich: "bayern", munich: "bayern",
  dortmund: "dortmund", borussiadortmund: "dortmund",
  parissaintgermain: "psg",
  oporto: "porto", napoles: "napoli", milan: "milan",
  sportingdeportugal: "sportingcp", sportinglisboa: "sportingcp",
  estrellaroja: "redstar", copenhague: "copenhagen", brujas: "brugge",
  salzburgo: "salzburg", marsella: "marseille", colonia: "koln",
  moenchengladbach: "monchengladbach",
};

function canonicalTeam(value) {
  // futbolenlatv abrevia el primer nombre: "O. Lyonnais", "B. Dortmund".
  // Esa inicial suelta no aporta y estorba al buscar el alias.
  const flat = String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/^[a-z][.][ ]*/, "").replace(/[^a-z0-9]+/g, "");
  return TEAM_ALIASES[flat] || null;
}

function teamSimilarity(a, b) {
  // un alias reconocido zanja la comparacion antes de mirar palabras
  const ca = canonicalTeam(a), cb = canonicalTeam(b);
  if (ca && cb && ca === cb) return 1;
  if (ca && teamTokens(b).has(ca)) return 1;
  if (cb && teamTokens(a).has(cb)) return 1;

  const left = teamTokens(a), right = teamTokens(b);
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const token of left) if (right.has(token)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/* ESPN publica tres rotulos por equipo y no siempre coincide el mismo:
   se prueba con todos y se queda el mejor. */
function bestTeamSimilarity(mine, side) {
  return Math.max(
    teamSimilarity(mine, side.displayName),
    teamSimilarity(mine, side.shortDisplayName),
    teamSimilarity(mine, side.name)
  );
}

/* ESPN indexa por SU fecha, no por la de Madrid: un Velez-Defensa de las
   02:00 peninsulares alli es del dia anterior y sin rango no aparece.
   Comprobado: arg.1 devolvia 0 eventos pidiendo el dia y 4 pidiendo el rango. */
function espnDateRange(now) {
  const stamp = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, "");
  const DIA = 24 * 60 * 60 * 1000;
  return `${stamp(now - DIA)}-${stamp(now + DIA)}`;
}

async function fetchEspnLeague(league, range) {
  const clave = `${league}@${range}`;
  const entry = scoresCache.get(clave);
  if (entry && entry.payload && Date.now() < entry.expiresAt) return entry.payload;
  if (entry && entry.pending) return entry.pending;

  const pending = fetchText(`${ESPN_BASE}/${league}/scoreboard?dates=${range}`, 0, new Set(), Date.now() + SCORES_FETCH_MS, 512 * 1024)
    .then((body) => {
      const events = JSON.parse(body).events || [];
      scoresCache.set(clave, { payload: events, expiresAt: Date.now() + SCORES_CACHE_MS, pending: null });
      return events;
    })
    .catch(() => {
      // una liga caida no puede tumbar el resto del marcador
      const previous = scoresCache.get(clave);
      const kept = (previous && previous.payload) || [];
      scoresCache.set(clave, { payload: kept, expiresAt: Date.now() + SCORES_CACHE_MS, pending: null });
      return kept;
    });

  scoresCache.set(clave, Object.assign({}, entry || {}, { pending }));
  return pending;
}

function readEspnEvent(event) {
  const competition = event && event.competitions && event.competitions[0];
  const competitors = (competition && competition.competitors) || [];
  const home = competitors.find((side) => side.homeAway === "home");
  const away = competitors.find((side) => side.homeAway === "away");
  if (!home || !away) return null;
  const status = event.status || {};
  const type = status.type || {};
  return {
    start: Date.parse(event.date),
    homeTeam: home.team || {},
    awayTeam: away.team || {},
    homeName: (home.team && home.team.displayName) || "",
    awayName: (away.team && away.team.displayName) || "",
    homeScore: Number.parseInt(home.score, 10),
    awayScore: Number.parseInt(away.score, 10),
    state: type.state || "",            // pre | in | post
    clock: status.displayClock || "",
    detail: type.shortDetail || "",
  };
}

/* Un partido de la agenda solo se busca si esta en su ventana: un cuarto de
   hora antes del saque y hasta tres horas y media despues. Fuera de ahi no
   hay marcador que valga y consultar seria gastar por gastar. */
function matchIsInScoreWindow(match, now) {
  if (!match || !Number.isFinite(match.start)) return false;
  return now >= match.start - SCORES_WINDOW_BEFORE_MS && now <= match.start + SCORES_WINDOW_AFTER_MS;
}

const SCORE_MIN_SIMILARITY = 0.5;   // media de los dos equipos
const SCORE_MIN_ANCHOR = 0.6;       // y uno de los dos ha de casar con holgura
const SCORE_MAX_START_DRIFT_MS = 45 * 60 * 1000;

async function getLiveScores() {
  const now = Date.now();
  let schedule;
  try {
    schedule = await getFootballSchedule();
  } catch {
    return { success: false, error: "sin_agenda", scores: {} };
  }

  const candidates = [];
  for (const day of (schedule && schedule.days) || []) {
    for (const match of day.matches || []) {
      if (!matchIsInScoreWindow(match, now)) continue;
      const leagues = espnLeaguesFor(match.competition);
      if (!leagues) continue;
      candidates.push({ match, leagues });
    }
  }
  if (!candidates.length) {
    return { success: true, generatedAt: new Date().toISOString(), source: "espn", leagues: 0, scores: {} };
  }

  const wanted = [...new Set(candidates.flatMap((entry) => entry.leagues))].slice(0, SCORES_MAX_LEAGUES);
  const range = espnDateRange(now);
  const fetched = await Promise.all(wanted.map((league) => fetchEspnLeague(league, range).then((events) => [league, events])));
  const byLeague = new Map(fetched);

  const scores = {};
  for (const { match, leagues } of candidates) {
    let best = null, bestScore = 0;
    for (const league of leagues) {
      for (const event of byLeague.get(league) || []) {
        const parsed = readEspnEvent(event);
        if (!parsed) continue;
        // la hora de saque descarta de golpe a los que juegan otro dia
        if (Math.abs(parsed.start - match.start) > SCORE_MAX_START_DRIFT_MS) continue;
        const local = bestTeamSimilarity(match.home, parsed.homeTeam);
        const visitante = bestTeamSimilarity(match.away, parsed.awayTeam);
        // dos parecidos flojos no valen: al menos uno tiene que ser claro
        if (Math.max(local, visitante) < SCORE_MIN_ANCHOR) continue;
        const similarity = (local + visitante) / 2;
        if (similarity > bestScore) { bestScore = similarity; best = parsed; }
      }
    }
    if (!best || bestScore < SCORE_MIN_SIMILARITY) continue;
    if (!Number.isFinite(best.homeScore) || !Number.isFinite(best.awayScore)) continue;
    scores[match.id] = {
      home: best.homeScore, away: best.awayScore,
      state: best.state, clock: best.clock, detail: best.detail,
      confidence: Number(bestScore.toFixed(2)),
    };
  }

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    source: "espn",
    attribution: "ESPN",
    leagues: wanted.length,
    scores,
  };
}

/* ---------- EPG de Movistar+ : respaldo de la agenda ----------
   TheSportsDB es una wiki mantenida por voluntarios: con la clave publica
   devuelve UN evento por consulta y su techo real es lo que alguien se haya
   molestado en escribir. La EPG del reproductor web de Movistar+ da la
   parrilla de lo que se emite de verdad en España, que es justo lo que esta
   app necesita: el nombre de canal exacto (casa al 100 con las listas M3U),
   la hora peninsular ya resuelta y la competicion de verdad.
   Medido el 22-08-2026: 15 emisiones frente a 1 de TheSportsDB.
   No es una API documentada, asi que ante cualquier fallo se cae a
   TheSportsDB en vez de dejar la agenda en blanco. */
const EPG_BASE = "https://ottcache.dof6.com/movistarplus/webplayer";
const EPG_DEMARCATION = 18;
// acotar los canales evita barrer los 135 del operador en cada refresco
const EPG_SPORT_CHANNEL = /laliga|liga de campeones|deportes|dazn|\bgol\b|eurosport|vamos/i;
const EPG_MAX_DETAILS = 60;
const EPG_BATCH = 5;

async function epgJson(url) {
  const text = await fetchText(url);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("epg_bad_response");
  }
}

function madridClock(value) {
  const date = new Date(Number(value));
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: FOOTBALL_TIMEZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).format(date);
}

function epgTitleKey(value) {
  return String(value || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    // "LIGA DE CAMPEONES --> ELCANO": lo de despues de la flecha es quien lo
    // sirve, no que canal es. Igual los asteriscos con que marcan la calidad.
    .replace(/-->.*$/, " ")
    .replace(/[*#]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}

// "Sevilla - Rayo" -> equipos. Sin ese guion no es un partido identificable.
function epgSplitTeams(value) {
  const parts = String(value || "").split(/\s+[-–—]\s+/);
  if (parts.length !== 2) return null;
  const home = cleanTitle(parts[0], "");
  const away = cleanTitle(parts[1], "");
  return home && away ? { home, away } : null;
}

async function epgFootballChannels() {
  const channels = await epgJson(
    `${EPG_BASE}/OTT/contents/channels?mdrm=true&tlsstream=true&demarcation=${EPG_DEMARCATION}&version=8`
  );
  if (!Array.isArray(channels)) throw new Error("epg_bad_response");
  return channels
    .filter((channel) => EPG_SPORT_CHANNEL.test(channel?.Nombre || ""))
    .map((channel) => ({ id: String(channel?.CodCadenaTv || ""), name: cleanTitle(channel?.Nombre, "") }))
    .filter((channel) => channel.id && channel.name);
}

async function epgChannelGrid(channel, from, span) {
  const rows = await epgJson(
    `${EPG_BASE}/OTT/epg?from=${from}T00:00:00&span=${span}&channel=${encodeURIComponent(channel.id)}` +
    `&version=8&mdrm=true&tlsstream=true&demarcation=${EPG_DEMARCATION}`
  );
  return Array.isArray(rows) ? rows : [];
}

// la rejilla solo trae titulos genericos ("LALIGA EA SPORTS"); los equipos y
// la competicion estan en la ficha, a una peticion por emision
async function epgAiringDetails(airing) {
  const id = String(airing?.row?.Ficha || "").match(/contents\/(\d+)\/details/)?.[1];
  if (!id) return null;
  const data = await epgJson(
    `${EPG_BASE}/contents/${id}/details?mediaType=FOTOV&profile=OTT&mode=VODREJILLA` +
    `&channels=${encodeURIComponent(airing.channel.id)}&version=8&tlsStream=true&mdrm=true` +
    `&catalog=events&showNonRated=true`
  );
  return {
    teams: cleanTitle(data?.TituloEpisodio, ""),
    competition: cleanTitle(data?.Contenedor?.TituloSerie, ""),
  };
}

/* Agrupa emisiones en partidos. Un mismo partido sale en varias cadenas (el
   Fluminense-Remo iba por M+ Vamos y por M+ Liga de Campeones a la vez), asi
   que se unifican por dia+titulo y se conserva la hora mas temprana. */
function normalizeEpgAirings(airings) {
  const grouped = new Map();
  for (const airing of airings) {
    const teams = epgSplitTeams(airing.detail?.teams);
    const title = cleanTitle(airing.detail?.teams, "") || cleanTitle(airing.row?.Titulo, "Partido por confirmar");
    const key = `${airing.date}|${epgTitleKey(title)}`;
    let match = grouped.get(key);
    if (!match) {
      match = {
        id: `epg-${airing.row?.ShowId || airing.row?.CodEventoRejilla || epgTitleKey(key)}`.slice(0, 80),
        date: airing.date,
        time: airing.time,
        title,
        home: teams?.home || title,
        away: teams?.away || "",
        competition: cleanTitle(airing.detail?.competition, "")
          || cleanTitle(airing.row?.Titulo, FOOTBALL_FALLBACK_COMPETITION),
        country: "España",
        channels: [],
        start: airing.start,
      };
      grouped.set(key, match);
    }
    if (airing.start < match.start) {
      match.start = airing.start;
      match.time = airing.time;
    }
    const name = airing.channel?.name || "";
    if (name && !match.channels.some((channel) => channel.name.toLowerCase() === name.toLowerCase())) {
      match.channels.push({ id: airing.channel.id, name });
    }
  }
  return [...grouped.values()]
    .map(({ start, ...match }) => match)
    .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
}

async function fetchEpgFootballSchedule() {
  const startDate = isoDateInMadrid();
  const window = new Set(Array.from({ length: FOOTBALL_DAYS }, (_, index) => addIsoDays(startDate, index)));
  const channels = await epgFootballChannels();
  if (!channels.length) throw new Error("epg_unavailable");

  // span cubre toda la ventana: una sola peticion de rejilla por canal
  const grids = [];
  for (let index = 0; index < channels.length; index += EPG_BATCH) {
    const batch = channels.slice(index, index + EPG_BATCH);
    const settled = await Promise.allSettled(batch.map((channel) => epgChannelGrid(channel, startDate, FOOTBALL_DAYS)));
    settled.forEach((result, offset) => {
      if (result.status === "fulfilled") grids.push({ channel: batch[offset], rows: result.value });
    });
  }
  if (!grids.length) throw new Error("epg_unavailable");

  const airings = [];
  for (const { channel, rows } of grids) {
    for (const row of rows) {
      if (row?.Directo !== true) continue;
      if (!/f[úu]tbol/i.test(row?.GeneroComAntena || "")) continue;
      const start = Number(row?.FechaHoraInicio);
      if (!Number.isFinite(start)) continue;
      const date = isoDateInMadrid(start);
      if (!window.has(date)) continue;
      airings.push({ channel, row, date, start, time: madridClock(start) });
    }
  }
  if (!airings.length) throw new Error("epg_empty");

  airings.sort((a, b) => a.start - b.start);
  const detailed = airings.slice(0, EPG_MAX_DETAILS);
  for (let index = 0; index < detailed.length; index += EPG_BATCH) {
    const batch = detailed.slice(index, index + EPG_BATCH);
    const settled = await Promise.allSettled(batch.map((airing) => epgAiringDetails(airing)));
    settled.forEach((result, offset) => {
      if (result.status === "fulfilled" && result.value) batch[offset].detail = result.value;
    });
  }

  return {
    success: true,
    generatedAt: new Date().toISOString(),
    timezone: FOOTBALL_TIMEZONE,
    country: "España",
    source: "movistarplus",
    attribution: "EPG de Movistar Plus+",
    demo: false,
    limited: false,
    partial: grids.length !== channels.length || airings.length > detailed.length,
    days: footballDaysFromMatches(startDate, normalizeEpgAirings(airings)),
  };
}

async function fetchFootballSchedule() {
  const startDate = isoDateInMadrid();
  /* Madrid va por delante de UTC, asi que un partido de madrugada aparece en
     el dia UTC anterior. Se pide un dia extra por detras para no perderlo;
     footballDaysFromMatches descarta luego lo que cae fuera de la ventana. */
  const dates = Array.from({ length: FOOTBALL_DAYS + 1 }, (_, index) => addIsoDays(startDate, index - 1));
  const settled = await Promise.allSettled(dates.map(async (date) => {
    const params = new URLSearchParams({ d: date, s: "Soccer", a: FOOTBALL_COUNTRY });
    const url = `https://www.thesportsdb.com/api/v1/json/${FOOTBALL_API_KEY}/eventstv.php?${params}`;
    const text = await fetchText(url);
    let data;
    try { data = JSON.parse(text); }
    catch { throw new Error("football_unavailable"); }
    return Array.isArray(data?.tvevents) ? data.tvevents : [];
  }));
  const successful = settled.filter((result) => result.status === "fulfilled");
  if (!successful.length) {
    const error = new Error("football_unavailable");
    error.statusCode = 502;
    throw error;
  }
  const rows = successful.flatMap((result) => result.value);
  const matches = await enrichFootballLeagues(normalizeFootballRows(rows));
  return {
    success: true,
    generatedAt: new Date().toISOString(),
    timezone: FOOTBALL_TIMEZONE,
    country: "España",
    source: "thesportsdb",
    attribution: "TheSportsDB",
    demo: false,
    limited: FOOTBALL_API_KEY === "123",
    partial: successful.length !== dates.length,
    days: footballDaysFromMatches(startDate, matches),
  };
}

function footballScheduleMatches(payload) {
  return (Array.isArray(payload?.days) ? payload.days : [])
    .flatMap((day) => Array.isArray(day?.matches) ? day.matches : []);
}

function footballProgramChannelNames(payload) {
  const output = [];
  const seen = new Set();
  for (const match of footballScheduleMatches(payload)) {
    for (const channel of Array.isArray(match?.channels) ? match.channels : []) {
      const name = cleanTitle(channel?.name ?? channel, "");
      const key = normalizeChannelKey(name);
      if (!name || !key || seen.has(key)) continue;
      seen.add(key);
      output.push(name);
    }
  }
  return output;
}

const SOURCE_REPORT_REASONS = new Set([
  "not_starting", "stuttering", "wrong_channel", "bad_quality", "audio",
]);

function validIso(value, fallback = null) {
  return typeof value === "string" && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString() : fallback;
}

function normalizeSourceReport(value) {
  const id = normalizeHash(value?.id);
  if (!id) return null;
  const reason = SOURCE_REPORT_REASONS.has(value?.reason) ? value.reason : "not_starting";
  const channel = cleanTitle(value?.channel, "");
  const channelKey = normalizeChannelKey(value?.channelKey || channel);
  const reportedAt = validIso(value?.reportedAt, new Date().toISOString());
  const state = ["reported", "checking", "working", "weak", "failed"].includes(value?.state)
    ? value.state : "reported";
  return {
    reportId: String(value?.reportId || crypto.randomBytes(8).toString("hex"))
      .trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40),
    id,
    title: cleanTitle(value?.title, `Stream ${id.slice(0, 8)}`),
    ih: value?.ih === true,
    source: cleanTitle(value?.source, "").slice(0, 30),
    channel,
    channelKey,
    matchId: String(value?.matchId || "").trim().replace(/[^a-zA-Z0-9_.:-]/g, "").slice(0, 100),
    reason,
    state,
    checkReason: String(value?.checkReason || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40),
    reportCount: Math.min(999, Math.max(1, Number.parseInt(value?.reportCount, 10) || 1)),
    reportedAt,
    lastCheckedAt: validIso(value?.lastCheckedAt),
    quarantineUntil: validIso(value?.quarantineUntil),
  };
}

function normalizeSourceReports(values) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const report = normalizeSourceReport(raw);
    if (!report) continue;
    const key = `${report.id}:${report.channelKey}:${report.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(report);
    if (output.length >= MAX_SOURCE_REPORTS) break;
  }
  return output;
}

function normalizeChannelFeedback(value) {
  const id = normalizeHash(value?.id);
  const channel = cleanTitle(value?.channel, "");
  const channelKey = normalizeChannelKey(value?.channelKey || channel);
  const verdict = value?.verdict === "correct" ? "correct"
    : value?.verdict === "incorrect" ? "incorrect" : "";
  if (!id || !channelKey || !verdict) return null;
  return {
    id,
    title: cleanTitle(value?.title, `Stream ${id.slice(0, 8)}`),
    channel: channel || cleanTitle(value?.channelKey, "Canal"),
    channelKey,
    verdict,
    reason: SOURCE_REPORT_REASONS.has(value?.reason) ? value.reason : "wrong_channel",
    corrections: Math.min(999, Math.max(1, Number.parseInt(value?.corrections, 10) || 1)),
    updatedAt: validIso(value?.updatedAt, new Date().toISOString()),
  };
}

function normalizeChannelFeedbacks(values) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : []) {
    const feedback = normalizeChannelFeedback(raw);
    if (!feedback) continue;
    const key = `${feedback.id}:${feedback.channelKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(feedback);
    if (output.length >= MAX_CHANNEL_FEEDBACK) break;
  }
  return output;
}

function semanticLibraryTexts(state) {
  const values = [];
  const directory = Array.isArray(state?.webSources)
    ? state.webSources.flatMap((source) => Array.isArray(source.streams) ? source.streams : [])
    : (Array.isArray(state?.web) ? state.web : []);
  for (const item of [...directory, ...(state?.favorites || []), ...(state?.history || [])]) {
    values.push(semanticChannelText(item?.title));
    if (item?.alias) values.push(semanticChannelText(item.alias));
  }
  return values.filter(Boolean);
}

/* La agenda completa se guarda como catalogo local y se calienta en segundo
   plano junto con la biblioteca. Cuando se pulsa "ver canal", la IA ya conoce
   que canales estan programados y normalmente no tiene que cargar el modelo
   desde cero. Ningun nombre, equipo ni preferencia sale del NAS. */
function rememberFootballProgramming(payload) {
  const matches = footballScheduleMatches(payload);
  const channels = footballProgramChannelNames(payload);
  footballProgramming.channels = channels;
  footballProgramming.matches = new Map(matches.map((match) => [String(match.id || ""), {
    id: String(match.id || ""),
    title: cleanTitle(match.title, "Partido"),
    home: cleanTitle(match.home, ""),
    away: cleanTitle(match.away, ""),
    competition: cleanTitle(match.competition, FOOTBALL_FALLBACK_COMPETITION),
    date: cleanTitle(match.date, ""),
    time: cleanTitle(match.time, ""),
    start: Number(match.start) || null,
    channels: (Array.isArray(match.channels) ? match.channels : [])
      .map((channel) => cleanTitle(channel?.name ?? channel, "")).filter(Boolean),
  }]));

  if (!ollamaConfigured() || !channels.length) return;
  let library = [];
  try { library = semanticLibraryTexts(readState()); } catch {}
  const texts = [...channels.map(semanticChannelText), ...library].filter(Boolean);
  const signature = crypto.createHash("sha256").update(texts.join("\n")).digest("hex");
  if (signature === footballProgramming.signature || footballProgramming.warmPending) return;
  footballProgramming.warmPending = semanticEmbeddingMap(texts)
    .then(() => { footballProgramming.signature = signature; })
    .catch((error) => {
      footballProgramming.signature = "";
      console.error(`[ia-programacion] no se pudo preparar el indice: ${error.message}`);
    })
    .finally(() => { footballProgramming.warmPending = null; });
}

function footballProgramMatch(id) {
  return footballProgramming.matches.get(String(id || "")) || null;
}

async function getFootballSchedule() {
  if (FOOTBALL_DEMO_ONLY) {
    const payload = buildFootballDemoSchedule();
    rememberFootballProgramming(payload);
    return payload;
  }
  if (footballCache.payload && Date.now() < footballCache.expiresAt) return footballCache.payload;
  if (footballCache.pending) return footballCache.pending;
  /* Cadena de respaldo, de mas a menos completa. Ninguna de las dos primeras
     es una API con contrato, asi que cada una cubre el fallo de la anterior y
     TheSportsDB queda de ultimo recurso para no dejar la agenda en blanco. */
  footballCache.pending = fetchFutbolEnLaTvSchedule()
    .catch(() => fetchEpgFootballSchedule())
    .catch(() => fetchFootballSchedule())
    .then((payload) => {
      footballCache.payload = payload;
      footballCache.expiresAt = Date.now() + FOOTBALL_CACHE_MS;
      rememberFootballProgramming(payload);
      return payload;
    })
    .catch((error) => {
      if (footballCache.payload) return { ...footballCache.payload, stale: true };
      throw error;
    })
    .finally(() => { footballCache.pending = null; });
  return footballCache.pending;
}

function parseM3u(text) {
  const streams = [];
  let currentTitle = "";
  let currentAlias = "";
  let currentCategory = "Importado";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const categoryMatch = line.match(/group-title="([^"]+)"/i);
      currentCategory = cleanTitle(categoryMatch?.[1], "Importado");
      /* El nombre visible de algunas listas lleva coletilla del proveedor
         ("DAZN 1 --> NEW ERA"), que al emparejar cuenta como palabra propia y
         hunde la puntuacion. El tvg-id es el nombre canonico del canal
         ("DAZN 1 HD"), asi que se guarda como alias para poder puntuar contra
         los dos y quedarse con el mejor. */
      currentAlias = cleanTitle(line.match(/tvg-id="([^"]*)"/i)?.[1], "");
      currentTitle = cleanTitle(line.split(",").slice(1).join(","), "Stream M3U");
      continue;
    }
    const id = normalizeHash(line);
    if (id) {
      streams.push({
        id,
        title: currentTitle || `Stream ${id.slice(0, 8)}`,
        alias: currentAlias,
        type: "web",
        category: currentCategory || "Importado",
      });
      currentTitle = "";
      currentAlias = "";
    }
  }
  return streams;
}

function parseHtml(text) {
  const streams = [];
  const seen = new Set();
  const linkRe = /<a\b[^>]*href=["']([^"']*(?:acestream:\/\/|[?&](?:id|content_id)=)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = linkRe.exec(text))) {
    const id = normalizeHash(match[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    streams.push({
      id,
      title: cleanTitle(match[2], `Stream ${id.slice(0, 8)}`),
      type: "web",
      category: "Importado",
    });
  }

  const bareRe = /acestream:\/\/([a-fA-F0-9]{40})/gi;
  while ((match = bareRe.exec(text))) {
    const id = normalizeHash(match[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    streams.push({ id, title: `Stream ${id.slice(0, 8)}`, type: "web", category: "Importado" });
  }
  return streams;
}

function aceRequest(pathname, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: ACESTREAM_HOST,
      port: 6878,
      path: pathname,
      timeout: timeoutMs,
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ statusCode: response.statusCode, body }));
    });
    req.on("timeout", () => req.destroy(new Error("ace_timeout")));
    req.on("error", reject);
  });
}

/* ---------- segundo motor: comprobacion silenciosa de fuentes ----------
   El motor principal queda reservado para el video que ve el usuario. Este
   segundo motor vive solo en la red interna de Docker y abre cada candidato
   el tiempo justo para comprobar que entrega bytes reales. No basta con que
   /search diga que hay disponibilidad: un hash puede tener pares y no llegar
   a producir una señal reproducible. */
function scannerEnabled() {
  return Boolean(ACESTREAM_SCANNER_HOST);
}

function scannerEnginePath(value) {
  const raw = String(value || "").trim();
  if (!raw || raw.length > 4096) return "";
  try {
    const parsed = new URL(raw, `http://scanner:${ACESTREAM_SCANNER_PORT}`);
    if (!parsed.pathname.startsWith("/ace/") && !parsed.pathname.startsWith("/content/")) return "";
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return "";
  }
}

function scannerStopPath(value) {
  const pathname = scannerEnginePath(value);
  if (!pathname) return "";
  const parsed = new URL(pathname, "http://scanner");
  parsed.searchParams.set("method", "stop");
  return `${parsed.pathname}${parsed.search}`;
}

async function scannerRequest(pathname, timeoutMs = 5000) {
  if (!scannerEnabled()) throw new Error("scanner_unavailable");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    /* AceStream no crea la misma sesion con el http.get desnudo de Node que
       con una peticion HTTP normal: devuelve URLs validas, pero el playback se
       queda sin bytes aunque el mismo hash ya este descargando. fetch aporta
       las cabeceras y semantica de conexion que espera el motor. Comprobado en
       un motor independiente: el falso negativo paso de 0 bytes/18 s a
       148944 bytes/681 ms, con pares y descarga creciente. */
    const response = await fetch(
      `http://${ACESTREAM_SCANNER_HOST}:${ACESTREAM_SCANNER_PORT}${pathname}`,
      { signal: controller.signal },
    );
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let body = "";
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 512 * 1024) {
          await reader.cancel().catch(() => {});
          throw new Error("scanner_response_too_large");
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    }
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } catch (error) {
    if (controller.signal.aborted) throw new Error("scanner_timeout");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function sampleScannerStream(pathname, timeoutMs = SCANNER_PROBE_TIMEOUT_MS, minBytes = SCANNER_SAMPLE_BYTES) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let request;
    let response;
    let bytes = 0;
    let done = false;
    let statusCode = 0;
    let contentType = "";
    const finish = (reason) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { response?.destroy(); } catch {}
      try { request?.destroy(); } catch {}
      resolve({ bytes, statusCode, contentType, reason, durationMs: Date.now() - startedAt });
    };
    const timer = setTimeout(() => finish("timeout"), timeoutMs);
    if (!scannerEnabled()) return finish("scanner_unavailable");
    const open = (target, redirects = 0) => {
      request = http.get({
        hostname: ACESTREAM_SCANNER_HOST,
        port: ACESTREAM_SCANNER_PORT,
        path: target,
        headers: { Accept: "video/mp2t,application/octet-stream,*/*" },
      }, (incoming) => {
        response = incoming;
        statusCode = Number(incoming.statusCode) || 0;
        const redirect = statusCode >= 300 && statusCode < 400
          ? scannerEnginePath(incoming.headers.location)
          : "";
        if (redirect && redirects < 3) {
          incoming.resume();
          incoming.on("end", () => { if (!done) open(redirect, redirects + 1); });
          return;
        }
        contentType = String(incoming.headers["content-type"] || "").slice(0, 100);
        incoming.on("data", (chunk) => {
          bytes += chunk.length;
          if (bytes >= minBytes) finish("enough_data");
        });
        incoming.on("end", () => finish("ended"));
        incoming.on("error", () => finish("stream_error"));
      });
      request.on("error", () => finish("request_error"));
    };
    open(pathname);
  });
}

/* Recibir bytes solo demuestra que el swarm responde. Para poner el punto
   verde necesitamos que esos bytes contengan una pista de video que el player
   web pueda decodificar. ffprobe consume la MISMA sesion del segundo motor,
   identifica el codec y termina; el finally de probeAceCandidate la detiene. */
function inspectScannerMedia(pathname, timeoutMs = SCANNER_MEDIA_PROBE_MS) {
  const target = scannerEnginePath(pathname);
  if (!target || !scannerEnabled()) {
    return Promise.resolve({ mediaValid: false, browserCompatible: false, videoCodec: "", audioCodecs: [], mediaReason: "probe_unavailable" });
  }
  const url = `http://${ACESTREAM_SCANNER_HOST}:${ACESTREAM_SCANNER_PORT}${target}`;
  return new Promise((resolve) => {
    let child;
    let timer;
    let stdout = "";
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { if (child && child.exitCode === null) child.kill("SIGKILL"); } catch {}
      resolve(value);
    };
    try {
      child = spawn("ffprobe", [
        "-v", "error",
        "-probesize", "524288",
        "-analyzeduration", "5000000",
        "-show_entries", "stream=codec_type,codec_name",
        "-of", "json",
        url,
      ], { stdio: ["ignore", "pipe", "ignore"] });
    } catch {
      finish({ mediaValid: false, browserCompatible: false, videoCodec: "", audioCodecs: [], mediaReason: "probe_unavailable" });
      return;
    }
    timer = setTimeout(() => finish({
      mediaValid: false, browserCompatible: false, videoCodec: "", audioCodecs: [], mediaReason: "probe_timeout",
    }), Math.max(1000, timeoutMs));
    child.stdout.on("data", (chunk) => {
      if (stdout.length < 64 * 1024) stdout += chunk.toString("utf8");
    });
    child.on("error", (error) => finish({
      mediaValid: false,
      browserCompatible: false,
      videoCodec: "",
      audioCodecs: [],
      mediaReason: error?.code === "ENOENT" ? "probe_unavailable" : "probe_error",
    }));
    child.on("close", () => {
      let streams = [];
      try {
        const parsed = JSON.parse(stdout || "{}");
        streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
      } catch {}
      const video = streams.find((stream) => stream?.codec_type === "video");
      const videoCodec = String(video?.codec_name || "").toLowerCase().slice(0, 24);
      const audioCodecs = [...new Set(streams
        .filter((stream) => stream?.codec_type === "audio")
        .map((stream) => String(stream?.codec_name || "").toLowerCase().slice(0, 24))
        .filter(Boolean))].slice(0, 8);
      const mediaValid = Boolean(videoCodec);
      /* mpegts.js, nuestro camino principal en escritorio, garantiza H.264.
         HEVC depende del equipo/navegador y no puede anunciarse como verde. */
      const browserCompatible = videoCodec === "h264";
      finish({
        mediaValid,
        browserCompatible,
        videoCodec,
        audioCodecs,
        mediaReason: !mediaValid ? "no_video" : browserCompatible ? "playable_media" : "unsupported_codec",
      });
    });
  });
}

function parseScannerStats(body) {
  try {
    const parsed = typeof body === "string" ? JSON.parse(body) : body;
    const stats = parsed?.response || parsed || {};
    return {
      peers: Math.max(0, Number(stats.peers) || 0),
      speedDown: Math.max(0, Number(stats.speed_down) || 0),
      downloaded: Math.max(0, Number(stats.downloaded) || 0),
      status: String(stats.status || "").slice(0, 32),
    };
  } catch {
    return { peers: 0, speedDown: 0, downloaded: 0, status: "" };
  }
}

function classifyScannerEvidence(evidence, minBytes = SCANNER_SAMPLE_BYTES) {
  const bytes = Math.max(0, Number(evidence?.bytes) || 0);
  const statusCode = Number(evidence?.statusCode) || 0;
  const peers = Math.max(0, Number(evidence?.peers) || 0);
  const speedDown = Math.max(0, Number(evidence?.speedDown) || 0);
  const downloadedDelta = Math.max(0, Number(evidence?.downloadedDelta) || 0);
  const contentType = String(evidence?.contentType || "").toLowerCase();
  const obviousErrorBody = contentType.includes("application/json") || contentType.includes("text/html");
  const mediaResponse = statusCode >= 200 && statusCode < 300 && !obviousErrorBody;
  const enoughTransport = mediaResponse && (bytes >= 16 * 1024 || downloadedDelta >= 16 * 1024 || (peers > 0 && speedDown > 0));
  if (!mediaResponse) return { state: "failed", reason: evidence?.reason === "timeout" ? "timeout" : "no_media" };
  if (evidence?.mediaReason === "probe_unavailable" && enoughTransport) {
    return { state: "weak", reason: "unverified_media" };
  }
  if (evidence?.mediaValid !== true) {
    return { state: "failed", reason: String(evidence?.mediaReason || "no_video") };
  }
  if (evidence?.browserCompatible !== true) return { state: "failed", reason: "unsupported_codec" };
  if (bytes >= minBytes) return { state: "working", reason: "playable_media" };
  if (enoughTransport) {
    return { state: "weak", reason: "slow_data" };
  }
  return { state: "failed", reason: evidence?.reason === "timeout" ? "timeout" : "no_media" };
}

async function probeAceCandidate(candidate, options = {}) {
  const id = normalizeHash(candidate?.id);
  if (!id) throw new Error("bad_request");
  const request = options.request || scannerRequest;
  const sample = options.sample || sampleScannerStream;
  const inspect = options.inspect || inspectScannerMedia;
  const timeoutMs = Math.min(30000, Math.max(1000, Number(options.timeoutMs) || SCANNER_PROBE_TIMEOUT_MS));
  const minBytes = Math.max(1024, Number(options.minBytes) || SCANNER_SAMPLE_BYTES);
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const idParam = candidate.ih === true ? "infohash" : "id";
  let commandPath = "";
  let initialStats = { peers: 0, speedDown: 0, downloaded: 0, status: "" };
  let finalStats = initialStats;
  try {
    const metaPath = `/ace/getstream?${idParam}=${encodeURIComponent(id)}&format=json`;
    const metaResult = await request(metaPath, Math.max(1000, Math.min(8000, deadline - Date.now())));
    if (metaResult.statusCode < 200 || metaResult.statusCode >= 300) throw new Error("scanner_session_failed");
    let meta;
    try { meta = JSON.parse(metaResult.body)?.response || {}; }
    catch { throw new Error("scanner_bad_response"); }
    const playbackPath = scannerEnginePath(meta.playback_url);
    const statPath = scannerEnginePath(meta.stat_url);
    commandPath = scannerStopPath(meta.command_url);
    if (!playbackPath) throw new Error("scanner_bad_response");

    if (statPath && deadline - Date.now() > 1800) {
      try {
        const before = await request(statPath, Math.min(1500, deadline - Date.now()));
        if (before.statusCode >= 200 && before.statusCode < 300) initialStats = parseScannerStats(before.body);
      } catch {}
    }

    const remaining = Math.max(1000, deadline - Date.now());
    const sampleBudget = Math.max(1000, Math.min(8000, remaining - 2500));
    const sampled = await sample(playbackPath, sampleBudget, minBytes);
    let media = { mediaValid: false, browserCompatible: false, videoCodec: "", audioCodecs: [], mediaReason: "no_media" };
    if (sampled.statusCode >= 200 && sampled.statusCode < 300 && sampled.bytes >= 16 * 1024) {
      const probeBudget = Math.max(1000, Math.min(SCANNER_MEDIA_PROBE_MS, deadline - Date.now()));
      media = await inspect(playbackPath, probeBudget);
    }

    if (statPath) {
      try {
        const after = await request(statPath, 1500);
        if (after.statusCode >= 200 && after.statusCode < 300) finalStats = parseScannerStats(after.body);
      } catch {}
    }
    const downloadedDelta = Math.max(0, finalStats.downloaded - initialStats.downloaded);
    const classification = classifyScannerEvidence({ ...sampled, ...finalStats, downloadedDelta, ...media }, minBytes);
    return {
      ...classification,
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      bytes: sampled.bytes,
      peers: finalStats.peers,
      speedDown: finalStats.speedDown,
      downloadedDelta,
      mediaValid: media.mediaValid === true,
      browserCompatible: media.browserCompatible === true,
      videoCodec: media.videoCodec || "",
      audioCodecs: media.audioCodecs || [],
    };
  } catch (error) {
    return {
      state: "failed",
      reason: error.message === "scanner_timeout" ? "timeout" : "engine_error",
      checkedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAt,
      bytes: 0,
      peers: 0,
      speedDown: 0,
      downloadedDelta: 0,
      mediaValid: false,
      browserCompatible: false,
      videoCodec: "",
      audioCodecs: [],
    };
  } finally {
    if (commandPath) {
      try { await request(commandPath, 2500); } catch {}
    }
  }
}

function scannerCacheHit(id, now = Date.now()) {
  const cached = scannerCache.get(id);
  if (!cached) return null;
  const ttl = cached.state === "failed" ? SCANNER_BAD_TTL_MS : SCANNER_GOOD_TTL_MS;
  if (now - cached.cachedAt > ttl) {
    scannerCache.delete(id);
    return null;
  }
  return cached;
}

function pruneScannerState(now = Date.now()) {
  for (const [id, job] of scannerJobs) {
    if (now - job.updatedAt <= SCANNER_JOB_TTL_MS) continue;
    if (job.retryTimer) clearTimeout(job.retryTimer);
    scannerJobs.delete(id);
    if (job.clientKey && scannerClients.get(job.clientKey) === id) scannerClients.delete(job.clientKey);
  }
  for (const [id, cached] of scannerCache) {
    const ttl = cached.state === "failed" ? SCANNER_BAD_TTL_MS : SCANNER_GOOD_TTL_MS;
    if (now - cached.cachedAt > ttl) scannerCache.delete(id);
  }
}

function scannerJobPayload(job) {
  const candidates = job.candidates.map((item) => ({
    id: item.id,
    state: item.state === "retry_wait" ? "failed" : item.state,
    checkedAt: item.checkedAt || null,
    retryAt: item.retryAt ? new Date(item.retryAt).toISOString() : null,
    durationMs: item.durationMs || 0,
    bytes: item.bytes || 0,
    peers: item.peers || 0,
    speedDown: item.speedDown || 0,
    reason: item.reason || "",
    mediaValid: item.mediaValid === true,
    browserCompatible: item.browserCompatible === true,
    videoCodec: item.videoCodec || "",
    audioCodecs: Array.isArray(item.audioCodecs) ? item.audioCodecs : [],
    cached: item.cached === true,
    attempts: item.attempts || 0,
  }));
  const checked = candidates.filter((item) => ["working", "weak", "failed"].includes(item.state)).length;
  const playable = candidates.filter((item) => ["working", "weak"].includes(item.state)).length;
  const retryAt = candidates.map((item) => Date.parse(item.retryAt || ""))
    .filter((value) => Number.isFinite(value) && value > Date.now())
    .sort((a, b) => a - b)[0] || 0;
  return {
    success: true,
    id: job.id,
    kind: job.kind || "interactive",
    status: job.status,
    createdAt: new Date(job.createdAt).toISOString(),
    updatedAt: new Date(job.updatedAt).toISOString(),
    total: candidates.length,
    checked,
    playable,
    failed: candidates.filter((item) => item.state === "failed").length,
    waiting: candidates.filter((item) => item.retryAt).length,
    retryAt: retryAt ? new Date(retryAt).toISOString() : null,
    initialCount: Math.min(SCANNER_INITIAL_SOURCES, candidates.length),
    candidates,
  };
}

function enqueueScannerJob(job, priority = job?.priority === true) {
  if (!job || job.enqueued || job.status === "cancelled" || job.status === "complete") return;
  if (!job.candidates.some((item) => item.state === "queued")) return;
  job.enqueued = true;
  if (priority) scannerQueue.unshift(job.id);
  else scannerQueue.push(job.id);
  setImmediate(drainScannerQueue);
}

function completeScannerJob(job) {
  if (job.retryTimer) clearTimeout(job.retryTimer);
  job.retryTimer = null;
  job.status = "complete";
  job.updatedAt = Date.now();
  updatePreheatFromScanner(job);
}

function scannerRetryPlan(result, attempts, now = Date.now(), delayMs = SCANNER_RETRY_DELAY_MS) {
  if (result?.state !== "failed" || attempts >= 2 || result?.reason === "unsupported_codec") return null;
  return {
    state: "retry_wait",
    reason: String(result?.reason || "failed"),
    retryAt: now + Math.max(1000, Number(delayMs) || SCANNER_RETRY_DELAY_MS),
  };
}

function scheduleScannerRetry(job) {
  if (!job || job.status === "cancelled" || job.status === "complete") return false;
  const waiting = job.candidates.filter((item) => item.state === "retry_wait" && Number(item.retryAt) > 0);
  if (!waiting.length) return false;
  const nextAt = Math.min(...waiting.map((item) => Number(item.retryAt)));
  if (job.retryTimer) clearTimeout(job.retryTimer);
  job.status = "waiting";
  job.retryTimer = setTimeout(() => {
    job.retryTimer = null;
    if (job.status === "cancelled" || job.status === "complete") return;
    const now = Date.now();
    for (const candidate of job.candidates) {
      if (candidate.state !== "retry_wait" || Number(candidate.retryAt) > now) continue;
      candidate.state = "queued";
      candidate.reason = "delayed_retry";
      candidate.retryAt = 0;
      candidate.force = true;
    }
    job.updatedAt = now;
    job.status = "queued";
    enqueueScannerJob(job, job.priority);
    if (!job.enqueued) scheduleScannerRetry(job);
  }, Math.max(0, nextAt - Date.now()));
  job.retryTimer.unref?.();
  return true;
}

async function drainScannerQueue() {
  if (scannerBusy) return;
  scannerBusy = true;
  try {
    while (scannerQueue.length) {
      const job = scannerJobs.get(scannerQueue.shift());
      if (!job) continue;
      job.enqueued = false;
      if (job.status === "cancelled") continue;
      /* Primero se da una oportunidad a TODAS. Una fuente fallida desaparece
         del selector y su segunda oportunidad queda aplazada: repetirla unos
         segundos despues solo bloqueaba el motor sin aportar informacion. */
      const candidate = job.candidates.find((item) => item.state === "queued");
      if (!candidate) {
        if (scheduleScannerRetry(job)) continue;
        completeScannerJob(job);
        continue;
      }

      const cached = candidate.force === true ? null : scannerCacheHit(candidate.id);
      if (cached) {
        Object.assign(candidate, cached, { cached: true });
      } else {
        candidate.state = "checking";
        job.status = "running";
        job.updatedAt = Date.now();
        const result = await probeAceCandidate(candidate);
        candidate.attempts = (candidate.attempts || 0) + 1;
        Object.assign(candidate, result, { cached: false });
        const retry = scannerRetryPlan(result, candidate.attempts);
        if (retry) {
          Object.assign(candidate, retry);
          scannerCache.set(candidate.id, { ...result, cachedAt: Date.now() });
        } else {
          candidate.retryAt = 0;
          scannerCache.set(candidate.id, { ...result, cachedAt: Date.now() });
          updateReportFromProbe(job, candidate);
        }
      }
      job.updatedAt = Date.now();
      if (job.status === "cancelled") continue;
      if (job.candidates.some((item) => item.state === "queued")) enqueueScannerJob(job);
      else if (scheduleScannerRetry(job)) continue;
      else completeScannerJob(job);
    }
  } finally {
    scannerBusy = false;
    if (scannerQueue.length) setImmediate(drainScannerQueue);
  }
}

function createScannerJob(candidates, clientValue = "", options = {}) {
  if (!scannerEnabled()) return null;
  pruneScannerState();
  const seen = new Set();
  const normalized = [];
  for (const item of Array.isArray(candidates) ? candidates : []) {
    const id = normalizeHash(item?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id, ih: item.ih === true, state: "queued", attempts: 0, force: options.force === true });
    if (normalized.length >= SCANNER_MAX_CANDIDATES) break;
  }
  if (!normalized.length) return null;

  const clientKey = String(clientValue || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  const previousId = clientKey ? scannerClients.get(clientKey) : "";
  const previous = previousId ? scannerJobs.get(previousId) : null;
  if (previous && !["complete", "cancelled"].includes(previous.status)) {
    previous.status = "cancelled";
    previous.updatedAt = Date.now();
    if (previous.retryTimer) clearTimeout(previous.retryTimer);
    previous.retryTimer = null;
  }

  const now = Date.now();
  const job = {
    id: crypto.randomBytes(12).toString("hex"),
    clientKey,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    enqueued: false,
    retryTimer: null,
    priority: options.priority === true,
    kind: String(options.kind || "interactive").slice(0, 30),
    matchId: String(options.matchId || "").slice(0, 100),
    reportId: String(options.reportId || "").slice(0, 40),
    candidates: normalized,
  };
  for (const candidate of job.candidates) {
    const cached = options.force === true ? null : scannerCacheHit(candidate.id, now);
    if (cached) Object.assign(candidate, cached, { cached: true });
  }
  if (!job.candidates.some((item) => item.state === "queued")) job.status = "complete";
  scannerJobs.set(job.id, job);
  if (clientKey) scannerClients.set(clientKey, job.id);
  enqueueScannerJob(job, job.priority);
  return {
    id: job.id,
    statusUrl: `/api/football/scan?id=${job.id}`,
    total: job.candidates.length,
    initialCount: Math.min(SCANNER_INITIAL_SOURCES, job.candidates.length),
  };
}

function readScannerJob(id) {
  pruneScannerState();
  const key = String(id || "").trim().toLowerCase();
  if (!/^[a-f0-9]{24}$/.test(key)) return null;
  const job = scannerJobs.get(key);
  return job ? scannerJobPayload(job) : null;
}

function parseAceSearchResults(body) {
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch {
    const error = new Error("engine_bad_response");
    error.statusCode = 502;
    throw error;
  }
  const rawResults = Array.isArray(parsed?.result?.results) ? parsed.result.results
    : Array.isArray(parsed?.result) ? parsed.result
    : Array.isArray(parsed?.results) ? parsed.results : [];
  const seen = new Set();
  const items = [];
  for (const entry of rawResults) {
    const candidates = Array.isArray(entry?.items) ? entry.items : [entry];
    for (const candidate of candidates) {
      const id = normalizeHash(candidate?.infohash || candidate?.content_id || candidate?.url);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push({
        id,
        title: cleanTitle(candidate?.name || entry?.name, `Stream ${id.slice(0, 8)}`),
        category: cleanTitle(Array.isArray(candidate?.categories) ? candidate.categories[0] : "", "Busqueda"),
        availability: typeof candidate?.availability === "number" ? candidate.availability : null,
        bitrate: typeof candidate?.bitrate === "number" ? candidate.bitrate : null,
        ih: true,
      });
      if (items.length >= 100) break;
    }
    if (items.length >= 100) break;
  }
  return items.sort((a, b) => (b.availability ?? -1) - (a.availability ?? -1));
}

async function searchAceStreams(query) {
  const q = cleanTitle(query, "").slice(0, 80);
  if (q.length < 2) {
    const error = new Error("empty_query");
    error.statusCode = 400;
    throw error;
  }
  let result;
  try {
    result = await aceRequest(`/search?query=${encodeURIComponent(q)}&page_size=60`, 12000);
  } catch (error) {
    if (error.message === "ace_timeout") throw error;
    const unavailable = new Error("engine_unavailable");
    unavailable.statusCode = 503;
    throw unavailable;
  }
  if (result.statusCode < 200 || result.statusCode >= 300) {
    const error = new Error("engine_unavailable");
    error.statusCode = 503;
    throw error;
  }
  return parseAceSearchResults(result.body);
}

function resolutionChannels(values) {
  const output = [];
  const seen = new Set();
  for (const raw of Array.isArray(values) ? values : [values]) {
    const channel = cleanTitle(raw, "");
    const key = normalizeChannelKey(channel);
    if (!channel || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(channel);
    if (output.length >= 4) break;
  }
  return output;
}

function scoreResolutionCandidate(channels, item, source) {
  let score = 0;
  let matchedChannel = channels[0] || "";
  let soloFamilia = false;
  // se puntua contra el nombre visible y contra el tvg-id, y gana el mejor:
  // listas como NEW ERA rotulan "DAZN 1 --> NEW ERA" pero declaran "DAZN 1 HD"
  const names = item.alias ? [item.title, item.alias] : [item.title];
  for (const channel of channels) {
    for (const name of names) {
      const candidateScore = channelMatchScore(channel, name);
      if (candidateScore > score) {
        score = candidateScore;
        matchedChannel = channel;
        soloFamilia = esFamiliaDe(channel, name);
      }
    }
  }
  return {
    id: item.id,
    title: item.title,
    alias: cleanTitle(item.alias, "") || null,
    ih: item.ih === true,
    source,
    score,
    matchedChannel,
    soloFamilia,
    familyFallbackAllowed: soloFamilia && channelAllowsFamilyFallback(matchedChannel),
    listaId: item.listaId || null,
    availability: typeof item.availability === "number" ? item.availability : null,
    bitrate: typeof item.bitrate === "number" ? item.bitrate : null,
  };
}

function libraryResolutionCandidates(state, channels, minimumScore = LIBRARY_MIN_SCORE, options = {}) {
  const output = [];
  const seen = new Set();
  const directoryItems = Array.isArray(state.webSources)
    ? state.webSources.flatMap((source) => source.streams.map((item) => ({ ...item, listaId: source.id })))
    : state.web;
  const sourceItems = {
    m3u: Array.isArray(directoryItems) ? directoryItems : [],
    favorites: Array.isArray(state.favorites) ? state.favorites : [],
    history: Array.isArray(state.history) ? state.history : [],
  };
  const sourceOrder = Array.isArray(options.sourceOrder) && options.sourceOrder.length
    ? options.sourceOrder.filter((source) => Object.hasOwn(sourceItems, source))
    : ["m3u", "favorites", "history"];
  for (const source of sourceOrder) {
    const items = sourceItems[source];
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const candidate = scoreResolutionCandidate(channels, item, source);
      /* 70, no 58: 58 es justo el techo que se pone a las variantes de un
         canal parecido, asi que con ese umbral se colaba "LaLiga TV
         Hypermotion" (Segunda) entre las opciones de un partido de Champions.
         Los canales correctos puntuan 100 gracias al tvg-id, asi que 70 separa
         limpiamente sin perder ninguno. */
      if (candidate.score >= minimumScore) output.push(candidate);
    }
  }
  return output.sort((a, b) => b.score - a.score);
}

/* No hay tope: se ofrecen TODAS las señales que superen el umbral de nombre.
   Los hashes de AceStream caducan solos y cuando un proveedor se cae se cae
   entero, asi que recortar la lista era quitarle alternativas al usuario justo
   cuando mas falta hacen. El limite real lo pone el propio umbral. */

/* El nombre dice si es EL canal; la disponibilidad dice si esta VIVO. Antes
   mandaba solo el nombre y la disponibilidad era un simple desempate, asi que
   un hash muerto con el nombre clavado se ofrecia por delante de uno vivo con
   el nombre algo peor. Ahora se agrupa por calidad de nombre -exacto, bueno- y
   dentro de cada grupo manda lo que esta vivo. Asi nunca se cuela un canal
   equivocado por estar mas disponible, pero entre iguales gana el que funciona. */
function resolutionTier(candidate) {
  if (candidate.score >= RESOLUTION_EXACT_SCORE) return 2;   // es ese canal, sin duda
  if (candidate.score >= 70) return 1;   // muy probablemente
  return 0;
}

/* De que proveedor viene una señal.
   Las listas grandes son agregadores: la de NEW ERA trae dentro ocho
   proveedores distintos -SPORT TV, NEW LOOP, ELCANO, NEW ERA...- y lo rotula
   en el propio titulo, "LIGA DE CAMPEONES --> ELCANO". Cuando un proveedor se
   cae, se caen TODAS sus señales a la vez, asi que saber de quien es cada una
   es lo que permite no poner todos los huevos en la misma cesta. */
function proveedorDeSeñal(candidate) {
  const coletilla = /(?:--?>|={1,2}>|[→⇒➜➝⟶⟹])\s*(.+)$/.exec(String(candidate.title || ""));
  if (coletilla) return coletilla[1].trim().toLowerCase();
  return candidate.listaId || candidate.source || "otros";
}

/* Reparte la lista entre proveedores en vez de dejar que uno la cope.
   Antes salian primero cinco señales del mismo sitio y las alternativas
   quedaban del octavo puesto en adelante; si ese proveedor estaba caido,
   la que arranca sola estaba muerta y las buenas ni se veian. Ahora se
   toma la mejor de cada proveedor, luego la segunda de cada uno, y asi:
   el orden dentro de cada proveedor se respeta, pero arriba hay variedad. */
function repartirEntreProveedores(ordenados) {
  const porProveedor = new Map();
  for (const candidate of ordenados) {
    const clave = proveedorDeSeñal(candidate);
    if (!porProveedor.has(clave)) porProveedor.set(clave, []);
    porProveedor.get(clave).push(candidate);
  }
  const colas = [...porProveedor.values()];
  const salida = [];
  let quedan = true;
  while (quedan) {
    quedan = false;
    for (const cola of colas) {
      if (!cola.length) continue;
      salida.push(cola.shift());
      quedan = true;
    }
  }
  return salida;
}


/* ================================================================
   FIABILIDAD APRENDIDA
   ----------------------------------------------------------------
   Que señales aguantan y cuales se caen, aprendido de lo que pasa de
   verdad al reproducir. No lo decide el modelo de IA: los embeddings
   sirven para reconocer QUE canal es, y eso es otra pregunta. Esto es
   aritmetica sobre resultados observados.

   Se guardan dos niveles, y los dos hacen falta:
     - por hash: un enlace concreto puede morir y no volver.
     - por proveedor: cuando un proveedor se cae, se caen TODAS sus
       señales a la vez. Saberlo permite ordenar bien un hash que
       todavia no se ha probado nunca, solo por quien lo sirve.

   Tres cosas que se registran, no una:
     arranco  la señal empezo a reproducir
     fallo    nunca llego a arrancar
     cayo     arranco y se murio; si duro poco, el exito se revoca

   El desgaste es deliberado: un proveedor que iba bien hace un mes y
   ahora se cae no debe seguir cobrando fama vieja. Cada vez que se
   anota algo, lo anterior se reduce segun el tiempo pasado, con una
   vida media de dos semanas.
   ================================================================ */
const STATS_HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;
const STATS_MAX_KEYS = 600;
const STATS_SHORT_PLAY_S = 60;     // menos de un minuto no cuenta como que funciono
const STATS_NEUTRAL = 0.35;        // lo desconocido: por debajo de lo probado bueno, por encima de lo probado malo

function statsVacias() {
  return { intentos: 0, exitos: 0, caidas: 0, segundos: 0, ultimo: 0 };
}

function normalizeSourceStatEntry(value) {
  const numero = (raw, tope) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, tope) : 0;
  };
  return {
    intentos: numero(value?.intentos, 100000),
    exitos: numero(value?.exitos, 100000),
    caidas: numero(value?.caidas, 100000),
    segundos: numero(value?.segundos, 100000000),
    ultimo: numero(value?.ultimo, Number.MAX_SAFE_INTEGER),
  };
}

function normalizeSourceStatsGroup(value) {
  const salida = {};
  const entradas = value && typeof value === "object" ? Object.entries(value) : [];
  // se conservan las mas recientes: la memoria no puede crecer sin tope
  const ordenadas = entradas
    .map(([clave, stat]) => [String(clave).slice(0, 120), normalizeSourceStatEntry(stat)])
    .filter(([clave, stat]) => clave && stat.intentos > 0)
    .sort((a, b) => b[1].ultimo - a[1].ultimo)
    .slice(0, STATS_MAX_KEYS);
  for (const [clave, stat] of ordenadas) salida[clave] = stat;
  return salida;
}

function normalizeSourceStats(value) {
  return {
    hashes: normalizeSourceStatsGroup(value?.hashes),
    proveedores: normalizeSourceStatsGroup(value?.proveedores),
  };
}

/* El pasado pesa menos cuanto mas viejo. Se aplica al escribir y no al leer
   para que las lecturas -que son muchas mas- salgan gratis. */
function desgastar(stat, ahora) {
  if (!stat.ultimo || ahora <= stat.ultimo) return stat;
  const factor = Math.pow(0.5, (ahora - stat.ultimo) / STATS_HALF_LIFE_MS);
  if (factor >= 0.999) return stat;
  return {
    intentos: stat.intentos * factor,
    exitos: stat.exitos * factor,
    caidas: stat.caidas * factor,
    segundos: stat.segundos * factor,
    ultimo: stat.ultimo,
  };
}

function anotarResultado(stat, resultado, segundos, ahora) {
  const previo = desgastar(stat || statsVacias(), ahora);
  const siguiente = { ...previo, ultimo: ahora };
  if (resultado === "fallo") {
    siguiente.intentos += 1;
  } else if (resultado === "arranco") {
    siguiente.intentos += 1;
    siguiente.exitos += 1;
  } else if (resultado === "cayo") {
    siguiente.caidas += 1;
    siguiente.segundos += Math.max(0, Number(segundos) || 0);
    /* Arrancar y morirse en menos de un minuto no es que funcionara: se
       retira el exito que se le habia apuntado al empezar. */
    if ((Number(segundos) || 0) < STATS_SHORT_PLAY_S) siguiente.exitos = Math.max(0, siguiente.exitos - 1);
  }
  return siguiente;
}

/* Cota inferior de Wilson sobre la tasa de exito. Se usa esta y no la media
   simple porque un 1 de 1 no puede valer lo mismo que un 20 de 20: con pocos
   intentos la cota se queda baja sola, sin necesidad de reglas especiales. */
function tasaFiable(stat) {
  if (!stat || stat.intentos < 1) return null;
  const n = stat.intentos;
  const p = Math.min(1, Math.max(0, stat.exitos / n));
  const z = 1.96, z2 = z * z;
  const centro = p + z2 / (2 * n);
  const margen = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return Math.max(0, (centro - margen) / (1 + z2 / n));
}

/* Fiabilidad de un candidato: primero lo que sepamos de ESE hash, y si nunca
   se ha probado, lo que sepamos de quien lo sirve, algo rebajado por ser una
   pista menos concreta. Sin datos devuelve null y el orden no se toca. */
function fiabilidadDeCandidato(candidate, stats) {
  if (!stats) return null;
  const propia = tasaFiable(stats.hashes?.[candidate?.id]);
  if (propia !== null) return propia;
  const proveedor = tasaFiable(stats.proveedores?.[proveedorDeSeñal(candidate || {})]);
  return proveedor === null ? null : proveedor * 0.9;
}

function registrarResultadoDeFuente(state, datos) {
  const id = normalizeHash(datos?.id);
  const resultado = String(datos?.resultado || "");
  if (!id || !["arranco", "fallo", "cayo"].includes(resultado)) {
    const error = new Error("bad_outcome");
    error.statusCode = 400;
    throw error;
  }
  const ahora = Date.now();
  const segundos = Math.min(86400, Math.max(0, Number(datos?.segundos) || 0));
  const proveedor = proveedorDeSeñal({ title: datos?.title, listaId: datos?.listaId, source: datos?.source });
  const stats = normalizeSourceStats(state.sourceStats);
  stats.hashes[id] = anotarResultado(stats.hashes[id], resultado, segundos, ahora);
  if (proveedor) stats.proveedores[proveedor] = anotarResultado(stats.proveedores[proveedor], resultado, segundos, ahora);
  const siguiente = writeState({ ...state, sourceStats: stats });
  return {
    success: true,
    hash: siguiente.sourceStats.hashes[id] || null,
    proveedor: proveedor ? siguiente.sourceStats.proveedores[proveedor] || null : null,
  };
}

function mergeResolutionCandidates(candidates, options = {}) {
  const customSourceOrder = Array.isArray(options.sourceOrder) && options.sourceOrder.length
    ? [...new Set(options.sourceOrder.map((source) => String(source || "").trim()).filter(Boolean))]
    : null;
  const sourceRank = (source) => {
    const rank = customSourceOrder?.indexOf(source) ?? -1;
    return rank < 0 ? Number.MAX_SAFE_INTEGER : rank;
  };
  const byId = new Map();
  for (const candidate of candidates) {
    const current = byId.get(candidate.id);
    if (!current) { byId.set(candidate.id, candidate); continue; }
    const gana = candidate.score > current.score
      || (candidate.score === current.score && (customSourceOrder
        ? sourceRank(candidate.source) < sourceRank(current.source)
        : candidate.source === "m3u"));
    const elegido = gana ? candidate : current;
    const otro = gana ? current : candidate;
    /* Un mismo hash puede llegar por la lista M3U y por el buscador del motor.
       Antes el ganador reemplazaba al otro y se perdia la disponibilidad, que
       solo trae el buscador: la unica pista de si ese hash sigue vivo. Se
       conserva venga de donde venga. */
    byId.set(candidate.id, {
      ...elegido,
      availability: elegido.availability ?? otro.availability ?? null,
      bitrate: elegido.bitrate ?? otro.bitrate ?? null,
    });
  }
  const todos = [...byId.values()];
  /* "M+ Liga de Campeones" existe tal cual en la biblioteca, asi que ofrecer
     ademas el 2, el 3 y el 4 es colar otros partidos. En cambio "DAZN" a secas
     no existe como canal: alli las hermanas numeradas son lo unico que hay.
     La regla que distingue los dos casos: la familia solo se ofrece cuando NO
     aparece el canal exacto. */
  /* Un vinculo guardado NO cuenta como prueba de que el canal exacto existe:
     esta archivado con el mismo nombre que pides, asi que casa consigo mismo
     al 100% por construccion. Contarlo hacia que tener un vinculo de "DAZN"
     borrase de golpe los 19 DAZN de la biblioteca, que es justo lo contrario
     de lo que se quiere. La prueba tiene que venir de la biblioteca. */
  const hayExacto = todos.some((candidate) =>
    candidate.source !== "saved" && !candidate.soloFamilia && candidate.score >= RESOLUTION_EXACT_SCORE);
  const vivas = todos
    .filter((candidate) => {
      if (!candidate.soloFamilia) return true;
      if (hayExacto) return false;
      /* Los candidatos antiguos o construidos a mano no traen la marca y
         conservan la compatibilidad. Los puntuados por esta version declaran
         false expresamente para canales principales como Champions/LALIGA. */
      return candidate.familyFallbackAllowed !== false;
    })
    /* El 0 del buscador sirve para descartar sus resultados sueltos, pero no
       puede vetar un hash que tambien viene de tus listas, favoritos o
       historial. La prueba real encontro justo ese caso: el motor principal
       decia 0 sobre una fuente local que el segundo motor descargo enseguida.
       Desde ahora la disponibilidad previa solo poda resultados exclusivos
       del buscador; las fuentes curadas llegan al comprobador independiente. */
    .filter((candidate) => candidate.availability !== 0 || candidate.source !== "acestream");

  /* Orden DENTRO de cada procedencia. Ojo con la disponibilidad: solo la traen
     los resultados del buscador del motor; los de las listas M3U valen null.
     Al compararlas juntas, null contaba como -1 y el buscador ganaba SIEMPRE a
     las listas propias, que es justo al reves de lo que interesa: las listas
     estan curadas y funcionan mucho mejor que un hash suelto del buscador. */
  const stats = options.sourceStats || null;
  const porCalidad = (a, b) => {
    const tierA = resolutionTier(a), tierB = resolutionTier(b);
    if (tierA !== tierB) return tierB - tierA;
    /* Lo aprendido pesa por encima de la disponibilidad que canta el motor:
       aquella es una foto de este instante y esto es lo que de verdad ha
       pasado al reproducir. Nunca decide QUE canal es -eso ya esta resuelto
       por el nivel de arriba-, solo ordena entre iguales. Lo desconocido vale
       STATS_NEUTRAL: por debajo de lo probado bueno y por encima de lo
       probado malo, que es justo lo que merece. */
    const fiaA = fiabilidadDeCandidato(a, stats) ?? STATS_NEUTRAL;
    const fiaB = fiabilidadDeCandidato(b, stats) ?? STATS_NEUTRAL;
    if (Math.abs(fiaA - fiaB) > 0.02) return fiaB - fiaA;
    const dispA = a.availability ?? -1, dispB = b.availability ?? -1;
    if (dispA !== dispB) return dispB - dispA;
    return b.score - a.score;
  };

  /* Primero lo tuyo, despues lo del buscador.
     1. vinculos que has confirmado a mano
     2. TODAS tus listas M3U importadas
     3. favoritos y despues historial
     4. el buscador del motor, como red de seguridad
     Dentro de cada grupo se reparte entre proveedores, para que un proveedor
     caido no copo la cabecera. */
  const ordenFuentes = customSourceOrder || ["saved", "m3u", "favorites", "history", "acestream"];
  const GRUPOS = [
    ...ordenFuentes.map((source) => (candidate) => candidate.source === source),
    () => true,
  ];
  const salida = [];
  const yaPuestas = new Set();
  for (const pertenece of GRUPOS) {
    const grupo = vivas.filter((c) => !yaPuestas.has(c.id) && pertenece(c)).sort(porCalidad);
    for (const candidate of repartirEntreProveedores(grupo)) {
      yaPuestas.add(candidate.id);
      salida.push(candidate);
    }
  }

  /* Sin recorte: van todas. Ya salen ordenadas -lo tuyo primero, el buscador
     al final- asi que quedarse solo con las primeras seria tirar alternativas
     validas sin motivo. */
  return salida;
}

/* Refresco de listas al ir a ver un partido.
   Las listas se refrescan solas cada tres horas, y los hashes de AceStream
   caducan mucho antes: se caen a mitad de tarde y al dar a reproducir se
   ofrecen señales que ya no existen. Al resolver un partido se comprueba la
   edad de las listas y, si pasan de este tiempo, se relanza la sincronizacion
   EN SEGUNDO PLANO. No se espera a que termine -eso metria segundos entre
   pulsar y ver- pero deja las listas frescas para el siguiente intento y para
   el selector de fuentes. */
const WEB_SYNC_ON_RESOLVE_MS = 30 * 60 * 1000;
let syncEnCurso = null;

function refrescarListasSiTocan(state) {
  if (syncEnCurso) return;
  const ahora = Date.now();
  const rancia = (state.webSources || []).some((source) => {
    const marca = source.syncedAt ? Date.parse(source.syncedAt) : 0;
    return !Number.isFinite(marca) || ahora - marca > WEB_SYNC_ON_RESOLVE_MS;
  });
  if (!rancia) return;
  syncEnCurso = autoSyncWeb()
    .catch((error) => console.error(`[sync-al-resolver] fallo: ${error.message}`))
    .finally(() => { syncEnCurso = null; });
}

function aceSearchQueries(channels, semanticEnabled = false) {
  const output = [];
  const seen = new Set();
  const add = (value) => {
    const query = cleanTitle(value, "").slice(0, 80);
    const key = normalizeChannelKey(query);
    if (query.length < 2 || !key || seen.has(key)) return;
    seen.add(key);
    output.push(query);
  };
  for (const channel of channels) {
    add(channel);
    if (semanticEnabled) {
      /* El buscador de AceStream es literal. Preguntar tambien sin operador
         hace aparecer "LIGA DE CAMPEONES --> ELCANO", que no siempre sale al
         buscar el nombre comercial completo "M+ Liga de Campeones". */
      const core = normalizeChannelKey(channel).split(" ")
        .filter((token) => !["movistar", "m", "plus"].includes(token)).join(" ");
      add(core);
    }
    if (output.length >= 8) break;
  }
  return output.slice(0, 8);
}

function minimumResolutionScore(candidate, semanticUsed = false) {
  if (candidate.source === "saved") return RESOLUTION_EXACT_SCORE;
  /* Sin IA se conserva el comportamiento anterior: el buscador remoto puede
     ofrecer opciones ambiguas a 58 para que el usuario elija. Cuando la IA si
     pudo comparar contra la programacion, solo pasan 70 o los rescatados que
     ella haya elevado; asi Hypermotion deja de colarse en Champions. */
  if (candidate.source === "acestream" && !semanticUsed) return 58;
  return LIBRARY_MIN_SCORE;
}

function sourceReportApplies(report, channelKeys, now = Date.now()) {
  const until = Date.parse(report?.quarantineUntil || "");
  if (!Number.isFinite(until) || until <= now) return false;
  if (report.reason !== "wrong_channel") return true;
  return !!report.channelKey && channelKeys.has(report.channelKey);
}

/* Las correcciones humanas mandan sobre la similitud del nombre y sobre la
   IA. Un "canal incorrecto" no condena el hash para todos los partidos: solo
   lo aparta del canal que se corrigio. Los fallos tecnicos si se ponen en
   cuarentena global durante un rato, porque no dependen de la programacion. */
function applyLearnedSourceRules(state, channels, candidates, now = Date.now()) {
  const channelKeys = new Set(channels.map(normalizeChannelKey).filter(Boolean));
  const feedback = Array.isArray(state?.channelFeedback) ? state.channelFeedback : [];
  const reports = Array.isArray(state?.sourceReports) ? state.sourceReports : [];
  return candidates.map((candidate) => {
    const learned = feedback.find((item) => item.id === candidate.id && channelKeys.has(item.channelKey));
    const report = reports.find((item) => item.id === candidate.id && sourceReportApplies(item, channelKeys, now));
    return {
      ...candidate,
      score: learned?.verdict === "correct" ? Math.max(98, candidate.score) : candidate.score,
      learned: learned?.verdict || null,
      reported: report ? {
        reason: report.reason,
        state: report.state,
        quarantineUntil: report.quarantineUntil,
      } : null,
      rejectedByLearning: learned?.verdict === "incorrect",
      quarantined: !!report,
    };
  }).filter((candidate) => !candidate.rejectedByLearning && !candidate.quarantined);
}

async function resolveFootballChannel(state, values, search = searchAceStreams, options = {}) {
  const channels = resolutionChannels(values);
  if (!channels.length) {
    const error = new Error("channel_required");
    error.statusCode = 400;
    throw error;
  }

  /* Se consultan TODAS las capas siempre, sin cortocircuitos. Antes, en cuanto
     la biblioteca daba una coincidencia buena se devolvia esa y no se llegaba
     a preguntar al buscador del motor, asi que si ese hash estaba muerto no
     habia alternativas. Los hashes de AceStream caducan a menudo: cuantas mas
     señales del mismo canal se reunan, mas probable es que alguna funcione. */
  const research = options.mode === "research";
  const semanticOptions = options.semantic || {};
  const semanticEnabled = semanticOptions.enabled ?? ollamaConfigured();
  const checked = research
    ? ["favorites", "m3u", "acestream"]
    : ["saved", "m3u", "library", "acestream"];
  if (semanticEnabled) checked.push("ai-programming");

  refrescarListasSiTocan(state);

  const bindings = research ? [] : state.channelBindings
    .map((binding) => {
      const scored = scoreResolutionCandidate(channels, { ...binding, title: binding.channel }, "saved");
      return { ...scored, title: binding.title, ih: binding.ih };
    })
    .filter((candidate) => candidate.score >= RESOLUTION_EXACT_SCORE);

  /* Se conservan temporalmente todas las entradas: las que el buscador
     clasico no entienda tendran una segunda oportunidad en el indice
     semantico. Tras esa capa se aplica el mismo umbral estricto a todas. */
  const local = libraryResolutionCandidates(
    state,
    channels,
    0,
    research ? { sourceOrder: ["favorites", "m3u"] } : {},
  );

  const queries = aceSearchQueries(channels, semanticEnabled);
  const searched = await Promise.allSettled(queries.map((channel) => search(channel)));
  const engineAvailable = searched.some((result) => result.status === "fulfilled");
  const remote = [];
  for (const result of searched) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      const candidate = scoreResolutionCandidate(channels, item, "acestream");
      remote.push(candidate);
    }
  }

  const program = options.program || null;
  const programChannels = [
    ...(Array.isArray(program?.channels) ? program.channels : []),
    ...(Array.isArray(options.programChannels) ? options.programChannels : footballProgramming.channels),
  ];
  const semanticResult = await applySemanticCandidateScores(
    channels,
    [...local, ...remote],
    programChannels,
    { ...semanticOptions, enabled: semanticEnabled },
  );
  const learnedCandidates = applyLearnedSourceRules(state, channels, semanticResult.candidates);
  const qualified = learnedCandidates
    .filter((candidate) => candidate.score >= minimumResolutionScore(candidate, semanticResult.used));
  const candidates = applyLearnedSourceRules(
    state,
    channels,
    mergeResolutionCandidates(
      [...bindings, ...qualified],
      research
        ? { sourceOrder: ["favorites", "m3u", "acestream"], sourceStats: state.sourceStats }
        : { sourceStats: state.sourceStats },
    ),
  );
  const ai = {
    enabled: semanticEnabled,
    used: semanticResult.used,
    model: semanticEnabled ? OLLAMA_EMBED_MODEL : null,
    catalogSize: semanticResult.catalogSize,
    error: semanticResult.error,
  };
  if (!candidates.length) {
    return { success: true, status: "not_found", channels, checked, candidates: [], engineAvailable, ai, program, research };
  }

  /* Un vinculo guardado manda sobre todo. Si no, hace falta que no haya
     ambiguedad, pero OJO: reunir mas fuentes hace que varias empaten arriba,
     y eso no es ambiguo si todas son del MISMO canal -son justo las señales
     alternativas que buscamos-. Solo se pregunta si empatan canales
     DISTINTOS, que es cuando de verdad no se sabe cual quiere el usuario. */
  const guardado = research ? null : candidates.find((c) => c.source === "saved");
  const cabeza = candidates.filter((c) => c.score >= RESOLUTION_EXACT_SCORE);
  const canalesEnCabeza = new Set(cabeza.map((c) => normalizeChannelKey(c.title)));
  const inequivoco = cabeza.length > 0 && canalesEnCabeza.size === 1;
  /* Habiendo candidatos validos se reproduce el mejor y punto: el selector de
     fuentes ya deja cambiar de señal sin volver a preguntar. El dialogo de
     eleccion solo aparece si no hay ninguno claro. */
  const elegido = guardado || (inequivoco ? cabeza[0] : null) || (cabeza[0] || null);

  if (elegido) {
    return { success: true, status: "found", channels, checked, candidate: elegido, candidates, engineAvailable, ai, program, research };
  }
  return { success: true, status: "choices", channels, checked, candidates, engineAvailable, ai, program, research };
}

function footballPreheatStage(start, now = Date.now()) {
  const kickoff = Number(start);
  if (!Number.isFinite(kickoff) || kickoff <= 0) return null;
  const until = kickoff - now;
  if (until > PREHEAT_DISCOVERY_MS || until < -120 * 60 * 1000) return null;
  if (until > PREHEAT_SCAN_MS) return "discovery";
  if (until > PREHEAT_KICKOFF_GRACE_MS) return "scan";
  if (until >= -5 * 60 * 1000) return "kickoff";
  return "live";
}

function publicPreheatRecord(record) {
  if (!record) return null;
  return {
    matchId: record.matchId,
    stage: record.stage,
    status: record.status,
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : null,
    candidateCount: record.result?.candidates?.length || 0,
    checked: record.scan?.checked || 0,
    playable: record.scan?.playable || 0,
    total: record.scan?.total || record.result?.candidates?.length || 0,
    error: record.error || "",
  };
}

function updatePreheatFromScanner(job) {
  if (job?.kind !== "preheat" || !job.matchId) return;
  const record = preheatMatches.get(job.matchId);
  if (!record) return;
  record.scan = scannerJobPayload(job);
  record.status = "ready";
  record.updatedAt = Date.now();
}

async function preheatFootballMatch(match, stage, options = {}) {
  const matchId = String(match?.id || "");
  const channelNames = (Array.isArray(match?.channels) ? match.channels : [])
    .map((channel) => cleanTitle(channel?.name ?? channel, "")).filter(Boolean);
  if (!matchId || !channelNames.length) return null;
  const now = Number(options.now) || Date.now();
  const previous = preheatMatches.get(matchId) || {};
  const record = {
    ...previous,
    matchId,
    start: Number(match.start) || 0,
    stage,
    status: "resolving",
    updatedAt: now,
    lastRunAt: now,
    error: "",
  };
  preheatMatches.set(matchId, record);
  try {
    const state = readState();
    if (stage === "discovery") refrescarListasSiTocan(state);
    const resolve = options.resolve || resolveFootballChannel;
    const result = await resolve(
      state,
      channelNames,
      options.search || searchAceStreams,
      { program: { ...match, channels: channelNames } },
    );
    record.result = result;
    record.updatedAt = Date.now();
    if (stage === "discovery" || !result.candidates?.length) {
      record.status = result.candidates?.length ? "discovered" : "no_sources";
      record.scan = null;
      return record;
    }
    const key = crypto.createHash("sha1").update(matchId).digest("hex").slice(0, 20);
    const scanRef = createScannerJob(result.candidates, `preheat_${key}`, {
      force: stage === "kickoff" || stage === "live",
      priority: false,
      kind: "preheat",
      matchId,
    });
    record.scanRef = scanRef;
    record.status = scanRef ? "scanning" : "scanner_offline";
    return record;
  } catch (error) {
    record.status = "failed";
    record.error = String(error?.message || "preheat_failed").slice(0, 80);
    record.updatedAt = Date.now();
    return record;
  }
}

function preheatRecordIsDue(record, stage, now) {
  if (!record || record.stage !== stage) return true;
  if (stage !== "live") return false;
  return now - (record.lastRunAt || 0) >= PREHEAT_RESULT_TTL_MS;
}

async function runFootballPreheat(options = {}) {
  if (preheatBusy) return;
  preheatBusy = true;
  try {
    const now = Number(options.now) || Date.now();
    const payload = options.payload || footballCache.payload || await getFootballSchedule();
    const due = footballScheduleMatches(payload)
      .map((match) => ({ match, stage: footballPreheatStage(match.start, now) }))
      .filter(({ match, stage }) => stage && match.channels?.length
        && preheatRecordIsDue(preheatMatches.get(String(match.id || "")), stage, now))
      .sort((a, b) => Math.abs(Number(a.match.start) - now) - Math.abs(Number(b.match.start) - now))
      .slice(0, 2);
    for (const item of due) await preheatFootballMatch(item.match, item.stage, { ...options, now });
    for (const [id, record] of preheatMatches) {
      if (now - (record.updatedAt || 0) > 3 * 60 * 60 * 1000) preheatMatches.delete(id);
    }
  } finally {
    preheatBusy = false;
  }
}

function reusablePreheat(matchId, now = Date.now()) {
  const record = preheatMatches.get(String(matchId || ""));
  if (!record?.result || now - (record.updatedAt || 0) > PREHEAT_RESULT_TTL_MS) return null;
  return record;
}

function updateFootballPreferences(current, value) {
  const state = writeState({ ...current, preferences: normalizePreferences(value) });
  return { success: true, preferences: state.preferences };
}

function saveChannelBinding(current, value) {
  const binding = normalizeChannelBinding({ ...value, updatedAt: new Date().toISOString() });
  if (!binding) throw new Error("bad_binding");
  const channelBindings = [binding, ...current.channelBindings.filter((item) => item.channelKey !== binding.channelKey)];
  const state = writeState({ ...current, channelBindings });
  return { success: true, binding, channelBindings: state.channelBindings };
}

function publicSourceReport(report) {
  if (!report) return null;
  return {
    reportId: report.reportId,
    id: report.id,
    channel: report.channel,
    matchId: report.matchId,
    reason: report.reason,
    state: report.state,
    checkReason: report.checkReason,
    reportedAt: report.reportedAt,
    lastCheckedAt: report.lastCheckedAt,
    quarantineUntil: report.quarantineUntil,
  };
}

function saveSourceFeedback(current, value) {
  const feedback = normalizeChannelFeedback({ ...value, updatedAt: new Date().toISOString() });
  if (!feedback) {
    const error = new Error("bad_feedback");
    error.statusCode = 400;
    throw error;
  }
  const previous = current.channelFeedback.find((item) =>
    item.id === feedback.id && item.channelKey === feedback.channelKey);
  feedback.corrections = Math.min(999, (previous?.corrections || 0) + 1);
  const channelFeedback = [feedback, ...current.channelFeedback.filter((item) =>
    !(item.id === feedback.id && item.channelKey === feedback.channelKey))];
  const sourceReports = feedback.verdict === "correct"
    ? current.sourceReports.map((report) => report.id === feedback.id
      && report.channelKey === feedback.channelKey && report.reason === "wrong_channel"
      ? { ...report, state: "working", quarantineUntil: null, lastCheckedAt: feedback.updatedAt }
      : report)
    : current.sourceReports;
  const state = writeState({ ...current, channelFeedback, sourceReports });
  return { success: true, feedback, learningCount: state.channelFeedback.length };
}

function reportSource(current, value) {
  const id = normalizeHash(value?.id);
  const reason = SOURCE_REPORT_REASONS.has(value?.reason) ? value.reason : "not_starting";
  const program = footballProgramMatch(value?.matchId);
  const channel = cleanTitle(value?.channel, "")
    || cleanTitle(program?.channels?.[0], "");
  const channelKey = normalizeChannelKey(channel);
  if (!id) {
    const error = new Error("bad_request");
    error.statusCode = 400;
    throw error;
  }
  const now = Date.now();
  const reportedAt = new Date(now).toISOString();
  const quarantineMs = reason === "wrong_channel" ? SOURCE_WRONG_CHANNEL_QUARANTINE_MS
    : ["stuttering", "bad_quality", "audio"].includes(reason) ? SOURCE_QUALITY_QUARANTINE_MS
      : SOURCE_REPORT_QUARANTINE_MS;
  const previous = current.sourceReports.find((item) =>
    item.id === id && item.channelKey === channelKey && item.reason === reason);
  const report = normalizeSourceReport({
    ...previous,
    reportId: previous?.reportId || crypto.randomBytes(8).toString("hex"),
    id,
    title: value?.title,
    ih: value?.ih === true,
    source: value?.source,
    channel,
    channelKey,
    matchId: value?.matchId,
    reason,
    state: "checking",
    checkReason: "",
    reportCount: (previous?.reportCount || 0) + 1,
    reportedAt,
    lastCheckedAt: null,
    quarantineUntil: new Date(now + quarantineMs).toISOString(),
  });
  let sourceReports = [report, ...current.sourceReports.filter((item) => item.reportId !== report.reportId)];
  let channelFeedback = current.channelFeedback;
  if (reason === "wrong_channel" && channelKey) {
    const feedback = normalizeChannelFeedback({
      id, title: value?.title, channel, channelKey, verdict: "incorrect",
      reason, updatedAt: reportedAt,
      corrections: (current.channelFeedback.find((item) => item.id === id && item.channelKey === channelKey)?.corrections || 0) + 1,
    });
    channelFeedback = [feedback, ...current.channelFeedback.filter((item) =>
      !(item.id === id && item.channelKey === channelKey))];
  }
  writeState({ ...current, sourceReports, channelFeedback });
  scannerCache.delete(id);
  const scan = createScannerJob(
    [{ id, ih: value?.ih === true }],
    `report_${report.reportId}`,
    { force: true, priority: true, kind: "report", reportId: report.reportId },
  );
  return { success: true, report: publicSourceReport(report), scan };
}

function updateReportFromProbe(job, candidate) {
  if (job?.kind !== "report" || !job.reportId || !["working", "weak", "failed"].includes(candidate?.state)) return;
  const current = readState();
  const target = current.sourceReports.find((report) => report.reportId === job.reportId);
  if (!target) return;
  const checkedAt = candidate.checkedAt || new Date().toISOString();
  let state = candidate.state;
  let quarantineUntil = null;
  if (target.reason === "wrong_channel") {
    state = "reported";
    quarantineUntil = new Date(Date.now() + SOURCE_WRONG_CHANNEL_QUARANTINE_MS).toISOString();
  } else if (["stuttering", "bad_quality", "audio"].includes(target.reason)
    && candidate.state !== "failed") {
    /* El muestreo confirma que hay video, no que el audio sea correcto ni que
       no haya microcortes. Se mantiene una cuarentena corta y se informa con
       honestidad de que la señal esta viva pero reportada. */
    state = "reported";
    quarantineUntil = new Date(Date.now() + SOURCE_QUALITY_QUARANTINE_MS).toISOString();
  } else if (candidate.state === "failed") {
    quarantineUntil = new Date(Date.now() + SOURCE_REPORT_QUARANTINE_MS).toISOString();
  }
  const sourceReports = current.sourceReports.map((report) => report.reportId === job.reportId
    ? { ...report, state, checkReason: candidate.reason || "", lastCheckedAt: checkedAt, quarantineUntil }
    : report);
  writeState({ ...current, sourceReports });
}

async function ollamaHealth() {
  if (!ollamaConfigured()) return { status: "disabled", online: false, model: OLLAMA_EMBED_MODEL };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(3500, OLLAMA_TIMEOUT_MS));
  try {
    const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: controller.signal });
    const data = await response.json().catch(() => ({}));
    const models = Array.isArray(data?.models) ? data.models.map((item) => String(item?.name || item?.model || "")) : [];
    const wanted = OLLAMA_EMBED_MODEL.split(":")[0];
    const modelReady = models.some((name) => name === OLLAMA_EMBED_MODEL || name.split(":")[0] === wanted);
    return { status: response.ok && modelReady ? "ready" : response.ok ? "model_missing" : "offline", online: response.ok, model: OLLAMA_EMBED_MODEL, modelReady };
  } catch {
    return { status: "offline", online: false, model: OLLAMA_EMBED_MODEL, modelReady: false };
  } finally {
    clearTimeout(timeout);
  }
}

async function systemHealth() {
  const state = readState();
  const [engineResult, scannerResult, ai] = await Promise.all([
    aceRequest("/webui/api/service?method=get_version", 3000)
      .then((result) => ({ status: result.statusCode >= 200 && result.statusCode < 300 ? "ready" : "offline", online: result.statusCode >= 200 && result.statusCode < 300 }))
      .catch(() => ({ status: "offline", online: false })),
    scannerEnabled()
      ? scannerRequest("/webui/api/service?method=get_version", 3000)
        .then((result) => ({ status: result.statusCode >= 200 && result.statusCode < 300 ? "ready" : "offline", online: result.statusCode >= 200 && result.statusCode < 300 }))
        .catch(() => ({ status: "offline", online: false }))
      : Promise.resolve({ status: "disabled", online: false }),
    ollamaHealth(),
  ]);
  const schedule = footballCache.payload;
  const matches = footballScheduleMatches(schedule);
  const sourceRows = state.webSources.map((source) => ({
    id: source.id,
    name: source.name,
    count: source.streams.length,
    syncedAt: source.syncedAt,
    lastErrorAt: source.lastErrorAt,
    stale: !source.syncedAt || Date.now() - Date.parse(source.syncedAt) > WEB_SYNC_INTERVAL_MS * 1.5,
  }));
  const activeJobs = [...scannerJobs.values()].filter((job) => !["complete", "cancelled"].includes(job.status));
  return {
    success: true,
    version: APP_VERSION,
    checkedAt: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    components: {
      backend: { status: "ready", online: true },
      engine: engineResult,
      scanner: {
        ...scannerResult,
        busy: scannerBusy,
        queue: scannerQueue.length,
        activeJobs: activeJobs.length,
        cachedSources: scannerCache.size,
      },
      ai,
      agenda: {
        status: schedule ? (schedule.stale ? "stale" : "ready") : "warming",
        generatedAt: schedule?.generatedAt || null,
        matches: matches.length,
        preheated: [...preheatMatches.values()].filter((item) => ["ready", "scanning", "discovered"].includes(item.status)).length,
      },
      directories: {
        status: sourceRows.some((source) => source.lastErrorAt && source.stale) ? "degraded" : sourceRows.length ? "ready" : "empty",
        total: sourceRows.length,
        channels: sourceRows.reduce((sum, source) => sum + source.count, 0),
        sources: sourceRows,
      },
    },
    reports: {
      total: state.sourceReports.length,
      quarantined: state.sourceReports.filter((report) => Date.parse(report.quarantineUntil || "") > Date.now()).length,
      learningCount: state.channelFeedback.length,
    },
  };
}

function restartAceStream() {
  return new Promise((resolve, reject) => {
    const now = Date.now();
    if (now - lastRestartAt < RESTART_COOLDOWN_MS) {
      const error = new Error("restart_cooldown");
      error.statusCode = 429;
      reject(error);
      return;
    }

    lastRestartAt = now;
    const controlReq = http.request({
      hostname: ENGINE_CONTROL_HOST,
      port: 3001,
      path: "/restart",
      method: "POST",
      timeout: 8000,
    }, (controlRes) => {
      controlRes.resume();
      controlRes.on("end", () => {
        if (controlRes.statusCode >= 200 && controlRes.statusCode < 300) {
          resolve({ restarted: true });
        } else {
          const error = new Error("restart_failed");
          error.statusCode = 502;
          reject(error);
        }
      });
    });
    controlReq.on("timeout", () => controlReq.destroy(new Error("restart_timeout")));
    controlReq.on("error", () => {
      const error = new Error("restart_failed");
      error.statusCode = 502;
      reject(error);
    });
    controlReq.end();
  });
}

async function handleRequest(req, res) {
  try {
    if (!isAllowedMutation(req)) return send(res, 403, { error: "cross_origin" });
    if (req.url === "/api/preferences") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, updateFootballPreferences(readState(), await readBody(req)));
    }

    if (req.url === "/api/football/bind") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, saveChannelBinding(readState(), await readBody(req)));
    }

    if (req.url === "/api/sources/report") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, reportSource(readState(), await readBody(req)));
    }

    if (req.url === "/api/sources/outcome") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const body = await readBody(req);
      return send(res, 200, registrarResultadoDeFuente(readState(), body));
    }

    if (req.url === "/api/sources/feedback") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, saveSourceFeedback(readState(), await readBody(req)));
    }

    if (req.url === "/api/health") {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, await systemHealth());
    }

    if (req.url === "/api/football/preheat" || req.url.startsWith("/api/football/preheat?")) {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const matchId = new URL(req.url, "http://internal").searchParams.get("match");
      return send(res, 200, { success: true, preheat: publicPreheatRecord(preheatMatches.get(String(matchId || ""))) });
    }

    if (req.url === "/api/football/scan" || req.url.startsWith("/api/football/scan?")) {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const scanId = new URL(req.url, "http://internal").searchParams.get("id");
      const job = readScannerJob(scanId);
      return job ? send(res, 200, job) : send(res, 404, { error: "scan_not_found" });
    }

    if (req.url === "/api/football/resolve" || req.url.startsWith("/api/football/resolve?")) {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const url = new URL(req.url, "http://internal");
      const research = url.searchParams.get("research") === "1";
      const program = footballProgramMatch(url.searchParams.get("match"));
      const announcedChannels = Array.isArray(program?.channels) && program.channels.length
        ? program.channels : url.searchParams.getAll("channel");
      /* Rebuscar siempre hace una pasada nueva. La precarga es perfecta para
         entrar rapido al partido, pero aqui ocultaria hashes que hayan
         aparecido o caducado desde la ultima comprobacion. */
      const preheated = research ? null : reusablePreheat(url.searchParams.get("match"));
      const currentState = readState();
      let result;
      if (preheated) {
        const candidates = applyLearnedSourceRules(currentState, resolutionChannels(announcedChannels), preheated.result.candidates || []);
        const candidate = candidates.find((item) => item.id === preheated.result.candidate?.id) || candidates[0] || null;
        result = {
          ...preheated.result,
          status: candidate ? "found" : "not_found",
          candidate,
          candidates,
          preheated: true,
        };
      } else {
        result = await resolveFootballChannel(currentState, announcedChannels, searchAceStreams, {
          program,
          mode: research ? "research" : "default",
        });
      }
      result.preheat = publicPreheatRecord(preheated);
      const scanCandidates = [...(result.candidates || [])];
      const currentId = research ? normalizeHash(url.searchParams.get("current")) : "";
      if (scanCandidates.length && currentId && !scanCandidates.some((candidate) => candidate.id === currentId)) {
        scanCandidates.push({
          id: currentId,
          ih: url.searchParams.get("current_ih") === "1",
        });
      }
      result.scan = createScannerJob(scanCandidates, url.searchParams.get("client"), {
        force: research,
        priority: true,
        kind: research ? "research" : "interactive",
        matchId: String(url.searchParams.get("match") || ""),
      });
      return send(res, 200, result);
    }

    if (req.url === "/api/scores") {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, await getLiveScores());
    }

    if (req.url === "/api/football" || req.url.startsWith("/api/football?")) {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, await getFootballSchedule());
    }

    if (req.url === "/api/state") {
      if (req.method === "GET") return send(res, 200, publicState(readState()));
      if (req.method === "PUT") {
        const body = await readBody(req);
        const current = readState();
        // Compatibilidad con clientes anteriores. Las mutaciones nuevas usan
        // /api/library para no sobreescribir cambios de otro dispositivo.
        const next = { ...current };
        // Un cliente 0.6.8 aun abierto puede seguir enviando listas completas.
        // Se aceptan altas/renombres, pero se fusionan con el estado actual
        // para que una copia obsoleta nunca borre datos de otro dispositivo.
        if (Array.isArray(body.favorites)) {
          next.favorites = mergeLegacyItems(body.favorites, current.favorites, "fav");
        }
        if (Array.isArray(body.history)) {
          next.history = mergeLegacyItems(body.history, current.history, "recent");
        }
        const incoming = normalizeNowPlaying(body.nowPlaying);
        if (incoming) {
          const sameClaim = current.nowPlaying?.id === incoming.id && current.nowPlaying?.dev === incoming.dev;
          next.nowPlaying = sameClaim ? current.nowPlaying : {
            ...incoming,
            at: Math.max(Date.now(), (Number(current.nowPlaying?.at) || 0) + 1),
          };
        }
        return send(res, 200, publicState(writeState(next)));
      }
      return send(res, 405, { error: "method_not_allowed" });
    }

    if (req.url === "/api/library") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const body = await readBody(req);
      return send(res, 200, mutateLibrary(readState(), body));
    }

    if (req.url === "/api/playback/claim") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const body = await readBody(req);
      return send(res, 200, claimPlayback(readState(), body));
    }

    if (req.url === "/api/playback/release") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const body = await readBody(req);
      return send(res, 200, releasePlayback(readState(), body));
    }

    if (req.url === "/api/remux/stop") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const body = await readBody(req);
      const id = normalizeHash(body.id);
      if (!id) return send(res, 400, { error: "bad_request" });
      const key = id.toLowerCase();
      const session = remuxSessions.get(key);
      const deviceId = String(body.dev || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
      if (session && deviceId) session.clients.delete(deviceId);
      const stopped = !!session && body.keepAlive !== true && (!deviceId || session.clients.size === 0);
      if (stopped) remuxCleanup(key);
      return send(res, 200, { success: true, stopped, detached: !!session && !!deviceId });
    }

    if (req.url === "/api/remux" || req.url.startsWith("/api/remux?")) {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const u = new URL(req.url, "http://internal");
      const ihParam = u.searchParams.get("infohash");
      const id = normalizeHash(ihParam || u.searchParams.get("id"));
      if (!id) return send(res, 400, { error: "bad_request" });
      const deviceId = String(u.searchParams.get("dev") || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
      const s = ensureRemux(ihParam ? "infohash" : "id", id, deviceId);
      const manifest = path.join(s.dir, "index.m3u8");
      const t0 = Date.now();
      while (!fs.existsSync(manifest)) {
        if (remuxSessions.get(id.toLowerCase()) !== s || s.exited) return send(res, 502, { error: "remux_died" });
        if (Date.now() - t0 > 40000) return send(res, 504, { error: "remux_timeout" });
        await new Promise((r) => setTimeout(r, 500));
      }
      return send(res, 200, { url: `/remux/${id.toLowerCase()}/index.m3u8` });
    }

    if (req.url.startsWith("/remux/")) {
      if (!["GET", "HEAD"].includes(req.method)) { res.writeHead(405); return res.end(); }
      const rel = decodeURIComponent(req.url.split("?")[0]).slice("/remux/".length);
      const parts = rel.split("/");
      if (parts.length < 2 || !HASH_RE.test(parts[0]) || rel.includes("\\")) { res.writeHead(403); return res.end(); }
      const s = remuxSessions.get(parts[0].toLowerCase());
      if (s) s.lastAccess = Date.now();
      const root = path.resolve(REMUX_DIR);
      const file = path.resolve(root, rel);
      if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
      return serveRemuxFile(req, res, file);
    }

    if (req.url === "/api/search" || req.url.startsWith("/api/search?")) {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const query = new URL(req.url, "http://internal").searchParams.get("q") || "";
      const q = query.replace(/\s+/g, " ").trim().slice(0, 80);
      if (q.length < 2) return send(res, 400, { error: "empty_query" });
      return send(res, 200, { query: q, results: await searchAceStreams(q) });
    }

    if (req.url === "/api/engine/status") {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const result = await aceRequest("/webui/api/service?method=get_version");
      return send(res, 200, { online: result.statusCode >= 200 && result.statusCode < 300, raw: result.body.slice(0, 300) });
    }

    if (req.url === "/api/restart-engine") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, await restartAceStream());
    }

    if (req.url === "/api/streams/sync") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const body = await readBody(req);
      const type = body.type === "html" ? "html" : "m3u";
      const url = normalizeWebUrl(body.url);
      if (!url) throw new Error("bad_url");
      const snapshot = readState();
      const requestedSourceId = String(body.sourceId || "");
      const snapshotSource = requestedSourceId
        ? snapshot.webSources.find((item) => item.id === requestedSourceId)
        : snapshot.webSources.find((item) => item.url === url && item.type === type);
      if (requestedSourceId && !snapshotSource) throw new Error("source_not_found");
      if (!snapshotSource && snapshot.webSources.length >= MAX_WEB_SOURCES) throw new Error("source_limit");
      const text = await fetchText(url);
      const streams = (type === "m3u" ? parseM3u(text) : parseHtml(text)).slice(0, MAX_WEB_STREAMS);
      if (!streams.length) throw new Error("empty_directory");
      // La descarga puede tardar varios segundos. Relee antes de escribir para
      // no borrar favoritos, historial ni cambios hechos desde otro dispositivo.
      const latest = readState();
      const source = requestedSourceId
        ? latest.webSources.find((item) => item.id === requestedSourceId)
        : latest.webSources.find((item) => item.url === url && item.type === type);
      if (requestedSourceId && !source) throw new Error("source_not_found");
      if (!source && latest.webSources.length >= MAX_WEB_SOURCES) throw new Error("source_limit");
      const id = source?.id || `directorio-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const synced = normalizeWebSource({
        ...source,
        id,
        name: body.name || source?.name,
        url,
        type,
        streams,
        syncedAt: new Date().toISOString(),
        lastErrorAt: null,
      }, latest.webSources.length);
      const webSources = source
        ? latest.webSources.map((item) => item.id === source.id ? synced : item)
        : [...latest.webSources, synced];
      const nextState = writeState({ ...latest, webSources, activeWebSourceId: id });
      return send(res, 200, directoryResponse(nextState));
    }

    if (req.url === "/api/streams/activate") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const body = await readBody(req);
      const state = readState();
      if (!state.webSources.some((source) => source.id === body.sourceId)) throw new Error("source_not_found");
      return send(res, 200, directoryResponse(writeState({ ...state, activeWebSourceId: body.sourceId })));
    }

    if (req.url === "/api/streams/delete") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      const body = await readBody(req);
      const state = readState();
      if (!state.webSources.some((source) => source.id === body.sourceId)) throw new Error("source_not_found");
      if (state.webSources.length <= 1) throw new Error("last_source");
      const webSources = state.webSources.filter((source) => source.id !== body.sourceId);
      const activeWebSourceId = state.activeWebSourceId === body.sourceId ? webSources[0].id : state.activeWebSourceId;
      return send(res, 200, directoryResponse(writeState({ ...state, webSources, activeWebSourceId })));
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    const status = error.statusCode || 400;
    const safeErrors = new Set([
      "ace_timeout",
      "bad_action",
      "bad_binding",
      "bad_collection",
      "bad_json",
      "bad_title",
      "bad_url",
      "body_too_large",
      "cross_origin",
      "dns_failed",
      "empty_directory",
      "empty_query",
      "engine_bad_response",
      "engine_unavailable",
      "fetch_failed",
      "fetch_timeout",
      "football_unavailable",
      "channel_required",
      "last_source",
      "method_not_allowed",
      "private_url",
      "redirect_limit",
      "redirect_loop",
      "restart_cooldown",
      "restart_failed",
      "response_too_large",
      "scan_not_found",
      "source_limit",
      "source_not_found",
      "unsupported_encoding",
    ]);
    send(res, status, { error: safeErrors.has(error.message) ? error.message : "bad_request" });
  }
}

async function autoSyncWeb() {
  const snapshot = readState();
  const updates = new Map();
  for (const source of snapshot.webSources) {
    try {
      const text = await fetchText(source.url);
      const streams = (source.type === "html" ? parseHtml(text) : parseM3u(text)).slice(0, MAX_WEB_STREAMS);
      if (!streams.length) throw new Error("empty_directory");
      updates.set(source.id, {
        url: source.url,
        type: source.type,
        streams,
        syncedAt: new Date().toISOString(),
        lastErrorAt: null,
      });
      console.log(`[auto-sync] ${source.name}: refreshed ${streams.length} web streams`);
    } catch (error) {
      updates.set(source.id, {
        url: source.url,
        type: source.type,
        lastErrorAt: new Date().toISOString(),
      });
      console.error(`[auto-sync] ${source.name}: failed: ${error.message}`);
    }
  }
  const latest = readState();
  const webSources = latest.webSources.map((source) => {
    const update = updates.get(source.id);
    if (!update || update.url !== source.url || update.type !== source.type) return source;
    return { ...source, ...update };
  });
  writeState({ ...latest, webSources });
}

function createServer() {
  return http.createServer(handleRequest);
}

function startServer() {
  ensureState();
  try { fs.rmSync(REMUX_DIR, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(REMUX_DIR, { recursive: true });
  const server = createServer();
  const runAutoSync = () => autoSyncWeb().catch((error) => console.error(`[auto-sync] failed: ${error.message}`));
  const runPreheat = () => runFootballPreheat().catch((error) => console.error(`[preheat] fallo: ${error.message}`));
  const remuxTimer = setInterval(reapRemuxSessions, 15000);
  const scannerTimer = setInterval(pruneScannerState, 60000);
  const syncTimer = setInterval(runAutoSync, WEB_SYNC_INTERVAL_MS);
  const preheatTimer = setInterval(runPreheat, PREHEAT_TICK_MS);
  const preheatWarmTimer = setTimeout(runPreheat, 5000);
  server.on("close", () => {
    clearInterval(remuxTimer);
    clearInterval(scannerTimer);
    clearInterval(syncTimer);
    clearInterval(preheatTimer);
    clearTimeout(preheatWarmTimer);
    scannerQueue.length = 0;
    for (const job of scannerJobs.values()) {
      if (job.retryTimer) clearTimeout(job.retryTimer);
      job.retryTimer = null;
      if (!['complete', 'cancelled'].includes(job.status)) job.status = 'cancelled';
    }
    for (const key of [...remuxSessions.keys()]) remuxCleanup(key);
  });
  server.listen(Number(process.env.PORT) || 3000, "0.0.0.0");
  runAutoSync();
  return server;
}

if (require.main === module) startServer();

module.exports = {
  createServer,
  startServer,
  readState,
  writeState,
  normalizeHash,
  normalizeItem,
  normalizePreferences,
  normalizeChannelKey,
  semanticChannelText,
  semanticNumbersCompatible,
  cosineSimilarity,
  applySemanticCandidateScores,
  semanticScore,
  RESOLUTION_EXACT_SCORE,
  SEMANTIC_MAX_SCORE,
  channelMatchScore,
  normalizeChannelBinding,
  normalizeSourceReport,
  normalizeChannelFeedback,
  applyLearnedSourceRules,
  normalizeWebSource,
  parseM3u,
  parseHtml,
  parseByteRange,
  normalizeFootballRows,
  normalizeEpgAirings,
  parseFutbolEnLaTv,
  espnLeaguesFor,
  teamSimilarity,
  bestTeamSimilarity,
  canonicalTeam,
  readEspnEvent,
  matchIsInScoreWindow,
  getLiveScores,
  fetchFutbolEnLaTvSchedule,
  decodeHtml,
  epgSplitTeams,
  fetchEpgFootballSchedule,
  madridDateTime,
  channelMatchScore,
  enrichFootballLeagues,
  buildFootballDemoSchedule,
  getFootballSchedule,
  footballProgramChannelNames,
  rememberFootballProgramming,
  footballProgramMatch,
  parseAceSearchResults,
  scannerEnginePath,
  parseScannerStats,
  inspectScannerMedia,
  classifyScannerEvidence,
  probeAceCandidate,
  scannerRetryPlan,
  scannerJobPayload,
  footballPreheatStage,
  preheatFootballMatch,
  runFootballPreheat,
  esFamiliaDe,
  proveedorDeSeñal,
  repartirEntreProveedores,
  scoreResolutionCandidate,
  mergeResolutionCandidates,
  normalizeSourceStats,
  anotarResultado,
  tasaFiable,
  fiabilidadDeCandidato,
  registrarResultadoDeFuente,
  STATS_NEUTRAL,
  resolutionTier,
  aceSearchQueries,
  resolveFootballChannel,
  reportSource,
  saveSourceFeedback,
  systemHealth,
  fetchText,
  isPrivateAddress,
  isPrivateHostname,
  mutateLibrary,
  claimPlayback,
  releasePlayback,
};
