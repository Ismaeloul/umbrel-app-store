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

const manifest = fs.readFileSync(path.join(__dirname, "../umbrel-app.yml"), "utf8");
const releaseVersion = manifest.match(/^version:\s*"([^"]+)"/m)?.[1];
assert.ok(releaseVersion, "umbrel-app.yml debe declarar una version");
const app = require(path.join(__dirname, "../releases", releaseVersion, "server.js"));

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
  // 21:30 UTC en agosto son las 23:30 en Madrid
  assert.equal(matches[0].time, "23:30");
  assert.deepEqual(matches[0].channels.map((channel) => channel.name), ["DAZN LaLiga", "DAZN LaLiga 2"]);
});

test("lee futbolenlatv con sus dos formatos de cabecera de competicion", () => {
  // en la web unas competiciones van enlazadas y otras son texto suelto tras
  // el <img>; anclarse solo al enlace dejaba la mayoria heredando la anterior
  const html = `
    <tr class="cabeceraCompericion"><td colspan="5">
      <img alt="Champions League" title="Champions League" />
      <a class="internalLink" href="/competicion/liga-campeones"> Champions League </a>
    </td></tr>
    <tr><td class="hora "> 21:00 </td>
      <td class="local"><a><span title="Fenerbah&#231;e">Fenerbah&#231;e</span></a></td>
      <td class="visitante"><span title="O. Lyonnais">O. Lyonnais</span></td>
      <td class="canales"><meta itemprop="startDate" content="2026-08-18T19:00:00" />
        <ul><li title="M+ Liga de Campeones (M60 O115)">M+ Liga de Campeones</li></ul>
      </td></tr>
    <tr class="cabeceraCompericion"><td colspan="5">
      <img alt="Torneo BetPlay DIMAYOR" title="Torneo BetPlay DIMAYOR" />Torneo BetPlay DIMAYOR
    </td></tr>
    <tr><td class="hora "> 02:00 </td>
      <td class="local"><span title="Atl&#233;tico Nacional">Atl&#233;tico Nacional</span></td>
      <td class="visitante"><span title="Mill&#243;n">Mill&#243;n</span></td>
      <td class="canales"><meta itemprop="startDate" content="2026-08-19T00:00:00" />
        <ul><li class="canal-sin-enlace" title="Zapping Internacional">Zapping</li></ul>
      </td></tr>`;

  const airings = app.parseFutbolEnLaTv(html, null);
  assert.equal(airings.length, 2);

  const [champions, dimayor] = airings;
  assert.equal(champions.competition, "Champions League", "cabecera con enlace");
  assert.equal(champions.home, "Fenerbahçe", "las entidades HTML se decodifican");
  assert.equal(champions.away, "O. Lyonnais");
  // 19:00 UTC en agosto son las 21:00 en Madrid
  assert.equal(champions.time, "21:00");
  assert.equal(champions.date, "2026-08-18");
  // el dial "(M60 O115)" se recorta para que case con las listas M3U
  assert.deepEqual(champions.channels, ["M+ Liga de Campeones"]);

  // la que va sin enlace no debe heredar "Champions League"
  assert.equal(dimayor.competition, "Torneo BetPlay DIMAYOR", "cabecera sin enlace");
  assert.equal(dimayor.home, "Atlético Nacional");
  assert.deepEqual(dimayor.channels, ["Zapping Internacional"]);
});

test("la ventana de futbolenlatv descarta lo que cae fuera de rango", () => {
  const fila = (fecha) => `
    <tr class="cabeceraCompericion"><td><img title="La Liga EA Sports" /></td></tr>
    <tr><td class="hora "> 21:00 </td>
      <td class="local"><span title="Sevilla">Sevilla</span></td>
      <td class="visitante"><span title="Rayo">Rayo</span></td>
      <td class="canales"><meta itemprop="startDate" content="${fecha}T19:00:00" />
        <ul><li title="M+ LALIGA">M+ LALIGA</li></ul></td></tr>`;
  const html = fila("2026-08-18") + fila("2026-09-30");
  const dentro = app.parseFutbolEnLaTv(html, new Set(["2026-08-18"]));
  assert.equal(dentro.length, 1);
  assert.equal(dentro[0].date, "2026-08-18");
  // sin ventana entran los dos
  assert.equal(app.parseFutbolEnLaTv(html, null).length, 2);
});

test("separa los equipos del titulo de la EPG", () => {
  assert.deepEqual(app.epgSplitTeams("Sevilla - Rayo"), { home: "Sevilla", away: "Rayo" });
  assert.deepEqual(app.epgSplitTeams("Atlético Madrid - Málaga"), { home: "Atlético Madrid", away: "Málaga" });
  // guion largo, que Movistar usa a veces
  assert.deepEqual(app.epgSplitTeams("Espanyol – Real Madrid"), { home: "Espanyol", away: "Real Madrid" });
  // sin separador no hay partido identificable
  assert.equal(app.epgSplitTeams("LALIGA EA SPORTS"), null);
  // los guiones del nombre no deben partir el equipo
  assert.equal(app.epgSplitTeams("Real Sociedad B"), null);
  assert.equal(app.epgSplitTeams(""), null);
});

test("agrupa una emision repetida en varias cadenas en un solo partido", () => {
  const cadena = (id, name) => ({ id, name });
  const emision = (canal, start, teams, competition, showId) => ({
    channel: canal, start, date: "2026-08-22",
    time: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(start)),
    row: { ShowId: showId, Titulo: "LALIGA EA SPORTS" },
    detail: { teams, competition },
  });
  const base = Date.UTC(2026, 7, 22, 18, 55);
  const matches = app.normalizeEpgAirings([
    emision(cadena("VAMOSD", "M+ Vamos"), base + 120000, "Fluminense - Remo", "Brasileirao", 1),
    emision(cadena("CHAPIO", "M+ Liga de Campeones"), base, "Fluminense - Remo", "Brasileirao", 2),
    emision(cadena("MLIGA", "M+ LALIGA"), Date.UTC(2026, 7, 22, 14, 54), "Athletic - Sevilla", "LALIGA EA SPORTS", 3),
  ]);

  assert.equal(matches.length, 2, "el partido repetido no debe duplicarse");
  const fluminense = matches.find((match) => match.home === "Fluminense");
  assert.deepEqual(fluminense.channels.map((channel) => channel.name).sort(), ["M+ Liga de Campeones", "M+ Vamos"]);
  // se conserva la hora mas temprana de las dos emisiones
  assert.equal(fluminense.time, "20:55");
  assert.equal(fluminense.away, "Remo");
  assert.equal(fluminense.competition, "Brasileirao");
  // y quedan ordenados por hora
  assert.deepEqual(matches.map((match) => match.time), ["16:54", "20:55"]);
});

test("una emision sin ficha conserva el titulo generico y no rompe la agenda", () => {
  const matches = app.normalizeEpgAirings([
    { channel: { id: "MLIGA", name: "M+ LALIGA" }, start: Date.UTC(2026, 7, 22, 18, 0),
      date: "2026-08-22", time: "20:00", row: { ShowId: 9, Titulo: "LALIGA EA SPORTS" } },
  ]);
  assert.equal(matches.length, 1);
  assert.equal(matches[0].title, "LALIGA EA SPORTS");
  assert.equal(matches[0].away, "", "sin equipos la UI cae al titulo");
  assert.deepEqual(matches[0].channels.map((channel) => channel.name), ["M+ LALIGA"]);
});

test("pasa la hora de TheSportsDB (UTC) al horario peninsular", () => {
  // verano: CEST = UTC+2
  assert.deepEqual(app.madridDateTime("2026-08-17", "19:30:00"), { date: "2026-08-17", time: "21:30" });
  // invierno: CET = UTC+1
  assert.deepEqual(app.madridDateTime("2026-01-17", "19:30:00"), { date: "2026-01-17", time: "20:30" });
  // de madrugada en Madrid: el partido salta al dia siguiente
  assert.deepEqual(app.madridDateTime("2026-08-17", "22:30:00"), { date: "2026-08-18", time: "00:30" });
  // sin hora utilizable se conserva el dia y se marca por confirmar
  assert.deepEqual(app.madridDateTime("2026-08-17", ""), { date: "2026-08-17", time: "Por confirmar" });
  assert.equal(app.madridDateTime("no-es-fecha", "19:30:00"), null);
});

test("no confunde canales de la misma familia que solo cambian una palabra", () => {
  const RECOMENDADO = 70;
  const ELEGIBLE = 58;
  // el fallo reportado: Segunda no puede presentarse como Primera.
  // Sigue siendo elegible a mano, pero nunca recomendada ni automatica.
  for (const [a, b] of [
    ["LaLiga TV Hypermotion", "LaLiga TV"],
    ["LaLiga TV", "LaLiga TV Hypermotion"],
    ["LaLiga TV", "LaLiga TV Bar"],
    ["Movistar LaLiga", "Movistar LaLiga Hypermotion"],
  ]) {
    const score = app.channelMatchScore(a, b);
    assert.ok(score < RECOMENDADO, `${a} vs ${b} no deberia recomendarse (score ${score})`);
    assert.ok(score <= ELEGIBLE, `${a} vs ${b} deberia quedar topado (score ${score})`);
  }
  // el guardia numerico que ya existia sigue en pie
  assert.equal(app.channelMatchScore("Eurosport 1", "Eurosport 2"), 0);
  // y lo que si es el mismo canal se sigue reconociendo
  assert.equal(app.channelMatchScore("GOL Play", "GOL Play HD"), 100);
  assert.equal(app.channelMatchScore("M+ LaLiga TV", "Movistar LaLiga TV"), 100);
  assert.ok(app.channelMatchScore("Movistar Liga de Campeones", "Movistar Liga Campeones") >= RECOMENDADO);
});

test("completa la competicion por evento y aguanta que el servicio falle", async () => {
  const matches = [
    { id: "9001", competition: "Fútbol" },
    { id: "9002", competition: "Fútbol" },
    { id: "9003", competition: "LaLiga" },
    { id: "sin-id-numerico", competition: "Fútbol" },
  ];
  const asked = [];
  await app.enrichFootballLeagues(matches, async (id) => {
    asked.push(id);
    if (id === "9002") throw new Error("thesportsdb_down");
    return "Spanish La Liga 2";
  });
  // solo se pregunta por los que no tienen liga y traen idEvent numerico
  assert.deepEqual(asked.sort(), ["9001", "9002"]);
  assert.equal(matches[0].competition, "Spanish La Liga 2");
  // el que falla se queda con el valor generico, no rompe la agenda
  assert.equal(matches[1].competition, "Fútbol");
  assert.equal(matches[2].competition, "LaLiga");
  assert.equal(matches[3].competition, "Fútbol");
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
