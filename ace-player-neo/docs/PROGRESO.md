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

## Estado por fases

| Fase | Estado | Notas |
|---|---|---|
| 0. Análisis y plan | en curso | |
| 1. Backend | pendiente | |
| 2. Web | pendiente | |
| 3. iOS | pendiente | |
| 4. CI, docs y entrega | pendiente | |

## Registro

- 2026-09-22 22:31: rama `rewrite-v2` creada. Comprobado en el código de
  umbreld (por SSH, solo lectura) qué copia Umbrel al actualizar: solo
  `docker-compose.yml`, `*.template`, `exports.sh`, `torrc`, `hooks/` y
  `umbrel-app.yml`. `releases/` no se copia, lo restaura `hooks/pre-start`.
  GitHub Actions vuelve a arrancar (hay ejecuciones correctas del 22-sep).

## Agentes y workflows lanzados

(se rellena al final de cada fase)
