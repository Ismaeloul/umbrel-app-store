# Accesibilidad

Cierre de la Fase 2 (agente «visual»). Qué se comprueba, con qué, el
resultado y lo que se arregló. Las reglas de diseño están en
[`diseno/sistema.md`](diseno/sistema.md) §2 «Accesibilidad».

## Cómo se comprueba

Todo contra la app levantada de verdad (build de producción con `vite
preview`, backend real y motor AceStream falso, con un canal sonando en las
vistas del reproductor) y con el Chrome instalado (Playwright, `channel:
'chrome'`):

```
# desde apps/web, con la app servida en <web>
corepack pnpm@10.18.2 --filter @ace/web revision -- --base http://127.0.0.1:<web> \
  --canal <hash que suena> --partido demo-4 --capturas ../../docs/capturas/fase2 \
  --axe --teclado --movimiento
```

`scripts/revision-visual.mjs` recorre **15 vistas** (agenda, centro de
partido con fuentes, reproductor, mini-reproductor, biblioteca en sus 3
pestañas y vacía, buscar, ajustes, dispositivos con el emparejamiento
abierto, salud, preferencias, ayuda de atajos y la página del sistema) en los
**12 tamaños** (móvil 360×800, 390×844 y 430×932 en vertical y en horizontal,
tableta 768×1024 y 1024×1366, portátil 1280×800 y 1440×900, escritorio
1920×1080 y 2560×1440), en oscuro y, en 390×844 y 1440×900, también en claro
(270 combinaciones), y sale con 1 si algo falla:

| Qué | Dónde | Cómo |
|---|---|---|
| **axe-core** (WCAG 2.0/2.1/2.2 A y AA + buenas prácticas) | 390×844 y 1440×900, oscuro y claro | `@axe-core/playwright`; falla con cualquier violación seria o crítica |
| **Teclado** | 390×844 y 1440×900, oscuro | Tab por toda la vista: se llega a todo lo enfocable, el foco nunca cae en algo invisible ni se pierde, y siempre se ve (borde de foco o cambio de sombra, borde o fondo) |
| **Objetivos táctiles ≥ 44 px** | todos los tamaños táctiles | cada control (contando su zona ampliada con `::before`/`::after`) |
| **Texto ≥ 11 px**, sin texto cortado | todos | recorre los nodos de texto visibles; un texto corto (≤ 20 letras) recortado con «…» también falla |
| Sin scroll horizontal ni nada fuera de la pantalla, sin controles solapados ni recortados | todos | `scrollingElement.scrollWidth > innerWidth`, cajas de cada elemento |
| **Movimiento reducido** | 390×844 y 1440×900 | `prefers-reduced-motion: reduce`: nada que se desplace en bucle ni más de 200 ms |
| **Reducir transparencia** | 390×844 y 1440×900 | con el ajuste activado: `data-transparency` en `<html>` y ningún `backdrop-filter` |
| **Móvil en horizontal** | 800×360, 844×390, 932×430 | el reproductor ocupa toda la pantalla y los controles se van solos (captura `-controles-ocultos`) |

Además, un repaso de axe con **todas** las gravedades (también las moderadas
y menores) en 11 vistas × 2 tamaños × 2 temas, y la categoría de
accesibilidad de Lighthouse en móvil y escritorio (`docs/rendimiento.md`).
El contraste de los tokens lo vigila `src/styles/tokens.test.ts` (AA en los
cuatro fondos de los dos temas) y el tamaño mínimo de letra, el mismo test.

## Resultado (23-sep)

- **Revisión completa: 270 combinaciones, 0 problemas** (informe en
  `docs/capturas/fase2/revision.json`, índice en
  [`capturas/fase2/README.md`](capturas/fase2/README.md), 273 capturas).
- **axe: 0 violaciones serias o críticas** en las 60 pasadas (15 vistas × 2
  tamaños × 2 temas). Con todas las gravedades: **0** en las 44 pasadas del
  repaso (había 2 moderadas, arregladas: abajo).
- **Lighthouse, accesibilidad: 100** en las 6 vistas medidas, en móvil y en
  escritorio.
- **Teclado**: en todas las vistas se llega con Tab a todo, sin perder el foco
  y con el foco visible. Paradas del recorrido (móvil / escritorio):

| Vista | Móvil | Escritorio |
|---|---|---|
| Agenda | 17 | 23 |
| Centro de partido | 27 | 39 |
| Reproductor | 20 | 32 |
| Mini-reproductor | 20 | 26 |
| Biblioteca: favoritos / recientes / listas / vacía | 16 / 12 / 14 / 11 | 26 / 20 / 16 / 13 |
| Buscar | 20 | 27 |
| Ajustes / Dispositivos / Salud | 32 / 37 / 36 | 36 / 38 / 37 |
| Preferencias (hoja, foco atrapado) | 44 | 44 |
| Ayuda de atajos (hoja, foco atrapado) | 2 | 2 |
| Sistema | 37 | 38 |

- **Movimiento reducido y transparencia reducida**: bien en todas las vistas
  (capturas `*-movimiento-reducido.png` y `*-transparencia-reducida.png`).
- **Horizontal en el móvil**: el reproductor ocupa la pantalla entera y los
  controles se ocultan solos a los 3,2 s en los tres tamaños.
- Recortes con «…» que quedan, a propósito (se apuntan como aviso, no
  fallan): la dirección de una lista M3U, el partido que emite un canal en su
  fila («A las 22:00, España – Marruecos») a 360-430 px, el subtítulo de la
  fuente sobre el vídeo en la columna de 1280 px y los mensajes largos de la
  línea de estado en la página del sistema.

## Qué se arregló

| Problema | Arreglo | Dónde |
|---|---|---|
| `--accent-ink` claro sobre `--accent-wash` (carril, pestañas, chips activos): 4,37:1 | oklch 0,5 → 0,48 (≥ 4,5:1 en los cuatro fondos; test nuevo) | `styles/tokens.css`, `tokens.test.ts`, `diseno/sistema.md` |
| La ayuda de atajos no se podía desplazar con el teclado (axe `scrollable-region-focusable`) | envoltorio enfocable con su borde de foco por dentro | `app/ShortcutHelp.tsx`, `shortcut-help.css` |
| Cabeceras «Hoy/Ayer» de Recientes en `h3` justo bajo el `h1` (axe `heading-order`) | `h2` | `features/library/LibraryView.tsx` |
| Dos regiones llamadas «Avisos» en la página del sistema (axe `landmark-unique`) | la sección se llama «Avisos y línea de estado» | `app/sistema/SistemaPage.tsx` |
| Sin borde de foco en la 2.ª cabecera de categoría y siguientes (el separador lo tapaba) | la regla de foco también con el separador | `features/library/library.css` |
| «Real Sociedad» salía «Real Socie…» junto a «Verificada» (móvil de 360 y columna del partido) | la columna vacía del marcador ya no se queda su hueco; huecos más justos a ≤ 380 px | `features/agenda/agenda.css` |
| «14 pares · 503 KB/s» cortado en «Datos técnicos» plegado (móvil) | la mono más estrecha y huecos justos a ≤ 430 / 380 px | `features/match-center/match-center.css` |
| «Siste…» en el segmentado del tema a 360 px | menos aire a ≤ 380 px | `ui/Segmented.css` |
| Hojas en el móvil en horizontal: la lista quedaba en una rendija de ~70 px | a ≤ 540 px de alto se desplaza la hoja entera, con título y botonera pegados | `ui/Sheet.css` |
| Tableta (768): la zona táctil del vídeo se salía 8 px y la página se ensanchaba a 776 | la zona ampliada no pasa del margen de la vista | `player/player.css` |
| Columna central de 1280: el botón de pantalla completa se salía del vídeo | Detener pasa a «Más opciones» y el volumen encoge en vídeos estrechos | `player/player.css` |
| Rack de fuentes del panel lateral: «Lista d…» | en menos de 360 px el nombre va a lo ancho y el estado baja | `features/sources/sources.css` |
| «Reproducir» aparecía y desaparecía al abrir un canal (y movía las fuentes) | no sale mientras el canal va a arrancar solo | `features/match-center/ChannelCenter.tsx` |

La comprobación automática es `apps/web/scripts/revision-visual.mjs`
(`pnpm --filter @ace/web revision`); que las animaciones solo usen `transform`
y `opacity` lo vigila además `src/styles/motion.test.ts`.

## Pendiente

- Probarlo con un lector de pantalla de verdad (VoiceOver en el iPhone,
  NVDA/Narrador en Windows): axe y el recorrido con Tab no sustituyen a oír
  la app. Los `aria-live` de la línea de estado y de los avisos están, pero
  su verbosidad durante una reconexión solo se juzga escuchándola.
- axe y el teclado solo se pasan en Chrome; WebKit (Safari) lo cubren las
  pruebas E2E del otro agente, sin axe.
