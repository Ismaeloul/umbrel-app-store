# Informes de las paradas

En modo autónomo no me detengo: cada parada deja aquí su informe y sigo con la
fase siguiente.

---

## Parada 1 — FASE 0: análisis y plan (22-sep-2026, 23:35)

### Qué se hizo

Once agentes leyeron entera la 0.6.59: CHANGELOG, `umbrel-app.yml`,
`server.js`, `index.html`, `player-controller.js`, tests, hook, monitoring,
nginx y engine-control. Con eso se escribieron estos documentos:

| Documento | Qué tiene |
|---|---|
| `comportamientos.md` | **Checklist de aceptación**: 278 comportamientos (B-001 a B-278) en 16 áreas, cada uno con sus cifras, su versión y su origen. Trazabilidad completa: las 281 entradas del CHANGELOG (246 vigentes y 35 sustituidas) y los 133 tests apuntan a alguna fila. Un crítico independiente corrigió 35 filas. |
| `api.md` + `openapi.yaml` | Las 25 rutas y 27 operaciones de hoy, con cuerpo, respuestas, errores y rarezas. Otro agente las verificó contra el código: 9 correcciones en `api.md` y 11 en el OpenAPI, sin rutas que falten ni inventadas. |
| `arquitectura.md` | Servicios, módulos, flujos (reproducción, comprobador, emparejamiento iOS, SSE) con 7 diagramas Mermaid y 22 decisiones razonadas. |
| `plan.md` | Fases 1-4 con 37 entregables, reparto en agentes, 18 riesgos y cómo migrar sin romper nada (incluida la vuelta atrás con una 0.7.1). |
| `analisis/*.md` | Los análisis de base: backend (202 funciones repartidas en módulos), front (inventario con 38 detalles a conservar), reproductor (23 problemas P1-P23), empaquetado, CHANGELOG, tests y **pruebas contra el motor real**. |

### Pruebas contra el motor real (Docker local, sin tocar el Umbrel)

La 0.6.59 levantada en local con la imagen real del motor (3.2.3) y una
copia de tu `state.json` funcionó a la primera: 563 partidos en la agenda y
275 canales. Lo que se comprobó (`analisis/motor-real.md`):

- una sesión **HLS** se puede compartir entre varios clientes;
- una sesión **progresiva** (la de mpegts.js) solo admite un consumidor;
- pedir otra sesión del mismo canal **mata** la anterior (403);
- ffmpeg puede hacer el remux de iOS leyendo el HLS del motor.

Con esto se tomó la decisión **D5**: el backend es el dueño de las sesiones y
el mismo canal se comparte entre dispositivos.

### Tests

La 0.6.59 pasa sus **133 tests** en este PC (línea base que el backend nuevo
tiene que igualar). En esta fase no hay código de producto.

### Decisiones de la fase (detalle en `decisiones.md`)

- **D1-D2**: se trabaja en un clon del repo de la tienda (rama
  `rewrite-v2`), con el monorepo en `ace-player-neo/`, fuera de la carpeta de
  la app.
- **D3**: el despliegue sigue con la imagen oficial de Node y la release
  compilada; no depende de GHCR.
- **D4**: la app de iOS entra por `/native/*` en el mismo puerto, con un
  blindaje contra un salto del login de Umbrel que encontré en el código de su
  pasarela (`/native/..%2fapi/...`).
- **D5**: el mismo canal se comparte por defecto; "Un solo dispositivo a la
  vez" queda en Ajustes. El agente de arquitectura proponía lo contrario y lo
  alineé con D5 porque el prompt lo pide expresamente.

### Dudas para ti (resumen; detalle en `dudas.md` y `arquitectura.md` §14)

1. Compartir el canal por defecto (D5) o el traspaso de siempre.
2. ¿Dos canales distintos a la vez en dos dispositivos? Mi prueba no fue
   concluyente.
3. HEVC: hoy una fuente HEVC sale "fallida" aunque el iPhone la reproduce con
   el remux.
4. El "reproductor externo" del inventario no existe en la 0.6.59 (solo copiar
   el enlace `acestream://`). En la v2 lo añado como opción nueva (abrir en
   VLC con `vlc://` o el enlace `acestream://`), sin quitar nada.

### Problemas

- Al reiniciar el PC se cortaron los agentes; no habían escrito nada y se
  relanzó la fase entera.

---

## Parada 2 — FASE 1: backend (23-sep-2026, ~05:45)

### Qué se hizo

- **Contratos** (`packages/shared`): esquemas zod del estado v1/v2, de las 27
  operaciones antiguas y de las 37 rutas v1, eventos SSE, catálogo de errores
  con mensaje en español, perfiles de reproducción y funciones puras portadas
  de la 0.6.59 (contrastadas con el código original). OpenAPI generado en
  `docs/openapi-v2.yaml`.
- **Backend** (`apps/server`, Fastify + TypeScript estricto): 14 módulos
  (`state`, `net`, `directories`, `engine`, `playback`, `remux`, `scanner`,
  `sources`, `football`, `auth`, `events`, `diagnostics`, `health`,
  `search`) más el sidecar `engine-control`. Lo principal de lo nuevo:
  - el backend es el **dueño de las sesiones del motor**: una por contenido,
    latido cada 15 s, stop siempre (sin zombis), cambio de canal sin
    carreras, mismo canal compartido por HLS (D5);
  - **vigilante del motor** con histéresis, backoff y como mucho 3
    reinicios por hora, que recupera solo el canal tras un reinicio;
  - el **comprobador** nunca prueba el canal que estás viendo y baja el ritmo
    si hay reproducción;
  - **estado** con escritura atómica (tmp + fsync + rename), copias rotadas,
    recuperación de un `state.json` corrupto y migración 1→2 que la 0.6.59
    sigue pudiendo leer;
  - **app de iOS**: emparejamiento con código de 6 dígitos + QR, tokens de
    256 bits guardados solo como hash, URLs de vídeo firmadas, límites contra
    fuerza bruta, `/native/` blindado en nginx;
  - **SSE** (`/api/v1/events`), registro de diagnóstico por causa y salud
    desde caché.
- **Motor AceStream falso** fiel al real (sesión única por contenido, HLS
  compartible, progresivo de un solo consumidor, modos de fallo) para tests,
  soak y E2E.
- **Empaquetado 0.7.0** (en `deploy/`, todavía sin copiar a la carpeta de la
  app): compose, hook `pre-start` con verificación por SHA256 y restauración
  atómica, nginx.conf blindado, build de un solo `server.js`, release
  reproducible y Dockerfile sin root.

### Resultados de los tests

| Batería | Resultado |
|---|---|
| `@ace/shared` | 65/65 |
| Servidor (unidad + integración) | 1143/1143 (ver nota) |
| Motor falso | 86/86 |
| Empaquetado (compose, nginx, hook, release) | 108/108 |
| nginx real en Docker, blindaje de `/native/` | 125/125 |
| Compose local con pasarela falsa | 39/39 |
| Humo del `server.js` empaquetado | 18/18, arranque en ~200 ms, apagado en 13 ms |
| Soak de 2 h simuladas con 11 fallos aleatorios | se recupera siempre, 0 sesiones y 0 temporizadores al final, +0,22 MiB |
| Estrés de 200 reproducciones | sin fugas |
| Contraste con la 0.6.59 (27 operaciones antiguas) | 195 comparaciones, 0 diferencias sin explicar |
| Front 0.6.59 contra el backend nuevo | carga, agenda, biblioteca, reproducción y traspaso funcionan |
| Migración de tu `state.json` real (copia) | 12 claves idénticas, idempotente, la 0.6.59 lo lee igual |

Nota: en este PC, 1 de cada 4 ejecuciones completas del servidor pierde un
worker de Vitest por un cierre de Windows en las conexiones locales
(`0xC0000409`), ajeno al código (ver `pendiente.md`). Repetida, la batería
pasa entera. La referencia será CI en Linux.

### Cobertura de comportamientos (`comportamientos.md`)

De 278: 133 cubiertos del todo, 38 con la parte del servidor cubierta y la
de la web pendiente, 2 con la parte de iOS pendiente, 93 solo de la web
(FASE 2), 9 solo de iOS (FASE 3), 2 de CI (FASE 4) y 1 que no aplica. Cero
rotos. Las diferencias con la 0.6.59 están en `compat.md` (114, de las que
35 afectan a rutas antiguas, todas justificadas).

### Verificación independiente

En curso a la vez que la web (D18): un verificador de seguridad y otro de
comportamientos e inventario. Su resultado se añade aquí debajo.

### Decisiones de la fase

D9-D17 en `decisiones.md`: sobre todo, playback no suelta una sesión mientras
el vigilante decide si el motor ha caído (D9), la salud responde desde caché
(D10) y dos diferencias con la 0.6.59 aceptadas tras el contraste (D17).

### Pendiente de esta fase

- Probar contra el motor real el paso de progresivo a HLS al unirse un
  segundo dispositivo, y un soak real de 30 min (se hace con la web nueva).
- Contrastar los parsers de la agenda con el HTML real de futbolenlatv.
- Normalizadores de directorios duplicados en dos módulos (D16).

### Verificación independiente del backend (añadido a la parada 2)

- **Seguridad** (`seguridad.md`): 0 graves, 2 medios y 2 leves, todos
  arreglados con su test: un salto del login de Umbrel con URLs que empiezan
  por `//` (cerrado en nginx; 188/188 casos contra nginx real), un iPhone
  emparejado que podía soltar la sesión de otro dispositivo, GET con efectos
  lanzados desde otra app del NAS y una IP de la LAN en un documento.
- **Comportamientos** (`verificacion-backend.md`): 0 reglas mal portadas, 0
  tests que no prueben su regla y 0 funcionalidades perdidas; las 202
  funciones de la 0.6.59 localizadas en la v2 y los 118 tests del servidor
  portados.

---

## Parada 3 — FASE 2: web (23-sep-2026, ~15:45)

### Qué se hizo

- **Dirección visual**: 3 propuestas con maquetas y capturas, elegida la A
  «Luz de focos» con injertos de B y C y **confirmada por ti**.
- **Web** (`apps/web`, Vite + React 19 + TanStack Query + SSE): armazón con
  el sistema de diseño (tokens OKLCH, Mona Sans y Martian Mono locales,
  cristal con respaldo opaco, oscuro y claro), agenda, preferencias, centro
  de partido y fuentes, reproductor (máquina de estados, mpegts.js y hls.js
  bajo demanda, directo real, reconexiones con backoff, Media Session, PiP,
  mini-reproductor), biblioteca, listas, buscar, ajustes, salud y
  diagnóstico, dispositivos (emparejar con código + QR), ayuda de atajos y
  PWA.

### Resultados

| Prueba | Resultado |
|---|---|
| Vitest + Testing Library | 668/668 |
| E2E Playwright (Chrome y WebKit, escritorio e iPhone) | 40/40, dos veces seguidas |
| Revisión visual automática (12 tamaños, 2 temas, 15 vistas) | 270/270 limpias; 273 capturas (selección en `docs/capturas/fase2/`) |
| axe | 0 problemas serios o críticos en 60 pasadas |
| Lighthouse móvil (4G) | rendimiento 95 en agenda, biblioteca, buscar y ajustes; 87-88 en las vistas con vídeo; accesibilidad 100; CLS < 0,05 |
| JS inicial | 107 KB gzip (límite 150) |
| Tiempo hasta la primera imagen | 0,45 s de mediana con el motor falso; < 5 s con el motor real |
| Inventario de la 0.6.59 | todo presente (`verificacion-web.md`) |
| En tu Chrome contra el motor real | reproducción, reconexiones, mini-reproductor, 0 errores de consola (GIF) |
| Soak real de 30 min | 0 cortes, 851 MB, sesión cerrada al final |

### Lo que no llega al objetivo

- **LCP en 4G lento: 2,7 s** frente a 2,0 s. Antes de pintar se descargan
  ~250 KB, de los que 98 KB son la tipografía Mona Sans del diseño. Bajar de
  2 s pediría cambiar la tipografía o renderizar en el servidor. Sin
  estrangular la red son ~0,4 s. Lo dejo anotado para que decidas.
- **Vistas con vídeo: Lighthouse 87-88**, porque Chrome cuenta el primer
  fotograma del vídeo como LCP.
- **WebKit de Playwright en Windows no reproduce vídeo**: esos recorridos se
  prueban en Chrome; en WebKit se comprueba que la app lo explica y no deja
  sesiones abiertas. Falta probarlo en un iPhone real.

### Decisiones

D18-D21 en `decisiones.md` (verificación en paralelo, inventario con
diferencias deliberadas en D20, y solo una selección de capturas en git
porque el Umbrel clona el repo entero).

---

## Parada 4 — FASE 3: app iOS (23-sep-2026, ~19:15)

### Qué se hizo

App nativa **"Ace Neo"** (`apps/ios`, SwiftUI, iOS 17+, Swift 6 con
concurrencia estricta, sin dependencias) generada con XcodeGen y compilada
**solo en GitHub Actions** (no hay Mac):
- **Núcleo**: cliente de `/native/api/v1` con Bearer, token en el Llavero,
  servidores de Tailscale y LAN con cambio automático, emparejamiento por
  código o QR (AVFoundation), SSE con reconexión y caché local para arrancar
  al instante. ATS acotado a Tailscale y la LAN (sin `NSAllowsArbitraryLoads`).
- **Reproductor**: AVPlayer con controles propios, PiP (también automático
  al salir), audio en segundo plano con interrupciones y auriculares, Now
  Playing con canal anterior/siguiente, AirPlay, pantalla completa en
  horizontal y la misma máquina de estados que la web (salto al directo si
  se congela, 3 reconexiones con espera y cambio a la siguiente verificada).
- **Pantallas**: agenda, centro de partido con fuentes, biblioteca (deslizar
  para borrar con deshacer), buscar, ajustes y mini-reproductor, con Liquid
  Glass (y respaldo de material), modo claro y oscuro, Dynamic Type,
  VoiceOver, reducir movimiento y háptica.
- **CI** (`.github/workflows/ios.yml`): genera el proyecto, pasa los tests
  en el simulador y deja la **IPA sin firmar** como artefacto (y en una
  Release si algún día se crea una etiqueta `ios-v*`).

### Resultados

| Prueba | Resultado |
|---|---|
| XCTest + XCUITest en el simulador | 120+ tests, 0 fallos, 0 saltados |
| E2E en CI contra el backend y el motor falso de verdad | emparejar, agenda, **reproducir vídeo real**, revocar y emparejar por QR |
| Última ejecución en verde | https://github.com/Ismaeloul/umbrel-app-store/actions/runs/35886091911 |
| Capturas del simulador | 30 en `docs/capturas/fase3/` (claro y oscuro) |

### Problemas

- **Tira de días en iOS 26** (Liquid Glass): salía como una franja en
  blanco. Hicieron falta 5 compilaciones para dar con ello; arreglado y con
  una comprobación visual en la CI.
- El agente de pruebas se cortó dos veces por el límite de uso; su trabajo
  estaba empujado y se completó en la siguiente ventana.
- **Sin probar en un iPhone real**: PiP (el simulador de la CI no lo tiene),
  audio en segundo plano, rotación, AirPlay y ATS con IPs. Todo eso está en
  `pruebas-iphone.md` para ti.

---

## Parada final — FASE 4: CI, documentación y entrega

- **CI del monorepo** (`.github/workflows/ci.yml`): lint, typecheck, tests
  del servidor, shared, motor falso, empaquetado y web, build y tamaño, humo
  del bundle, E2E, nginx y shellcheck en Docker, `docker build` y SwiftLint.
  En verde. El workflow de la 0.6.59 sigue corriendo sus 133 tests.
- **Release 0.7.0** cortada en `ismaeloul-ace-player-neo/` (montada en Linux,
  reproducible, con SHA256SUMS), `releaseNotes` en español, CHANGELOG,
  vigilante del NAS que ya no miente y `despliegue.md` con la vuelta atrás.
  **Sin publicar.**
- **Documentación**: `README.md`, `INFORME.md`, `RESUMEN-MAÑANA.md`,
  `acceso-remoto.md`, `ios.md`, `pruebas-iphone.md`, `rendimiento.md`,
  `accesibilidad.md`, `seguridad.md` y `comportamientos.md` (259 de 278 con
  test; los que faltan son de iOS en un iPhone real, de CI o no aplican).
