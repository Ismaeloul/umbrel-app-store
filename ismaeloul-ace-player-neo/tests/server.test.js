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

test("reune fuentes de todas las capas aunque la biblioteca ya acierte", async () => {
  // antes se cortaba al encontrar una coincidencia buena en la biblioteca y
  // no se llegaba a preguntar al motor: si ese hash estaba muerto, no habia
  // alternativas. Los hashes de AceStream caducan, asi que interesan todas.
  const state = seedState();
  state.webSources = [{
    id: "m3u", url: "https://example.com/l.m3u", name: "Lista", renames: {}, hidden: [],
    streams: [
      { id: ID_A, title: "DAZN LaLiga 1080p", type: "web" },
      { id: ID_B, title: "DAZN LaLiga 720p", type: "web" },
    ],
  }];
  state.web = state.webSources[0].streams;

  let consultado = false;
  const result = await app.resolveFootballChannel(state, ["DAZN LaLiga"], async () => {
    consultado = true;
    return [{ id: ID_C, title: "DAZN LaLiga", ih: true, availability: 40 }];
  });

  assert.equal(consultado, true, "debe preguntar al buscador aunque la biblioteca acierte");
  assert.equal(result.status, "found", "varias señales del MISMO canal no son ambiguas");
  const ids = result.candidates.map((c) => c.id);
  assert.ok(ids.includes(ID_A) && ids.includes(ID_B), "las dos de la lista estan");
  assert.ok(ids.includes(ID_C), "y tambien la del motor");
  assert.ok(result.candidates.length >= 3, "se devuelven todas para poder saltar");
});

test("con dos canales del mismo partido reproduce el mejor y ofrece los dos", async () => {
  // Antes preguntaba. Ahora reproduce directamente y el selector de fuentes
  // deja cambiar: para el usuario es un clic en vez de dos.
  const state = seedState();
  state.webSources = [{
    id: "m3u", url: "https://example.com/l.m3u", name: "Lista", renames: {}, hidden: [],
    streams: [
      { id: ID_A, title: "M+ Liga de Campeones 1080p", type: "web" },
      { id: ID_B, title: "LaLiga TV Bar 1080p", type: "web" },
    ],
  }];
  state.web = state.webSources[0].streams;
  const result = await app.resolveFootballChannel(
    state, ["M+ Liga de Campeones", "LaLiga TV Bar"], async () => []);
  assert.equal(result.status, "found", "no debe pedir que elijas");
  assert.ok(result.candidate, "se elige uno para empezar");
  assert.equal(result.candidates.length, 2, "y los dos quedan como fuentes");
});

test("un canal de otra competicion no entra como fuente del partido", async () => {
  // el fallo reportado: en un partido de Champions aparecia LaLiga TV
  // Hypermotion, que es Segunda. Puntua 58 -el techo de variante- y el
  // umbral de la biblioteca estaba justo ahi.
  const state = seedState();
  state.webSources = [{
    id: "m3u", url: "https://example.com/l.m3u", name: "Lista", renames: {}, hidden: [],
    streams: [
      { id: ID_A, title: "LIGA DE CAMPEONES --> SPORT TV", alias: "M+ Liga de Campeones HD", type: "web" },
      { id: ID_B, title: "HYPERMOTION --> ELCANO", alias: "LaLiga TV Hypermotion HD", type: "web" },
    ],
  }];
  state.web = state.webSources[0].streams;
  const result = await app.resolveFootballChannel(state, ["M+ Liga de Campeones"], async () => []);
  const titulos = result.candidates.map((c) => c.title);
  assert.ok(titulos.some((t) => /CAMPEONES/.test(t)), "el de Champions si");
  assert.ok(!titulos.some((t) => /HYPERMOTION/i.test(t)), "el de Segunda no");
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

test("elige el canal exacto del M3U, pero ya SI consulta tambien el motor", async () => {
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
  // el contrato cambio: los hashes de AceStream caducan, asi que se reunen
  // alternativas del motor aunque la biblioteca ya tenga una coincidencia
  assert.equal(searched, true, "ahora tambien se pregunta al motor");
  assert.equal(result.candidate.source, "m3u");
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

/* ---------- marcadores en vivo ---------- */

test("las competiciones de la agenda se mapean a ligas de ESPN", () => {
  assert.deepEqual(app.espnLeaguesFor("La Liga EA Sports"), ["esp.1"]);
  assert.deepEqual(app.espnLeaguesFor("LaLiga Hypermotion"), ["esp.2"]);
  // se rotula con tildes y espacios de sobra segun el dia
  assert.deepEqual(app.espnLeaguesFor("  Serie A Italiana  "), ["ita.1"]);
  // la Champions puede estar en fase previa o en el cuadro final
  assert.deepEqual(app.espnLeaguesFor("Champions League"), ["uefa.champions", "uefa.champions_qual"]);
  // lo que ESPN no cubre no se consulta
  assert.equal(app.espnLeaguesFor("Torneo Proyección"), null);
  assert.equal(app.espnLeaguesFor("MLS Next Pro"), null);
});

test("los nombres de equipo casan pese a escribirse distinto", () => {
  assert.equal(app.teamSimilarity("Fenerbahçe", "Fenerbahce"), 1);
  assert.equal(app.teamSimilarity("Atlético de Madrid", "Atlético Madrid"), 1);
  assert.equal(app.teamSimilarity("GNK Dinamo Zagreb", "Dinamo Zagreb"), 1);
  // sin alias no comparten ni una palabra
  assert.equal(app.teamSimilarity("O. Lyonnais", "Lyon"), 1);
  assert.equal(app.teamSimilarity("B. Dortmund", "Borussia Dortmund"), 1);
  assert.equal(app.teamSimilarity("Inter de Milán", "Internazionale"), 1);
});

test("dos equipos distintos no se confunden por compartir una palabra", () => {
  // este es el fallo que hay que evitar: 'Real' lo llevan los dos
  assert.ok(app.teamSimilarity("Real Madrid", "Real Sociedad") < 0.6);
  assert.equal(app.teamSimilarity("Levski Sofia", "AEK Athens"), 0);
  assert.equal(app.teamSimilarity("Athletic Club", "Atlético Madrid"), 0);
});

test("solo se consulta el marcador dentro de la ventana del partido", () => {
  const saque = Date.UTC(2026, 7, 18, 19, 0, 0);
  const MIN = 60 * 1000;
  assert.equal(app.matchIsInScoreWindow({ start: saque }, saque - 60 * MIN), false, "una hora antes todavia no");
  assert.equal(app.matchIsInScoreWindow({ start: saque }, saque - 10 * MIN), true, "diez minutos antes ya");
  assert.equal(app.matchIsInScoreWindow({ start: saque }, saque + 60 * MIN), true, "en pleno partido");
  assert.equal(app.matchIsInScoreWindow({ start: saque }, saque + 200 * MIN), true, "recien acabado todavia interesa");
  assert.equal(app.matchIsInScoreWindow({ start: saque }, saque + 300 * MIN), false, "cinco horas despues ya no");
  // un partido sin hora de saque no puede buscarse
  assert.equal(app.matchIsInScoreWindow({ start: undefined }, saque), false);
});

test("se leen marcador, estado y reloj de un evento de ESPN", () => {
  const evento = {
    date: "2026-08-18T19:00Z",
    status: { displayClock: "63'", type: { state: "in", shortDetail: "63'" } },
    competitions: [{
      competitors: [
        { homeAway: "home", score: "2", team: { displayName: "Fenerbahce", shortDisplayName: "Fenerbahce" } },
        { homeAway: "away", score: "1", team: { displayName: "Lyon", shortDisplayName: "Lyon" } },
      ],
    }],
  };
  const leido = app.readEspnEvent(evento);
  assert.equal(leido.homeScore, 2);
  assert.equal(leido.awayScore, 1);
  assert.equal(leido.state, "in");
  assert.equal(leido.clock, "63'");
  assert.equal(leido.start, Date.parse("2026-08-18T19:00Z"));
});

test("un evento sin los dos equipos se descarta en vez de romper", () => {
  assert.equal(app.readEspnEvent({ competitions: [{ competitors: [] }] }), null);
  assert.equal(app.readEspnEvent({}), null);
});

/* ---------- familias de canal ---------- */

test("pedir un canal a secas ofrece toda su familia numerada", () => {
  // la agenda anuncia "DAZN" en 151 de 661 partidos; antes eso puntuaba 0
  // contra los 59 canales DAZN de la biblioteca y el partido salia sin canal
  assert.ok(app.channelMatchScore("DAZN", "DAZN 1") >= 70);
  assert.ok(app.channelMatchScore("DAZN", "DAZN 1 720p *") >= 70);
  assert.ok(app.channelMatchScore("M+ LALIGA", "M+ LALIGA 2") >= 70);
});

test("la familia se ofrece pero nunca se reproduce a ciegas", () => {
  // por encima del umbral de recomendado (70) y por debajo del de arrancar
  // solo (92): se listan todos y el salto lo decide el usuario
  const puntos = app.channelMatchScore("DAZN", "DAZN 3");
  assert.ok(puntos >= 70 && puntos < 92, `esperaba entre 70 y 92, fue ${puntos}`);
});

test("dos canales numerados distintos siguen sin confundirse", () => {
  assert.equal(app.channelMatchScore("DAZN 1", "DAZN 2"), 0);
  assert.equal(app.channelMatchScore("M+ LALIGA 2", "M+ LALIGA 3"), 0);
});

test("una palabra de mas no es familia: sigue siendo otra competicion", () => {
  // este es el fallo original: LaLiga TV (Primera) no puede traer Hypermotion
  const puntos = app.channelMatchScore("LaLiga TV", "LALIGA TV Hypermotion");
  assert.ok(puntos < 70, `Hypermotion no debe recomendarse, fue ${puntos}`);
});

test("las coletillas de calidad no rompen la coincidencia exacta", () => {
  assert.equal(app.channelMatchScore("LaLiga TV Bar", "LaLiga TV Bar HD"), 100);
  assert.equal(app.channelMatchScore("DAZN 1", "DAZN 1 720p"), 100);
});

/* ---------- señales muertas y vivas ---------- */

const señal = (id, extra = {}) => ({
  id, title: "DAZN 1", score: 100, source: "m3u", availability: null, bitrate: null, ...extra,
});

test("una señal que el motor da por muerta no se ofrece", () => {
  const salida = app.mergeResolutionCandidates([
    señal("a".repeat(40), { source: "acestream", availability: 0 }),
    señal("b".repeat(40), { source: "acestream", availability: 0.9 }),
  ]);
  assert.equal(salida.length, 1);
  assert.equal(salida[0].id, "b".repeat(40));
});

test("entre dos de la MISMA procedencia, primero la que esta viva", () => {
  /* La disponibilidad desempata dentro de cada grupo, no entre grupos: solo la
     traen los resultados del buscador, asi que compararla entre una del
     buscador y una de tus listas hacia ganar siempre al buscador. */
  const salida = app.mergeResolutionCandidates([
    señal("a".repeat(40), { score: 100, source: "acestream", availability: 0.2 }),
    señal("b".repeat(40), { score: 100, source: "acestream", availability: 0.8 }),
  ]);
  assert.equal(salida[0].id, "b".repeat(40), "la mas disponible va primero");
  assert.equal(salida.length, 2, "la otra sigue ofreciendose");
});

test("estar disponible no cuela un canal que no es", () => {
  // 100 es coincidencia exacta; 72 es solo "probablemente". Aunque la segunda
  // este al 100% de disponibilidad, no puede adelantar a la que si es el canal
  const salida = app.mergeResolutionCandidates([
    señal("a".repeat(40), { score: 100, availability: null }),
    señal("b".repeat(40), { score: 72, source: "acestream", availability: 1 }),
  ]);
  assert.equal(salida[0].id, "a".repeat(40));
});

test("un hash que llega por dos vias conserva su disponibilidad", () => {
  // el mismo hash en la lista M3U y en el buscador: la lista gana por origen,
  // pero la unica pista de si sigue vivo la trae el buscador y no debe perderse
  const salida = app.mergeResolutionCandidates([
    señal("c".repeat(40), { source: "m3u", availability: null }),
    señal("c".repeat(40), { source: "acestream", availability: 0.6, bitrate: 3500 }),
  ]);
  assert.equal(salida.length, 1);
  assert.equal(salida[0].source, "m3u");
  assert.equal(salida[0].availability, 0.6, "la disponibilidad sobrevive a la fusion");
  assert.equal(salida[0].bitrate, 3500);
});

test("un hash duplicado que el motor da por muerto se descarta entero", () => {
  const salida = app.mergeResolutionCandidates([
    señal("d".repeat(40), { source: "m3u", availability: null }),
    señal("d".repeat(40), { source: "acestream", availability: 0 }),
  ]);
  assert.equal(salida.length, 0, "aunque venga de tu lista, sin pares no tira");
});

test("se ofrecen TODAS las señales, sin tope", () => {
  // recortar la lista era quitar alternativas justo cuando mas falta hacen:
  // los hashes caducan solos y un proveedor caido se cae entero
  const muchas = Array.from({ length: 40 }, (_, i) =>
    señal(String(i).padStart(40, "0"), { availability: 1 - i / 100 }));
  assert.equal(app.mergeResolutionCandidates(muchas).length, 40);
});

/* ---------- la familia es un recurso, no un añadido ---------- */

test("si existe el canal exacto, no se ofrecen sus hermanas numeradas", () => {
  // "M+ Liga de Campeones" existe tal cual: el 2 y el 3 son OTROS partidos
  const biblioteca = [
    { id: "1".repeat(40), title: "M+ Liga de Campeones 1080p" },
    { id: "2".repeat(40), title: "M+ Liga de Campeones 2 1080p" },
    { id: "3".repeat(40), title: "M+ Liga de Campeones 3 1080p" },
  ];
  const candidatos = biblioteca
    .map((item) => app.scoreResolutionCandidate(["M+ Liga de Campeones"], item, "m3u"))
    .filter((c) => c.score >= 70);
  const ofrecidas = app.mergeResolutionCandidates(candidatos);
  assert.equal(ofrecidas.length, 1);
  assert.equal(ofrecidas[0].title, "M+ Liga de Campeones 1080p");
});

test("si NO existe el canal exacto, la familia es lo unico que hay", () => {
  // la agenda anuncia "DAZN" a secas y no hay ningun canal llamado asi
  const biblioteca = [
    { id: "1".repeat(40), title: "DAZN 1 720p" },
    { id: "2".repeat(40), title: "DAZN 2 720p" },
    { id: "3".repeat(40), title: "DAZN 3 720p" },
  ];
  const candidatos = biblioteca
    .map((item) => app.scoreResolutionCandidate(["DAZN"], item, "m3u"))
    .filter((c) => c.score >= 70);
  const ofrecidas = app.mergeResolutionCandidates(candidatos);
  assert.equal(ofrecidas.length, 3, "sin exacto se ofrecen las tres");
  assert.ok(ofrecidas.every((c) => c.soloFamilia));
});

test("las coletillas de calidad no cuentan como numero de canal", () => {
  // 1080p o 720p no convierten el canal en otro distinto
  assert.equal(app.esFamiliaDe("M+ Liga de Campeones", "M+ Liga de Campeones 1080p"), false);
  assert.equal(app.esFamiliaDe("DAZN 1", "DAZN 1 720p"), false);
  assert.equal(app.esFamiliaDe("DAZN", "DAZN 1"), true);
  assert.equal(app.esFamiliaDe("LaLiga TV", "LALIGA TV Hypermotion"), false);
});

/* ---------- el proveedor no es el canal ---------- */

test("la coletilla del proveedor no forma parte del nombre", () => {
  // las listas grandes son agregadores y rotulan quien sirve cada señal
  assert.equal(app.normalizeChannelKey("LIGA DE CAMPEONES --> ELCANO"), "liga de campeones");
  assert.equal(app.normalizeChannelKey("LIGA DE CAMPEONES FHD --> NEW ERA II"), "liga de campeones");
  assert.equal(app.normalizeChannelKey("DAZN 1 720p **"), "dazn 1");
});

test("el operador dice por donde llega, no que canal es", () => {
  // "M+ Liga de Campeones" y "LIGA DE CAMPEONES" son el mismo canal
  assert.ok(app.channelMatchScore("M+ Liga de Campeones", "LIGA DE CAMPEONES --> ELCANO") >= 70);
  assert.ok(app.channelMatchScore("M+ Liga de Campeones", "M. Liga de Campeones") >= 70);
  assert.ok(app.channelMatchScore("M+ Liga de Campeones", "LIGA DE CAMPEONES --> SPORT TV") >= 70);
});

test("quitar la decoracion no borra el numero de canal", () => {
  // es lo unico que de verdad distingue un partido de otro
  assert.equal(app.normalizeChannelKey("LIGA DE CAMPEONES 2 --> ELCANO"), "liga de campeones 2");
  assert.ok(app.channelMatchScore("M+ Liga de Campeones", "LIGA DE CAMPEONES 2 --> ELCANO") < 70);
  assert.ok(app.channelMatchScore("M+ Liga de Campeones", "LIGA DE CAMPEONES 3 --> SPORT TV") < 70);
});

test("se reconoce de que proveedor es cada señal", () => {
  assert.equal(app.proveedorDeSeñal({ title: "LIGA DE CAMPEONES --> ELCANO" }), "elcano");
  assert.equal(app.proveedorDeSeñal({ title: "LIGA DE CAMPEONES FHD --> NEW ERA II" }), "new era ii");
  assert.equal(app.proveedorDeSeñal({ title: "M+ Liga de Campeones", listaId: "principal" }), "principal");
});

test("la lista se reparte entre proveedores en vez de copar uno", () => {
  // si un proveedor se cae, se caen todas sus señales a la vez: no pueden
  // ocupar los primeros puestos y dejar las alternativas fuera de vista
  const entrada = [
    { title: "C --> alfa" }, { title: "C --> alfa" }, { title: "C --> alfa" },
    { title: "C --> beta" }, { title: "C --> beta" },
    { title: "C --> gamma" },
  ];
  const salida = app.repartirEntreProveedores(entrada).map((c) => app.proveedorDeSeñal(c));
  assert.deepEqual(salida.slice(0, 3), ["alfa", "beta", "gamma"], "primero uno de cada");
  assert.equal(salida.length, 6, "no se pierde ninguna");
});

/* ---------- primero lo tuyo, luego el buscador ---------- */

const cand = (id, source, extra = {}) => ({
  id: String(id).padStart(40, "0"), title: "Liga de Campeones",
  score: 100, source, availability: null, bitrate: null, soloFamilia: false, ...extra,
});

test("las listas importadas van por delante del buscador del motor", () => {
  // la disponibilidad solo la traen los del buscador; comparandolas juntas,
  // el null de las listas contaba como -1 y el buscador ganaba siempre
  const salida = app.mergeResolutionCandidates([
    cand(1, "acestream", { availability: 1 }),
    cand(2, "m3u"),
  ]);
  assert.equal(salida[0].source, "m3u", "lo tuyo primero aunque no sepamos si esta vivo");
  assert.equal(salida[1].source, "acestream");
});

test("un vinculo confirmado a mano manda sobre todo lo demas", () => {
  const salida = app.mergeResolutionCandidates([
    cand(1, "m3u"), cand(2, "acestream", { availability: 1 }), cand(3, "saved"),
  ]);
  assert.equal(salida[0].source, "saved");
});

test("van todas: las tuyas primero y las del buscador detras", () => {
  const mias = Array.from({ length: 20 }, (_, i) => cand(i + 1, "m3u"));
  const suyas = Array.from({ length: 5 }, (_, i) => cand(100 + i, "acestream", { availability: 0.9 }));
  const salida = app.mergeResolutionCandidates([...mias, ...suyas]);
  assert.equal(salida.length, 25, "no se pierde ninguna");
  assert.ok(salida.slice(0, 20).every((c) => c.source === "m3u"), "las tuyas van delante");
  assert.ok(salida.slice(20).every((c) => c.source === "acestream"));
});

test("un vinculo guardado no borra la familia del canal", () => {
  /* El vinculo esta archivado con el mismo nombre que pides, asi que casa
     consigo mismo al 100%. Contarlo como prueba de que el canal exacto existe
     hacia que tener un vinculo de "DAZN" borrase los DAZN de la biblioteca. */
  const candidatos = [
    { ...cand(1, "saved"), title: "DAZN", score: 100, soloFamilia: false },
    { ...cand(2, "m3u"), title: "DAZN 1", score: 78, soloFamilia: true },
    { ...cand(3, "m3u"), title: "DAZN 2", score: 78, soloFamilia: true },
  ];
  const salida = app.mergeResolutionCandidates(candidatos);
  assert.equal(salida.length, 3, "las de la familia siguen ofreciendose");
});
