# Empaquetado y despliegue de Ace Player Neo 0.7.0

Todo lo que convierte el monorepo en la app de Umbrel, y cómo se prueba sin
tocar la carpeta de la app (`ismaeloul-ace-player-neo/`). Referencias:
arquitectura §8 (nginx y ruta nativa) y §11 (empaquetado), empaquetado §6-§7.

## Qué hay y dónde

| Ruta | Qué es |
|---|---|
| `deploy/umbrel/docker-compose.yml` | Compose de la 0.7.0: el de la 0.6.59 con `releases/0.7.0`, `PROXY_AUTH_WHITELIST: "/native/*"`, `ACE_SEED`, `timeout 60` para ffmpeg, healthcheck a `/api/v1/health/live` y nginx copiando solo `web/`. Sin `build:` ni `profiles:` (U3). |
| `deploy/umbrel/hooks/pre-start` | Hook 0.7.0 (empaquetado §7.4): `REQUIRED_FILES` nueva, `-f` y `-s`, `sha256sum --check`, restauración en carpeta aparte + renombrado, `chmod`, y solo aviso si el manifiesto no coincide con Compose. LF y ejecutable. |
| `deploy/umbrel/nginx.conf` | Plantilla de la `nginx.conf` de la release (arquitectura §8.2): origen calculado sobre la URI cruda, 400 a `%2f`/`%2e`/`%5c`/`..`/`\` en la ruta, 403 al origen `native` fuera de `/native/`, `X-Ace-Origin` y `X-Request-Id` en todo lo que va al backend. |
| `deploy/local/` | Pila local: `compose.local.yml` (perfiles `falso`, `real` y `test`), `prepare.mjs` (monta la release en `.work/`) y la pasarela falsa que imita la de umbreld. |
| `deploy/test/` | Tests de Vitest del Compose, la `nginx.conf`, la pasarela falsa y el hook (ejecutado con bash de verdad). |
| `apps/server/build.mjs` | esbuild: `server.js` y `engine-control.js`, un fichero CommonJS cada uno, `node24`, sin minificar, `__APP_VERSION__` inyectada. |
| `apps/server/Dockerfile` | Imagen del backend (solo CI y perfil `test`; Umbrel no la usa). Su ignore efectivo es `Dockerfile.dockerignore`. |
| `scripts/release.mjs` | Monta `releases/<v>/` desde cero: reproducible, `SHA256SUMS` con LF, `RELEASE.json` sin fecha, `sw.js` con la versión y la precarga. |
| `scripts/test-nginx-docker.mjs` | Matriz de arquitectura §8.3 y cargas de ataque contra el nginx real, con y sin la pasarela falsa. |
| `scripts/test-shellcheck-docker.mjs` | shellcheck del hook con la imagen oficial por digest. |
| `scripts/lib/` | Lector de `nginx.conf` y la lista de cargas del blindaje, compartidos por los tests. |

## Comprobar

Desde `ace-player-neo/`:

```bash
corepack pnpm@10.18.2 test:deploy        # Vitest: Compose, nginx, pasarela, hook, build y release
corepack pnpm@10.18.2 typecheck:deploy   # tsc de deploy/ y scripts/
corepack pnpm@10.18.2 lint               # eslint + prettier de todo el monorepo
corepack pnpm@10.18.2 test:nginx         # nginx real en Docker (hace falta Docker arrancado)
corepack pnpm@10.18.2 test:shellcheck    # shellcheck del hook (Docker)
corepack pnpm@10.18.2 test:contraste     # E1.4: rutas antiguas contra el server.js de la 0.6.59 (sin Docker)
corepack pnpm@10.18.2 test:compose       # pila local con motor falso de punta a punta + E1.12 con Chrome (Docker)
```

`test:compose` monta su propia release en una carpeta temporal y usa el
proyecto `aceneo-contraste` con puertos que elige Docker: no choca con la pila
de abajo ni con una 0.6.59 levantada en el 17792, y la baja al terminar
(`--keep` la deja arriba, `--navegador no` se salta Playwright). Resultados e
informe en `docs/analisis/contraste-0659.md`.

En Windows los tests del hook usan el bash de Git (`Git/usr/bin/bash.exe`) y
un `curl` falso delante del PATH: ningún test sale a internet.

## Pila local

```bash
node deploy/local/prepare.mjs     # release en deploy/local/.work (sin web v2, usa la de la 0.6.59)
docker compose -f deploy/local/compose.local.yml --profile falso up   # motor falso
docker compose -f deploy/local/compose.local.yml --profile real up    # motor real
docker compose -f deploy/local/compose.local.yml --profile test up --build servidor_imagen
```

Puertos (solo 127.0.0.1): 17792 pasarela falsa (login en `/__pasarela/login`),
17793 nginx directo, 17794 la imagen del Dockerfile.

## Decisiones propias de esta entrega

- **Origen `native` más amplio que en arquitectura §8.2**: el `map` usa
  `"~*^/native"` en vez de `"~^/native(/|\?|$)"`. Sin distinguir mayúsculas y
  con cualquier continuación (`/NATIVE/…`, `/native;…`, `/nativeX`): si la
  pasarela casara alguna de esas con la lista blanca, entraría sin login, y así
  fuera de `/native/` recibe un 403. Ninguna ruta web empieza por `/native`.
- **`Dockerfile.dockerignore`** además de `.dockerignore`: con
  `docker build -f apps/server/Dockerfile .` BuildKit solo lee el que se llama
  como el Dockerfile. Un test exige que los dos tengan las mismas reglas.
- **`deploy/prettier.config.mjs`**: los Compose conservan las comillas dobles de
  la 0.6.59; el resto usa la configuración de la raíz.
- **`release.mjs` sin `--out`** (la carpeta real de la app) comprueba antes de
  crear nada que existen el servidor, engine-control y la web compilada; con
  `--out` admite una release incompleta y lo avisa.

## Cortar la release (Fase 4)

**Hecho el 23-09 en `rewrite-v2`**, sin publicar. Cómo publicarla, comprobarla
y volver atrás: [`docs/despliegue.md`](../docs/despliegue.md).

1. Web compilada (`corepack pnpm@10.18.2 --filter @ace/web build`).
2. `corepack pnpm@10.18.2 release` → `ismaeloul-ace-player-neo/releases/0.7.0/`
   (sin los `.map` de Vite). `corepack pnpm@10.18.2 check:release` la vuelve a
   montar y la compara con la commiteada; CI lo hace en cada push.
3. `deploy/umbrel/docker-compose.yml` y `deploy/umbrel/hooks/pre-start` copiados
   tal cual a la carpeta de la app, el hook con modo 100755 en git. Un test
   (`deploy/test/compose.test.ts`) exige que sigan siendo iguales.
4. `umbrel-app.yml`: `version: "0.7.0"` (entre comillas, U9) y notas de la versión.
5. `.gitattributes` de la raíz: `ismaeloul-ace-player-neo/releases/** -text`
   (en este PC `core.autocrlf=true` y los hashes no cuadrarían) y LF para
   `monitoring/` y el paquete de la 0.6.59.
6. Tests de la carpeta de la app: `tests/release.test.js` (coherencia del
   paquete) y los de la 0.6.59 en `tests/legacy-0.6.59/`, siempre contra
   `releases/0.6.59`, con su Compose y su hook en `paquete/`.
7. Pendiente de Isma: el merge con la etiqueta `ace-player-neo-v0.7.0` a la vez,
   y la 0.7.1 de vuelta atrás preparada antes (`docs/despliegue.md` §6).

## Pendiente

- Prueba de humo del `server.js` real y de la imagen en cuanto exista
  `apps/server/src/main.ts` (hoy se prueba con un servidor mínimo de Fastify).
- Casos de §8.3 que dependen del backend: el 401 sin token y el 403 a rutas
  antiguas con origen `native` ya los prueba `test:compose` con el backend
  real; falta la URL de vídeo caducada.
- Probar la pasarela real de umbreld en un Umbrel (plan §8.3); si se comporta
  distinto, plan B de arquitectura §8.4 (puerto aparte).
- `typecheck:deploy` deja fuera, de momento, tres herramientas sueltas que
  llegaron sin tipos JSDoc (`scripts/smoke-bundle.mjs`, `scripts/soak-real.mjs`
  y `scripts/check-migration-prod.mjs`: 57 errores de `checkJs`). La prueba de
  humo sí corre en la CI. Tiparlas y quitarlas del `exclude` de
  `deploy/tsconfig.json`.
