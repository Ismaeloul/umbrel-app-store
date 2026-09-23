# Rendimiento

Cierre de la Fase 2. Dos partes: la **web** (Lighthouse, Core Web Vitals,
tamaño del JS y fuentes; agente «visual») y el **TTFF** (del toque a la
primera imagen; agente de TTFF, `apps/web/e2e/ttff.spec.ts`).

## Web

### Cómo se mide

```
# la app de verdad: motor falso + backend + build de producción con vite preview
node apps/server/test/fake-engine/cli.ts … (con tsx)   # 127.0.0.N:6878 y otro en [::] para el comprobador
PORT=… DATA_DIR=… AUTO_SYNC=false FOOTBALL_DEMO_ONLY=true ACESTREAM_HOST=127.0.0.N … tsx src/main.ts
VITE_BACKEND=http://127.0.0.1:<backend> VITE_ENGINE=http://127.0.0.N:6878 vite preview --outDir <build>

# desde apps/web
corepack pnpm@10.18.2 --filter @ace/web rendimiento -- --base http://127.0.0.1:<web> \
  --canal <hash que suena> --partido demo-4 --json resultados.json
```

`scripts/rendimiento.mjs` pasa **Lighthouse 13** (paquete `lighthouse` con el
Chrome instalado, que encuentra `chrome-launcher`) a cada vista en móvil (la
configuración por defecto: Moto G Power, **4G lento simulado** —150 ms de
RTT, 1,6 Mbit/s— y **CPU ×4**) y en escritorio, y mide la latencia de
interacción de los controles principales con la **Event Timing API**
(Lighthouse no da INP en laboratorio). Sin `--base` compila y sirve la demo.
Sale con 1 si falla un umbral duro en móvil (rendimiento ≥ 95 en las vistas
sin vídeo; CLS < 0,05 y accesibilidad ≥ 90 en todas; interacción < 200 ms);
el LCP < 2,0 s y el rendimiento de las vistas con vídeo **se informan**
(abajo, por qué).

### Lighthouse por vista y tamaño (23-sep, contra la app con backend y motor falso)

| Vista | Móvil: rend. | acc. | FCP | LCP | TBT | CLS | Escritorio: rend. | acc. | LCP | CLS |
|---|---|---|---|---|---|---|---|---|---|---|
| Agenda | **95** | 100 | 1,88 s | 2,71 s | 0 ms | 0,012 | 100 | 100 | 0,58 s | 0,004 |
| Biblioteca | **95** | 100 | 1,96 s | 2,71 s | 2 ms | 0,001 | 100 | 100 | 0,61 s | 0,000 |
| Buscar | **95** | 100 | 1,96 s | 2,71 s | 0 ms | 0,000 | 100 | 100 | 0,61 s | 0,000 |
| Ajustes | **95** | 100 | 1,88 s | 2,73 s | 0 ms | 0,000 | 100 | 100 | 0,61 s | 0,013 |
| Partido (con vídeo) | 87 | 100 | 2,11 s | 3,78 s ᵛ | 0 ms | 0,030 | 99 | 100 | 0,85 s | 0,038 |
| Reproductor (canal sonando) | 88 | 100 | 2,11 s | 3,71 s ᵛ | 0 ms | 0,000 | 99 | 100 | 0,86 s | 0,041 |

ᵛ En las vistas con vídeo el elemento del LCP es el **primer fotograma del
`<video>`** (Chrome lo cuenta): llega después de pedir la sesión al backend,
cargar mpegts.js/hls.js y que el motor dé los primeros segmentos, así que es
el TTFF (sección de abajo) y no el pintado de la página. La página en sí
(cabecera, marcador, fuentes) está pintada en el FCP.

Antes de la revisión (primera medida de este cierre, mismo montaje):

| Móvil | Rend. | LCP | CLS |
|---|---|---|---|
| Agenda | 95 → 95 | 2,71 → 2,71 s | 0,012 |
| Biblioteca | 91 → **95** | 3,16 → 2,71 s | 0,001 |
| Buscar | 91 → **95** | 3,17 → 2,71 s | 0,000 |
| Ajustes | 86 → **95** | 3,91 → 2,73 s | 0,000 |
| Reproductor | 81 → 88 | 3,86 → 3,71 s | **0,132 → 0,000** |
| Partido (escritorio) | 95 → 99 | — | **0,128 → 0,038** |

(La primera ronda del intento anterior, antes de sus arreglos de CLS y de
precarga, daba agenda 65 con CLS 0,475 y LCP 3,8 s.)

### Core Web Vitals

- **LCP** (móvil, 4G lento simulado): **2,7 s** en las cuatro vistas sin vídeo.
  El objetivo de 2,0 s **no se alcanza** y no es por el JS de la página: con
  el perfil de Lighthouse, lo que se descarga antes del primer pintado son
  ~250 KB (98 de ellos la fuente Mona Sans, 107 el JS inicial, ~32 el de la
  vista, 12 de CSS y el arranque de la API) y a 1,6 Mbit/s con 150 ms de RTT
  eso solo ya son ~1,9 s de FCP. Probado y medido (sin mejora o peor):
  quitar la precarga de la fuente (FCP 1,96 → 2,41 s), pedir la agenda desde
  el HTML (igual), juntar los trozos compartidos en uno (igual) y bloquear la
  fuente entera (LCP 2,56 s: ni así). Bajar de 2 s pediría renunciar a la
  tipografía de la dirección «Luz de focos» o pintar en el servidor. Sin limitar
  (como en la red local del Umbrel, el uso real) el LCP es de ~0,4 s.
- **CLS** < 0,05 en todas las vistas y tamaños medidos.
- **TBT**: 0-2 ms en todas (no hay tareas largas; el JS inicial se evalúa en
  ~20 ms reales).
- **INP de laboratorio** (Event Timing, Chrome con pantalla de móvil y CPU ×4;
  peor interacción de cada paso):

| Vista | Interacción | Latencia |
|---|---|---|
| Agenda | día siguiente / volver a hoy | 56 / 64 ms |
| Agenda | abrir la biblioteca desde la barra | 16 ms |
| Biblioteca | pestañas Recientes / Listas / Favoritos | 40 / 40 / 40 ms |
| Biblioteca | escribir en el filtro | 32 ms |
| Reproductor | pausa / reproducir / silenciar / minimizar | 24 / 32 / 0 / 16 ms |

Todas muy por debajo de 200 ms («bueno»).

### Qué se ha cambiado (revisión de rendimiento de la Fase 2)

| Problema medido | Arreglo | Dónde |
|---|---|---|
| CLS 0,475 en la agenda: la tira de días llegaba después y empujaba todo | pastillas vacías del mismo alto mientras carga | `features/agenda/DayStrip.tsx`, `agenda.css` |
| CLS 0,25 en el reproductor: la línea de estado aparecía encima de las fuentes | hueco de 44 px reservado | `app/shell.css` (`.stage__status`) |
| CLS 0,13 en el canal (móvil): «Reproducir» salía un instante y al irse subían las fuentes; y las fuentes pintaban vacías un fotograma | sin botón mientras el canal va a arrancar solo; las fuentes se montan tras entrar al canal, en el mismo pintado | `features/match-center/ChannelCenter.tsx` |
| CLS 0,128 en el partido (escritorio, → 0,038): el panel lateral pintaba «Datos técnicos» arriba y las fuentes lo empujaban 400 px | el panel se llena cuando existe la sesión del partido | `features/match-center/MatchAside.tsx` |
| El trozo de la vista se descubría cuando React ya había pintado el armazón | `index.html` precarga el JS y el CSS de la vista de la URL (`viewPreload`) | `build/plugins.ts` |
| `/api/v1/bootstrap` salía cuando el JS ya había llegado | se pide desde `index.html`, en paralelo con el JS | `index.html`, `api/mode.ts`, `api/client.ts` |
| Las vistas pedían sus datos al acabar la transición de vista (~520 ms tarde) | la consulta arranca en el render | `api/query.ts` |
| 15-30 ficheros por vista | trozos por familias (`base`, `agenda`, `canales`, `fuentes`, `ajustes`) | `vite.config.ts` |
| La biblioteca y la búsqueda bajaban la agenda entera; Ajustes bajaba canales y agenda (~70 KB gzip de más) | lo compartido en trozos propios: `comun` (@ace/shared), `mando` (API del reproductor), `virtual` (listas virtuales), `partidos` (dominio de la agenda), `listas` (listas M3U), y `fuentes` aparte de `canales` | `vite.config.ts` |
| La cadena install → `sw.js` → `/api/v1/ping` entraba antes del LCP | la PWA se arranca 3 s después de `load`, en un hueco libre | `main.tsx` |
| Ajustes pedía el registro de fallos (40 KB) y la fuente mono (39 KB) al abrirse | Salud y «Acerca de» se montan al acercarse a la pantalla (o si se piden) | `features/settings/SettingsView.tsx` |

JS que baja cada vista además del inicial (gzip, precargado desde `index.html`):

| Vista | Antes | Después |
|---|---|---|
| Agenda | 32 KB | 32 KB |
| Biblioteca / Buscar | 77 KB | **39 KB** |
| Ajustes | 96 KB | **36 KB** |
| Partido / canal | 102 KB | 87 KB (lo necesita casi todo) |

### Tamaño del JS

- **Inicial** (lo que pide `index.html`, `pnpm size`, gzip nivel 9): **~107 KB
  de 150** — `vendor` (React + TanStack Query, 77 KB, cambia poco entre
  versiones), `base` (armazón, `src/ui`, `src/lib`, `src/api`, avisos: 28 KB),
  la entrada y el runtime (1,3 KB). CSS inicial: 12 KB.
- **Diferido**: cada vista (tabla de arriba), `player` (21 KB), y los motores
  de vídeo solo al reproducir: `mpegts` 62 KB y `hls` 179 KB.
- La demo (`api/demo`, los `demo-data`) va en trozos que solo se piden en
  modo demo.

### Fuentes

| Fuente | Fichero | Tamaño | Cómo se carga |
|---|---|---|---|
| Mona Sans (variable, ejes wdth 75-125 y wght 200-900, subconjunto latino) | `mona-sans-latin-wdth-normal-*.woff2` | 98 KB | **precargada** en `index.html` (`fontPreload`), `font-display: swap` |
| Martian Mono (variable, wdth y wght) | `martian-mono-latin-wdth-normal-*.woff2` | 38 KB | solo cuando algo la usa (datos técnicos, hashes, teclas) |

Autoalojadas (la app vive en la LAN: nada de CDN). La precarga de Mona Sans
compensa: sin ella el texto espera a que el CSS la descubra (FCP +0,45 s en
el 4G de Lighthouse). Es lo que más pesa antes del primer pintado (40 % de
los bytes): un subconjunto más fino o quitar el eje de anchura (la dirección
usa wdth 75 en las cifras y 112 en los titulares) es lo único que bajaría el
LCP de forma apreciable.

### Animaciones

Solo `transform` y `opacity`: ninguna transición ni `@keyframes` del CSS
anima propiedades de maquetación (lo vigila `src/styles/motion.test.ts`, que
lee todas las hojas). Con `prefers-reduced-motion` y con «Reducir
transparencia» se comprueba en la revisión visual (`docs/accesibilidad.md`).

## TTFF

Tiempo desde **tocar una fuente verificada** hasta la **primera imagen**, en
modo **Equilibrado**. Objetivo: **< 4 s**.

### Resultado (23-sep)

| Motor (caché al abrir) | Proyecto | Mediana | p90 | Mín–máx | ¿< 4 s? |
|---|---|---|---|---|---|
| Falso, 15 s de caché (la de la pila E2E) | Chrome escritorio 1440×900 | **0,45 s** | 0,48 s | 0,44–0,48 s | sí |
| Falso, 15 s de caché | Chrome iPhone 390×844 táctil | **0,43 s** | 0,44 s | 0,42–0,44 s | sí |
| Falso, 2 s de caché (caso malo) | Chrome escritorio | 4,44 s | 4,47 s | 4,43–4,47 s | no (imposible: abajo) |
| Falso, 2 s de caché | Chrome iPhone | 4,42 s | 4,42 s | 4,41–4,42 s | no (imposible) |

Las dos baterías completas seguidas dieron lo mismo con 15 s de caché
(escritorio 0,449 y 0,443 s de mediana; iPhone 0,429 y 0,420 s). El `ttffMs`
del propio reproductor (de pedir el canal a la primera imagen) coincide con el
del toque a ±3 ms: entre el toque y la petición no hay nada.

**Qué manda es la caché del motor.** Equilibrado no da al play hasta tener
**6 s de colchón** (`PLAYBACK_PROFILES.balanced.initial`, como la 0.6.59); lo
que el motor no tenga ya en caché llega a ritmo de directo. Con 2 s de caché
faltan 4 s de vídeo que aún no existen: 4 s de espera física + los mismos
~0,43 s de la web que con caché de sobra. Es decir, la web añade **~0,43 s**
en cualquier caso (petición al backend, apertura en el motor, primer byte,
carga de mpegts.js, el sondeo del colchón cada 250 ms y el primer fotograma).
El motor de verdad está en el caso bueno: con un solo consumidor da 22 MB en
12 s (`docs/analisis/motor-real.md` §7) a ~3,8 Mbit/s de media (§9), unos
34 s de vídeo por delante del directo, así que el colchón de 6 s se llena
casi al momento. La caché de 15 s de la pila es la misma que ya da el HLS del
motor falso (3 segmentos de 5, 4 y 6 s) y se queda por debajo del real.
**Pendiente:** medirlo con el motor real en el Umbrel (el script de soak ya
da el primer byte: 608 ms).

### Método

`apps/web/e2e/ttff.spec.ts`, dentro de la batería E2E (motor falso + backend
de verdad + Vite, `apps/web/e2e/README.md`), en los dos proyectos de Chrome
(el WebKit de Playwright en Windows no reproduce vídeo):

1. Modo Equilibrado explícito (`localStorage['aceneo-pb'] = 'balanced'`).
2. Se abre el partido Real Madrid – Manchester City (3 fuentes, verificadas
   por el comprobador o ya vistas funcionar) y se espera al arranque
   automático.
3. Seis muestras, dos por fuente, cada una **en frío**: se detiene lo que
   suene, se espera a que el motor no tenga ninguna sesión abierta y a que el
   reproductor esté parado.
4. En la propia página (`performance.now()`, sin viajes a Node):
   **t0** = el `pointerdown` del toque sobre la fuente (con `tap()` en el
   proyecto táctil); **t1** = el primer fotograma presentado después del
   evento `playing` (`requestVideoFrameCallback`; respaldo: `timeupdate` con
   el cabezal avanzando). Es la misma definición de «arrancó» que usa el
   reproductor (P14), que se anota al lado.
5. Mediana, p90, mínimo y máximo por proyecto; el detalle queda en
   `apps/web/test-results/e2e/ttff-<proyecto>.json` y como adjunto del informe.

La prueba exige el objetivo (mediana < 4 s) cuando la caché del motor cubre
el colchón de Equilibrado; con menos caché (`E2E_CACHE_MOTOR_S=2`) exige que
la web no añada más de 1 s a la espera inevitable (6 − caché segundos).

```
# desde apps/web
corepack pnpm@10.18.2 run e2e e2e/ttff.spec.ts --project chrome-escritorio --project chrome-iphone
E2E_CACHE_MOTOR_S=2 corepack pnpm@10.18.2 run e2e e2e/ttff.spec.ts --project chrome-escritorio --project chrome-iphone
```
