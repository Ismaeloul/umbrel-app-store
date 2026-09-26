# Pruebas E2E de la web (Playwright)

Recorridos de punta a punta contra la pila entera en local: la web servida
por Vite, el backend de verdad y motores AceStream falsos. No sale nada a
internet y no toca la instancia de Isma (3000, 3001, 5173 ni 6878 en `::`).

```
# desde apps/web (Chrome instalado + WebKit de Playwright 1.63)
corepack pnpm@10.18.2 run e2e                         # toda la batería, los 4 proyectos
corepack pnpm@10.18.2 run e2e --project chrome-escritorio
corepack pnpm@10.18.2 run e2e e2e/ttff.spec.ts        # solo el TTFF
npx playwright show-report playwright-report          # el informe HTML
```

`iptv.spec.ts` necesita `ffmpeg` en el PATH (la CI lo instala). En Windows
vale cualquier ffmpeg reciente (probado con el 7.0 que trae L-Connect 3): en
Windows el remux escribe la lista sin `temp_file` y con barras «/»
(`apps/server/src/modules/remux/args.ts`).

Si falta el WebKit de esta versión: `npx playwright install webkit` (baja a la
caché del usuario, `%LOCALAPPDATA%\ms-playwright`).

## La pila (`support/`)

| Fichero | Qué |
|---|---|
| `puertos.ts` | Elige los puertos UNA vez (el proceso principal) y los pasa en `E2E_PORTS`. El backend busca el motor SIEMPRE en el 6878: el falso escucha en la primera `127.0.0.N:6878` libre desde la `.40` y el backend va a ella con `ACESTREAM_HOST`. |
| `stack.ts` | El `webServer` de Playwright: lanza y vigila motores, backend y Vite; si un proceso se cae (los filtros de red de este PC tumban a veces un Node), lo relanza en el mismo puerto. Al acabar borra el `DATA_DIR` temporal. |
| `motores.ts` | Motor falso principal con su API de control `/__fake/*` en un puerto aparte, el del comprobador (otro motor, como en el NAS) y un `engine_control` falso en el 3001 de la misma dirección. |
| `iptv.ts` | El proveedor IPTV falso (`apps/server/test/fake-iptv`) en `[::1]:<iptv>`, anunciado como `iptv.ace-e2e.example:8080`, con su control `/__iptv/*` (`modo`, `conexiones`, `peticiones`, `reset`). |
| `backend.ts` | El arranque de `apps/server/src/main.ts` con dos cambios: escucha en `::` y la lista M3U de pruebas y el proveedor IPTV se «descargan» sin salir a internet (dominios reservados que resuelven a una IP pública; los filtros anti-SSRF son los de producción). |
| `pila.ts` | Dónde deja la pila su carpeta de trabajo, para que `iptv.spec.ts` busque las credenciales en los datos y los logs. |
| `catalogo.ts` | Las fuentes del motor falso (casan con la agenda de demostración), la lista M3U y la caché del motor (`E2E_CACHE_MOTOR_S`, 15 s por defecto: ver «TTFF» abajo). |
| `vite.e2e.config.ts` | `vite.config.ts` sin HMR ni vigilancia: otros agentes editan la web a la vez y cada guardado recargaba las páginas a mitad de un recorrido. |
| `pruebas.ts` | El `test` con su fixture (motor sin fallos al empezar; al acabar, nada sonando y ninguna excepción sin capturar), el acceso al backend y al motor falso y los pasos comunes. |

Todo lo que las pruebas piden desde Node va con reintentos (en este PC
127.0.0.1 corta ~1 de cada 6 conexiones por la VPN) y al backend por `::1`.
Un reintento por recorrido en `playwright.config.ts`: lo que pasa al
reintentar sale como «flaky» en el informe, no se esconde.

## Proyectos

| Proyecto | Navegador | Pantalla |
|---|---|---|
| `chrome-escritorio` | Chrome instalado (`channel: 'chrome'`) | 1440×900 |
| `chrome-iphone` | Chrome instalado | 390×844, táctil, `isMobile`, ×3 |
| `webkit-escritorio` | WebKit de Playwright | 1440×900 |
| `webkit-iphone` | WebKit de Playwright | iPhone 13 a 390×844 |

**WebKit y el vídeo.** El WebKit de Playwright en Windows no tiene
MediaSource ni HLS nativo: no puede reproducir nada (Safari de verdad sí).
Los recorridos con vídeo (`@video`) corren en los dos Chrome; en WebKit se
comprueba en su lugar que la app lo explica y no deja sesiones abiertas
(`@sin-video`, `webkit.spec.ts`).

**WebKit y las View Transitions.** Ese mismo WebKit (WinCairo) tumba el
proceso de la página al capturar una View Transition mientras corre una
animación CSS (el esqueleto de carga): 11 de 12 cargas se caían. En los
proyectos WebKit se quita `startViewTransition` (la app ya vive sin ella,
como en Firefox). **Pendiente de comprobar en un iPhone de verdad.**

## Recorridos

| # | Fichero | Qué comprueba |
|---|---|---|
| 1 | `primer-uso.spec.ts` | Primer uso → personalizar gustos → la agenda pasa a «Para ti» y se filtra; queda guardado en el servidor. |
| 2 | `partido.spec.ts` | Abrir un partido → elegir una fuente verificada → el `<video>` avanza → cambiar de fuente (el motor suelta la anterior). |
| 3 | `partido.spec.ts` | Corte del motor como un reinicio (flujos cortados en seco, sesiones perdidas y 2,5 s sin contestar) → «Reconectando» → vuelve solo con la misma fuente. |
| 4 | `partido.spec.ts` | La fuente que suena falla 3 veces («failed to load content») → salta sola a otra verificada. |
| 5 | `mini-reproductor.spec.ts` | Volver a la portada → el mini-reproductor sigue sonando con el MISMO `<video>` y la misma sesión → detener. |
| 6 | `favoritos.spec.ts` | Quitar un favorito → «Deshacer» antes de 6 s (el servidor ni se entera); sin deshacer, se borra. |
| 7 | `listas.spec.ts` | Una URL privada se bloquea con su mensaje; una lista M3U pública se sincroniza y sus canales salen en la biblioteca. |
| 8 | `motor.spec.ts` | Reiniciar el motor pide un segundo toque (un toque suelto se desarma solo) y el motor vuelve en línea. |
| 9 | `dispositivos.spec.ts` | Emparejar: el código de 6 cifras se ve, un «iPhone» lo canjea, la web se entera; revocar (doble toque) y su token deja de valer. |
| D5 | `sesiones.spec.ts` | Dos dispositivos con el mismo canal → UNA sesión del motor (HLS), que se para cuando la sueltan los dos. |
| D5 | `sesiones.spec.ts` | Canales distintos → manda el último: el primero se para con su aviso y el motor suelta su canal. |
| D5 | `sesiones.spec.ts` | Cerrar la pestaña suelta la sesión al momento (sendBeacon); si muere sin avisar, caduca por falta de latido (45 s). |
| TTFF | `ttff.spec.ts` | Toque en una fuente verificada → primera imagen, en Equilibrado (6 muestras en frío). Resultados en `docs/rendimiento.md` y en `test-results/e2e/ttff-<proyecto>.json`. |
| IPTV | `iptv-buscador.spec.ts` | Buscador con IPTV y AceStream juntos (docs/iptv.md §14.9): Telecinco solo en la IPTV suena por hls.js, entra en Recientes y se guarda en Favoritos; «La 1» sale una vez y, si cae su IPTV, sigue por su AceStream; tu «Antena 3 HD» lleva «IPTV»; el filtro de Canales; la pausa; y las variantes de resolución (§17): «dazn 1» en una fila con «4K · 1080p · 720p · SD», 4 carteles IPTV en orden, la 1080p cae y sigue la 4K (no AceStream), tocar la 720p cambia. Capturas con `IPTV_CAPTURAS=<carpeta>`. Necesita ffmpeg. |
| — | `webkit.spec.ts` | Solo WebKit: sin forma de reproducir, la app lo explica y no deja nada abierto. |
| Fuentes | `fuentes-demo.spec.ts` | Con `?demo=1` (en los 4 proyectos): en los carteles de fuente de un partido y de un canal con varias fuentes, el proveedor va dentro de la tesela (donde iba la sigla, sin meterse bajo el número) y debajo solo el nombre del canal, sin repetir el proveedor. |
| IPTV | `iptv-demo.spec.ts` | Con `?demo=1` (corre ya, en los 4 proyectos): Ajustes → IPTV sin credenciales en la página, la IPTV como fuente 1 de demo-5 que arranca sola y no se pliega, el puente (cae la IPTV → AceStream con «Volver a la IPTV») y un canal de Canales que está en la IPTV suena primero por ella. |
| IPTV | `iptv.spec.ts` | `docs/iptv.md` §9.3 contra el backend con el proveedor IPTV falso (`support/iptv.ts`) y ffmpeg de verdad (`@video`, los dos Chrome): configurar Xtream y M3U sin que las credenciales vuelvan; la IPTV primera en un partido (confirmada por la guía) y en un canal suelto (Antena 3) con hls.js; cae la IPTV → AceStream con aviso y «Volver a la IPTV»; cae la AceStream → la IPTV; en pausa, como hoy; y la contraseña y el usuario buscados en todas las respuestas, el SSE, la página, el almacenamiento y los ficheros de datos y logs de la pila. Sin ffmpeg en el PATH se salta con su motivo. |

## Excepciones que se aceptan

El fixture falla el recorrido con cualquier excepción sin capturar en la
página, salvo las de `ERRORES_CONOCIDOS` en `support/pruebas.ts`, cada una con
su porqué: hoy solo carreras internas de mpegts.js 1.8.2 con
`enableWorkerForMSE` al soltar el `<video>` (cambiar de fuente, detener o
traspasar). No cortan nada y la app no puede capturarlas.

## Para depurar

- `E2E_REUSE=1` y `E2E_PORTS` fijos: usa una pila ya lanzada a mano
  (`node ../../node_modules/tsx/dist/cli.mjs e2e/support/stack.ts`).
- `E2E_KEEP_DATA=1`: no borra la carpeta temporal (datos del backend y los
  logs de cada proceso de la pila). `E2E_LOG_LEVEL=debug` sube el log del
  backend.
- `E2E_CACHE_MOTOR_S=<s>`: segundos que el motor falso ya tiene en caché al
  abrir un progresivo (0-30).
- El reproductor expone `window.__acePlayer` solo con Vite (`get()`, `play`,
  `stop`): los recorridos lo usan para leer la fase y el TTFF y para detener
  al acabar.

## TTFF

`ttff.spec.ts` mide del toque en una fuente verificada a la primera imagen,
en Equilibrado, con 6 arranques en frío por proyecto (método completo y
resultados en `docs/rendimiento.md`). Lo que manda es la caché del motor:
Equilibrado espera a tener 6 s de colchón. Con la de la pila (15 s, la misma
que ya da el HLS del motor falso y menos que el motor real) se exige el
objetivo de < 4 s; con menos caché que colchón (`E2E_CACHE_MOTOR_S=2`, el
caso malo) el objetivo es imposible por construcción y se exige que la web
no añada más de 1 s a la espera inevitable.
