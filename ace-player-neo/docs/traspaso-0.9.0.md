# Traspaso: Ace Player Neo 0.8.4 → 0.9.0 (para Claude Code en el PC de Isma)

> Escrito el 3-oct-2026 por la sesión de Claude Code en la nube que hizo la 0.8.3 y la 0.8.4. A partir de aquí
> el trabajo sigue **en local, en el PC de Isma (Windows)**, con ultracode. Este documento lo cuenta todo: dónde
> está cada cosa, qué falta, cómo trabajar y cómo publicar. Léelo entero antes de empezar.

---

## 0. Lo primero: preparar el repositorio en el escritorio

Isma va a **borrar del escritorio todo lo que tenga de su tienda de Umbrel** y abrirá la terminal **en el
escritorio**. Así que:

1. **Descarga el repositorio de GitHub** dentro del escritorio (no reutilices carpetas viejas):

   ```powershell
   cd $HOME\Desktop          # la terminal ya estará ahí; esto es por si acaso
   git clone https://github.com/Ismaeloul/umbrel-app-store.git
   cd umbrel-app-store
   git fetch --all --prune
   ```

   El repositorio es **la tienda de Umbrel entera** (`Ismaeloul/umbrel-app-store`). Dentro está:
   - `ace-player-neo/` → **el código** (monorepo pnpm). Aquí se trabaja.
   - `ismaeloul-ace-player-neo/` → **la app que instala Umbrel** (`umbrel-app.yml`, `docker-compose.yml`,
     `CHANGELOG.md`, `releases/<versión>/`). No se toca a mano: lo genera el corte de la release (§8).
   - Otras apps de Isma (`ismaeloul-saldo`, `ismaeloul-nutritrack`…): **no tocar**.

2. **Herramientas** (comprueba y, si falta algo, instálalo o dile a Isma qué falta):
   - **Node 24** (`node -v` ≥ 24). Con corepack: `corepack enable` o usa siempre `corepack pnpm@10.18.2 …`.
   - **pnpm 10.18.2** vía corepack (lo fija `packageManager`).
   - **ffmpeg y ffprobe** en el PATH (los usan el remux de la IPTV, sus tests y el E2E `iptv.spec.ts`; en Windows
     vale cualquier ffmpeg reciente).
   - **Google Chrome** instalado (lo usa Playwright para el E2E y el laboratorio).
   - **Docker Desktop**: solo para cortar la release (`release:docker`), los tests de nginx/shellcheck y la pila
     local. No hace falta para el día a día.
   - Git con su usuario de GitHub (para `git push`, abrir PRs con `gh` si está instalado, y etiquetas).

3. **Instala dependencias** (desde `ace-player-neo/`):

   ```powershell
   cd ace-player-neo
   corepack pnpm@10.18.2 install --frozen-lockfile
   ```

4. **Lee** `ace-player-neo/README.md` (cómo levantar todo en local, tests), y luego los documentos de §9.

---

## 1. Cómo quiere trabajar Isma (importante)

- **En local, para ver los cambios al momento** en el navegador de su PC (servidor de Vite y backend locales).
  **No** hay que subir cada cambio a GitHub para que lo revise: eso lo hacíamos en la nube y era lento.
- Trabaja tú en segundo plano y **avísale cuando haya algo que revisar**, con la URL local y qué mirar
  (`http://localhost:5173/?demo=1…` o la pila completa, §7).
- **Solo web.** La app de iPhone va al final, cuando él tenga el Mac de su hermano. No toques `apps/ios` salvo lo
  generado automáticamente (`ErrorCatalog.swift` cuando cambian los errores, para que el CI de iOS no se rompa).
- Isma escribe en español coloquial y muchas veces por voz. Contesta en español, claro y sin jerga. Él está de
  alternancia y en septiembre empieza un máster de ciberseguridad.
- Usa **ultracode** (workflows con varios agentes) para lo grande; él lo activa.
- Cuando algo esté listo para su Umbrel: rama → PR a `main` → CI en verde → **merge commit** (nunca squash ni
  rebase) → etiqueta → él actualiza en la tienda de Umbrel (§8).

---

## 2. Estado de las ramas (3-oct-2026)

| Rama | Qué es | Estado |
|---|---|---|
| `main` | Lo publicado | **0.8.3** (merge `c1f7219`). Isma la tiene instalada y la IPTV «parece que va bien». |
| `claude/wizardly-clarke-ycfsia` | La **0.8.4**, cortada | Release `releases/0.8.4/` hecha (`7ac098b`, fuentes `32282a6`) + commits de docs y `scripts/epg-sondeo.mjs`. **Sin PR todavía.** Falta el arreglo del iPhone (§3). |
| `fix/transicion-safari` | Arreglo de las vistas solapadas en Safari/iPhone | La sesión de la nube lo tenía en marcha. **Mira si existe en GitHub** (`git branch -r`). Si existe, úsalo (§3); si no, hazlo tú. |
| `integracion/0.9.0` | Rama donde juntar la 0.9.0 | Creada desde la 0.8.4 (`b7b96c7`). Sin cambios propios aún. |
| `vod/1-contrato` | VOD-1: contrato de Pelis y series (zod, rutas, errores) + `scripts/vod-sondeo.mjs` + `docs/vod-estado.md` | **Terminado.** Basado en la base anterior a la 0.8.3. |
| `vod/2-catalogo` | VOD-2: catálogo Xtream (servidor) | Completo pero **sin revisar**; el último commit es un «wip» rescatado. Tiene 3 fallos conocidos (§5.1). |
| `vod/3-web` | VOD-3: pantallas para navegar | Casi acabado (`61f746c`). |
| `vod/4-reproduccion` | VOD-4: piezas de la reproducción con saltos | ~10-15 %; último commit «wip» rescatado. |
| `fix/*`, `feat/*` | Ramas ya unidas en la 0.8.4 | Ignorar. |

Las ramas `vod/*` se hicieron sobre la base anterior a la 0.8.3: hay que unirlas sobre `integracion/0.9.0`
(`docs/vod-estado.md` dice que casi no chocan; regenera `openapi-v2.yaml`, fixtures y `ErrorCatalog.swift` con
los scripts del repo tras unir, nunca a mano).

---

## 3. Lo primero que hay que cerrar: la 0.8.4

La 0.8.4 lleva (todo ya unido y probado en `claude/wizardly-clarke-ycfsia`):
- Agenda: fuera juveniles/filiales/femenino/Sub-21 de «Para ti» salvo que se sigan; «Barcelona» = FC Barcelona
  de Primera por id de equipo; «España» = absoluta masculina; en «Todos» tus competiciones primero (D23).
- Partido destacado compacto en escritorio (móvil igual).
- Reproductor: los controles se esconden a los 2,5 s (también tras pulsar pantalla completa y al sacar el
  ratón); «Vas en directo» sin cifra de retraso.
- Cambio rápido de canal entre favoritos: ↑/↓ en PC, deslizar a izquierda/derecha en el móvil, cartel
  «Favorito 3/12», solo abre el canal final.
- Arranque instantáneo: 3 min antes de un partido de sus **equipos** favoritos (no ligas), la mejor fuente lista
  (D24; interruptor en Ajustes → Reproducción).
- Ajustes por secciones (una cada vez) + sección «Copia de seguridad» (D25).
- Transiciones entre pestañas consistentes, revisión de todas las animaciones, la URL ya no arrastra parámetros
  de otras vistas.
- El logo de Umbrel en toda la web.

**Falta, y va en la 0.8.4 (Isma lo pidió así):** en el **iPhone (Safari)**, al cambiar de pestaña (Buscar ↔
Canales) **se quedan las dos vistas pintadas a la vez**, una encima de otra (captura
`docs/capturas/pendiente/transicion-solapada-iphone.png`). Viene de las transiciones nuevas por vista
(`<ViewTransition enter/exit>` dentro de `<Activity>` en `apps/web/src/app/Shell.tsx`, `transitions.ts`,
`shell.css`). En Chrome de escritorio va bien. Además Isma quiere en el **móvil el mismo fundido** que ve en el
PC (sale una vista, entra la otra); ahora en el iPhone no hay fundido.
- Si existe `origin/fix/transicion-safari`, revísalo, únelo a `claude/wizardly-clarke-ycfsia` y comprueba en
  WebKit (Playwright `webkit` con emulación de iPhone): cambios rápidos de pestaña, pulsar otra a mitad de
  animación, atrás/adelante. La vista que sale **siempre** tiene que acabar oculta aunque la transición se corte;
  si las View Transitions fallan en WebKit, fundido CSS simple con los mismos tokens.
- Si no existe, hazlo tú con esas condiciones.

Después:
1. **Vuelve a cortar la release 0.8.4** (cambió código fuente después de `32282a6`): `corepack pnpm@10.18.2
   release:docker` regenera `ismaeloul-ace-player-neo/releases/0.8.4/` y `RELEASE.json` con el commit nuevo;
   commit aparte con el estilo de los anteriores. Pasa `check:release:docker`, `check:release`, `test:deploy`,
   `typecheck:deploy` y `node --test tests/release.test.js` (en `ismaeloul-ace-player-neo/`).
2. Si te apetece, añade una línea en las notas de `umbrel-app.yml` y `CHANGELOG.md` sobre el fundido en el móvil.
3. PR de `claude/wizardly-clarke-ycfsia` a `main` (plantilla de la 0.8.3, PR #53). Espera el CI.
4. **Merge commit** y etiqueta `ace-player-neo-v0.8.4` sobre el merge (`git tag -a … && git push origin
   ace-player-neo-v0.8.4`; desde la nube no se podía empujar etiquetas: la de la 0.8.3 **falta**, créala también
   sobre `c1f7219`).
5. Dile a Isma que actualice en su Umbrel.

**CI conocido:** el job de iOS «Compilar, probar y empaquetar» falla en las pruebas de interfaz («No aparece el
mini-reproductor») **desde la 0.8.0**, no por nuestros cambios; Isma aceptó fusionar con eso en rojo. Todo lo
demás tiene que estar en verde. Un E2E de IPTV depende de la hora (la guía borra los programas terminados tras las
20:25 de Madrid); ya está resuelto, pero tenlo en cuenta si ves 3 carteles en vez de 4.

---

## 4. Alcance de la 0.9.0 (todo lo que ha pedido Isma)

Fuente: `docs/pendiente.md` (puntos 4, 7, 11, 12 y la sección «Para la 0.9.0 — lo que pide Isma tras ver la vista
previa de la 0.8.4»). Resumen completo:

### 4.1 Películas y series (lo grande)
- Diseño en `docs/vod.md` (rama `vod/1-contrato`; decisiones D-VOD1…D-VOD30) y estado/plan en
  `docs/vod-estado.md`. Respuestas de Isma (§19.4 de `vod.md`): **Xtream**, rótulo **«Pelis y series»**,
  **una película por IPTV puede convivir con un partido por AceStream** (D-VOD11 cambiada; dos cosas por IPTV a la
  vez no, por la única conexión), **subtítulos después** de la 0.9.0.
- **Antes de seguir, investiga en internet** cómo lo hacen otras apps (Netflix, Plex, Jellyfin, TiviMate, IPTV
  Smarters, Kodi) y ajusta las pantallas.
- Lo que quiere Isma: «como los partidos». En la lista, **carátula grande y título** bien visibles. Al entrar en
  una **película**: carátula, **toda la información que dé la IPTV** (sinopsis, año, reparto, director, nota,
  duración…) y **botón de play**. En una **serie**: su información y elegir **temporada y capítulo**. Seguir
  viendo, siguiente capítulo.
- Reproducción: estrategia C (`vod.md` §9): índice de fotogramas clave del MKV/MP4 por Range, lista HLS VOD
  completa de entrada, ffmpeg copia vídeo y pasa audio a AAC, reinicia solo al saltar lejos, relé VOD en serie con
  una sola conexión al proveedor. Probada de punta a punta con ffmpeg 6.1 y 8.1 (ver `vod-estado.md`).
- **Pendiente de Isma:** si los títulos para **adultos** salen en la portada (por defecto, D-VOD7: no en la
  portada, sí en su categoría y en la búsqueda).
- **El Paso 0** (medir su panel): ver §6.

### 4.2 Guía TV (experimental)
- Botón/vista nueva **«Programación» / «Guía TV»** con parrilla **estilo Movistar+** (referencias en
  `docs/capturas/pendiente/programacion-referencia-movistar.png` y `-2.png`; una de Kodi también, menos preferida):
  canales a la izquierda (número + nombre), horas arriba cada 30 min con **raya vertical en «ahora»**, bloques por
  programa a lo ancho de su duración, «Sin información» donde no hay EPG, y **abajo el programa elegido** (logo del
  canal, título, barra de progreso con inicio/fin, «Ver» y «Más info»). **Sin pestañas de géneros.**
- Interruptor **«Favoritos | Todos»**: por defecto sus canales favoritos; «Todos» = todos los canales con EPG de su
  proveedor; si no tiene favoritos con guía, empieza en Todos.
- Hoy la app guarda solo ~93 canales (filtra: España, 48 h, solo lo que parece un partido; `iptv.md` §3.6).
  Hay que guardar **la guía completa**: compacta en disco (el contenedor `storage` tiene 768 MB), ventana de hoy a
  +2 días, y que la web pida solo el trozo visible (canales × horas) y cargue al desplazarse. Antes, mide la guía
  real con `scripts/epg-sondeo.mjs` (§6).
- Opcional: «ahora / después» en Canales.

### 4.3 Agenda híbrida
- Días 1-14: **futbolenlatv** como hoy. Hoy y mañana: la **EPG de la IPTV confirma** el partido y su **canal
  exacto**; ese canal guía también la **búsqueda en AceStream** (primero por ese canal), se enseña («Confirmado en
  tu guía: M+ LaLiga TV 2 · 21:00»), si hora/canal no coinciden manda la guía para hoy/mañana, y un partido que esté
  en la guía pero no en futbolenlatv se añade.
- **Sin IPTV, IPTV en pausa, sin EPG o sin datos de ese partido: todo como hoy.** La guía solo suma.
- Ya existe en parte: `modules/iptv/guide-match.ts` (`iptv.md` §4.5).

### 4.4 Arreglos y pulido pedidos tras ver la 0.8.4
1. **Escudos** en la columna derecha de Canales (donde salen «Girona 1-1 Sevilla» con dos círculos rojos).
2. **Agenda en PC: quitar el partido destacado** y subir el calendario: toda la página es el calendario. El partido
   de **sus equipos favoritos** (solo equipos) se resalta **dentro de la lista** con el aura amarilla (o verde).
3. **Deslizar entre días en la agenda del móvil** funciona a ratos: hacerlo bien (que funcione siempre) o
   quitarlo. A Isma le da igual en la web; en la app de iPhone sí lo quiere.
4. **Abrir un partido sin la animación del escudo que «baja»** (se ve a ~3 FPS): que se abra con el mismo fundido
   que al cambiar de pestaña. La animación vistosa queda para la app de iPhone.
5. **Columna «En directo» de la agenda:** marcador junto al minuto; al tocar cualquier partido en directo, abajo su
   canal y «Ver canal» (con RSO–VIL hoy salen los de «Luego», sin sentido); «Luego» se queda pero con el partido de
   sus equipos resaltado.
6. **Buscador de canales IPTV:** los nombres reales son raros («ES 4K LA 1», «ES: LA 1 4K», «|ES| LA 1 FHD»…);
   buscar «la 1» debe dar La 1 la primera. Probar con nombres reales de listas.
7. **La misma mejora en el buscador de Pelis y series.**
8. **Salud: botón «Descargar fallos».** Un fichero con errores y registro, **redactado** (sin contraseñas ni URLs
   con credenciales), para que Isma lo pase y se distinga lo nuestro (motor, decodificación, relé, web) de lo que
   no (una fuente caída).
9. **Panel «Fuentes» del partido:** al seleccionar una fuente su cartel crece y tapa al de al lado (y otro sale
   cortado). Que la seleccionada se marque solo con el borde, sin crecer, y que nada se salga del panel. Captura:
   `docs/capturas/pendiente/fuentes-carteles-solapados.png`.

### 4.5 Ideas descartadas por Isma (no hacer)
Avisos de partido (usa SofaScore), aprender qué canales IPTV fallan, retroceder más tiempo, dos partidos a la vez,
página de equipo con historial de fuentes, marcador en el reproductor, calendario exportable, grabar, perfiles,
mando remoto, modo tele. No sustituir futbolenlatv por la EPG.

### 4.6 Para la app de iPhone (no ahora)
Basada en la web pulida, con el Mac de su hermano. Ideas: descargar pelis y capítulos para verlos sin conexión;
la animación del escudo al abrir un partido; deslizar entre días.

---

## 5. Detalles técnicos que conviene saber

### 5.1 Pelis y series
- Fallos conocidos de `vod/2-catalogo` (de `vod-estado.md`): «CSI: Miami» se queda en «Miami»; una categoría mala
  tumba la descarga por categorías; quitar la IPTV mientras se guarda deja `vod.enc` en disco; una sincronización
  VOD larga retrasa la del directo hasta ~8 min (choca con la 0.8.3): arreglar antes de unir.
- Los experimentos de reproducción vivían en `/tmp` de la nube y **se han perdido**; `vod-estado.md` dice qué
  eran. Rehacer el proveedor falso de Range y el troceador cuesta ~½ día.
- Orden propuesto (`vod-estado.md`): contrato → web navegar → catálogo → reproducción → enganches → reproductor →
  cierre. VOD-5 (enganches del servidor) depende del Paso 0.

### 5.2 IPTV (lo que se arregló en la 0.8.3; no lo rompas)
- Diagnóstico completo: `docs/diagnostico-iptv-0.8.2.md`. Puerta de resincronía TS (`modules/iptv/ts-gate.ts`),
  relé que no se cuelga (`relay.ts`), remux continuo en reinicios (`remux/*`, `seamless` en `stream.reopened`),
  reproductor web sin pausas por huecos y latencia en segundos.
- **Laboratorio de reproducción** `ace-player-neo/scripts/iptv-lab` (README): proveedor falso con emisión real,
  backend de verdad y Chrome. Úsalo para cualquier cambio en el camino de la IPTV. **Una sola instancia a la vez.**
  Escenarios clave: `ts-costura` (el patrón real de Isma), `ts-silencio`, `ts-panel-real`, `ts-corte-pts`,
  `ts-limpio`, `hls-limpio`. Necesita Chrome con H.264 (el de Playwright no lo trae).
- En Windows, `iptv-lab` y algunos tests de red pueden tropezar con NordVPN/AdGuard (`docs/pendiente.md`, «Tests
  intermitentes en ESTE PC»).

### 5.3 Contratos y generados
- Contratos en `packages/shared` (zod). Tras cambiar rutas, errores o esquemas: `corepack pnpm@10.18.2 --filter
  @ace/shared openapi`, `… fixtures`, y `node apps/ios/scripts/generar-catalogo-errores.mjs` (el CI de iOS lo
  comprueba con `--check`).
- Decisiones en `docs/decisiones.md`: la última es **D25** (copia de seguridad). La siguiente, D26.

### 5.4 Tests
- `corepack pnpm@10.18.2 lint`, `corepack pnpm@10.18.2 -r typecheck`, `--filter @ace/shared test`,
  `--filter @ace/web test`, `--filter @ace/server test`, `test:deploy`, E2E `--filter @ace/web e2e`.
- En la nube fallaban 9 tests de red del servidor por el entorno (net/transport, health ollama, state/routes T-108,
  integración escrituras). En Windows puede variar; el CI de GitHub (Linux) manda.
- Intermitentes por carga: alguno de `iptv/relay.test.ts` con ffmpeg real, `teams/routes.test.ts`,
  `LibraryView`. Pasan al repetirlos solos.

---

## 6. Lo que depende de Isma: el Paso 0 (mediciones de su panel)

Dos guiones de **solo lectura** que solo imprimen agregados (nunca servidor, usuario, contraseña, URLs ni nombres):
- `scripts/vod-sondeo.mjs` (rama `vod/1-contrato`): catálogo VOD, códecs, Range (206), cuánto tarda en soltar la
  conexión, pausas, token de redirección. ~1 hora.
- `scripts/epg-sondeo.mjs` (rama `claude/wizardly-clarke-ycfsia`): la guía XMLTV entera (canales, programas,
  horas que cubre, % con sinopsis/imagen/categoría…). ~1-2 min.

Isma los lanza en su Umbrel por SSH, en segundo plano, **con la app de IPTV del PC cerrada**:

```sh
mkdir -p ~/sondeo && cd ~/sondeo
curl -fsSLO https://raw.githubusercontent.com/Ismaeloul/umbrel-app-store/refs/heads/vod/1-contrato/ace-player-neo/scripts/vod-sondeo.mjs
curl -fsSLO https://raw.githubusercontent.com/Ismaeloul/umbrel-app-store/refs/heads/claude/wizardly-clarke-ycfsia/ace-player-neo/scripts/epg-sondeo.mjs
read -rp 'Servidor (http://...:puerto): ' VOD_SERVIDOR; read -rp 'Usuario: ' VOD_USUARIO
read -rsp 'Contraseña: ' VOD_CLAVE; echo; export VOD_SERVIDOR VOD_USUARIO VOD_CLAVE
IMG='node:24.19.0-alpine3.24@sha256:d32cdf619f63fe0471182d08996dd516c6275bb5fd31ae06e55a570bd9e1ad43'
sudo --preserve-env=VOD_SERVIDOR,VOD_USUARIO,VOD_CLAVE docker run -d --rm --name sondeo -e VOD_SERVIDOR -e VOD_USUARIO -e VOD_CLAVE -v "$PWD":/w -w /w "$IMG" sh -c 'node epg-sondeo.mjs > epg.json; node vod-sondeo.mjs --json > sondeo.json; echo FIN > fin.txt'
# más tarde: cat ~/sondeo/fin.txt  → FIN;  luego: cat ~/sondeo/epg.json ~/sondeo/sondeo.json
```

Cuando te pase `epg.json` y `sondeo.json`: copia el resultado (sin datos sensibles) en `docs/vod.md` §3 y ajusta
según su tabla «Qué decide» (Range, plaza, tamaños, % HEVC, % VOSE…) y el plan de la Guía TV (cuánta guía hay).
**No esperes por ellos para empezar:** casi todo se puede construir antes; lo que dependa, con valores por defecto
configurables.

---

## 7. Cómo ver los cambios en local (lo que Isma quiere)

- **Solo la web, con datos de ejemplo (modo demo):** desde `ace-player-neo/`,
  `corepack pnpm@10.18.2 --filter @ace/web dev` y abre `http://localhost:5173/?demo=1` (pantallas de Pelis y
  series con `?demo=1&flag=cine` si siguen detrás del flag). Ideal para revisar diseño.
- **La pila entera con el motor falso** (`README.md`, «Desarrollar en local con el motor falso»): motor falso en
  6878, backend en 3000, web en 5173. En PowerShell:

  ```powershell
  corepack pnpm@10.18.2 exec tsx apps/server/test/fake-engine/cli.ts --port 6878 --host 127.0.0.1
  # otra terminal:
  $env:DATA_DIR='.data'; $env:ACESTREAM_HOST='127.0.0.1'; $env:AUTO_SYNC='false'; $env:FOOTBALL_DEMO_ONLY='true'
  $env:VITE_BACKEND='http://127.0.0.1:3000'; $env:ACE_SEED='una-frase-larga-cualquiera'
  corepack pnpm@10.18.2 dev
  ```

- **Con su IPTV real desde el PC:** el backend local puede conectar con su proveedor (Ajustes → IPTV en la web
  local). Recuerda la **única conexión**: mientras pruebas así, que no esté viendo la IPTV en el Umbrel ni en la app
  del PC. Para VOD es la mejor forma de probar de verdad avanzar/retroceder.
- Proveedor IPTV falso para pruebas: `apps/server/test/fake-iptv` (y la pila E2E en `apps/web/e2e/support`).
- Cuando haya algo que revisar, **dile a Isma exactamente qué URL abrir y qué mirar**, y pídele capturas si algo se
  ve raro (él manda capturas del móvil y del PC).

---

## 8. Publicar una versión en el Umbrel de Isma

Procedimiento de la 0.8.3/0.8.4 (`deploy/README.md` «Cortar la release» y `docs/despliegue.md`):
1. `build: version X.Y.Z`: `package.json` del monorepo, `apps/server`, `apps/web`, `packages/shared`; plantilla
   `deploy/umbrel/docker-compose.yml` con `/releases/X.Y.Z/`; `openapi-v2.yaml` regenerado.
2. `corepack pnpm@10.18.2 release:docker` (Docker) → `ismaeloul-ace-player-neo/releases/X.Y.Z/`; copia la
   plantilla a `ismaeloul-ace-player-neo/docker-compose.yml`; `umbrel-app.yml` con `version` y `releaseNotes`
   (español llano, sin tildes, como las anteriores); entrada nueva arriba en `CHANGELOG.md`.
3. Comprobaciones: `check:release:docker`, `check:release`, `test:deploy`, `typecheck:deploy`,
   `node --test tests/release.test.js` (en `ismaeloul-ace-player-neo/`), lint, typecheck.
4. **Ningún commit de código después del corte** sin volver a cortar (si no, `check:release` falla).
5. PR a `main`, CI en verde (salvo el job de iOS ya conocido), **merge commit** (nunca squash/rebase: `RELEASE.json`
   apunta a un commit que tiene que estar en `main`), etiqueta `ace-player-neo-vX.Y.Z` sobre el merge.
6. Isma: tienda de Umbrel → Ace Player Neo → Actualizar.

---

## 9. Documentos que leer (en este orden)

1. `ace-player-neo/README.md`
2. `ace-player-neo/docs/pendiente.md` (la lista viva de lo pedido)
3. `ace-player-neo/docs/traspaso-0.9.0.md` (este)
4. `docs/vod.md` y `docs/vod-estado.md` (en `vod/1-contrato`)
5. `docs/iptv.md` (§3.6 guía, §4.5 guía y partidos, §6-§7 reproducción) y `docs/diagnostico-iptv-0.8.2.md`
6. `docs/decisiones.md` (D23-D25), `docs/comportamientos.md`, `docs/arquitectura.md`
7. `scripts/iptv-lab/README.md` si tocas la IPTV

---

## 10. Propuesta de plan para la 0.9.0 (con ultracode)

Equipos por zona de la app (cada uno dueño de sus ficheros, para que no se pisen), cada uno con
«construir → revisor que intenta romperlo → corregir», en ramas propias que se unen en `integracion/0.9.0`:

| Equipo | Qué |
|---|---|
| 1. Pelis y series · servidor | Revisar y terminar el catálogo (y sus 3+1 fallos), piezas de reproducción, enganches (VOD-5) |
| 2. Pelis y series · web | Pantallas (lista con carátulas, ficha película, ficha serie) y reproductor VOD (barra, seguir viendo, siguiente capítulo) |
| 3. Guía TV | Guía completa en disco + API por trozos + parrilla estilo Movistar+ con Favoritos/Todos |
| 4. Agenda | Agenda híbrida + quitar el destacado en PC + aura de sus equipos + «En directo» con marcador y canal + escudos en Canales + deslizar entre días |
| 5. Buscadores | IPTV («la 1» con «ES 4K LA 1»…) y después Pelis y series (misma limpieza de nombres) |
| 6. Pulido | Abrir partido con fundido, carteles de fuentes que se solapan, «Descargar fallos» en Salud |

Orden: (0) investigación en internet para Pelis y series y para la parrilla → (1) primera tanda en paralelo:
equipos 1, 3 (servidor), 4, 5 (IPTV), 6 y la parte de navegar del 2 → Isma revisa en local → (2) segunda tanda:
reproductor VOD, parrilla web, buscador VOD → (3) cierre: unir, batería completa, laboratorio IPTV (que nada se
rompa), E2E Chrome y WebKit, revisión de Isma en local, release 0.9.0 (§8).

Avisa a Isma en cada hito con qué revisar en local.
