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
