# Informe final: Ace Player Neo v2 (0.7.0)

Reescritura completa del reproductor AceStream del Umbrel en tres piezas
(backend, web y app de iPhone), hecha entre el 22 y el 23 de septiembre de
2026 en la rama `rewrite-v2` del repo `Ismaeloul/umbrel-app-store`. **Nada
está publicado**: `main`, las etiquetas y el Umbrel siguen en la 0.6.59
hasta que lo apruebes (`despliegue.md`).

## 1. Qué ha cambiado

| Antes (0.6.59) | Ahora (0.7.0) |
|---|---|
| `server.js` de 5.300 líneas sin tipos | Backend Fastify + TypeScript estricto en 14 módulos con contratos zod compartidos (`apps/server`, `packages/shared`) |
| `index.html` de 6.200 líneas | Web Vite + React 19 + TanStack Query + SSE con el diseño «Luz de focos» (`apps/web`) |
| iPhone solo por el navegador | App nativa SwiftUI "Ace Neo" con PiP, audio en segundo plano, Now Playing y AirPlay (`apps/ios`) |
| Cada cliente pedía su sesión al motor | El backend es el dueño de las sesiones: una por canal, compartida entre dispositivos (D5) |
| Sondeos cada 5 s | Tiempo real por SSE (`/api/v1/events`) |
| `vendor/` duplicado en 59 releases | Release compilada, reproducible y verificada por SHA256 (`releases/0.7.0`) |
| 133 tests con `node:test` | Unos 2.200 tests (Vitest, Playwright y XCTest) y CI en GitHub Actions |

Las rutas antiguas (`/api/*`) siguen respondiendo igual: una pestaña 0.6.x
abierta durante la actualización sigue funcionando (probado). Lo nuevo va
bajo `/api/v1`, documentado en `openapi-v2.yaml`.

## 2. Qué se ha mejorado

**Motor y reproducción** (§2.3 del prompt)
- Sesiones sin zombis: latido cada 15 s, caducidad a los 45 s, `stop` siempre
  (comprobado contra el motor real: cada sesión abierta tiene su cierre).
- Dos dispositivos en el mismo canal comparten sesión (antes uno echaba al
  otro); con canales distintos se conserva el traspaso.
- Vigilante del motor con histéresis (un silencio no lo da por caído),
  reinicio automático con espera creciente y **como mucho 3 por hora**, y
  recuperación sola del canal que veías.
- El comprobador nunca prueba el canal que estás viendo y baja el ritmo
  mientras reproduces.
- Registro de diagnóstico por causa (motor, fuente, red, códec, cliente,
  estado) consultable desde Salud.
- Resueltos los 23 problemas del reproductor que salieron en el análisis
  (`analisis/reproductor.md` §11): directo real con el retraso medido,
  reconexiones con presupuesto y espera, "arrancó" solo con imagen real,
  Media Session con acciones, reconexión en iPhone sin matar el remux, etc.

**Datos**: escritura atómica con copias rotadas, recuperación de un
`state.json` corrupto, migración que conserva todo (probada con una copia
de tu fichero: las 12 claves idénticas) y copia intocable
`state.pre-0.7.0.json`. La 0.6.59 puede leer el estado migrado, así que
volver atrás no pierde nada.

**Seguridad** (`seguridad.md`): app de iPhone por `/native/` con token de
256 bits guardado solo como hash, emparejamiento con código de 6 dígitos o
QR, límites contra fuerza bruta, URLs de vídeo firmadas y revocación
inmediata. Dos saltos del login de Umbrel encontrados en su pasarela
(`/native/..%2f…` y URLs con `//`) cerrados en nginx y probados con 188
casos contra nginx real. Anti-SSRF reforzado (IPv6, redirecciones, DNS
rebinding).

## 3. Resultados

| Batería | Resultado |
|---|---|
| Servidor (unidad + integración) | 1.294 tests |
| `packages/shared` | 66 |
| Motor AceStream falso | 86 |
| Empaquetado, hook, nginx y release | 113 + 16 de la carpeta de la app + 133 de la 0.6.59 |
| Web (Vitest) | 668 |
| E2E Playwright (Chrome y WebKit, escritorio e iPhone) | 40/40 |
| App de iOS (XCTest y XCUITest en el simulador de GitHub) | 120+ tests, 0 fallos, E2E contra el backend real con vídeo de verdad; IPA en la ejecución 35886091911 |
| nginx real contra ataques de ruta | 188/188 |
| Contraste con la 0.6.59 (27 operaciones antiguas) | 0 diferencias sin explicar (las buscadas, en `compat.md`) |
| Comportamientos del CHANGELOG (`comportamientos.md`) | 259 de 278 con test; el resto de iOS o no aplica |
| Soak de 2 h simuladas | sin fugas ni sesiones colgadas |
| Soak real de 30 min con el motor de verdad | 0 cortes, 851 MB, primer byte a los 608 ms |

## 4. Rendimiento (`rendimiento.md`)

| Objetivo | Medido |
|---|---|
| JS inicial ≤ 150 KB gzip | 107 KB |
| Tocar canal → primera imagen < 4 s | 0,45 s de mediana (motor falso); < 5 s con el motor real en tu Chrome |
| Arranque del backend < 3 s | ~200 ms |
| Lighthouse móvil ≥ 95 | 95 en agenda, biblioteca, buscar y ajustes; **87-88 en las vistas con vídeo** |
| Accesibilidad ≥ 90 | 100 en todas |
| CLS < 0,05 | cumplido en todas |
| LCP < 2,0 s en 4G | **2,7 s** (no cumplido, ver deuda) |
| Memoria estable | estrés de 200 reproducciones y soak sin crecimiento |

## 5. Deuda técnica pendiente

1. **LCP de 2,7 s en 4G lento.** De los ~250 KB que se descargan antes de
   pintar, 98 KB son la tipografía Mona Sans del diseño. Bajar de 2 s pide
   cambiar de fuente o renderizar en el servidor. En tu red o por Tailscale
   es ~0,4 s.
2. **Vistas con vídeo en Lighthouse (87-88)**: Chrome cuenta el primer
   fotograma como LCP; depende de lo que tarde el motor.
3. **Pruebas en un iPhone real** (`pruebas-iphone.md`): PiP, pantalla de
   bloqueo, audio en segundo plano, AirPlay y la web en Safari de verdad.
4. **Sin probar contra el motor real todavía**: el paso de progresivo a HLS
   cuando se une un segundo dispositivo (D5.3) y dos canales distintos a la
   vez.
5. **Parsers de la agenda** contrastados con fixtures, no con el HTML de hoy
   de futbolenlatv (aunque la agenda real cargó bien en la prueba).
6. **Riesgos aceptados** (`seguridad.md`): cualquier contenedor del NAS
   puede llamar al backend directamente (igual que en la 0.6.59); la web se
   puede incrustar en un marco (no hay `frame-ancestors`); no hay límite de
   conexiones SSE por dispositivo.
7. Normalizadores de directorios duplicados en `state` y `directories`
   (D16), y la firma de los registros IPNS sin verificar.
8. En **este PC**, 1 de cada 4 ejecuciones completas de los tests del
   servidor pierde un proceso por un filtro de red de Windows
   (`pendiente.md`); en CI (Linux) no pasa.
9. La release de referencia se monta en **Linux** (`release:docker`): en
   Windows algunos colores del CSS salen con otro redondeo.

## 6. Siguientes pasos que recomiendo

1. **Publicar con red**: seguir `despliegue.md` (merge, etiqueta
   `ace-player-neo-v0.7.0`, actualizar en Umbrel) con la vuelta atrás
   preparada.
2. Instalar la IPA con IPA Station y pasar `pruebas-iphone.md`.
3. Decidir lo de "Un solo dispositivo a la vez" (D5) y lo de la tipografía
   (LCP).
4. Después de probarla, las ideas aparcadas (`ideas-futuras.md`): mapa de
   canales por competición, juez con IA local para desempates y soporte
   IPTV.
5. Cuando la 0.7.x lleve un tiempo estable: etiquetar las releases viejas que
   no tienen etiqueta y retirar `releases/0.6.1`…`0.6.58` del repo
   (`analisis/empaquetado.md` §7.9).
6. Si algún día quieres compilar iOS sin GitHub: probar xtool en WSL o un Mac
   mini usado (ver la conversación del 23-sep).

## 7. Cómo se hizo

Trabajo orquestado con workflows de agentes (unos 60 agentes en total),
siempre con verificadores independientes. El reparto, los tiempos y los
tokens están en `PROGRESO.md`; las decisiones, en `decisiones.md` (D1-D21);
los informes de cada parada, en `PARADAS.md`.
