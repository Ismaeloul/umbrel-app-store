const http = require("http");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const DOCKER_SOCKET = "/var/run/docker.sock";
const ACESTREAM_CONTAINER = "ismaeloul-ace-player_acestream_1";
const HASH_RE = /^[a-fA-F0-9]{40}$/;
const MAX_HISTORY = 40;
const RESTART_COOLDOWN_MS = 15000;
let lastRestartAt = 0;

function ensureState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ favorites: [], history: [] }, null, 2));
  }
}

function normalizeItem(item) {
  const hash = String(item?.hash || "").trim();
  if (!HASH_RE.test(hash)) return null;
  return {
    hash,
    name: String(item?.name || `Canal ${hash.slice(0, 8)}`).trim().slice(0, 80),
    date: item?.date || new Date().toISOString(),
  };
}

function readState() {
  ensureState();
  try {
    const parsed = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    return {
      favorites: Array.isArray(parsed.favorites) ? parsed.favorites.map(normalizeItem).filter(Boolean) : [],
      history: Array.isArray(parsed.history) ? parsed.history.map(normalizeItem).filter(Boolean).slice(0, MAX_HISTORY) : [],
    };
  } catch {
    return { favorites: [], history: [] };
  }
}

function writeState(nextState) {
  const state = {
    favorites: Array.isArray(nextState.favorites) ? nextState.favorites.map(normalizeItem).filter(Boolean) : [],
    history: Array.isArray(nextState.history) ? nextState.history.map(normalizeItem).filter(Boolean).slice(0, MAX_HISTORY) : [],
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
      if (body.length > 1024 * 1024) {
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

function hostFromUrl(value) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

function hasTrustedOrigin(req) {
  const host = req.headers.host;
  const originHost = hostFromUrl(req.headers.origin || "");
  const refererHost = hostFromUrl(req.headers.referer || "");
  if (!originHost && !refererHost) return true;
  return Boolean(host && (!originHost || originHost === host) && (!refererHost || refererHost === host));
}

function requireTrustedWrite(req) {
  if (!hasTrustedOrigin(req)) {
    const error = new Error("forbidden");
    error.statusCode = 403;
    throw error;
  }
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
          return;
        }
        const error = new Error("restart_failed");
        error.statusCode = 502;
        reject(error);
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
        requireTrustedWrite(req);
        return send(res, 200, writeState(await readBody(req)));
      }
      return send(res, 405, { error: "method_not_allowed" });
    }

    if (req.url === "/api/restart-engine") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      requireTrustedWrite(req);
      return send(res, 200, await restartAceStream());
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    const status = error.statusCode || 400;
    const safeErrors = new Set(["forbidden", "method_not_allowed", "restart_cooldown", "restart_failed"]);
    return send(res, status, { error: safeErrors.has(error.message) ? error.message : "bad_request" });
  }
});

ensureState();
server.listen(3000, "0.0.0.0");
