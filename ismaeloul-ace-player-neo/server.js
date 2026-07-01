const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

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
    };
  } catch {
    return { favorites: [], history: [], web: [], webSyncedAt: null };
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

function aceRequest(pathname) {
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: ACESTREAM_CONTAINER,
      port: 6878,
      path: pathname,
      timeout: 5000,
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
        return send(res, 200, writeState({ webSyncedAt: current.webSyncedAt, ...body }));
      }
      return send(res, 405, { error: "method_not_allowed" });
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
      "bad_json",
      "bad_url",
      "body_too_large",
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
