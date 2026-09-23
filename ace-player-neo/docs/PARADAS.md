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
