#!/usr/bin/env node
// Soak contra el motor AceStream REAL (prompt §2.3 y §2.4: al menos 30 min).
//
// Hace de cliente web: pide el canal a /api/v1/channels/:id/stream, lee el
// vídeo que entrega nginx, manda el latido de la sesión y mide el caudal cada
// 10 s. Si el flujo se corta, vuelve a pedir el canal como haría la web y
// apunta cuánto tardó en recuperarse. Al acabar suelta la sesión.
//
// Uso (con la pila local del perfil "real" levantada):
//   node scripts/soak-real.mjs --base http://127.0.0.1:17793 --id <hash> --min 30
// La salida es JSON por líneas (una por ventana de 10 s) y un resumen final.

import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    base: { type: 'string', default: 'http://127.0.0.1:17793' },
    id: { type: 'string' },
    min: { type: 'string', default: '30' },
    mode: { type: 'string', default: 'balanced' },
  },
});
if (!values.id || !/^[0-9a-f]{40}$/i.test(values.id)) {
  console.error('Falta --id <hash de 40 caracteres>');
  process.exit(2);
}

const BASE = values.base.replace(/\/$/, '');
const DURATION_MS = Number(values.min) * 60_000;
const VIEWER = `soak-${process.pid}`;
const WINDOW_MS = 10_000;
// Una ventana sin bytes durante tanto tiempo se cuenta como corte visible.
const STALL_MS = 8_000;

const startedAt = Date.now();
const summary = {
  minutos: Number(values.min),
  bytes: 0,
  aperturas: 0,
  cortes: 0,
  recuperacionesMs: [],
  ventanasSinDatos: 0,
  primeraImagenMs: null,
  errores: [],
};

let session = null;
let lastByteAt = Date.now();
let windowBytes = 0;

async function openStream() {
  const t0 = Date.now();
  const res = await fetch(
    `${BASE}/api/v1/channels/${values.id}/stream?client=web&mode=${values.mode}&viewer=${VIEWER}`,
  );
  if (!res.ok) throw new Error(`stream ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = await res.json();
  session = body.session;
  summary.aperturas += 1;
  // El motor real responde 500 en /ace/r/ mientras precarga la sesión recién
  // abierta: se reintenta como hace el reproductor web, hasta 45 s.
  let media;
  for (let i = 0; i < 45; i++) {
    media = await fetch(new URL(body.url, BASE));
    if (media.ok && media.body) break;
    await media.body?.cancel().catch(() => {});
    await new Promise((r) => setTimeout(r, 1_000));
  }
  if (!media.ok || !media.body) throw new Error(`vídeo ${media.status}`);
  return { reader: media.body.getReader(), t0, protocol: body.protocol };
}

async function heartbeatLoop() {
  while (Date.now() - startedAt < DURATION_MS) {
    await new Promise((r) => setTimeout(r, 15_000));
    if (!session) continue;
    try {
      const r = await fetch(`${BASE}/api/v1/sessions/${session.id}/heartbeat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ viewer: VIEWER, playing: true }),
      });
      if (!r.ok) summary.errores.push(`latido ${r.status}`);
    } catch (e) {
      summary.errores.push(`latido: ${e.message}`);
    }
  }
}

function reporter() {
  const timer = setInterval(() => {
    const now = Date.now();
    const kbps = Math.round((windowBytes * 8) / (WINDOW_MS / 1000) / 1000);
    const idle = now - lastByteAt;
    if (windowBytes === 0) summary.ventanasSinDatos += 1;
    console.log(
      JSON.stringify({ t: Math.round((now - startedAt) / 1000), kbps, parado: idle > STALL_MS }),
    );
    windowBytes = 0;
  }, WINDOW_MS);
  return () => clearInterval(timer);
}

async function play() {
  let cutAt = null;
  while (Date.now() - startedAt < DURATION_MS) {
    let stream;
    try {
      stream = await openStream();
    } catch (e) {
      summary.errores.push(e.message);
      await new Promise((r) => setTimeout(r, 3_000));
      continue;
    }
    let first = true;
    try {
      while (Date.now() - startedAt < DURATION_MS) {
        const { done, value } = await stream.reader.read();
        if (done) break;
        if (first) {
          first = false;
          const ms = Date.now() - stream.t0;
          if (summary.primeraImagenMs === null) summary.primeraImagenMs = ms;
          if (cutAt) summary.recuperacionesMs.push(Date.now() - cutAt);
          cutAt = null;
        }
        summary.bytes += value.byteLength;
        windowBytes += value.byteLength;
        lastByteAt = Date.now();
      }
    } catch (e) {
      summary.errores.push(`lectura: ${e.message}`);
    }
    try {
      await stream.reader.cancel();
    } catch {}
    if (Date.now() - startedAt < DURATION_MS) {
      summary.cortes += 1;
      cutAt = Date.now();
    }
  }
}

const stopReporter = reporter();
await Promise.all([play(), heartbeatLoop()]);
stopReporter();
if (session) {
  await fetch(`${BASE}/api/v1/sessions/${session.id}/release`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ viewer: VIEWER, reason: 'user' }),
  }).catch(() => {});
}
summary.mbTotales = Math.round(summary.bytes / 1e6);
summary.kbpsMedios = Math.round((summary.bytes * 8) / (DURATION_MS / 1000) / 1000);
console.log(JSON.stringify({ resumen: summary }));
