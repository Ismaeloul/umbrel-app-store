# Ace Player Neo · Fase 1: cinco exploraciones de diseño navegables

Cinco propuestas de rediseño completas de la web y de la app de iPhone, con datos falsos y sin
servidor. Todo funciona offline: no hay llamadas al Umbrel, ni CDNs, ni logos descargados.

## Arrancar

```bash
corepack pnpm@10.18.2 install
corepack pnpm@10.18.2 dev            # http://0.0.0.0:5180 (con recarga en caliente)
corepack pnpm@10.18.2 dev:capturas   # http://0.0.0.0:5182 (sin recarga; para capturas)
```

Abrir desde el PC: `http://localhost:5180/`. Desde el iPhone, en casa: `http://192.168.1.156:5180/`;
fuera de casa, por Tailscale: `http://100.109.137.119:5180/`. En el iPhone la versión «iPhone» de
cada propuesta se ve a pantalla completa y sin marco (y se puede añadir a la pantalla de inicio).

## Qué hay

| Ruta | Qué es |
|---|---|
| `00-inventario.md` | Paso 1: pantallas, flujos, datos reales de la API y crítica de UX de la web y de la app iOS |
| `01-investigacion.md` | Paso 2: patrones concretos con enlaces (HIG / Liquid Glass, Apple Sports, FotMob, DAZN, Linear…) y dónde se usa cada uno |
| `docs/fuentes/` | Informes brutos de la lectura del código y de la investigación |
| `docs/CONTRATO-PROTOTIPO.md` | Lo que toda propuesta tiene que cumplir y lo que da el núcleo compartido |
| `src/core/` | Núcleo: datos falsos con la forma de `/api/v1`, simulador (reloj, comprobador, reproductor, sesiones, listas, emparejamiento), router, vídeo falso, escudos generados, marco de iPhone, panel de depuración |
| `src/directions/0N-*/DESIGN.md` | Concepto, sistema de diseño, movimiento, señal, navegación, traducción a SwiftUI y notas de construcción de cada propuesta |
| `src/directions/0N-*/web.tsx` · `iphone.tsx` | Las dos versiones de cada propuesta |
| `scripts/capturas.mjs` | Capturas de las pantallas clave (iPhone con marco y escritorio, claro y oscuro) con Playwright. Los PNG no entran en el repositorio (pesan 200 MB): `pnpm capturas` y `node capturas/03-palco/escenas.mjs` los regeneran en unos minutos |
| `scripts/comparativa.mjs` → `comparativa.html` | Las cinco propuestas lado a lado, por pantalla |
| `scripts/shot.mjs` | Una captura suelta: `node scripts/shot.mjs 1/iphone/agenda out.png --iphone --framed --dark` |

## Rutas

`#/` galería · `#/<1-5>/web/<pantalla>` · `#/<1-5>/iphone/<pantalla>`. Pantallas: `agenda`,
`partido/<id>`, `canal/<id>`, `biblioteca`, `buscar`, `ajustes[/sección]`, `emparejar`.

## Panel de depuración (⚙︎ abajo a la derecha, o Mayús+D)

Gol entrando · Fuente cayéndose (reconexión ×3 y cambio automático) · Reconectando · Sin señal ·
Directorio actualizándose · Segundo dispositivo reproduciendo · Traspaso del mando · Motor apagado
(y reinicio automático) · Primer uso (iPhone sin emparejar, sin gustos) · Restaurar datos · Tema ·
Transparencia reducida · Movimiento reducido · Reloj simulado (20:40 / 21:12 / 22:05 / 23:30).
Para scripts: `window.__aceSim.runScenario('gol')`, `playMatch(id)`, `setExpanded(bool)`…

## Propuesta elegida: Palco

Tras probar las cinco, Isma eligió **Palco** (`#/3/iphone/agenda` · `#/3/web/agenda`) y se ha pulido
a fondo, sobre todo el iPhone: gestos de cortina como en Mapas, arrastrar el vídeo para
minimizar, deslizar a los lados para cambiar de fuente, doble toque para pantalla completa,
pulsación larga para menús, borde izquierdo para volver, horizontal real, respuesta háptica
(`src/directions/03-palco/components/haptics.ts`) y animaciones nuevas. Todo está descrito en
`src/directions/03-palco/DESIGN.md` › «Pulido tras la elección».

## Escudos reales (opcional)

El prototipo genera escudos propios. Si quieres los reales, deja los ficheros en
`public/escudos/` (nombre = id del equipo) con un `index.json`, o ejecuta `node scripts/escudos.mjs`
(TheSportsDB). Detalles en `public/escudos/LEEME.md`. La carpeta no entra en el repositorio.

## Atajos en la web

← → zapear (solo con algo sonando) · Espacio/K pausa · J −30 s · L directo · M silencio · F pantalla
completa · N siguiente fuente · 1–9 fuente · / buscar · ? ayuda · Esc cierra.
