Ajustes (listas, tu fútbol, reproducción, «Dónde se está reproduciendo»,
apariencia, dispositivos, salud, motor y «Acerca de»). «Dónde se está
reproduciendo» vive en `src/features/where-playing/` (sesiones de
GET /api/v1/playback y el evento SSE `playback.sessions`). Entrada del
armazón: `index.tsx`. El código está en
`src/features/settings/` y las listas en `src/features/directories/`.

- «Tu fútbol» abre la hoja de `src/features/preferences/PreferencesSheet.tsx`.
- «Modo de reproducción» usa la API del reproductor (`setPlaybackMode` de
  `src/player/api.ts`), que guarda `aceneo-pb`, avisa y se reengancha.

**Para aportar una sección desde otra vista** (Salud, Dispositivos): crea
`src/features/<carpeta>/ajustes.tsx` con `export default` de un componente
que recibe `ViewProps` y **sin cabecera propia** (el título lo pone Ajustes).
Carpetas que se miran:

| Sección                | Carpetas                             |
| ---------------------- | ------------------------------------ |
| `ajustes/salud`        | `health`, `salud`                    |
| `ajustes/dispositivos` | `pairing`, `devices`, `dispositivos` |

(también valen `seccion.tsx` y `section.tsx`). Ajustes las encuentra sola con
`import.meta.glob` (`src/features/settings/external.tsx`); mientras no
existen, Salud y Dispositivos no salen y `ajustes/salud` lleva al motor.
