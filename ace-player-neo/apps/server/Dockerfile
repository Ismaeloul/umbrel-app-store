# syntax=docker/dockerfile:1
# Imagen del backend de Ace Player Neo (arquitectura §11.4).
#
# Umbrel NO la usa: en el NAS el backend sigue corriendo con la imagen oficial
# de Node fijada por digest y la release montada en solo lectura
# (deploy/umbrel/docker-compose.yml), porque umbreld solo descarga imagenes
# publicas y el paquete de GHCR todavia no lo es. Esta imagen se construye en
# CI (sin publicar) y en el perfil "test" de la pila local. Cuando el paquete
# sea publico, pasar a ella es cambiar image: y command: de storage.
#
# Se construye desde la raiz del monorepo (hacen falta el lockfile y
# packages/shared):
#   docker build -f apps/server/Dockerfile --build-arg ACE_COMMIT=$(git rev-parse HEAD) .
# El ignore que aplica es apps/server/Dockerfile.dockerignore: con -f, BuildKit
# busca <Dockerfile>.dockerignore junto al Dockerfile, no el .dockerignore de
# esta carpeta.
#
# Para correrla como en produccion (sin root, disco de solo lectura):
#   docker run --init --read-only --tmpfs /tmp -v aceneo-datos:/data -p 3000:3000 <imagen>

# La misma imagen, por digest, que storage en el Compose de Umbrel: lo que se
# prueba aqui es lo que corre en el NAS.
ARG NODE_IMAGE=node:24.19.0-alpine3.24@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43

# ---------------------------------------------------------------------------
# deps: descarga al almacen de pnpm todo lo del lockfile. Solo mira
# pnpm-lock.yaml, asi que esta capa se reutiliza mientras el lockfile no cambie
# aunque cambie el codigo.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS deps
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    PNPM_STORE_DIR=/pnpm/store
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
# corepack instala el pnpm exacto de "packageManager" (10.18.2).
RUN corepack enable pnpm && pnpm --version
RUN pnpm fetch --store-dir "${PNPM_STORE_DIR}"

# ---------------------------------------------------------------------------
# build: instala sin red desde el almacen y monta la release igual que para
# Umbrel (scripts/release.mjs): server.js de esbuild, engine-control.js y, si ya
# existe la web (Fase 2), su build de Vite.
# ---------------------------------------------------------------------------
FROM deps AS build
ARG ACE_COMMIT=desconocido
COPY . .
RUN pnpm install --offline --frozen-lockfile --store-dir "${PNPM_STORE_DIR}"
RUN if [ -f apps/web/package.json ]; then pnpm --filter @ace/web build; fi
# La carpeta de la release lleva la version en el nombre; se deja en /release
# para que la etapa final no tenga que saberla.
RUN node scripts/release.mjs --out /out --commit "${ACE_COMMIT}" \
 && mv "/out/$(node -p "require('./package.json').version")" /release

# ---------------------------------------------------------------------------
# runtime: Node y ffmpeg, nada mas. Sin node_modules: server.js lleva dentro
# todas sus dependencias.
# ---------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS runtime
# ffmpeg va en la imagen: en el NAS se instala con apk en cada arranque, aqui no
# hace falta red al arrancar.
RUN apk add --no-cache ffmpeg \
 && mkdir -p /data \
 && chown node:node /data
ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=3000
WORKDIR /app
# De root y 644: el usuario node puede leer el codigo pero no cambiarlo.
COPY --from=build --chown=root:root --chmod=644 /release/server.js /release/RELEASE.json /app/
USER node
EXPOSE 3000
# /api/v1/health/live no sale a la red: responde en cuanto el servidor escucha.
HEALTHCHECK --interval=15s --timeout=8s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live >/dev/null || exit 1
CMD ["node", "/app/server.js"]
