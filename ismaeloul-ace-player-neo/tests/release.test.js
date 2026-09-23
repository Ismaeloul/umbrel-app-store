"use strict";

/* Coherencia del paquete de Umbrel de la version actual (0.7.0 en adelante):
   manifiesto, Compose, hook, release compilada y vigilante. Es lo que umbreld
   y el hook pre-start van a ver en el NAS, asi que se prueba sobre la carpeta
   real de la app y sin dependencias (node --test, como en CI).

   Los tests de la 0.6.59 (que sigue en releases/0.6.59 como plan de vuelta
   atras) estan en legacy-0.6.59/. La release se monta con
   ace-player-neo/scripts/release.mjs; que coincida byte a byte con el codigo lo
   comprueba ace-player-neo/scripts/check-release.mjs en CI. */

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const APP_DIR = path.join(__dirname, "..");
const MONOREPO_DIR = path.join(APP_DIR, "..", "ace-player-neo");
const read = (relative) => fs.readFileSync(path.join(APP_DIR, relative), "utf8");

const manifest = read("umbrel-app.yml");
const version = manifest.match(/^version: "(\d+\.\d+\.\d+)"$/m)?.[1];
assert.ok(version, 'umbrel-app.yml debe declarar version: "X.Y.Z" entre comillas dobles (U9)');
const compose = read("docker-compose.yml");
const hook = read("hooks/pre-start");
const releaseDir = path.join(APP_DIR, "releases", version);
const legacyCompose = fs.readFileSync(path.join(__dirname, "legacy-0.6.59", "paquete", "docker-compose.yml"), "utf8");

/* Todos los ficheros de una carpeta, con ruta POSIX relativa y en orden de
   codigo (el mismo que usa release.mjs para SHA256SUMS). */
function listFiles(root) {
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) found.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return found.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/* Bloque de texto de cada servicio del Compose (indentacion de dos espacios). */
function services(text) {
  const out = {};
  let current = null;
  let inServices = false;
  for (const line of text.split("\n")) {
    if (/^services:\s*$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^\S/.test(line)) break;
    const header = /^ {2}([a-z_]+):\s*$/.exec(line);
    if (header) {
      current = header[1];
      out[current] = [];
    } else if (current) {
      out[current].push(line);
    }
  }
  return out;
}

/* Valor de una clave de primer nivel del servicio (cuatro espacios). */
function key(lines, name) {
  const line = lines.find((candidate) => candidate.startsWith(`    ${name}:`));
  return line === undefined ? undefined : line.slice(`    ${name}:`.length).trim();
}

function requiredFiles() {
  const block = /readonly -a REQUIRED_FILES=\(\n([\s\S]*?)\n\)/.exec(hook)?.[1];
  assert.ok(block, "el hook declara REQUIRED_FILES");
  return [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

function git(args) {
  const run = spawnSync("git", args, { cwd: APP_DIR, encoding: "utf8" });
  return run.status === 0 ? run.stdout : null;
}

const COMPOSE_SERVICES = services(compose);
const LEGACY_SERVICES = services(legacyCompose);

test("manifiesto: id, puerto, categoria y version entre comillas (U1, U4, U9)", () => {
  assert.match(manifest, /^manifestVersion: 1$/m);
  assert.match(manifest, /^id: ismaeloul-ace-player-neo$/m);
  assert.match(manifest, /^port: 7792$/m);
  assert.match(manifest, /^category: media$/m);
  assert.match(manifest, /^name: Ace Player Neo$/m);
  assert.match(manifest, /^releaseNotes: >-\n {2}\S/m);
  assert.doesNotMatch(manifest, /\r/);
});

test("Compose apunta a una unica release y es la del manifiesto (T1)", () => {
  const versions = [...new Set([...compose.matchAll(/\/releases\/(\d+\.\d+\.\d+)\//g)].map((m) => m[1]))];
  assert.deepEqual(versions, [version]);
  assert.doesNotMatch(compose, /\r/);
  assert.doesNotMatch(compose, /^\s*(build|profiles):/m, "umbreld descarga todas las imagenes (U3)");
});

test("todo lo que Compose arranca existe en la release", () => {
  for (const file of ["server.js", "engine-control.js", "nginx.conf", "web/index.html"]) {
    assert.ok(fs.statSync(path.join(releaseDir, file)).isFile(), file);
  }
  assert.match(key(COMPOSE_SERVICES.storage, "command"), new RegExp(`exec node /releases/${version.replace(/\./g, "\\.")}/server\\.js"$`));
  assert.equal(key(COMPOSE_SERVICES.engine_control, "command"), `node /releases/${version}/engine-control.js`);
  assert.match(compose, new RegExp(`cp -r /releases/${version.replace(/\./g, "\\.")}/web/\\. /www/`));
  assert.match(compose, new RegExp(`cp /releases/${version.replace(/\./g, "\\.")}/nginx\\.conf /etc/nginx/conf\\.d/default\\.conf`));
});

test("toda imagen va fijada por digest y con el prefijo de la tienda (U1, U3)", () => {
  for (const [name, lines] of Object.entries(COMPOSE_SERVICES)) {
    if (name === "app_proxy") continue;
    assert.match(key(lines, "image") ?? "", /^[a-z0-9./_-]+(:[\w.-]+)?@sha256:[0-9a-f]{64}$/, name);
    assert.equal(key(lines, "container_name"), `ismaeloul-ace-player-neo_${name}_1`);
  }
});

test("app_proxy: el nginx de siempre en el 80 y /native/* sin login (D4)", () => {
  const proxy = COMPOSE_SERVICES.app_proxy.join("\n");
  assert.match(proxy, /^ {6}APP_HOST: ismaeloul-ace-player-neo_nginx_1$/m);
  assert.match(proxy, /^ {6}APP_PORT: "80"$/m);
  assert.match(proxy, /^ {6}PROXY_AUTH_ADD: "true"$/m);
  assert.match(proxy, /^ {6}PROXY_AUTH_WHITELIST: "\/native\/\*"$/m);
});

test("limites intactos respecto a la 0.6.59: memoria, procesos y endurecimiento", () => {
  assert.deepEqual(Object.keys(COMPOSE_SERVICES).sort(), Object.keys(LEGACY_SERVICES).sort());
  for (const name of Object.keys(LEGACY_SERVICES)) {
    for (const field of ["mem_limit", "pids_limit", "read_only", "init", "restart"]) {
      assert.equal(key(COMPOSE_SERVICES[name], field), key(LEGACY_SERVICES[name], field), `${name}.${field}`);
    }
    const hardened = (lines) => lines.some((line) => line.trim() === "- no-new-privileges:true");
    assert.equal(hardened(COMPOSE_SERVICES[name]), hardened(LEGACY_SERVICES[name]), `${name}: no-new-privileges`);
  }
  assert.equal(key(COMPOSE_SERVICES.acestream, "mem_limit"), "4g");
  assert.equal(key(COMPOSE_SERVICES.storage, "mem_limit"), "768m");
  assert.equal(key(COMPOSE_SERVICES.storage, "pids_limit"), "128");
});

test("el hook no fija la version a mano, lee Compose y va con LF y shebang (T1, U6)", () => {
  assert.doesNotMatch(hook, /readonly VERSION="\d+\.\d+\.\d+"/);
  assert.match(hook, /docker-compose\.yml/);
  assert.match(hook, /MANIFEST_VERSION/);
  assert.match(hook, /^#!\/usr\/bin\/env bash\n/);
  assert.doesNotMatch(hook, /\r/);
  assert.match(hook, /sha256sum --check --strict --quiet SHA256SUMS/);
});

test("REQUIRED_FILES del hook: todos presentes y no vacios en la release", () => {
  const required = requiredFiles();
  assert.ok(required.includes("SHA256SUMS") && required.includes("server.js") && required.includes("web/index.html"));
  for (const relative of required) {
    const stat = fs.statSync(path.join(releaseDir, relative));
    assert.ok(stat.isFile() && stat.size > 0, relative);
  }
});

test("SHA256SUMS: formato de sha256sum, ordenado, cubre toda la release y cuadra", () => {
  const sums = fs.readFileSync(path.join(releaseDir, "SHA256SUMS"), "utf8");
  assert.doesNotMatch(sums, /\r/);
  assert.ok(sums.endsWith("\n"));
  const entries = sums.trimEnd().split("\n").map((line) => {
    const match = /^([0-9a-f]{64}) {2}(\S.*)$/.exec(line);
    assert.ok(match, `linea mal formada: ${line}`);
    return { hash: match[1], file: match[2] };
  });
  const files = listFiles(releaseDir).filter((file) => file !== "SHA256SUMS");
  assert.deepEqual(entries.map((entry) => entry.file), files);
  for (const { hash, file } of entries) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(releaseDir, file))).digest("hex");
    assert.equal(actual, hash, file);
  }
  for (const relative of requiredFiles()) {
    if (relative !== "SHA256SUMS") assert.ok(files.includes(relative), `SHA256SUMS sin ${relative}`);
  }
});

test("la release solo lleva lo que toca: backend, config, RELEASE.json y web/ (sin mapas)", () => {
  const files = listFiles(releaseDir);
  assert.deepEqual(
    files.filter((file) => !file.startsWith("web/")),
    ["RELEASE.json", "SHA256SUMS", "engine-control.js", "nginx.conf", "server.js"]
  );
  assert.deepEqual(files.filter((file) => file.endsWith(".map") || file.endsWith(".complete")), []);
  const release = JSON.parse(fs.readFileSync(path.join(releaseDir, "RELEASE.json"), "utf8"));
  assert.equal(release.version, version);
  assert.match(release.commit, /^[0-9a-f]{40}$/, "RELEASE.json con el commit exacto de las fuentes (sin -dirty)");
});

test("servidor y service worker llevan la version del manifiesto (T3)", () => {
  const server = fs.readFileSync(path.join(releaseDir, "server.js"), "utf8");
  const sw = fs.readFileSync(path.join(releaseDir, "web", "sw.js"), "utf8");
  assert.ok(server.includes(`"${version}"`), "server.js con __APP_VERSION__");
  assert.match(sw, new RegExp(`^const VERSION = "aceneo-${version.replace(/\./g, "\\.")}";$`, "m"));
});

test("index.html y la precarga del service worker solo piden assets que existen", () => {
  const web = path.join(releaseDir, "web");
  const html = fs.readFileSync(path.join(web, "index.html"), "utf8");
  const sw = fs.readFileSync(path.join(web, "sw.js"), "utf8");
  const referenced = new Set([
    ...[...html.matchAll(/(?:href|src)="\/(assets\/[^"]+)"/g)].map((m) => m[1]),
    ...[...sw.matchAll(/"\/(assets\/[^"]+)"/g)].map((m) => m[1]),
  ]);
  assert.ok(referenced.size > 0);
  for (const asset of referenced) assert.ok(fs.existsSync(path.join(web, asset)), asset);
});

test("Compose, hook y nginx.conf son los de la plantilla del monorepo", (t) => {
  const umbrel = path.join(MONOREPO_DIR, "deploy", "umbrel");
  if (!fs.existsSync(umbrel)) return t.skip("sin el monorepo al lado (no es un checkout del repo)");
  assert.equal(compose, fs.readFileSync(path.join(umbrel, "docker-compose.yml"), "utf8"));
  assert.equal(hook, fs.readFileSync(path.join(umbrel, "hooks", "pre-start"), "utf8"));
  const template = fs.readFileSync(path.join(umbrel, "nginx.conf"), "utf8").replace(/\r\n?/g, "\n");
  assert.equal(fs.readFileSync(path.join(releaseDir, "nginx.conf"), "utf8"), template);
});

test("git: hook y vigilante ejecutables con LF, y la release byte a byte (-text)", (t) => {
  const staged = git(["ls-files", "-s", "--", "hooks/pre-start", "monitoring/ace-player-neo-healthcheck"]);
  if (!staged) return t.skip("sin git");
  for (const line of staged.trim().split("\n")) assert.match(line, /^100755 /, line);
  const attrs = git(["check-attr", "text", "eol", "--", "hooks/pre-start", "monitoring/ace-player-neo-healthcheck", `releases/${version}/SHA256SUMS`]);
  assert.match(attrs, /^hooks\/pre-start: eol: lf$/m);
  assert.match(attrs, /^monitoring\/ace-player-neo-healthcheck: eol: lf$/m);
  assert.match(attrs, new RegExp(`^releases/${version.replace(/\./g, "\\.")}/SHA256SUMS: text: unset$`, "m"));
});

test("vigilante: sondea una ruta sin login que existe y conserva el formato de status.json", () => {
  const script = read("monitoring/ace-player-neo-healthcheck");
  assert.doesNotMatch(script, /\r/);
  assert.match(script, /http:\/\/127\.0\.0\.1:7792\/native\/api\/v1\/ping/);
  assert.doesNotMatch(script, /7792\/api\/health/, "/api/health pide el login de Umbrel (D3)");
  assert.ok(
    script.includes(
      `'{"checkedAt":"%s","overall":"%s","version":"%s","checks":{"appProxy":"%s","appState":"%s","aceStream":"%s","scanner":"%s","ollama":"%s"}}\\n'`
    )
  );
});

test("la 0.6.59 sigue en el repo como plan de vuelta atras", () => {
  for (const file of ["server.js", "index.html", "sw.js", "player-controller.js", "nginx.conf"]) {
    assert.ok(fs.existsSync(path.join(APP_DIR, "releases", "0.6.59", file)), file);
  }
});
