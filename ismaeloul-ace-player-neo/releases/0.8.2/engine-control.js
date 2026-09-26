// Ace Player Neo 0.8.2 · engine-control.js
// Generado por ace-player-neo/apps/server/build.mjs (esbuild). No se edita a mano.
"use strict";
var __ace_import_meta_url = require("node:url").pathToFileURL(__filename).href;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/engine-control/server.ts
var import_node_crypto = require("node:crypto");
var import_node_http = __toESM(require("node:http"), 1);
var DOCKER_SOCKET = "/var/run/docker.sock";
var DEFAULT_ACESTREAM_CONTAINER = "ismaeloul-ace-player-neo_acestream_1";
var RESTART_COOLDOWN_MS = 15e3;
var DOCKER_TIMEOUT_MS = 7e3;
var ENGINE_CONTROL_PORT = 3001;
var FORCE_EXIT_MS = 5e3;
var systemClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle)
};
function sanitizeContainer(value) {
  return String(value || "").trim().replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 128) || DEFAULT_ACESTREAM_CONTAINER;
}
function normalizeToken(value) {
  return String(value || "").trim().slice(0, 200);
}
function optionsFromEnv(env) {
  return {
    token: normalizeToken(env.ENGINE_CONTROL_TOKEN),
    container: sanitizeContainer(env.ACESTREAM_CONTAINER)
  };
}
function digest(value) {
  return (0, import_node_crypto.createHash)("sha256").update(value, "utf8").digest();
}
function tokenValido(req, token) {
  if (!token) return false;
  const header = req.headers["x-engine-token"];
  const given = typeof header === "string" ? header : "";
  return (0, import_node_crypto.timingSafeEqual)(digest(given), digest(token));
}
function send(res, status, payload) {
  if (res.writableEnded) return;
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  res.end(JSON.stringify(payload));
}
function createRequestHandler(options) {
  const clock = options.clock ?? systemClock;
  const socketPath = options.dockerSocket ?? DOCKER_SOCKET;
  const timeoutMs = options.dockerTimeoutMs ?? DOCKER_TIMEOUT_MS;
  const container = sanitizeContainer(options.container);
  const log = options.log ?? (() => void 0);
  let lastRestartAt = null;
  function restartEngine(res) {
    const now = clock.now();
    if (lastRestartAt !== null && now - lastRestartAt < RESTART_COOLDOWN_MS) {
      send(res, 429, { error: "restart_cooldown" });
      return;
    }
    lastRestartAt = now;
    let answered = false;
    let timer = null;
    const answer = (status, payload) => {
      if (answered) return;
      answered = true;
      if (timer !== null) clock.clearTimeout(timer);
      if (status !== 200) log(`reinicio fallido (${status})`);
      else log(`contenedor ${container} reiniciado`);
      send(res, status, payload);
    };
    const dockerRequest = import_node_http.default.request(
      {
        socketPath,
        path: `/containers/${encodeURIComponent(container)}/restart?t=2`,
        method: "POST"
      },
      (dockerResponse) => {
        dockerResponse.resume();
        dockerResponse.on("end", () => {
          const code = dockerResponse.statusCode ?? 0;
          if (code >= 200 && code < 300) answer(200, { restarted: true });
          else answer(502, { error: "restart_failed" });
        });
        dockerResponse.on("error", () => answer(502, { error: "restart_failed" }));
      }
    );
    timer = clock.setTimeout(() => dockerRequest.destroy(new Error("docker_timeout")), timeoutMs);
    dockerRequest.on("error", () => answer(502, { error: "restart_failed" }));
    dockerRequest.end();
  }
  return (req, res) => {
    if (req.method === "POST" && req.url === "/restart") {
      req.resume();
      if (!tokenValido(req, options.token)) {
        send(res, 401, { error: "unauthorized" });
        return;
      }
      restartEngine(res);
      return;
    }
    req.resume();
    send(res, 404, { error: "not_found" });
  };
}
function createServer(options) {
  return import_node_http.default.createServer(createRequestHandler(options));
}
function startEngineControl(env, start = {}) {
  const log = start.log ?? ((line) => console.log(`engine-control: ${line}`));
  const base = optionsFromEnv(env);
  if (!base.token) {
    log("ENGINE_CONTROL_TOKEN vacío: se rechazarán todos los reinicios (401)");
  }
  const server = createServer({
    ...base,
    log,
    ...start.dockerSocket ? { dockerSocket: start.dockerSocket } : {},
    ...start.clock ? { clock: start.clock } : {}
  });
  const exit = start.exit ?? ((code) => process.exit(code));
  const signals = start.signals ?? process;
  const clock = start.clock ?? systemClock;
  let closing = false;
  const shutdown = () => {
    if (closing) return;
    closing = true;
    server.close(() => exit(0));
    const force = clock.setTimeout(() => exit(1), FORCE_EXIT_MS);
    force?.unref?.();
  };
  signals.once("SIGTERM", shutdown);
  signals.once("SIGINT", shutdown);
  const listening = new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(start.port ?? ENGINE_CONTROL_PORT, start.host ?? "0.0.0.0", () => {
      const address = server.address();
      resolve(typeof address === "object" && address ? address.port : start.port ?? 0);
    });
  });
  return { server, listening };
}

// src/engine-control/main.ts
startEngineControl(process.env).listening.catch((error) => {
  console.error("engine-control: no se pudo escuchar en el puerto 3001", error);
  process.exit(1);
});
