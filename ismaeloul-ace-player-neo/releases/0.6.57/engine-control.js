"use strict";

const http = require("http");

const DOCKER_SOCKET = "/var/run/docker.sock";
const ACESTREAM_CONTAINER = String(process.env.ACESTREAM_CONTAINER || "ismaeloul-ace-player-neo_acestream_1")
  .trim().replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 128) || "ismaeloul-ace-player-neo_acestream_1";
const RESTART_COOLDOWN_MS = 15000;
/* Secreto compartido con el backend (el compose pone APP_SEED en los dos).
   Todos los contenedores del NAS comparten red: sin esto, cualquier app podia
   reiniciar el motor a media emision. Vacio = sin comprobacion, para que una
   instalacion que aun no tenga la variable siga funcionando. */
const ENGINE_CONTROL_TOKEN = String(process.env.ENGINE_CONTROL_TOKEN || "").trim().slice(0, 200);
let lastRestartAt = 0;

function send(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function restartEngine(res) {
  const now = Date.now();
  if (now - lastRestartAt < RESTART_COOLDOWN_MS) return send(res, 429, { error: "restart_cooldown" });
  lastRestartAt = now;
  let answered = false;
  const answer = (status, payload) => {
    if (answered || res.writableEnded) return;
    answered = true;
    send(res, status, payload);
  };
  const dockerRequest = http.request({
    socketPath: DOCKER_SOCKET,
    path: `/containers/${encodeURIComponent(ACESTREAM_CONTAINER)}/restart?t=2`,
    method: "POST",
    timeout: 7000,
  }, (dockerResponse) => {
    dockerResponse.resume();
    dockerResponse.on("end", () => {
      if (dockerResponse.statusCode >= 200 && dockerResponse.statusCode < 300) {
        answer(200, { restarted: true });
      } else {
        answer(502, { error: "restart_failed" });
      }
    });
    dockerResponse.on("error", () => answer(502, { error: "restart_failed" }));
  });
  dockerRequest.on("timeout", () => dockerRequest.destroy(new Error("docker_timeout")));
  dockerRequest.on("error", () => answer(502, { error: "restart_failed" }));
  dockerRequest.end();
}

function tokenValido(req) {
  if (!ENGINE_CONTROL_TOKEN) return true;
  return String(req.headers["x-engine-token"] || "") === ENGINE_CONTROL_TOKEN;
}

function handleRequest(req, res) {
  if (req.method === "POST" && req.url === "/restart") {
    req.resume();
    if (!tokenValido(req)) return send(res, 401, { error: "unauthorized" });
    return restartEngine(res);
  }
  return send(res, 404, { error: "not_found" });
}

function createServer() {
  return http.createServer(handleRequest);
}

if (require.main === module) {
  const server = createServer();
  server.listen(3001, "0.0.0.0");

  const shutdown = () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

module.exports = { createServer, handleRequest, tokenValido };
