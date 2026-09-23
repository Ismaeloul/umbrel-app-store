// Compose de la 0.7.0 (deploy/umbrel/docker-compose.yml) frente al de la
// 0.6.59 (guardado en ismaeloul-ace-player-neo/tests/legacy-0.6.59/paquete para
// volver atrás): solo puede cambiar lo que dicen arquitectura §11.2 y
// empaquetado §7.3. También la pila local, el Dockerfile y sus ignores, que
// tienen que usar las mismas imágenes, y que la carpeta de la app publica la
// plantilla tal cual.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNginx, findAll } from '../../scripts/lib/nginx-conf.mjs';
import {
  APP_DIR,
  LEGACY_PACKAGE_DIR,
  COMPOSE_TEMPLATE,
  HOOK_TEMPLATE,
  MONOREPO_DIR,
  NGINX_TEMPLATE,
  monorepoVersion,
  readCompose,
  readText,
  type ComposeService,
} from './helpers.js';

const VERSION = monorepoVersion();
const RAW = readText(COMPOSE_TEMPLATE);
const COMPOSE = readCompose(COMPOSE_TEMPLATE);
const LEGACY = readCompose(path.join(LEGACY_PACKAGE_DIR, 'docker-compose.yml'));
/** Lo que se publica: la carpeta de la app lleva la plantilla tal cual. */
const PUBLISHED = readText(path.join(APP_DIR, 'docker-compose.yml'));
const LOCAL_FILE = path.join(MONOREPO_DIR, 'deploy', 'local', 'compose.local.yml');
const LOCAL = readCompose(LOCAL_FILE);
const DOCKERFILE = readText(path.join(MONOREPO_DIR, 'apps', 'server', 'Dockerfile'));
const DIGEST = /@sha256:[0-9a-f]{64}$/;

function service(name: string): ComposeService {
  const found = COMPOSE.services[name];
  if (!found) throw new Error(`Falta el servicio ${name}`);
  return found;
}

function legacy(name: string): ComposeService {
  const found = LEGACY.services[name];
  if (!found) throw new Error(`Falta el servicio ${name} en la 0.6.59`);
  return found;
}

/** Lo que umbreld y el hook ven: todas las versiones de /releases/X.Y.Z/ del texto. */
function releaseVersions(text: string): string[] {
  return [...new Set([...text.matchAll(/\/releases\/(\d+\.\d+\.\d+)\//g)].map((m) => m[1] ?? ''))];
}

/** Espacios del bloque plegado ">" de YAML reducidos a uno, para comparar comandos. */
const squash = (command: unknown) => String(command).replace(/\s+/g, ' ').trim();

describe('Compose de Umbrel (plantilla 0.7.0)', () => {
  it('apunta a una única release y es la versión del monorepo (T-001)', () => {
    expect(releaseVersions(RAW)).toEqual([VERSION]);
    const serverPkg = JSON.parse(
      readFileSync(path.join(MONOREPO_DIR, 'apps', 'server', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(serverPkg.version).toBe(VERSION);
  });

  it('los mismos servicios que la 0.6.59, sin build: ni profiles: (U3)', () => {
    expect(Object.keys(COMPOSE.services).sort()).toEqual(Object.keys(LEGACY.services).sort());
    for (const [name, definition] of Object.entries(COMPOSE.services)) {
      expect(definition.build, name).toBeUndefined();
      expect(definition.profiles, name).toBeUndefined();
    }
    expect(RAW).not.toMatch(/^\s*(build|profiles):/m);
  });

  it('mismas imágenes y digests, límites, volúmenes, puertos y nombres que la 0.6.59', () => {
    const kept = [
      'image',
      'container_name',
      'restart',
      'init',
      'read_only',
      'security_opt',
      'working_dir',
      'ports',
      'extra_hosts',
      'depends_on',
      'volumes',
      'mem_limit',
      'pids_limit',
    ];
    for (const name of Object.keys(LEGACY.services)) {
      for (const key of kept) {
        expect(service(name)[key], `${name}.${key}`).toEqual(legacy(name)[key]);
      }
    }
  });

  it('toda imagen va fijada por digest y todo contenedor con el prefijo de la tienda (U1, U3)', () => {
    for (const [name, definition] of Object.entries(COMPOSE.services)) {
      if (name === 'app_proxy') continue;
      expect(definition.image, name).toMatch(DIGEST);
      expect(definition.container_name).toBe(`ismaeloul-ace-player-neo_${name}_1`);
    }
  });

  it('app_proxy: el nginx de siempre en el 80 y /native/* sin login (U4, arquitectura §8.1)', () => {
    expect(service('app_proxy').environment).toEqual({
      ...legacy('app_proxy').environment,
      PROXY_AUTH_WHITELIST: '/native/*',
    });
    expect(service('app_proxy').environment?.APP_HOST).toBe(service('nginx').container_name);
    expect(RAW).toContain('PROXY_AUTH_WHITELIST: "/native/*"');
  });

  it('storage: el entorno de la 0.6.59 más ACE_SEED de APP_SEED', () => {
    expect(service('storage').environment).toEqual({
      ...legacy('storage').environment,
      ACE_SEED: '${APP_SEED}',
    });
    expect(RAW).toContain('ACE_SEED: "${APP_SEED}"');
    expect(service('engine_control').environment).toEqual(legacy('engine_control').environment);
  });

  it('storage: ffmpeg con plazo y node sobre el server.js CommonJS de la release', () => {
    expect(squash(service('storage').command)).toBe(
      `sh -c "timeout 60 apk add ffmpeg >/dev/null 2>&1 || echo 'sin ffmpeg, remux iOS desactivado'; exec node /releases/${VERSION}/server.js"`,
    );
  });

  it('storage: healthcheck a /api/v1/health/live con los plazos de siempre', () => {
    const { test, ...timings } = service('storage').healthcheck ?? {};
    const { test: _legacyTest, ...legacyTimings } = legacy('storage').healthcheck ?? {};
    expect(test).toEqual([
      'CMD-SHELL',
      'wget -qO- http://127.0.0.1:3000/api/v1/health/live >/dev/null || exit 1',
    ]);
    expect(timings).toEqual(legacyTimings);
  });

  it('engine_control y los motores: mismo comando, solo cambia la release', () => {
    expect(squash(service('engine_control').command)).toBe(
      `node /releases/${VERSION}/engine-control.js`,
    );
    expect(service('acestream').command).toBe(legacy('acestream').command);
    expect(service('acestream_scanner').command).toBe(legacy('acestream_scanner').command);
  });

  it('nginx copia SOLO web/ a /www y la nginx.conf de la release (arregla N1)', () => {
    const command = squash(service('nginx').command);
    expect(command).toBe(
      `sh -c "rm -rf /www && mkdir -p /www && cp -r /releases/${VERSION}/web/. /www/ && cp /releases/${VERSION}/nginx.conf /etc/nginx/conf.d/default.conf && exec nginx -g 'daemon off;'"`,
    );
    expect(command).not.toContain(`/releases/${VERSION}/. `);
  });

  it('la release se monta entera y de solo lectura, nunca ficheros sueltos (empaquetado §7.3)', () => {
    for (const name of ['engine_control', 'storage', 'nginx']) {
      const volumes = service(name).volumes ?? [];
      expect(volumes).toContain('${APP_DATA_DIR}/releases:/releases:ro');
      expect(volumes.filter((volume) => volume.includes('/releases/'))).toEqual([]);
    }
  });

  it('nginx.conf y el backend usan los nombres de contenedor de Compose (I1)', () => {
    const names = new Set(Object.values(COMPOSE.services).map((s) => s.container_name));
    const tree = parseNginx(readText(NGINX_TEMPLATE));
    const hosts = findAll(tree, 'proxy_pass').map(
      (directive) => /^https?:\/\/([^:/]+)/.exec(directive.args[0] ?? '')?.[1],
    );
    expect(hosts.length).toBeGreaterThan(0);
    for (const host of hosts) expect(names.has(host), String(host)).toBe(true);
    const env = service('storage').environment ?? {};
    for (const key of ['ACESTREAM_HOST', 'ACESTREAM_SCANNER_HOST', 'ENGINE_CONTROL_HOST']) {
      expect(names.has(env[key]), key).toBe(true);
    }
  });

  it('texto con LF y sin secretos ni IPs privadas escritas', () => {
    expect(RAW).not.toContain('\r');
    expect(RAW).not.toMatch(/\b(10|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+/);
  });

  it('la carpeta de la app publica esta plantilla y este hook tal cual', () => {
    expect(PUBLISHED).toBe(RAW);
    expect(readText(path.join(APP_DIR, 'hooks', 'pre-start'))).toBe(readText(HOOK_TEMPLATE));
    const manifest = readText(path.join(APP_DIR, 'umbrel-app.yml'));
    expect(/^version: "([^"]+)"$/m.exec(manifest)?.[1]).toBe(VERSION);
  });
});

describe('Pila local (deploy/local/compose.local.yml)', () => {
  const localRaw = readText(LOCAL_FILE);
  const production = (name: string) => squash(service(name).command);
  const local = (name: string) =>
    squash(LOCAL.services[name]?.command).replaceAll('${ACE_VERSION:-0.7.0}', VERSION);

  it('las mismas imágenes por digest que producción', () => {
    const productionImages = new Set(Object.values(COMPOSE.services).map((s) => s.image));
    for (const [name, definition] of Object.entries(LOCAL.services)) {
      if (!definition.image) continue;
      expect(definition.image, name).toMatch(DIGEST);
      expect(productionImages.has(definition.image), name).toBe(true);
    }
  });

  it('el mismo comando de nginx y de storage que producción', () => {
    expect(local('nginx')).toBe(production('nginx'));
    expect(local('storage')).toBe(production('storage'));
    expect(LOCAL.services.storage?.healthcheck).toEqual(service('storage').healthcheck);
  });

  it('el mismo entorno de storage, salvo la semilla de pruebas', () => {
    const {
      ENGINE_CONTROL_TOKEN: _t,
      ACE_SEED: _s,
      ...rest
    } = LOCAL.services.storage?.environment ?? {};
    const {
      ENGINE_CONTROL_TOKEN: _pt,
      ACE_SEED: _ps,
      ...productionRest
    } = service('storage').environment ?? {};
    expect(rest).toEqual(productionRest);
  });

  it('los nombres de producción como alias de red, para que nginx.conf sirva tal cual', () => {
    const aliases = Object.values(LOCAL.services).flatMap(
      (definition) => definition.networks?.default?.aliases ?? [],
    );
    for (const name of ['nginx', 'storage', 'acestream', 'acestream_scanner', 'engine_control']) {
      expect(aliases).toContain(service(name).container_name);
    }
  });

  it('solo publica puertos en 127.0.0.1', () => {
    for (const [name, definition] of Object.entries(LOCAL.services)) {
      for (const port of definition.ports ?? []) expect(port, name).toMatch(/^127\.0\.0\.1:/);
    }
    expect(localRaw).not.toContain('\r');
  });

  it('el perfil test construye la imagen del Dockerfile sin tocar el Compose de Umbrel', () => {
    const image = LOCAL.services.servidor_imagen;
    expect(image?.profiles).toEqual(['test']);
    expect(image?.build).toEqual({ context: '../..', dockerfile: 'apps/server/Dockerfile' });
    expect(image?.read_only).toBe(true);
  });
});

describe('Dockerfile del backend (arquitectura §11.4)', () => {
  it('usa la misma imagen de Node, por digest, que storage en Umbrel', () => {
    const arg = /^ARG NODE_IMAGE=(\S+)$/m.exec(DOCKERFILE)?.[1];
    expect(arg).toBe(service('storage').image);
    expect(DOCKERFILE).not.toMatch(/^FROM (?!\$\{NODE_IMAGE\}|deps )/m);
  });

  it('multi-etapa: deps con el lockfile, build con release.mjs y runtime sin root', () => {
    expect(DOCKERFILE).toMatch(/^FROM \$\{NODE_IMAGE\} AS deps$/m);
    expect(DOCKERFILE).toMatch(/^FROM deps AS build$/m);
    expect(DOCKERFILE).toMatch(/^FROM \$\{NODE_IMAGE\} AS runtime$/m);
    expect(DOCKERFILE).toContain('pnpm fetch');
    expect(DOCKERFILE).toContain('pnpm install --offline --frozen-lockfile');
    expect(DOCKERFILE).toContain('node scripts/release.mjs --out /out');
    expect(DOCKERFILE).toContain('apk add --no-cache ffmpeg');
    expect(DOCKERFILE).toMatch(/^USER node$/m);
    expect(DOCKERFILE).toContain('http://127.0.0.1:3000/api/v1/health/live');
    expect(DOCKERFILE).toMatch(/^CMD \["node", "\/app\/server\.js"\]$/m);
  });

  it('los dos ignores tienen las mismas reglas y dejan fuera node_modules', () => {
    const rules = (file: string) =>
      readText(path.join(MONOREPO_DIR, 'apps', 'server', file))
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '' && !line.startsWith('#'));
    expect(rules('.dockerignore')).toEqual(rules('Dockerfile.dockerignore'));
    expect(rules('Dockerfile.dockerignore')).toContain('**/node_modules');
    expect(rules('Dockerfile.dockerignore')).toContain('deploy/local/.work');
  });
});
