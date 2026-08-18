const http = require("http");
const https = require("https");
const dns = require("dns");
const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");

const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const ACESTREAM_CONTAINER = "ismaeloul-ace-player-neo_acestream_1";
const ENGINE_CONTROL_HOST = process.env.ENGINE_CONTROL_HOST || "engine_control";
const HASH_RE = /^[a-fA-F0-9]{40}$/;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_HISTORY = 60;
const MAX_WEB_STREAMS = 500;
const MAX_WEB_SOURCES = 8;
const MAX_FOOTBALL_LEAGUES = 12;
const MAX_FOOTBALL_TEAMS = 24;
const MAX_FOOTBALL_NATIONALITIES = 24;
const MAX_CHANNEL_BINDINGS = 120;
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
  const src = `http://${ACESTREAM_CONTAINER}:6878/ace/getstream?${idParam}=${id}`;
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
    // aresample=async=1 rellena/recorta muestras cuando el TS en directo trae
    // huecos o timestamps no monotonos: sin esto el audio deriva respecto al
    // video copiado (desync creciente) y el muxer avisa "Packet duration ... out of range"
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-ac", "2",
    "-af", "aresample=async=1:min_hard_comp=0.100:first_pts=0",
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
]);
// Techo para nombres que difieren en una palabra propia: quedan por debajo
// de recomendar (70) y de reproducir solo (92), pero siguen siendo elegibles.
const CHANNEL_VARIANT_MAX_SCORE = 58;
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

function channelMatchScore(left, right) {
  const a = normalizeChannelKey(left);
  const b = normalizeChannelKey(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  const numsA = (a.match(/\d+/g) || []).join(",");
  const numsB = (b.match(/\d+/g) || []).join(",");
  if (numsA !== numsB && (numsA || numsB)) return 0;
  const tokensA = a.split(" ");
  const tokensB = b.split(" ");
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
  return { ...state, webSources: sourceSummaries(state.webSources) };
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
      nowPlaying: normalizeNowPlaying(parsed.nowPlaying),
    };
  } catch {
    const source = normalizeWebSource({ id: DEFAULT_WEB_SOURCE_ID, name: "Directorio principal", url: DEFAULT_WEB_SYNC_URL }, 0);
    return {
      favorites: [], history: [], web: [], webSyncedAt: null,
      webSources: source ? [source] : [], activeWebSourceId: source?.id || null,
      preferences: normalizePreferences(null), channelBindings: [],
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
  const sideEffectGet = req.method === "GET" && (req.url === "/api/remux" || req.url.startsWith("/api/remux?"));
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

async function getFootballSchedule() {
  if (FOOTBALL_DEMO_ONLY) return buildFootballDemoSchedule();
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
      hostname: ACESTREAM_CONTAINER,
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
  // se puntua contra el nombre visible y contra el tvg-id, y gana el mejor:
  // listas como NEW ERA rotulan "DAZN 1 --> NEW ERA" pero declaran "DAZN 1 HD"
  const names = item.alias ? [item.title, item.alias] : [item.title];
  for (const channel of channels) {
    for (const name of names) {
      const candidateScore = channelMatchScore(channel, name);
      if (candidateScore > score) {
        score = candidateScore;
        matchedChannel = channel;
      }
    }
  }
  return {
    id: item.id,
    title: item.title,
    ih: item.ih === true,
    source,
    score,
    matchedChannel,
    availability: typeof item.availability === "number" ? item.availability : null,
    bitrate: typeof item.bitrate === "number" ? item.bitrate : null,
  };
}

function libraryResolutionCandidates(state, channels) {
  const output = [];
  const seen = new Set();
  const directoryItems = Array.isArray(state.webSources)
    ? state.webSources.flatMap((source) => source.streams) : state.web;
  for (const [source, items] of [
    ["m3u", directoryItems],
    ["favorites", state.favorites],
    ["history", state.history],
  ]) {
    for (const item of items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      const candidate = scoreResolutionCandidate(channels, item, source);
      /* 70, no 58: 58 es justo el techo que se pone a las variantes de un
         canal parecido, asi que con ese umbral se colaba "LaLiga TV
         Hypermotion" (Segunda) entre las opciones de un partido de Champions.
         Los canales correctos puntuan 100 gracias al tvg-id, asi que 70 separa
         limpiamente sin perder ninguno. */
      if (candidate.score >= LIBRARY_MIN_SCORE) output.push(candidate);
    }
  }
  return output.sort((a, b) => b.score - a.score);
}

function mergeResolutionCandidates(candidates) {
  const byId = new Map();
  for (const candidate of candidates) {
    const current = byId.get(candidate.id);
    if (!current || candidate.score > current.score
      || (candidate.score === current.score && candidate.source === "m3u")) {
      byId.set(candidate.id, candidate);
    }
  }
  return [...byId.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return (b.availability ?? -1) - (a.availability ?? -1);
  }).slice(0, 8);
}

async function resolveFootballChannel(state, values, search = searchAceStreams) {
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
  const checked = ["saved", "m3u", "library", "acestream"];

  const bindings = state.channelBindings
    .map((binding) => {
      const scored = scoreResolutionCandidate(channels, { ...binding, title: binding.channel }, "saved");
      return { ...scored, title: binding.title, ih: binding.ih };
    })
    .filter((candidate) => candidate.score >= 92);

  const local = libraryResolutionCandidates(state, channels);

  const searched = await Promise.allSettled(channels.slice(0, 3).map((channel) => search(channel)));
  const engineAvailable = searched.some((result) => result.status === "fulfilled");
  const remote = [];
  for (const result of searched) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value) {
      const candidate = scoreResolutionCandidate(channels, item, "acestream");
      if (candidate.score >= 58) remote.push(candidate);
    }
  }

  const candidates = mergeResolutionCandidates([...bindings, ...local, ...remote]);
  if (!candidates.length) {
    return { success: true, status: "not_found", channels, checked, candidates: [], engineAvailable };
  }

  /* Un vinculo guardado manda sobre todo. Si no, hace falta que no haya
     ambiguedad, pero OJO: reunir mas fuentes hace que varias empaten arriba,
     y eso no es ambiguo si todas son del MISMO canal -son justo las señales
     alternativas que buscamos-. Solo se pregunta si empatan canales
     DISTINTOS, que es cuando de verdad no se sabe cual quiere el usuario. */
  const guardado = candidates.find((c) => c.source === "saved");
  const cabeza = candidates.filter((c) => c.score >= 92);
  const canalesEnCabeza = new Set(cabeza.map((c) => normalizeChannelKey(c.title)));
  const inequivoco = cabeza.length > 0 && canalesEnCabeza.size === 1;
  /* Habiendo candidatos validos se reproduce el mejor y punto: el selector de
     fuentes ya deja cambiar de señal sin volver a preguntar. El dialogo de
     eleccion solo aparece si no hay ninguno claro. */
  const elegido = guardado || (inequivoco ? cabeza[0] : null) || (cabeza[0] || null);

  if (elegido) {
    return { success: true, status: "found", channels, checked, candidate: elegido, candidates, engineAvailable };
  }
  return { success: true, status: "choices", channels, checked, candidates, engineAvailable };
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

    if (req.url === "/api/football/resolve" || req.url.startsWith("/api/football/resolve?")) {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const channels = new URL(req.url, "http://internal").searchParams.getAll("channel");
      return send(res, 200, await resolveFootballChannel(readState(), channels));
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
  const remuxTimer = setInterval(reapRemuxSessions, 15000);
  const syncTimer = setInterval(runAutoSync, WEB_SYNC_INTERVAL_MS);
  server.on("close", () => {
    clearInterval(remuxTimer);
    clearInterval(syncTimer);
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
  channelMatchScore,
  normalizeChannelBinding,
  normalizeWebSource,
  parseM3u,
  parseHtml,
  parseByteRange,
  normalizeFootballRows,
  normalizeEpgAirings,
  parseFutbolEnLaTv,
  fetchFutbolEnLaTvSchedule,
  decodeHtml,
  epgSplitTeams,
  fetchEpgFootballSchedule,
  madridDateTime,
  channelMatchScore,
  enrichFootballLeagues,
  buildFootballDemoSchedule,
  getFootballSchedule,
  parseAceSearchResults,
  resolveFootballChannel,
  fetchText,
  isPrivateAddress,
  isPrivateHostname,
  mutateLibrary,
  claimPlayback,
  releasePlayback,
};
