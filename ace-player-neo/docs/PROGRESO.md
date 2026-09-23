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
| 1. Backend | **hecha** (23-sep 05:40, tests en verde; verificación independiente en curso) | Parada 2 |
| 2. Web | en curso (diseño elegido; armazón y vistas) | |
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
- 23:40: FASE 1, paso 1.0 lanzado (workflow `wf_8a9e75d2-b4f`): A0
  contratos + esqueleto del servidor, FE motor AceStream falso y A7
  empaquetado, cada uno con su verificador independiente.
- 23:50: la extensión Claude in Chrome falla por AdGuard (`pendiente.md`);
  las capturas se hacen con Playwright sobre el Chrome instalado
  (`@playwright/test` 1.63.0 en la raíz, sin descargar navegadores).
- 23:55: exploración visual adelantada (D8, workflow `wf_12c8280b-696`):
  referencias, 3 direcciones con maquetas y capturas, 3 jurados y elección.
- ~00:00: **límite de uso alcanzado** (14 agentes a la vez en dos
  workflows). Murieron todos menos el de referencias
  (`docs/diseno/referencias.md`, completo). Los demás dejaron ficheros
  parciales en disco (shared/src, fake-engine, deploy, scripts, build.mjs).
- 01:38: Isma reactiva. Relanzo el paso 1.0 como **reanudación** sobre lo
  parcial (workflow `wf_75432a9b-19d`, 3 agentes, sin verificadores aparte:
  los tests los paso yo). Las maquetas esperan a que termine para no volver
  a quemar la cuota con muchos agentes a la vez.
- 02:25: paso 1.0 terminado y verificado por mí (typecheck, shared 65,
  server 107, motor falso 86, deploy 108 tests; ESLint limpio). Commit
  `ff107c8`. Aviso del agente del motor falso: en este PC `127.0.0.1` corta
  ~1 de cada 6 conexiones (NordVPN/AdGuard); los tests escuchan en `::1`.
- 02:30: paso 1.1 lanzado (workflow `wf_1bee92ed-1e4`): 7 agentes de
  módulo (estado+salud, motor+búsqueda+engine-control, comprobador+fuentes,
  red+directorios, fútbol, reproducción+remux, acceso+eventos+diagnóstico),
  como mucho 4 a la vez. Si se corta por la cuota, relanzar con
  `resumeFromRunId` (los terminados se reutilizan) y a los cortados
  pedirles que retomen lo que haya en disco.
- 02:35: Isma desactiva AdGuard; la extensión Claude in Chrome ya navega
  (probado con la 0.6.59 local). Las pruebas en su navegador se hacen con
  ella; Playwright sigue para CI y para las capturas en serie.
- 03:55: paso 1.1 terminado (7/7 agentes, 3,49 M tokens, 87 min).
  Typecheck limpio, 1102 tests en verde, 18 del esqueleto de A0 por ajustar
  (esperaban módulos vacíos). Informes literales en
  `docs/cobertura/informes-paso-1.1.md`; cobertura por módulo en
  `docs/cobertura/<módulo>.md`. Migración contra la copia de producción:
  las 12 claves v1 idénticas, idempotente, y la 0.6.59 la lee igual. Commit
  `4e25a91`.
- 04:00: lanzado el workflow `wf_5096d575-3c2`: integrador (contratos
  pedidos, 18 tests, cableado, humo del bundle, soak de 2 h simulado,
  compat.md, comportamientos.md) → contraste con la 0.6.59 y Docker local;
  en paralelo, las 3 maquetas visuales y un jurado que elige.
- 05:20: integración y contraste terminados (6/6 agentes, 2,44 M tokens).
  Comprobado por mí: typecheck limpio, shared 65, servidor 1143 (con el
  cierre intermitente de Windows en 1 de 4 ejecuciones, ver `pendiente.md`),
  motor falso 86, deploy 108, humo 18/18. Diseño elegido: A «Luz de focos»
  con injertos de B y C (`docs/diseno/eleccion.md`). Commits `e35184a` y
  `d9dbaf3` (dependencias de la web).
- 05:40: workflow `wf_c97519e8-c5f`: verificadores independientes del
  backend (seguridad; comportamientos e inventario) a la vez que la FASE 2
  (D18): armazón + sistema de diseño (B0) y después 5 vistas, 3 a la vez
  (agenda, biblioteca, reproductor, partido y fuentes, salud/dispositivos/PWA).
  Parada 2 escrita (se completa con los verificadores).

- **07:29: PAUSA POR CUOTA.** Isma avisa de que lleva el 96 % usado y se
  reinicia a las 9:00. Paro a mano el workflow `wf_c97519e8-c5f` para que
  no le pille a medias. Quedan **sin commitear** (a propósito: están a medias
  y sin verificar) los cambios de sus 3 agentes:
  - verificador de seguridad: `core/csrf.ts`, `main.ts`,
    `playback/service.ts`, `deploy/umbrel/nginx.conf`,
    `scripts/lib/blindaje.mjs`, tests nuevos (`test/security.test.ts`,
    `playback/security.test.ts`, `test/process-handlers.test.ts`...);
  - verificador de comportamientos: `test/numeros-0659.test.ts`,
    `test/integration/escrituras.test.ts`, retoques de tests y de
    `comportamientos.md`/`compat.md`;
  - armazón web (B0): todo lo nuevo de `apps/web/` (src, index.html,
    vite.config.ts, public, scripts, README).

  **Cómo retomar a partir de las 9:00**: relanzar esos tres encargos como
  REANUDACIÓN (que cada agente haga inventario de lo que hay en disco, lo
  termine y pase sus comprobaciones), con el script del workflow
  `wf_c97519e8-c5f` cambiando los prompts a "retoma"; después las 5 vistas
  (3 a la vez), la integración de la web, E2E/axe/Lighthouse y capturas
  (también con Claude in Chrome, que ya funciona), la prueba contra el motor
  real y las FASES 3 y 4. Lo último commiteado y en verde es `a4fdbcf`.

| Fase | Estado |
|---|---|
| 0 | hecha |
| 1 | hecha (tests en verde); verificación independiente en curso |
| 2 | en curso: armazón y vistas |
| 3 | pendiente |
| 4 | pendiente |

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

- 07:45: Isma ve las capturas de A, B y C y **confirma la A «Luz de focos»**.
