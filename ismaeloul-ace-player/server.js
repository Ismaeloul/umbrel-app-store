const http = require("http");
const fs = require("fs");
const path = require("path");

const DATA_DIR = process.env.DATA_DIR || "/data";
const STATE_FILE = path.join(DATA_DIR, "state.json");
const DOCKER_SOCKET = "/var/run/docker.sock";
const ACESTREAM_CONTAINER = "ismaeloul-ace-player_acestream_1";
const MAX_HISTORY = 50;
const HASH_RE = /^[a-fA-F0-9]{40}$/;

function ensureState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(STATE_FILE)) {
    fs.writeFileSync(STATE_FILE, JSON.stringify({ favorites: [], history: [] }, null, 2));
  }
}

function normalizeItem(item) {
  const hash = String(item?.hash || "").trim().replace(/^acestream:\/\//i, "");
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
        req.destroy();
        reject(new Error("Body too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
  });
}

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

function restartAceStream() {
  return new Promise((resolve, reject) => {
    const req = http.request({
      socketPath: DOCKER_SOCKET,
      path: `/containers/${ACESTREAM_CONTAINER}/restart?t=2`,
      method: "POST",
    }, (dockerRes) => {
      let body = "";
      dockerRes.on("data", (chunk) => { body += chunk; });
      dockerRes.on("end", () => {
        if (dockerRes.statusCode >= 200 && dockerRes.statusCode < 300) {
          resolve({ restarted: true });
        } else {
          reject(new Error(`Docker restart failed ${dockerRes.statusCode}: ${body}`));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});

  try {
    if (req.url === "/api/state") {
      if (req.method === "GET") return send(res, 200, readState());
      if (req.method === "PUT") return send(res, 200, writeState(await readBody(req)));
      return send(res, 405, { error: "method_not_allowed" });
    }

    if (req.url === "/api/restart-engine") {
      if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });
      return send(res, 200, await restartAceStream());
    }

    return send(res, 404, { error: "not_found" });
  } catch (error) {
    return send(res, 400, { error: "bad_request", message: error.message });
  }
});

ensureState();
server.listen(3000, "0.0.0.0");
