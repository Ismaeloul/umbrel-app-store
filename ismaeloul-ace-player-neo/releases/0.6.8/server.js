const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const DOCKER_SOCKET = "/var/run/docker.sock";
const ACESTREAM_CONTAINER = "ismaeloul-ace-player-neo_acestream_1";
const HASH_RE = /^[a-fA-F0-9]{40}$/;
const MAX_BODY = 2 * 1024 * 1024;
const MAX_HISTORY = 60;
const MAX_WEB_STREAMS = 300;
const RESTART_COOLDOWN_MS = 15000;
const DEFAULT_WEB_SYNC_URL = "https://ipfs.io/ipns/k51qzi5uqu5di462t7j4vu4akwfhvtjhy88qbupktvoacqfqe9uforjvhyi4wr/hashes_acestream.m3u";
const WEB_SYNC_INTERVAL_MS = 3 * 60 * 60 * 1000;

let lastRestartAt = 0;

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
  try { s.proc.kill("SIGKILL"); } catch {}
  try { fs.rmSync(s.dir, { recursive: true, force: true }); } catch {}
}
setInterval(() => {
  const now = Date.now();
  for (const [key, s] of remuxSessions) {
    if (now - s.lastAccess > 90000) remuxCleanup(key);
  }
}, 15000);

function ensureRemux(idParam, id) {
  const key = id.toLowerCase();
  let s = remuxSessions.get(key);
  if (s) { s.lastAccess = Date.now(); return s; }
  const dir = path.join(REMUX_DIR, key);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  fs.mkdirSync(dir, { recursive: true });
  const src = `http://${ACESTREAM_CONTAINER}:6878/ace/getstream?${idParam}=${id}`;
  const logFd = fs.openSync(path.join(dir, "ffmpeg.log"), "w");
  const proc = spawn("ffmpeg", [
    "-hide_banner", "-loglevel", "warning", "-nostdin",
    "-fflags", "+genpts+discardcorrupt",
    "-probesize", "5000000", "-analyzeduration", "5000000",
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
    "-hls_flags", "delete_segments+independent_segments",
    "-hls_segment_type", "fmp4", "-hls_fmp4_init_filename", "init.mp4",
    path.join(dir, "index.m3u8"),
  ], { stdio: ["ignore", "ignore", logFd] });
  try { fs.closeSync(logFd); } catch {}
  s = { proc, dir, lastAccess: Date.now() };
  proc.on("error", () => { if (remuxSessions.get(key) === s) remuxCleanup(key); });
  proc.on("exit", () => { if (remuxSessions.get(key) === s) remuxSessions.delete(key); });
  remuxSessions.set(key, s);
  return s;
}

const REMUX_TYPES = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".ts": "video/mp2t",
};

function ensureState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ favorites: [], history: [], web: [], webSyncedAt: null }, null, 2));
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
  return {
    id,
    title,
    type,
    category,
    date: item?.date || new Date().toISOString(),
    fromWebSync: item?.fromWebSync === true,
    // true si el id es un infohash (resultados del buscador): se reproduce con ?infohash=
    ih: item?.ih === true,
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
    at,
  };
}

function readState() {
  ensureState();
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.map((i) => normalizeItem(i, "fav")).filter(Boolean) : [],
      history: Array.isArray(parsed.history) ? parsed.history.map((i) => normalizeItem(i, "recent")).filter(Boolean).slice(0, MAX_HISTORY) : [],
      web: Array.isArray(parsed.web) ? parsed.web.map((i) => normalizeItem(i, "web")).filter(Boolean).slice(0, MAX_WEB_STREAMS) : [],
      webSyncedAt: typeof parsed.webSyncedAt === "string" ? parsed.webSyncedAt : null,
      nowPlaying: normalizeNowPlaying(parsed.nowPlaying),
    };
  } catch {
    return { favorites: [], history: [], web: [], webSyncedAt: null, nowPlaying: null };
  }
}

function writeState(nextState) {
  const seen = new Set();
  const unique = (items, type, max) => {
    const output = [];
    for (const item of Array.isArray(items) ? items : []) {
      const normalized = normalizeItem({ ...item, type }, type);
      if (!normalized || seen.has(`${type}:${normalized.id}`)) continue;
      seen.add(`${type}:${normalized.id}`);
      output.push(normalized);
      if (output.length >= max) break;
    }
    return output;
  };
  const state = {
    favorites: unique(nextState.favorites, "fav", MAX_HISTORY),
    history: unique(nextState.history, "recent", MAX_HISTORY),
    web: unique(nextState.web, "web", MAX_WEB_STREAMS),
    webSyncedAt: typeof nextState.webSyncedAt === "string" ? nextState.webSyncedAt : null,
    nowPlaying: normalizeNowPlaying(nextState.nowPlaying),
  };
  const tempFile = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2));
  fs.renameSync(tempFile, STATE_FILE);
  return state;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error("body_too_large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error("bad_json"));
      }
    });
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

function fetchText(url) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error("bad_url"));
      return;
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
      reject(new Error("bad_url"));
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.get(parsed, {
      timeout: 12000,
      headers: { "User-Agent": "AcePlayerNeo/0.2" },
    }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, parsed).toString();
        fetchText(nextUrl).then(resolve, reject);
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new Error("fetch_failed"));
        return;
      }
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        body += chunk;
        if (body.length > MAX_BODY) {
          req.destroy(new Error("response_too_large"));
        }
      });
      response.on("end", () => resolve(body));
    });
    req.on("timeout", () => req.destroy(new Error("fetch_timeout")));
    req.on("error", reject);
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

function parseM3u(text) {
  const streams = [];
  let currentTitle = "";
  let currentCategory = "Importado";
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("#EXTINF:")) {
      const categoryMatch = line.match(/group-title="([^"]+)"/i);
      currentCategory = cleanTitle(categoryMatch?.[1], "Importado");
      currentTitle = cleanTitle(line.split(",").slice(1).join(","), "Stream M3U");
      continue;
    }
    const id = normalizeHash(line);
    if (id) {
      streams.push({ id, title: currentTitle || `Stream ${id.slice(0, 8)}`, type: "web", category: currentCategory || "Importado" });
      currentTitle = "";
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
    const dockerReq = http.request({
      socketPath: DOCKER_SOCKET,
      path: `/containers/${ACESTREAM_CONTAINER}/restart?t=2`,
      method: "POST",
    }, (dockerRes) => {
      dockerRes.resume();
      dockerRes.on("end", () => {
        if (dockerRes.statusCode >= 200 && dockerRes.statusCode < 300) {
          resolve({ restarted: true });
        } else {
          const error = new Error("restart_failed");
          error.statusCode = 502;
          reject(error);
        }
      });
    });
    dockerReq.on("error", (error) => {
      error.statusCode = 502;
      reject(error);
    });
    dockerReq.end();
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === "/api/state") {
      if (req.method === "GET") return send(res, 200, readState());
      if (req.method === "PUT") {
        const body = await readBody(req);
        const current = readState();
        // nowPlaying: gana el mas reciente (el ultimo dispositivo que dio al play)
        const incoming = normalizeNowPlaying(body.nowPlaying);
        body.nowPlaying = (incoming && (!current.nowPlaying || incoming.at >= current.nowPlaying.at))
          ? incoming
          : current.nowPlaying;
        return send(res, 200, writeState({ webSyncedAt: current.webSyncedAt, ...body }));
      }
      return send(res, 405, { error: "method_not_allowed" });
    }

    if (req.url.startsWith("/api/remux")) {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const u = new URL(req.url, "http://internal");
      const ihParam = u.searchParams.get("infohash");
      const id = normalizeHash(ihParam || u.searchParams.get("id"));
      if (!id) return send(res, 400, { error: "bad_request" });
      const s = ensureRemux(ihParam ? "infohash" : "id", id);
      const manifest = path.join(s.dir, "index.m3u8");
      const t0 = Date.now();
      while (!fs.existsSync(manifest)) {
        if (!remuxSessions.has(id.toLowerCase())) return send(res, 502, { error: "remux_died" });
        if (Date.now() - t0 > 40000) return send(res, 504, { error: "remux_timeout" });
        await new Promise((r) => setTimeout(r, 500));
      }
      return send(res, 200, { url: `/remux/${id.toLowerCase()}/index.m3u8` });
    }

    if (req.url.startsWith("/remux/")) {
      const rel = decodeURIComponent(req.url.split("?")[0]).slice("/remux/".length);
      if (!rel || rel.includes("..") || rel.includes("\\")) { res.writeHead(403); return res.end(); }
      const s = remuxSessions.get(rel.split("/")[0]);
      if (s) s.lastAccess = Date.now();
      const file = path.join(REMUX_DIR, rel);
      return fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404, { "Cache-Control": "no-store" }); return res.end(); }
        res.writeHead(200, {
          "Content-Type": REMUX_TYPES[path.extname(file)] || "application/octet-stream",
          "Cache-Control": "no-store",
        });
        res.end(data);
      });
    }

    if (req.url.startsWith("/api/search")) {
      if (req.method !== "GET") return send(res, 405, { error: "method_not_allowed" });
      const query = new URL(req.url, "http://internal").searchParams.get("q") || "";
      const q = query.replace(/\s+/g, " ").trim().slice(0, 80);
      if (q.length < 2) return send(res, 400, { error: "empty_query" });

      const result = await aceRequest(`/search?query=${encodeURIComponent(q)}&page_size=60`, 12000);
      let parsed;
      try {
        parsed = JSON.parse(result.body);
      } catch {
        const error = new Error("engine_bad_response");
        error.statusCode = 502;
        throw error;
      }

      // El motor puede devolver los resultados planos o agrupados por canal
      // ({ items: [...] }); se aceptan ambas formas.
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
      items.sort((a, b) => (b.availability ?? -1) - (a.availability ?? -1));
      return send(res, 200, { query: q, results: items });
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
      const text = await fetchText(body.url);
      const streams = (body.type === "m3u" ? parseM3u(text) : parseHtml(text)).slice(0, MAX_WEB_STREAMS);
      const state = readState();
      const nextState = writeState({ ...state, web: streams, webSyncedAt: new Date().toISOString() });
      return send(res, 200, { success: true, streams: nextState.web, webSyncedAt: nextState.webSyncedAt });
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    const status = error.statusCode || 400;
    const safeErrors = new Set([
      "ace_timeout",
      "bad_json",
      "bad_url",
      "body_too_large",
      "empty_query",
      "engine_bad_response",
      "fetch_failed",
      "fetch_timeout",
      "method_not_allowed",
      "restart_cooldown",
      "restart_failed",
      "response_too_large",
    ]);
    send(res, status, { error: safeErrors.has(error.message) ? error.message : "bad_request" });
  }
});

async function autoSyncWeb() {
  try {
    const text = await fetchText(DEFAULT_WEB_SYNC_URL);
    const streams = parseM3u(text).slice(0, MAX_WEB_STREAMS);
    const state = readState();
    writeState({ ...state, web: streams, webSyncedAt: new Date().toISOString() });
    console.log(`[auto-sync] refreshed ${streams.length} web streams`);
  } catch (error) {
    console.error(`[auto-sync] failed: ${error.message}`);
  }
}

ensureState();
server.listen(3000, "0.0.0.0");
autoSyncWeb();
setInterval(autoSyncWeb, WEB_SYNC_INTERVAL_MS);
