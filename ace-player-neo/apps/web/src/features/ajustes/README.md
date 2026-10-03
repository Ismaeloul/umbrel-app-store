Ajustes (listas, tu fútbol, reproducción, «Dónde se está reproduciendo»,
apariencia, copia de seguridad, dispositivos, salud, motor y «Acerca de»). «Dónde se está
reproduciendo» vive en `src/features/where-playing/` (sesiones de
GET /api/v1/playback y el evento SSE `playback.sessions`). Entrada del
armazón: `index.tsx`. Se ve **una sección cada vez**: el índice (columna en
escritorio, fila de chips en el móvil) funciona como pestañas y cada sección
tiene su dirección, `?vista=ajustes/<sección>` (sin sección, la primera). El código está en
`src/features/settings/` y las listas en `src/features/directories/`.

- «Copia de seguridad» vive en `src/features/backup/` (decisiones.md D24):
  descargar la copia y restaurarla con vista previa y confirmación.
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
