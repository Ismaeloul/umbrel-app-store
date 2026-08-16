"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");

const testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "ace-player-neo-"));
process.env.DATA_DIR = testDataDir;
process.env.DEFAULT_WEB_SYNC_URL = "https://example.com/default.m3u";
process.env.FOOTBALL_DEMO_ONLY = "true";

const app = require("../releases/0.6.9/server.js");

const ID_A = "a".repeat(40);
const ID_B = "b".repeat(40);
const ID_C = "c".repeat(40);
let server;
let baseUrl;

function seedState() {
  return app.writeState({
    favorites: [{ id: ID_A, title: "Favorito", type: "fav" }],
    history: [{ id: ID_B, title: "Reciente", type: "recent" }],
    webSources: [{
      id: "principal",
      name: "Principal",
      url: "https://example.com/list.m3u",
      type: "m3u",
      streams: [
        { id: ID_A, title: "Canal original", type: "web", category: "TV" },
        { id: ID_C, title: "Otro canal", type: "web", category: "TV" },
      ],
    }],
    activeWebSourceId: "principal",
    nowPlaying: null,
  });
}

async function post(route, body) {
  const response = await fetch(baseUrl + route, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { response, data: await response.json() };
}

before(async () => {
  server = app.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(testDataDir, { recursive: true, force: true });
});

test("normaliza Content IDs y rangos HTTP", () => {
  assert.equal(app.normalizeHash(`acestream://${ID_A.toUpperCase()}`), ID_A);
  assert.equal(app.normalizeHash(`https://example.com/watch?id=${ID_B}`), ID_B);
  assert.deepEqual(app.parseByteRange("bytes=10-19", 100), { start: 10, end: 19 });
  assert.deepEqual(app.parseByteRange("bytes=-20", 100), { start: 80, end: 99 });
  assert.equal(app.parseByteRange("bytes=120-130", 100), false);
});

test("detecta destinos privados usados en intentos SSRF", () => {
  for (const address of ["127.0.0.1", "10.0.0.5", "172.16.4.2", "192.168.1.10", "169.254.169.254", "::1", "0:0:0:0:0:0:0:1", "::ffff:7f00:1", "fd00::1", "fe80::1"]) {
    assert.equal(app.isPrivateAddress(address), true, address);
  }
  assert.equal(app.isPrivateAddress("1.1.1.1"), false);
  assert.equal(app.isPrivateAddress("2606:4700:4700::1111"), false);
  assert.equal(app.isPrivateHostname("umbrel.local"), true);
  assert.equal(app.isPrivateHostname("example.com"), false);
});

test("la descarga rechaza loopback antes de abrir la conexion", async () => {
  await assert.rejects(() => app.fetchText(baseUrl + "/private.m3u"), /private_url/);
  await assert.rejects(() => app.fetchText("https://example.com/list.m3u", 0, new Set(), Date.now() - 1), /fetch_timeout/);
});

test("agrupa las emisiones de un partido y normaliza sus canales", () => {
  const matches = app.normalizeFootballRows([
    {
      idEvent: "9001", strSport: "Soccer", strEvent: "Barcelona vs Valencia",
      strLeague: "LaLiga", dateEvent: "2026-08-16", strTime: "21:30:00",
      idChannel: "11", strChannel: "DAZN LaLiga", strCountry: "Spain",
    },
    {
      idEvent: "9001", strSport: "Soccer", strEvent: "Barcelona vs Valencia",
      strLeague: "LaLiga", dateEvent: "2026-08-16", strTime: "21:30:00",
      idChannel: "12", strChannel: "DAZN LaLiga 2", strCountry: "Spain",
    },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].home, "Barcelona");
  assert.equal(matches[0].away, "Valencia");
  assert.equal(matches[0].time, "21:30");
  assert.deepEqual(matches[0].channels.map((channel) => channel.name), ["DAZN LaLiga", "DAZN LaLiga 2"]);
});

test("sirve una agenda de desarrollo completa sin consultar servicios externos", async () => {
  const response = await fetch(baseUrl + "/api/football");
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(data.demo, true);
  assert.ok(data.days.length >= 3);
  assert.ok(data.days.some((day) => day.matches.length > 0));
  assert.ok(data.days.some((day) => day.matches.some((match) => match.home === "España" && match.away === "Portugal")));
});

test("guarda y normaliza las preferencias de fútbol entre dispositivos", async () => {
  seedState();
  const { response, data } = await post("/api/preferences", {
    onboardingComplete: true,
    country: "Spain",
    leagues: ["LaLiga", "LaLiga", "Champions League"],
    teams: ["Real Madrid", "  Real   Madrid  ", "Arsenal"],
    nationalities: ["España", "España", "Argentina"],
  });
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.deepEqual(data.preferences.leagues, ["LaLiga", "Champions League"]);
  assert.deepEqual(data.preferences.teams, ["Real Madrid", "Arsenal"]);
  assert.deepEqual(data.preferences.nationalities, ["España", "Argentina"]);
  const state = await (await fetch(baseUrl + "/api/state")).json();
  assert.equal(state.preferences.onboardingComplete, true);
  assert.deepEqual(state.preferences.teams, ["Real Madrid", "Arsenal"]);
  assert.deepEqual(state.preferences.nationalities, ["España", "Argentina"]);
});

test("resuelve primero un canal exacto del M3U sin consultar el motor", async () => {
  const state = seedState();
  state.webSources[0].streams = [
    { id: ID_C, title: "DAZN LaLiga 1080p", type: "web", category: "Deportes" },
  ];
  const saved = app.writeState(state);
  let searched = false;
  const result = await app.resolveFootballChannel(saved, ["DAZN LaLiga"], async () => {
    searched = true;
    return [];
  });
  assert.equal(result.status, "found");
  assert.equal(result.candidate.id, ID_C);
  assert.equal(result.candidate.source, "m3u");
  assert.equal(searched, false);
});

test("recuerda una vinculación manual y la usa antes que la búsqueda", async () => {
  seedState();
  const binding = await post("/api/football/bind", {
    channel: "Amazon Prime Video",
    id: `acestream://${ID_B}`,
    title: "Mi señal de Prime",
    ih: false,
  });
  assert.equal(binding.response.status, 200);
  assert.equal(binding.data.binding.id, ID_B);
  const response = await fetch(baseUrl + "/api/football/resolve?channel=Amazon%20Prime%20Video");
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.status, "found");
  assert.equal(data.candidate.id, ID_B);
  assert.equal(data.candidate.title, "Mi señal de Prime");
  assert.equal(data.candidate.source, "saved");
});

test("explica que no hay resultado cuando fallan biblioteca y buscador", async () => {
  const state = seedState();
  const result = await app.resolveFootballChannel(state, ["Amazon Prime Video"], async () => {
    throw new Error("engine_unavailable");
  });
  assert.equal(result.status, "not_found");
  assert.equal(result.engineAvailable, false);
  assert.deepEqual(result.candidates, []);
  assert.deepEqual(result.checked, ["saved", "m3u", "library", "acestream"]);
});

test("pide elegir cuando el buscador devuelve varias señales ambiguas", async () => {
  const state = seedState();
  const result = await app.resolveFootballChannel(state, ["DAZN"], async () => [
    { id: ID_A, title: "DAZN Eventos", ih: true, availability: 30 },
    { id: ID_B, title: "DAZN Deportes", ih: true, availability: 20 },
  ]);
  assert.equal(result.status, "choices");
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every((item) => item.ih === true));
});

test("normaliza resultados planos y agrupados del buscador AceStream", () => {
  const results = app.parseAceSearchResults(JSON.stringify({ result: { results: [
    { name: "DAZN", items: [{ infohash: ID_A, name: "DAZN HD", availability: 12 }] },
    { content_id: ID_B, name: "M+ Deportes", availability: 3 },
    { infohash: ID_A, name: "Duplicado" },
  ] } }));
  assert.deepEqual(results.map((item) => item.id), [ID_A, ID_B]);
  assert.equal(results[0].ih, true);
  assert.equal(results[0].title, "DAZN HD");
});

test("las mutaciones HTTP no pisan colecciones de otros dispositivos", async () => {
  seedState();
  const historyBefore = app.readState().history;
  const { response, data } = await post("/api/library", {
    action: "favorite-upsert",
    item: { id: ID_C, title: "Nuevo favorito", type: "fav" },
  });
  assert.equal(response.status, 200);
  assert.equal(data.success, true);
  assert.equal(app.readState().favorites[0].id, ID_C);
  assert.deepEqual(app.readState().history, historyBefore);
});

test("rechaza cuerpos API mayores de 2 MiB", async () => {
  const response = await fetch(baseUrl + "/api/library", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "noop", padding: "x".repeat(2 * 1024 * 1024) }),
  });
  assert.equal(response.status, 413);
  assert.equal((await response.json()).error, "body_too_large");
});

test("bloquea mutaciones iniciadas desde otro origen", async () => {
  const response = await fetch(baseUrl + "/api/restart-engine", {
    method: "POST",
    headers: { Origin: "https://attacker.example", "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(response.status, 403);
  assert.equal((await response.json()).error, "cross_origin");
  const remux = await fetch(`${baseUrl}/api/remux?id=${ID_A}`, {
    headers: { "Sec-Fetch-Site": "cross-site" },
  });
  assert.equal(remux.status, 403);
});

test("un cliente 0.6.8 obsoleto no puede borrar datos actuales", async () => {
  seedState();
  const response = await fetch(baseUrl + "/api/state", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ favorites: [
      { id: ID_C, title: "Desde cliente antiguo" },
      { id: ID_A, title: "Nombre obsoleto" },
    ] }),
  });
  assert.equal(response.status, 200);
  const ids = app.readState().favorites.map((item) => item.id);
  assert.deepEqual(ids, [ID_C, ID_A]);
  assert.equal(app.readState().favorites.find((item) => item.id === ID_A).title, "Favorito");
});

test("el remux sirve rangos sin cargar el segmento completo en memoria", async () => {
  const remuxDir = path.join(testDataDir, "remux", ID_A);
  fs.mkdirSync(remuxDir, { recursive: true });
  fs.writeFileSync(path.join(remuxDir, "init.mp4"), Buffer.from("0123456789"));
  const response = await fetch(`${baseUrl}/remux/${ID_A}/init.mp4`, {
    headers: { Range: "bytes=2-5" },
  });
  assert.equal(response.status, 206);
  assert.equal(response.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(response.headers.get("accept-ranges"), "bytes");
  assert.equal(await response.text(), "2345");

  const stop = await post("/api/remux/stop", { id: ID_A, dev: "test-device" });
  assert.equal(stop.response.status, 200);
  assert.equal(stop.data.stopped, false);
});

test("renombres y borrados web sobreviven a una sincronizacion posterior", async () => {
  seedState();
  let result = await post("/api/library", {
    action: "rename",
    collection: "web",
    sourceId: "principal",
    id: ID_A,
    title: "Mi nombre",
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.data.web.find((item) => item.id === ID_A).title, "Mi nombre");

  let state = app.readState();
  const refreshedSource = {
    ...state.webSources[0],
    streams: [
      { id: ID_A, title: "Nombre remoto", type: "web", category: "TV" },
      { id: ID_C, title: "Otro canal", type: "web", category: "TV" },
    ],
  };
  state = app.writeState({ ...state, webSources: [refreshedSource] });
  assert.equal(state.web.find((item) => item.id === ID_A).title, "Mi nombre");

  result = await post("/api/library", {
    action: "delete",
    collection: "web",
    sourceId: "principal",
    id: ID_A,
  });
  assert.equal(result.response.status, 200);
  state = app.readState();
  state = app.writeState({
    ...state,
    webSources: [{
      ...state.webSources[0],
      streams: [
        { id: ID_A, title: "Nombre remoto", type: "web", category: "TV" },
        { id: ID_C, title: "Otro canal", type: "web", category: "TV" },
      ],
    }],
  });
  assert.equal(state.web.some((item) => item.id === ID_A), false);
  assert.equal(state.web.some((item) => item.id === ID_C), true);
});

test("el servidor arbitra el mando con marcas monotónicas", async () => {
  seedState();
  const first = await post("/api/playback/claim", { id: ID_A, title: "Uno", dev: "movil" });
  const second = await post("/api/playback/claim", { id: ID_B, title: "Dos", dev: "tele" });
  assert.equal(first.response.status, 200);
  assert.equal(second.response.status, 200);
  assert.ok(second.data.nowPlaying.at > first.data.nowPlaying.at);

  const wrongRelease = await post("/api/playback/release", { id: ID_A, dev: "movil" });
  assert.equal(wrongRelease.data.released, false);
  assert.equal(app.readState().nowPlaying.id, ID_B);

  const release = await post("/api/playback/release", { id: ID_B, dev: "tele" });
  assert.equal(release.data.released, true);
  assert.equal(app.readState().nowPlaying, null);
});

test("una liberación adelantada no resucita un claim tardío", async () => {
  seedState();
  const lateToken = "movil-late-claim";
  const earlyRelease = await post("/api/playback/release", { id: ID_A, dev: "movil", token: lateToken });
  assert.equal(earlyRelease.response.status, 200);
  const lateClaim = await post("/api/playback/claim", { id: ID_A, title: "Tarde", dev: "movil", token: lateToken });
  assert.equal(lateClaim.data.ignored, true);
  assert.equal(app.readState().nowPlaying, null);

  await post("/api/playback/claim", { id: ID_A, title: "Viejo", dev: "movil", token: "movil-old" });
  await post("/api/playback/claim", { id: ID_A, title: "Nuevo", dev: "movil", token: "movil-new" });
  const delayedRelease = await post("/api/playback/release", { id: ID_A, dev: "movil", token: "movil-old" });
  assert.equal(delayedRelease.data.released, false);
  assert.equal(app.readState().nowPlaying.token, "movil-new");
});
