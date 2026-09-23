# @ace/web · la web de Ace Player Neo v2

Vite 8 + React 19 + TypeScript + TanStack Query + SSE. Dirección visual A
«Luz de focos» ([`docs/diseno/sistema.md`](../../docs/diseno/sistema.md)).

```
corepack pnpm@10.18.2 --filter @ace/web dev        # Vite en :5173, proxy a VITE_BACKEND (http://[::1]:3000)
corepack pnpm@10.18.2 --filter @ace/web typecheck
corepack pnpm@10.18.2 --filter @ace/web test       # Vitest + Testing Library (jsdom), sin red
corepack pnpm@10.18.2 --filter @ace/web build      # dist/ (assets con hash, .gz, mapas aparte)
corepack pnpm@10.18.2 --filter @ace/web size       # falla si el JS inicial pasa de 150 KB gzip
corepack pnpm@10.18.2 --filter @ace/web capturas   # capturas + revisión de 11 tamaños
corepack pnpm@10.18.2 --filter @ace/web icons      # PNG de la app desde public/icon.svg
```

Sin backend en `localhost` la app entra sola en **modo demo** (o con `?demo=1`).
La página del sistema de diseño: `?vista=sistema` (en producción, `&flag=sistema`).

## Estructura

| Carpeta | Qué | De quién |
|---|---|---|
| `src/styles/` | `tokens.css`, `base.css`, `fonts.css` | armazón |
| `src/ui/` | Componentes base (Button, Sheet, Menu, SignalBadge, TeamMark, LiveRing, Num…) | armazón |
| `src/app/` | Shell, router, tema, atajos, contratos, página de sistema | armazón |
| `src/api/` | Cliente tipado, TanStack Query, SSE, identidad, demo | armazón |
| `src/notices/` | Toasts y línea de estado | armazón |
| `src/lib/` | Utilidades (almacenamiento, color, gestos, carruseles, teclado) | armazón |
| `src/features/<vista>/` | Cada vista | su agente |
| `src/player/` | El reproductor persistente | su agente |

Si una vista necesita un cambio en algo del armazón, en la API o en
`@ace/shared`, **no lo toques: descríbelo** en tu respuesta.

## Cómo añadir una vista

1. Crea `src/features/<carpeta>/index.tsx` con un **export default**:

   ```tsx
   import type { ViewProps } from '../../app/contracts.ts';
   import { ViewHeader } from '../../app/ViewHeader.tsx';

   export default function Agenda({ route, active }: ViewProps) {
     return (
       <div className="agenda">
         <ViewHeader title="Agenda" actions={…} />
         …
       </div>
     );
   }
   ```

   Carpetas: `agenda`, `biblioteca`, `buscar`, `ajustes`, `partido`. El armazón
   las encuentra solo (`import.meta.glob` en `src/app/views.tsx`), cada una en su
   trozo de JS (`React.lazy`) con un esqueleto mientras carga y un
   ErrorBoundary propio. Mientras el fichero no existe, sale «en construcción».
   El código puede vivir en otra carpeta (`library/`, `settings/`, `search/`)
   si la de la ruta solo reexporta: `export { default } from '../library/LibraryView.tsx';`.
   **No hay que tocar el armazón para añadir una vista.** `src/app/views.test.tsx`
   comprueba que todo `index.tsx`, `aside.tsx`, `column.tsx` y
   `player/index.tsx` que exista exporta por defecto un componente: pásalo
   (`corepack pnpm@10.18.2 --filter @ace/web test`) antes de dar tu vista por buena.

2. Opcionales:
   - `src/features/<carpeta>/aside.tsx` (export default, mismas props): el
     **panel lateral** de escritorio (≥ 1024 px, plegable). Si
     `useLayout().asideVisible` es `false` (móvil, tableta o plegado), ese
     contenido lo tiene que enseñar la vista (debajo o en una `Sheet`).
   - `src/features/agenda/column.tsx`: la **columna compacta** de la agenda
     que acompaña al reproductor en el centro de partido (≥ 1280 px).
3. El reproductor: `src/player/index.tsx` con export default que recibe
   `PlayerDockProps` (`presentation: 'stage' | 'mini'`, `route`, `onMinimize`,
   `onExpand`). Es UN componente montado en UN sitio: pasar de grande a mini no
   recrea el `<video>`. Avisa al armazón con `setPlayerPresence({ active, route,
   immersive })` (`src/app/player-presence.ts`) y fija la línea de estado con
   `setStatusBase(...)`. hls.js y mpegts.js, **solo con `import()`** al empezar
   a reproducir (el build los deja en trozos `hls-*.js` y `mpegts-*.js`).

### Lo que te da el armazón

- **Rutas** (`src/app/routes.ts`, `router.tsx`): `?vista=agenda | biblioteca |
  buscar | ajustes[/<sección>] | partido/<idPartido> | partido/canal/<hash> |
  sistema`. `useRoute()`, `useNavigate()` (`navigate({ vista: 'partido', id,
  canal: null })`), `useBack()`, `useSearchParam('q')` para los parámetros
  propios de tu vista. Secciones de Ajustes acordadas: `salud` (el indicador del
  motor lleva ahí) y `dispositivos`.
- **Las vistas visitadas siguen montadas** (React `<Activity>`): al volver
  conservan estado y scroll. Oculta, una vista no tiene efectos vivos (sus
  consultas, atajos y temporizadores se paran solos). `active` dice si se ve.
- **Datos** (`src/api/index.ts`):
  - `useApiQuery('footballSchedule')`, `useApiQuery('footballScan', { params: { id } })`,
    `useApiMutation('libraryMutate')` y `api(id, input)`: tipados desde
    `V1_ROUTES`; en desarrollo validan la respuesta con zod.
  - Errores: `ApiError` con `.message` en español (`describeFailure(error)`).
  - Tiempo real: `useSseEvent('scan.progress', (data) => …)`. El SSE ya
    invalida la caché (`state.changed` → biblioteca, preferencias…;
    `engine.status` → motor). Sin SSE en 10 s, respaldo con sondeo.
  - `useViewSignal()` para peticiones imperativas que se cancelan al ocultarse la vista.
  - Demo: `registerDemoHandlers({ footballResolve: ({ query }) => … })`.
  - `useEngineSummary()`, `getDeviceId()`, `getViewerId()`.
- **Avisos** (`src/notices/index.ts`): `notify(texto, { kind: 'signal' })` para
  lo que le pasa a la señal (va a la línea de estado si se está viendo algo),
  `notify(texto, { tone: 'ok' })` o `toast(...)` para acciones tuyas (máx. 2,
  ×n, 2,8 s, nunca sobre el vídeo; con `action: { label: 'Deshacer', … }`).
- **Atajos**: `useShortcut({ id, keys, display, label, group, when, handler })`;
  salen solos en el panel «?». No saltan escribiendo en un campo ni con una
  hoja abierta. `/` ya abre la biblioteca y pide el foco para
  `buscar-biblioteca`: marca tu buscador con `<TextField focusTarget="buscar-biblioteca" …>`.
- **Maquetación**: `useLayout()` → `{ kind, asideVisible, asideAvailable,
  setAsideOpen, columnVisible }`.
- **Transición fila → partido**: envuelve lo mismo en los dos sitios con
  `<ViewTransition name={partidoTransitionName(id)}>` (`src/app/transitions.ts`).
- **Carruseles** (`src/lib/scroll.ts`): `useKeepActiveVisible` (solo se mueven
  al cambiar el activo, nunca al repintar) y `wheelToHorizontal`.
- **Gestos** (`src/lib/gestures.ts`): `useSwipe(ref, { onSwipe })` para cambiar
  de día o de fuente y arrastrar.

### Reglas de estilo

- Usa los tokens (`var(--surface)`, `var(--s-4)`, `var(--r-l)`…) y los
  componentes de `src/ui/`. Nada de colores sueltos.
- Prefija tus clases con la vista (`.agenda-fila`) o usa `*.module.css`.
- Cifras de marcador, horas y contadores con `<Num value="21:00" />`. **Nunca
  `tabular-nums` con Mona Sans** (su cero tabular lleva barra).
- Solo `transform` y `opacity` en animaciones; hover dentro de
  `@media (hover: hover) and (pointer: fine)`; nada por debajo de 11 px;
  objetivos de 44 px.
- Cristal solo en lo que flota; sobre listas, `glass--dense`.
- Estados de señal con `SignalBadge` (forma + palabra), nunca solo color.
- El marcador del partido que se está viendo sale **tapado** por defecto en
  todos los sitios (regla 29 y corrección 2).

### Tests

Junto a cada componente (`*.test.tsx`). Sin red: `mockFetch({ 'GET /api/v1/football': fixture('footballSchedule') })`
y `fixture(ruta)` de `src/test/fetch.ts` (los ejemplos de
`packages/shared/fixtures`). Antes de llamar a `api()`, fija el modo:
`setMode('live', 'bootstrap')` (y `resetMode()` al acabar). Cero tests
saltados (`.skip`/`.todo` no valen).

- Los tests del armazón (`src/app/Shell.test.tsx`) usan vistas y reproductor
  de mentira (`vi.mock('./views.tsx')`): cambiar una vista no los rompe. Si tu
  vista necesita el armazón entero en un test, móntalo con `<App client={createQueryClient()} initialSearch="?vista=…" />`.
- Para simular un ancho (panel lateral, columna, carril), sustituye
  `window.matchMedia` como hace `setViewport()` en `Shell.test.tsx` y
  devuélvelo al acabar.

### Build y presupuesto

- `size` mide lo que pide `index.html` (entrada + `modulepreload` + sus imports
  estáticos) en gzip nivel 9: hoy ~103 KB de 150. Se reparte en `vendor-*.js`
  (React + TanStack Query, ~77 KB; cambia poco entre releases), `index-*.js`
  (armazón) y un trozo común de `src/api`, `src/ui` y `src/notices`.
- Todo lo que importe **una vista** se queda en su trozo diferido. Si algo tuyo
  acaba en el inicial (se ve en `size`), impórtalo con `import()`.
- `hls-*.js` y `mpegts-*.js`: solo al reproducir (`import()` desde `src/player/`).
- **Ojo con `import './x.ts';`** (importar solo por los efectos): `package.json`
  declara `sideEffects` (CSS, `main.tsx` y `src/**/demo.ts`) para que los
  barriles no arrastren todo, así que en producción el build QUITA cualquier
  otro fichero importado así (en desarrollo funciona y no se nota). Mejor
  exporta una función y llámala; si no, añade el patrón a `sideEffects`.
  `src/app/side-effects.test.ts` lo comprueba.
