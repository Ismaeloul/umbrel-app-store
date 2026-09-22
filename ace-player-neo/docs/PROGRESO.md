# Progreso de Ace Player Neo v2

> Si la sesión se corta, este fichero basta para retomarla. Se actualiza al
> terminar cada paso lógico.

## Dónde está todo

- **Repo**: clon de `Ismaeloul/umbrel-app-store` en
  `C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store`, rama
  **`rewrite-v2`** (sale de `origin/main` @ `a9a6f3d`, que lleva la 0.6.59).
- **Código nuevo (monorepo pnpm)**: `ace-player-neo/` en la raíz del repo
  (mismo patrón que `saldo/`).
  - `apps/server` (Fastify + TS), `apps/web` (Vite + React + TS),
    `apps/ios` (SwiftUI + XcodeGen), `packages/shared` (esquemas zod).
  - `docs/`: toda la documentación, las paradas y las capturas.
- **Paquete de Umbrel**: `ismaeloul-ace-player-neo/` (manifiesto, compose,
  hooks, monitoring y `releases/<versión>/` con lo ya compilado).
- La carpeta `Desktop\Actualización aceplayer\ismaeloul-ace-player-neo` es la
  copia sin git de la 0.6.59 que dejaste; no se toca.
- pnpm se usa con `corepack pnpm@10.18.2 …` (no hay pnpm global instalado).
- **Pruebas locales con el motor real**: una copia de la 0.6.59 corre en
  Docker (`docker compose` en la carpeta `legacy/` del scratchpad de la
  sesión), con nginx en `127.0.0.1:17792`. La copia del `state.json` de
  producción vive solo en ese scratchpad, nunca en el repo.

## Estado por fases

| Fase | Estado | Notas |
|---|---|---|
| 0. Análisis y plan | **hecha** (22-sep 23:35) | informe en PARADAS.md |
| 1. Backend | en curso | |
| 2. Web | pendiente | |
| 3. iOS | pendiente | |
| 4. CI, docs y entrega | pendiente | |

## Registro

- 2026-09-22 22:31: rama `rewrite-v2` creada. Comprobado en el código de
  umbreld (por SSH, solo lectura) qué copia Umbrel al actualizar: solo
  `docker-compose.yml`, `*.template`, `exports.sh`, `torrc`, `hooks/` y
  `umbrel-app.yml`. `releases/` no se copia, lo restaura `hooks/pre-start`.
  GitHub Actions vuelve a arrancar (hay ejecuciones correctas del 22-sep).
- 22:36: esqueleto del monorepo (pnpm vía `corepack pnpm@10.18.2`, sin
  instalar nada global; TypeScript 6.0.3 porque typescript-eslint aún no
  admite la 7). Commit `9e74d5f`.
- 22:40: Isma reinicia el PC para activar Docker y se cortan los agentes de
  la FASE 0. Revisado tras el reinicio: ningún agente llegó a escribir nada
  (0 resultados en el diario del workflow `wf_ecbe543e-928`), no había
  worktrees ni ramas extra, y el árbol solo tenía el esqueleto, que estaba
  bien (instala con `--frozen-lockfile`) y se ha commiteado. FASE 0
  relanzada entera (workflow `wf_fe88e8d0-f49`). Docker Desktop no estaba
  arrancado tras el reinicio: lo lancé yo.
- 22:47-23:00: 0.6.59 en local contra el motor real y pruebas de sesiones
  (`analisis/motor-real.md`); decisiones D3-D5.
- 23:35: FASE 0 terminada (Parada 1 en `PARADAS.md`). Decisiones D6-D7.

## Agentes y workflows lanzados

### FASE 0 (workflow `wf_fe88e8d0-f49`, 11 agentes, ~48 min, 3,45 M tokens de subagentes)

| Agente | Qué hizo | Resultado |
|---|---|---|
| changelog | CHANGELOG + releaseNotes → `analisis/comportamientos-changelog.md` | 281 entradas (246 vigentes, 35 sustituidas) |
| tests | los 133 tests → `analisis/comportamientos-tests.md` | ficha por test con cómo portarlo; 71 exportaciones usadas |
| api | `server.js` → `api.md` + `openapi.yaml` | 25 rutas, 27 operaciones |
| backend | mapa de `server.js` → `analisis/backend-modulos.md` | 202 funciones repartidas, esquema de state.json, 37 riesgos |
| front | `index.html` → `analisis/inventario-front.md` | 48 puntos del prompt cruzados, 38 detalles a conservar |
| reproductor | lógica de reproducción → `analisis/reproductor.md` | máquina de estados real y 23 problemas P1-P23 |
| empaquetado | compose, hook, nginx, SW → `analisis/empaquetado.md` | propuesta de `releases/0.7.0` y del hook |
| verificar-api (independiente) | contrasta api.md/openapi con el código | 9 + 11 correcciones, nada inventado |
| comportamientos | síntesis → `comportamientos.md` | 278 filas con trazabilidad completa |
| critico-comportamientos (independiente) | relee CHANGELOG y tests contra la lista | 35 filas corregidas, 0 que falten |
| arquitectura | → `arquitectura.md` + `plan.md` | alineado a mano con D5 (compartir por defecto) |

Además, yo (orquestador): pruebas contra el motor real en Docker local
(`analisis/motor-real.md`) y decisiones D1-D7.
