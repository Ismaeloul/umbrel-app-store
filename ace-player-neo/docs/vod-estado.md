# Películas y series 0.9.0: estado y plan para seguir

Escrito el 2-oct-2026, con la 0.8.3 («IPTV sin cortes») cerrada en `claude/wizardly-clarke-ycfsia` y aún sin unir a
`main`. Sale de tres auditorías hechas ese mismo día sobre las ramas subidas (contrato y web, catálogo, reproducción).
El diseño sigue siendo `docs/vod.md`: este documento solo dice **dónde está cada pieza, qué se queda, cómo se lleva
encima de la 0.8.3 y qué falta hasta la 0.9.0**.

**Convenciones:** las de `docs/vod.md`. Las rutas son relativas a `ace-player-neo/`. Un «§N» sin más es de
`docs/vod.md`; los apartados de este documento se citan como «(aquí, §N)». Los comandos dan por hecho
`export PATH=/opt/node24/bin:$PATH` y `corepack pnpm@10.18.2` desde `ace-player-neo/`.

---

## 0. En pocas palabras

1. **Hay cuatro ramas `vod/*` subidas, todas sobre `8570fb5`** (la base de antes de la 0.8.3). Ninguna toca un fichero
   que haya cambiado la 0.8.3 salvo `docs/openapi-v2.yaml` (solo la línea de la versión), y ninguna pisa a otra. Las
   tres pruebas de unión que hicieron las auditorías salieron **sin conflictos**.
2. **Se queda todo; no se rehace nada.** VOD-1 (contrato) y VOD-3 (web de navegar) están casi terminados. VOD-2
   (catálogo) está entero pero sin revisar: necesita de medio a un día de arreglos. VOD-4 (reproducción) apenas ha
   empezado (unas 390 líneas buenas, sin pruebas).
3. **Antes de unir nada hay que regenerar `ErrorCatalog.swift`** con los 8 `vod_*`, o el CI de iOS falla. Se hace
   **después** de unir con la 0.8.3, no antes, porque la 0.8.3 también lo regeneró (`933a539`).
4. **La 0.9.0 se monta en una rama nueva, `vod/0.9.0`**, que sale de la 0.8.3 y recibe las ramas con commits de
   merge (nunca squash ni force-push). No puede llamarse `vod` a secas: git no deja tener `vod` y `vod/1-contrato` a
   la vez (§16.2 decía «unidas en `vod`»).
5. **Orden:** VOD-1 → VOD-3 → VOD-2 (rehecho en commits revisables) → VOD-4 → VOD-5 → VOD-6 → VOD-7.
6. **El diagnóstico IPTV ya terminó** (salió en la 0.8.3): VOD-5 y los enganches de VOD-6 ya pueden tocar
   `relay.ts`, `remux/service.ts`, `playback/service.ts` y `runtime.ts`. Lo único que sigue bloqueando VOD-5 es el
   **Paso 0 en el Umbrel de Isma**.
7. **Fallos del catálogo que hay que arreglar antes de la 0.9.0:** «CSI: Miami» se queda en «Miami» (la regla de §4.4
   está mal en el propio diseño), el modo por categorías se rompe con una sola categoría mala, y quitar la IPTV a mitad
   de guardar puede dejar un `vod.enc` cifrado en disco.
8. **La estrategia C está comprobada de punta a punta**, con ffmpeg 6.1.1 y con el 8.1.2 de producción: índice por
   Range idéntico a ffprobe, una sola conexión con el relé, lista VOD completa y 6 saltos en Chrome sin un solo error de
   hls.js. Hay dos trampas medidas que el código tiene que cubrir (`elst` vacío y `tfdt` negativo del audio).
9. **Quedan unos 11-13 días de un desarrollador**; con dos o tres agentes en paralelo, el camino crítico es de unos
   9 días (VOD-4 → VOD-5 → final de VOD-6 → VOD-7).
10. **De Isma depende:** lanzar el Paso 0 (una hora, con la app de IPTV del PC cerrada), decir si los títulos para
    adultos salen en la portada, y al final la prueba en su NAS y en su iPhone (aquí, §5).

---

## 1. Dónde está cada rama

La 0.8.3 es `origin/claude/wizardly-clarke-ycfsia` en `5a61376` (fuentes `3734f5c`): 7 commits encima de `8570fb5`
(puerta TS, hls.js, `ErrorCatalog.swift`, versión y release). Todavía no está en `main` (`main` sigue en 0.8.2).

| Rama | Cabeza | Encima de | Worktree (`.claude/worktrees/…`) | Contenido | Estado | Veredicto |
|---|---|---|---|---|---|---|
| `vod/1-contrato` | `d3a9b46` (+ este documento) | `8570fb5` | `wf_45590fb4-538-1` | VOD-1 entero (§11, §16.1), `scripts/vod-sondeo.mjs` (Paso 0), D-VOD11 cambiada y D-VOD21 | Terminado; 38 ficheros, +6555/−112 | **Se queda**; cierre de 30 min (aquí, §2.1) |
| `vod/3-web` | `61f746c` | `d3a9b46` | `wf_45590fb4-538-3` | VOD-3: rutas, navegación (T17), `features/cine/*`, Ajustes, demo, `revision-visual` | Hecho con huecos deliberados; 54 ficheros, +6195/−49 | **Se queda**; arreglos de 1-2 h |
| `vod/2-catalogo` | `203e009` «wip(vod)… sin revisar» | `d3a9b46` | `wf_45590fb4-538-2` | VOD-2 entero en un solo commit (§4-§8, §10) | Completo, 128/128 pruebas VOD; 41 ficheros, +7650/−53 | **Se queda**; 0,5-1 día de arreglos y partirlo en commits |
| `vod/4-reproduccion` | `631e5ca` «wip(vod)… sin revisar» | `d3a9b46` | `wf_45590fb4-538-4` | `remux/vod/{types,reader,codecs}.ts` y `identity`/`released` en `net/` | 10-15 % de VOD-4, sin pruebas; 6 ficheros, +390/−2 | **Se queda la WIP**; quedan 3,5-4 días |

**Ficheros que se pisan** (comparado con `comm` sobre las listas de cambios):

| Pareja | Ficheros en común |
|---|---|
| `vod/1-contrato` y 0.8.3 | `docs/openapi-v2.yaml` (la 0.8.3 solo cambia la línea de la versión; se une solo) |
| `vod/2-catalogo`, `vod/3-web` o `vod/4-reproduccion` y 0.8.3 | ninguno |
| `vod/2` y `vod/3`; `vod/2` y `vod/4`; `vod/3` y `vod/4` | ninguno |

Además de lo textual, la 0.8.3 cambió `apps/web/src/player/runtime.ts` y `player/engines/hls.ts` (salto del hueco del
remux reiniciado durante la retención y sin intersticiales, `82e7c8a`). Ninguna rama VOD los toca hoy, pero VOD-6 sí
los tocará (aquí, §3.3).

---

## 2. Qué se queda y qué se rehace

### 2.1 VOD-1 contrato

**Hecho y conforme al diseño:** las 6 rutas `access: 'web'` (con `vodProgress` como 204 sin cuerpo), los esquemas de
`api/v1/vod.ts` tal cual §11.2, los 8 `vod_*` con su HTTP, `IptvStatus.vod` y `bootstrap.features.vod` opcionales,
`V2_FILES` y `VodDocSchema`, `constants/vod.ts`, ejemplos `web/v1`, openapi, `docs/api.md` y `docs/contratos.md`. En
el servidor, esqueletos que validan y responden 501 (`iptv/routes.ts:60-72`, `playback/routes.ts:106`). Typecheck,
lint, `shared` 124/124 y `test:deploy` 121/121 (con `vod-sondeo.test.ts`).

**Cierre (30 min):**
- `packages/shared/src/constants/vod.ts:4`: el comentario cita `generar-plazos.mjs`, que no existe. Se corrige.
- **`container` en `VodEpisodeSchema`** (opcional, `z.string().max(8)`): hoy un episodio con `playable: 'no'` enseña
  «Este formato (DESCONOCIDO)…» (`features/cine/model.ts:313-321`). La extensión del episodio viene en la ficha de
  Xtream. Recomendado: añadirlo en un commit pequeño solo de contrato, con su ejemplo y su variante.
- `docs/vod.md:8` («Estado»): apuntar a este documento.
- **No** se regenera aquí `ErrorCatalog.swift` (aquí, §3.2, paso 2).

### 2.2 VOD-2 catálogo

**Se queda: no se rehace.** Sigue el diseño de cerca, está comentado en castellano, tiene pruebas junto a cada fichero
y buenos números (150 000 películas + 30 000 series: sincronización en 3,7 s, pico +41,5 MB, retenido 25,9 MB,
búsqueda p95 10,5 ms). Rehacerlo costaría 2-3 días; arreglarlo, medio o uno.

**Lo que hay** (`apps/server/src/modules/iptv/vod/`): `xtream-vod.ts`, `parse.ts`, `titles.ts`, `table.ts`,
`table-codec.ts`, `catalog.ts`, `ids.ts`, `search.ts`, `details.ts`, `art.ts`, `progress.ts`, `vod-service.ts`,
`test-support.ts`, cada uno con su `.test.ts` (menos `xtream-vod.ts`, que se prueba a través de `catalog.test.ts`) y
`memoria.test.ts`. Fuera de la carpeta: `iptv/{routes,xtream,crypto,store,types,service}.ts`, `config/keys.ts`,
`config.paths.vod*`, `state/routes.ts` y el proveedor falso `test/fake-iptv/vod.ts`.

**Ya engancha cosas que el diseño guardaba para VOD-5** en `iptv/service.ts`: `HeavyKind 'vod'`, arrancar y parar el
servicio VOD, purga al quitar y al cambiar de proveedor, `onLiveSynced`, «Actualizar» → `refreshIfOlder` y
`vodStatus`. Con el diagnóstico cerrado, está bien que se queden ahí.

**Lo que falla** (por gravedad; cada arreglo, con su prueba): ver aquí, §4.1.

### 2.3 VOD-3 web de navegar

**Hecho:** rutas `cine` y `cine/<40 hex>` (`routeDepth` 9 en la ficha, `scrollKey`), `navVistas()` con
`features.vod` y `?flag=cine`, T17 resuelta (`--n` e `--i` de la lista filtrada, sin `--n: 4` en `shell.css`, con
prueba), 768-1023 px sin iconos, rótulo «Pelis y series» con `aria-label` «Películas y series», icono, trozo perezoso
propio, invalidación por SSE solo con cambio de `state` o `builtAt`, todo `features/cine/*` de §12.3, los estados de
§13, las líneas de Ajustes → IPTV, demo de 60 películas y 12 series, 5 vistas nuevas en `revision-visual` y las
pruebas de §15.4 que le tocan. Web 1123/1123.

**Huecos deliberados** (los dejó escritos su agente; pasan a otros paquetes):

| Hueco | Pasa a |
|---|---|
| Ruta `sala/<id>`, modo escenario del Shell, `FEATURE_FOLDER.sala` (§12.2, §12.8) | VOD-6 |
| Fila de Buscar (§12.5, D-VOD25) | VOD-6 |
| Reproducir en la demo (§12.11); hoy «Reproducir» enseña «Próximamente» (`features/cine/play.ts:26-29`) | VOD-6 |
| Atajo del manifiesto `/?vista=cine` y su comprobación en `recorrido-inventario.mjs` (§12.1) | VOD-7 |
| `e2e/cine.spec.ts` (§15.5) | VOD-7 |

**Arreglos** (1-2 h): aquí, §4.2.

### 2.4 VOD-4 reproducción

**Se queda la WIP**, con arreglos: `remux/vod/types.ts`, `reader.ts` (lector de rangos contra el relé en 127.0.0.1,
comprueba `Content-Range`, lecturas a medias, tope de 32 MiB, plazo y cancelación), `codecs.ts` (`parseAvcC` y
`parseHvcC` dan `avc1.64001f` y `hvc1.1.6.L90.90` con muestras reales; `isAacLcConfig` distingue LC de HE-AAC) y, en
`net/{types,client,transport}.ts`, la opción `identity` y la promesa `released` (cierre del socket).

**Falta todo lo demás:** `index-mkv.ts`, `index-mp4.ts`, `index.ts`, `plan.ts`, `playlist.ts`, `args.ts`, `fmp4.ts`,
`run.ts`, `producer.ts` y `iptv/relay-vod.ts`. De las 7 pruebas de §15.1 para VOD-4 no hay ninguna.

**El experimento vale oro y está en carpetas temporales:**
- `/tmp/claude-0/-home-user-umbrel-app-store/a55b23bc-9148-5109-8f22-499cf5fbe6b9/scratchpad/vodc/` (514 MB):
  `server.mjs` (proveedor falso con Range y una sola conexión), `relay.mjs`, `exp.mjs` (índice → plan → ffmpeg con los
  argumentos de §9.6 → troceador fMP4), `split.mjs`, `browser.mjs` y los resultados `r_{mkv,mp4,hevc}_{61,81}.json`;
- `/tmp/claude-0/vod-scratch/ffx/kfindex.mjs`: el prototipo del índice de fotogramas clave.

Los guiones (no las muestras, que se generan con ffmpeg) se copian al repositorio en el primer commit de VOD-4 (aquí,
§4.3), antes de que se pierdan.

---

## 3. Integración sobre la 0.8.3

### 3.1 La rama `vod/0.9.0`

- Sale de `main` **en cuanto la 0.8.3 esté unida**. Si se empieza antes, sale de `origin/claude/wizardly-clarke-ycfsia`
  (`5a61376`), que tendrá el mismo contenido; después, `main` se une en ella con un merge normal.
- **No se toca** `claude/wizardly-clarke-ycfsia` ni `fix/agenda-filtrado`. Nada se sube a `main` hasta la 0.9.0.
- Todo llega con `git merge --no-ff` y un mensaje «merge: vod/… (…)», como las uniones del diagnóstico (`8570fb5`).
  Nunca rebase de una rama ya subida ni force-push.
- `features.vod` sigue sin encenderse con el servidor real hasta que VOD-2 esté unido, y el destino necesita
  `?flag=cine` hasta VOD-7: la rama se puede publicar como beta sin que Isma vea nada a medias.

### 3.2 Orden y estrategia por rama

| Paso | Qué | Cómo | Conflictos esperados | Cómo se resuelven | Comprobación |
|---|---|---|---|---|---|
| 1 | Cierre de VOD-1 | Commits en `vod/1-contrato` (aquí, §2.1) y push | — | — | `shared` test, `contracts.test.ts`, openapi sin diff |
| 2 | `vod/1-contrato` → `vod/0.9.0` | `merge --no-ff` | `docs/openapi-v2.yaml`: la línea de la versión; git lo une solo | Si choca, se queda la versión de la 0.8.3 y se regenera con `--filter @ace/shared openapi` | Después del merge, **commit aparte**: `node apps/ios/scripts/generar-catalogo-errores.mjs` (8 `vod_*`, ~9 líneas) y `--check` en verde |
| 3 | `vod/3-web` → `vod/0.9.0` | Antes, los arreglos de aquí, §4.2, en `vod/3-web`; después `merge --no-ff`. `vod/3` ya contiene `d3a9b46`; los commits nuevos de `vod/1` llegan por el paso 2 | Ninguno textual | — | `-r typecheck`, `lint`, web entera, `revision-visual` a 360/768/1024/1280 con `?demo=1&flag=cine`, `size` |
| 4 | VOD-2 → `vod/0.9.0` | **Rama nueva `vod/2-catalogo-b` desde `vod/0.9.0`**: se trae la WIP por rutas (`git checkout origin/vod/2-catalogo -- <rutas>`) en 5 commits revisables (abajo), sin `dbg.log`; encima, los arreglos de aquí, §4.1; después `merge --no-ff`. `vod/2-catalogo` se queda como está, de historia | Ninguno textual (`iptv/service.ts` y `state/routes.ts` no los tocó la 0.8.3; `service.test.ts`, sí, pero VOD-2 no) | — | `-r typecheck`, `lint`, servidor entero (los 9 de red y los intermitentes conocidos se repiten solos), `@lento` aparte |
| 5 | VOD-4 → `vod/0.9.0` | Se une `vod/0.9.0` **dentro de** `vod/4-reproduccion` (sin conflictos) y se sigue trabajando allí; al terminar, `merge --no-ff` hacia `vod/0.9.0`. La WIP es pequeña: no merece partirse | Ninguno (la 0.8.3 no tocó `net/`, `remux/` ni `relay.ts`) | — | Pruebas de `remux/vod`, `net` y `relay-vod`; `transport.test.ts` en CI (en el sandbox falla por `::1`) |
| 6 | VOD-5, VOD-6, VOD-7 | Ramas nuevas desde `vod/0.9.0` (`vod/5-enganches`, `vod/6-reproductor`, `vod/7-cierre`) | VOD-6 con `runtime.ts` y `engines/hls.ts` de la 0.8.3 (aquí, §3.3) | Se trabaja sobre la versión 0.8.3, nunca sobre `8570fb5` | Las de cada paquete |

**Los 5 commits de VOD-2** (paso 4), en este orden y cada uno con typecheck en verde:
1. `feat(iptv): sellado binario, acciones VOD de Xtream y rutas de datos VOD` — `iptv/crypto.ts` (`sealBlobBytes`,
   `openBlobBytes`), `xtream.ts`, `store.ts` (`removeAll`), `types.ts`, `config/keys.ts`, `config.paths.vod*`.
2. `feat(vod): piezas puras del catálogo` — `parse`, `titles`, `table`, `table-codec`, `ids`, `search`, `progress`
   con sus pruebas.
3. `feat(vod): catálogo, fichas, carteles y servicio` — `xtream-vod`, `catalog`, `details`, `art`, `vod-service`,
   `test-support`, `memoria.test.ts`.
4. `feat(vod): rutas VOD y enganches en el servicio IPTV y el estado` — `iptv/routes.ts`, `iptv/service.ts`,
   `state/routes.ts`.
5. `test(vod): acciones VOD en el proveedor falso` — `test/fake-iptv/vod.ts`.

### 3.3 Conflictos que git no ve

- **`ErrorCatalog.swift`**: lo regeneraron la 0.8.3 (`933a539`) y lo tiene que regenerar VOD. Si se hiciera en
  `vod/1-contrato`, sobre la base vieja, chocaría con el de la 0.8.3. Por eso va **después** del merge (paso 2). Si
  aun así choca: cualquiera de los dos lados, regenerar y `--check`.
- **`runtime.ts` y `engines/hls.ts`** (0.8.3, `82e7c8a`): ahora saltan el hueco del remux reiniciado **durante la
  retención** y van sin intersticiales. Con VOD, `on('waiting')` no debe retener (§12.7) y un hueco en VOD es un error
  de verdad, no una costura del directo. VOD-6 tiene que poner `if (this.vod) return` también en el salto de hueco
  nuevo y probarlo en `runtime.test.ts`.
- **`docs/openapi-v2.yaml`**: la versión dirá 0.8.3 hasta VOD-7; se regenera al final con la 0.9.0.
- **El cerrojo `runHeavy`** (VOD-2 lo comparte con el directo): la 0.8.3 promete «IPTV sin cortes» y una
  sincronización VOD larga retrasa la del directo y la guía (aquí, §4.1, fallo 8).

### 3.4 Reglas mientras dure

- **Confirmar y subir a menudo:** cada paso que pasa sus pruebas es un commit y un `git push -u origin <rama>`
  (reintentos a 2, 4, 8 y 16 s). La cuota se ha acabado dos veces a mitad de paquete y por eso hay dos WIP sin revisar.
- Commits en castellano con prefijo (`feat`, `fix`, `test`, `docs`, `merge`), comentarios y textos en castellano,
  pruebas junto al código.
- **Nadie más que el contrato toca `packages/shared`** (§16.2): si VOD-2 o VOD-6 necesitan algo, un commit pequeño
  aparte con prefijo `feat(contrato)`.
- Las pruebas intermitentes conocidas (`relay.test.ts` de tiempos, `ChannelDetail.test.tsx` «clic derecho»,
  `integration/iptv.test.ts` n.º 14, `iptv/browse.test.ts`, dos de `teams/routes.test.ts`) se repiten solas antes de
  darlas por rotas. Los 9 fallos de red del sandbox (`net/transport`, `health`, `state/routes`,
  `integration/escrituras`) no cuentan.

---

## 4. Paquetes que quedan

### 4.1 VOD-2: cierre del catálogo (0,75-1 día)

| # | Gravedad | Dónde | Qué pasa | Arreglo | Prueba |
|---|---|---|---|---|---|
| 1 | media | `vod/titles.ts:73` (`PREFIX_CODE`) y §4.4 | Quita cualquier 2-3 mayúsculas con «:»: «CSI: Miami» → «Miami», «UP: Una aventura…», «ET: El extraterrestre», «SOS: Rescate». Buscar «csi» no encuentra nada | Lista cerrada de códigos (ES, ESP, SPA, CAST, LAT, LATAM, EN, ENG, VOSE, VOS, SUB, MULTI, FR, IT, DE, PT, 4K, FHD, HD) o solo `\|XX\|`. Se corrige también §4.4 | `titles.test.ts`: esos cuatro intactos y los casos de §15.1 siguen igual |
| 2 | media | `vod/catalog.ts:136-181` | Al pasar al modo por categorías reutiliza el `builder` a medias de la lista entera: `skipped` se infla en decenas de miles | Un `builder` nuevo en el cambio de modo | `catalog.test.ts`: la lista entera muere a mitad (plazo de 240 s o `too_large`) y `skipped` sale bien |
| 3 | media | `vod/catalog.ts:147-158` y `:187-195` | Una categoría mala tira todo el modo por categorías y vuelve a la lista entera, que es lo que ya había fallado | Saltar y contar la categoría; rendirse tras N fallos (p. ej. 5 o el 20 %) | `catalog.test.ts`: una categoría con 500 y el resto bien |
| 4 | media-baja | `vod/vod-service.ts:458-477` | `stillCurrent` se mira antes de `saveVodCatalog`, que no lleva señal: un `remove()` durante el gzip+escritura deja `vod.enc` en disco (rompe §10.5 y §14.6) | Pasar la señal y mirarla antes del `rename`, o borrar el fichero si al terminar ya no es la actual | `vod-service.test.ts`: `remove()` durante el guardado → sin `vod.enc` |
| 5 | media-baja | `vod/table.ts:205` | Tope de 0xfffe carpetas internadas: un panel con una carpeta por título pierde los carteles a partir del 65 534, sin aviso | Con la tabla llena, guardar la URL entera con un centinela «sin carpeta» | `table.test.ts`: 70 000 títulos con carpeta propia, todos con cartel |
| 6 | baja (prueba) | `vod/memoria.test.ts:180-209` | La carga en frío mide «+0,0 MB» y siempre pasa; de ahí el error de lint de la línea 183 | Medirla en un proceso aparte (o en su propia prueba sin el catálogo anterior vivo); dejar `memoria.test.ts` solo con `@lento` | Que la medida dé un número creíble (< 40 MB) |
| 7 | baja | `vod/xtream-vod.ts:186` | Las fichas admiten `maxBytes * 3` descomprimidos: 24 MiB antes de `JSON.parse` (el diseño dice 8) | `maxBytes` para las llamadas de ficha | `details.test.ts`: ficha de 9 MiB → `failed` |
| 8 | baja, pero toca la promesa de la 0.8.3 | `iptv/service.ts` (`runHeavy`) y `vod/catalog.ts` | La sincronización VOD retiene el cerrojo: la del directo y la guía esperan hasta ~8 min (lista entera) o sin tope (por categorías) | Tope total del modo por categorías (p. ej. 10 min) y que una sincronización del directo pase delante de una VOD (se aborta y se reprograma) | `service.test.ts`: con un VOD largo en marcha, la del directo empieza en < 1 s |
| 9 | baja | `iptv/xtream.ts:299` | Los nombres de categoría solo pasan por `slice(0,200)` y `redact()` | `cleanText` (§7.2) | `parse.test.ts`/`routes.test.ts`: categoría con HTML y caracteres de control |
| 10 | baja | varios | `StopList` pierde el `skipped` del troceador (`xtream-vod.ts:150`); el barrido borra el `.tmp` de otra descarga (`art.ts:319-321`, solo un aviso); el cartel del `cover` de la ficha da 404 tras 6 h (`vod-service.ts:1047`); `stale` solo en memoria | Arreglar el primero y el tercero; los otros, comentario | Las de cada fichero |
| 11 | higiene | raíz del repo, `iptv/routes.ts:99-107` | `dbg.log` subido; `settle()` duplica el de `teams/service.ts:120` | No traer `dbg.log` (aquí, §3.2, paso 4); reutilizar `settle()` | lint |

**Además:**
- **Pruebas que faltan:** `bootstrap.features.vod` (web sí, nativa no), `IptvStatus.vod` en `iptv.status`,
  «Actualizar» llama a `refreshIfOlder`, un cambio de proveedor por `save()` vacía `vod.json`, y `xtream-vod.test.ts`.
- **«Comprobar de nuevo» fuerza el VOD** con el estado `none` o `error` (hoy `features/cine/Home.tsx:140` llama a
  `iptvSync`, que solo resincroniza el VOD si tiene más de 1 h). Si hace falta un campo en el cuerpo de `iptvSync`, lo
  añade el contrato aparte.
- **Endurecimiento de §5.3, la mitad que toca VOD-2:** `libraryMutate` (`state/routes.ts`) responde
  `validation_error` con `detail: 'vod_id'`. `isVodId` en `IptvService` (o `iptv.vod?.isVodId`). `channelStream` va en
  VOD-5.
- **Ojo para la 0.9.0:** `feature()` (`vod-service.ts:610`) da `true` en `preparing`, así que con cualquier Xtream el
  destino sale hasta que la primera sincronización diga `none`. Es lo que dice el diseño; se deja, pero el texto de
  «Preparando…» tiene que existir (lo tiene: §13).

**Ficheros:** `apps/server/src/modules/iptv/vod/{titles,catalog,vod-service,table,xtream-vod,memoria}.ts` y sus
pruebas, `iptv/{xtream,service,routes}.ts`, `state/routes.ts` (+ prueba), `docs/vod.md` §4.4.

### 4.2 VOD-3: arreglos (1-2 h, en `vod/3-web` antes del paso 3)

| # | Dónde | Arreglo | Prueba |
|---|---|---|---|
| 1 | `features/cine/model.ts:313-321`, `EpisodeList.tsx:127`, `Ficha.tsx:162` | Con `container` en el contrato (aquí, §2.1), el texto lo usa; sin él, un texto genérico («Este episodio no se puede reproducir en este navegador.») en vez de «(DESCONOCIDO)» | `model.test.ts`, `Ficha.test.tsx` |
| 2 | `features/cine/texts.ts:9-11` (`formatCount`) y `features/iptv/model.ts:425,436` | `{useGrouping: 'always'}`: «1.234» como piden §12.4 y §12.10 (es-ES no agrupa 4 cifras). Toca también el contador IPTV: en su propio commit | `iptv/model.test.ts` deja de aceptar «1234» |
| 3 | `features/cine/Seasons.tsx:17-32` | Quitar `temporada` al salir de la ficha o cambiar de título (hoy `searchFor` lo arrastra a la siguiente serie) | `Ficha.test.tsx`: categoría desde una serie → otra serie abre en su temporada |
| 4 | `revision-visual` | Repetir la pasada: hubo un aviso de contraste de axe en `.toast__text` (cine-pelicula, 390×844, oscuro), quizá a mitad de animación | Sin avisos |
| 5 | `apps/web` `size` | Comprobar el presupuesto de JS inicial (~1,5 KB más según §12.3) | `pnpm --filter @ace/web size` |

### 4.3 VOD-4: reproducción, piezas nuevas (3,5-4 días)

En `vod/4-reproduccion`, después de unir `vod/0.9.0` en ella (aquí, §3.2, paso 5). Cada pieza, un commit con sus
pruebas y push.

| Pieza | Ficheros (en `apps/server/src/modules/`) | Pruebas | Arreglos de la auditoría | Estimación |
|---|---|---|---|---|
| 0. Rescatar el experimento | `apps/server/test/fake-vod/` (o `scripts/vod-lab/`): `server.mjs`, `relay.mjs`, `exp.mjs`, `split.mjs`, `browser.mjs`, `kfindex.mjs`; las muestras se generan con ffmpeg (`lavfi`) al preparar, nunca binarios en el repo | — | — | 0,1 d |
| 1. WIP probada | `remux/vod/{reader,codecs}.ts`, `net/{client,transport}.ts` | `reader.test.ts` (servidor local en `127.0.0.1`, no `::1`), `codecs.test.ts`, `client.test.ts` (`identity`, `released`) | P3 (HEVC solo perfiles 1 y 2, 4:2:0), P5 (tolerancia `max(2·GOP, 30 s)`), P6 (con `identity`, esperar a `response.closed` antes de seguir una redirección o tras un fallo), P8 (`isAacLcConfig(null)` no es LC; `A_AAC/MPEG4/*/SBR` aparte), P9 (416 sin cabecera no es `sin_saltos`), P10 (perfil 244, 144 no reproducible, `reason: VodUnsupportedReason`), P12 (prettier; sin `-threads 2` con todo copiado) | 0,3 d |
| 2. Índice MKV | `remux/vod/index-mkv.ts` | `index-mkv.test.ts`: escritor EBML mínimo en la prueba (SeekHead al final, tamaño desconocido, sin Cues → `indice`) y `@ffmpeg` contra ffprobe (49/49 y 30/30 en el experimento) | — | 0,5 d |
| 3. Índice MP4 e índice común | `remux/vod/index-mp4.ts`, `remux/vod/index.ts` (bytes mágicos, AVI → `formato`, TS → `indice`, LRU de 8, `assertPlayable`) | `index-mp4.test.ts` (moov al final, `ctts`, **`elst` vacío**, fragmentado → no soportado), `index.test.ts` | **P1**: sumar la entrada vacía del `elst` (`media_time = -1`) en la escala de `mvhd`; si no, los fotogramas clave salen 21 ms antes | 0,5 d |
| 4. Plan, lista y argumentos | `remux/vod/{plan,playlist,args}.ts` (puros) | `plan.test.ts`, `playlist.test.ts`, `args.test.ts` (§15.1) | — | 0,3 d |
| 5. Troceador fMP4 | `remux/vod/fmp4.ts` | `fmp4.test.ts`: tamaños de 64 bits, `tfdt` v0 y v1, **`tfdt` v1 negativo** | **P2**: el primer `tfdt` del audio de una ejecución desde 0 es −1024 (2⁶⁴−1024); leerlo con signo o usar solo el vídeo | 0,25 d |
| 6. Ejecución y productor | `remux/vod/{run,producer}.ts`, `remux/process.ts` (`stdout: 'pipe'`) | `producer.test.ts` con ffmpeg falso (§15.1) | **P4**: asignar fragmentos por PTS (`tfdt` + `cto` de la primera muestra) o por el fotograma clave más cercano con margen ≥ 0,2 s; «Non-monotonic DTS» en stderr no es un fallo | 1-1,25 d |
| 7. Relé VOD | `iptv/relay-vod.ts` (clase suelta) | `relay-vod.test.ts` (§15.1), contra el `server.mjs` rescatado | **P7** va en VOD-5 (es `relay.ts`) | 0,75 d |

### 4.4 VOD-5: enganches del servidor (1,5-2 días; necesita el Paso 0, VOD-2 y VOD-4 unidos)

| Fichero | Qué |
|---|---|
| `iptv/service.ts` | `openVod`, `isVodId` (si no llegó con VOD-2); lo demás ya está (aquí, §2.2) |
| `iptv/relay.ts` | `route` y `openVod` hacia `relay-vod.ts`, `connections`; **P7**: `connect` (`relay.ts:1193-1214`) acepta la cabecera `Range` e `identity` |
| `remux/service.ts` | La línea de `serveFile`, el registro de productores VOD y el barrido de carpetas VOD al arrancar |
| `playback/service.ts` | `acquireVod`, `openVodLocked` y las guardas de D-VOD11 cambiada: un VOD corta el directo IPTV y otro VOD (con aviso), **convive con AceStream** |
| `playback/routes.ts` | `vodStream` real en lugar del 501 (`:106`); `channelStream` → `validation_error` con `detail: 'vod_id'` (§5.3) |
| `iptv/vod/vod-service.ts` | `knownDurationS` (comprobación ±10 % de `durS`; hoy solo ≤ 12 h) |
| `test/fake-iptv/` | `/movie/` y `/series/` con Range/206 y las opciones de §15.3 (`noRange`, `redirect`, `maxConn: 1`, `busyAfterCloseMs`, `firstByteMs`, `rateMbps`, `dropAtBytes`, `idleCloseMs`) |
| Ajustes del Paso 0 | `forwardSkipBytes`, `reuseRedirect`, `idleReleaseMs` y el modo por categorías según la tabla de §3 |

**Pruebas:** `playback/vod-sessions.test.ts`, `vod/timings.test.ts` (presupuesto de §9.12 contra `nginx.conf`) y
`test/integration/vod.test.ts` con los 12 casos de §15.3. **CI:** el job `tests` de `ci.yml` no tiene ffmpeg; o se
instala allí o la integración VOD corre en el job `e2e`.

### 4.5 VOD-6: web, el reproductor (3 días; los enganches, tras VOD-5)

| Ficheros (en `apps/web/src/`) | Qué |
|---|---|
| `player/api.ts` | Orden `play-vod`, `playVod()`, `PlayerState.kind` y `PlayerState.vod` |
| `player/vod/{driver,progress,timeline,texts}.ts`, `VodControls.tsx`, `NextUp.tsx`, `StillWatching.tsx`, `vod.css` | §12.7 y §12.9: motor hls.js o HLS nativo, una reconexión en la posición, `vod_busy` con `retryAfterS`, progreso con `keepalive`, controles, teclado, Media Session, mini reproductor, datos técnicos, siguiente episodio y «¿Sigues viendo?» |
| `player/runtime.ts`, `player/engines/hls.ts` | Los enganches de una línea de §12.7, **sobre la versión 0.8.3** (aquí, §3.3) |
| `app/routes.ts`, Shell, `FEATURE_FOLDER.sala`, `features/sala/{index,SalaView}.tsx` | Ruta `sala/<id>` y modo escenario (§12.2, §12.8) |
| `features/cine/play.ts` | `playVod()` real; en la demo, la lista VOD de prueba (§12.11) |
| `features/search/*` | La fila «Pelis y series» de Buscar (§12.5, D-VOD25) |

**Pruebas:** `player/vod/driver.test.ts` con `FakeVideo`, `VodControls.test.tsx`, `media-session`, `routes.test.ts`
(`sala`), `Shell.test.tsx` (escenario), `runtime.test.ts` (el salto de hueco de la 0.8.3 no actúa con VOD). La parte
pura (controles, progreso, siguiente episodio) puede empezar ya contra la demo; los enganches de `runtime.ts`, cuando
VOD-5 dé `vodStream` de verdad.

### 4.6 VOD-7: cierre y 0.9.0 (1,5-2 días)

- `apps/web/e2e/cine.spec.ts`: `@sin-video` (también WebKit) y `@video` en Google Chrome (en este entorno,
  `/tmp/claude-0/iptv-lab-scratch/cache/chrome/opt/google/chrome/chrome`).
- Atajo del manifiesto `/?vista=cine` y su comprobación en `scripts/recorrido-inventario.mjs`; quitar el requisito de
  `?flag=cine`.
- `@lento`, `revision-visual`, la medida de memoria en el NAS (§15.6) **antes** de quitar el flag.
- Opcional: vectores compartidos de §10.3 para iOS (`apps/ios/scripts/generar-vectores.mjs`).
- Lo de siempre de §16.3: versión 0.9.0 en todos los ficheros, openapi y `ErrorCatalog.swift` regenerados,
  `pnpm release:docker` desde un HEAD confirmado, `releases/0.9.0`, CHANGELOG, `check:release`, unión con commit de
  merge. Actualizar `docs/vod.md` (Estado), `docs/iptv.md` (una línea) y pasar la lista de §17 a iOS.

### 4.7 Después de la 0.9.0

VOD-8 subtítulos (Isma dijo que pueden esperar, §19.4), pistas de audio HLS, «Mi lista», modo sin índice (antes si el
Paso 0 ve > 10 % de `.ts`/`.avi` o MKV sin Cues), M3U VOD, agrupar por TMDB y la fase de iOS (§17).

---

## 5. Lo que depende de Isma

1. **El Paso 0** (bloquea VOD-5; no bloquea VOD-2, VOD-4 ni VOD-6). Una hora, en su Umbrel, **con la app de IPTV del
   PC cerrada** (usa su única plaza). El guion solo usa módulos de Node, así que basta un contenedor de Node:

   ```sh
   curl -fsSLO https://raw.githubusercontent.com/Ismaeloul/umbrel-app-store/refs/heads/vod/1-contrato/ace-player-neo/scripts/vod-sondeo.mjs
   read -rp 'Servidor (http://…:puerto): ' VOD_SERVIDOR; read -rp 'Usuario: ' VOD_USUARIO
   read -rsp 'Contraseña: ' VOD_CLAVE; echo; export VOD_SERVIDOR VOD_USUARIO VOD_CLAVE
   docker run --rm -e VOD_SERVIDOR -e VOD_USUARIO -e VOD_CLAVE -v "$PWD":/w -w /w node:24-alpine \
     node vod-sondeo.mjs --json > sondeo.json
   ```

   Las credenciales se teclean (no quedan en el historial). Solo imprime agregados (nunca URL, usuario, contraseña,
   hosts ni tokens). Isma pega `sondeo.json` y su resultado se
   copia en §3 antes de empezar VOD-5. Si no puede pronto, VOD-5 arranca con los valores por defecto de §3 y se ajusta
   después; el riesgo es tener que retocar el relé (aquí, §6).
2. **Adultos en la portada** (§19.3, pregunta 4, sin respuesta). Por defecto (D-VOD7): fuera de la portada y de
   «Todas», visibles en su categoría (que va al final) y en la búsqueda.
3. **Revisar las pantallas:** capturas de `revision-visual` en el PR de `vod/0.9.0` (o la demo `?demo=1&flag=cine`).
4. **Al final, en su NAS** (§15.6): una película MKV con AC-3, un MP4, un HEVC y una serie larga; saltos con la app del
   PC abierta (se espera `vod_busy`); la medida de memoria del contenedor; y el iPhone con Safari, que además prueba la
   costura HEVC entre ejecuciones (P4), lo único de la estrategia C que no se ha visto en Safari.

---

## 6. Riesgos

1. **El Paso 0 no llega o sale mal.** Sin 206 con Range, la reproducción se apaga para su proveedor
   (`vod_unsupported`, `sin_saltos`) y el catálogo sigue; si la plaza tarda > 14 s en soltarse, `vod_busy` con
   `retryAfterS`. VOD-4 no depende de él; VOD-5, sí.
2. **La cuota.** Ya ha parado dos paquetes a mitad. Mitigado con commits y push en cada paso que pasa sus pruebas y con
   paquetes que se pueden retomar desde el documento.
3. **El experimento de VOD-4 vive en una carpeta temporal.** Si se pierde antes de rescatarlo (aquí, §4.3, pieza 0),
   rehacer el proveedor falso, el relé de prueba y el troceador cuesta ~½ día más.
4. **Interacción con los arreglos de la 0.8.3** en `runtime.ts` y `hls.ts`: un salto de hueco o una retención
   pensados para el directo actuando en una película. Mitigado con las guardas `if (this.vod)` y su prueba.
5. **Una sincronización VOD retrasa el directo** (fallo 8): va contra la promesa de la 0.8.3. Se arregla en VOD-2.
6. **Títulos destrozados** (fallo 1): «CSI», «UP», «ET». El diseño también estaba mal; se arregla código y documento.
7. **HEVC en Chrome de escritorio** sin decodificación: no se ve; el mensaje manda a Safari o al iPhone (§19.2, 5).
8. **`transport.ts` sin probar aquí** (el sandbox no tiene `::1`): sus pruebas tienen que pasar en el CI antes de unir
   VOD-4.
9. **Pruebas intermitentes con carga** (`relay.test.ts` de tiempos y otras de aquí, §3.4): ninguna es de VOD, pero
   pueden tapar un fallo real. Se repiten solas, nunca se dan por buenas sin repetirlas.

---

## 7. Estimación

| Paquete | Queda | Puede ir en paralelo con |
|---|---|---|
| Cierre de VOD-1 y `vod/0.9.0` con VOD-1 y VOD-3 (aquí, §3.2, pasos 1-3) | 0,25 d | — |
| VOD-2 cierre (aquí, §4.1) | 0,75-1 d | VOD-4, VOD-6 (parte pura) |
| VOD-3 arreglos (aquí, §4.2) | 0,2 d | todo |
| VOD-4 (aquí, §4.3) | 3,5-4 d | VOD-2, VOD-6 (parte pura) |
| VOD-5 (aquí, §4.4) | 1,5-2 d | final de VOD-6 |
| VOD-6 (aquí, §4.5), con lo que pasó de VOD-3 | 3 d | VOD-4, VOD-5 |
| VOD-7 (aquí, §4.6), con lo que pasó de VOD-3 | 1,5-2 d | — |
| **Total de un desarrollador** | **≈ 11-13 d** | |

**Con dos o tres agentes:** primero, una sesión corta para los pasos 1-3 (VOD-1, VOD-3 y `vod/0.9.0`). Después, en
paralelo, un agente en VOD-4, otro en el cierre de VOD-2 y, cuando acabe, en la parte pura de VOD-6. El camino crítico
es VOD-4 (≈ 4 d) → VOD-5 (≈ 2 d) → final de VOD-6 (≈ 1 d) → VOD-7 (≈ 2 d): **unos 9 días**, siempre que el Paso 0
llegue antes de que termine VOD-4.
