# Publicar la 0.7.0 en el Umbrel (y volver atrás si algo falla)

La release 0.7.0 está cortada en la rama `rewrite-v2` y **no se ha publicado
nada**: `main`, las etiquetas y el Umbrel siguen en la 0.6.59. Publicar es
decisión de Isma. Este documento cuenta cómo hacerlo, qué pasa durante la
actualización, cómo comprobar que ha ido bien, cómo volver a la 0.6.59 y qué
queda pendiente de hacer a mano.

Referencias: `analisis/empaquetado.md` §7.7-§7.8 (actualización y vuelta
atrás), `arquitectura.md` §11 y `deploy/README.md`.

## 1. Qué hay en la rama

En `ismaeloul-ace-player-neo/` (lo único que llega al Umbrel):

| Ruta | Qué es |
|---|---|
| `umbrel-app.yml` | `version: "0.7.0"` y las notas de la versión. `id`, puerto 7792 y categoría, sin cambios. |
| `docker-compose.yml` | La plantilla `deploy/umbrel/docker-compose.yml` tal cual: `/releases/0.7.0/`, `PROXY_AUTH_WHITELIST: "/native/*"`, `ACE_SEED`, mismas imágenes por digest y mismos límites que la 0.6.59. |
| `hooks/pre-start` | El hook de la 0.7.0 (modo 100755, LF): restaura `releases/0.7.0` y la verifica con `SHA256SUMS`. |
| `releases/0.7.0/` | 81 ficheros, 5,5 MB: `server.js`, `engine-control.js`, `nginx.conf`, `web/`, `SHA256SUMS` y `RELEASE.json` (con el commit de las fuentes). Sin mapas de fuentes. |
| `releases/0.6.59/` | Intacta: es la base de la vuelta atrás. Las 0.6.1-0.6.58 siguen también (se retiran aparte, ver §7). |
| `monitoring/` | El vigilante corregido (§5). **No llega al NAS solo.** |
| `tests/release.test.js` | Coherencia del paquete que se publica. |
| `tests/legacy-0.6.59/` | Los 133 tests de la 0.6.59, siempre contra `releases/0.6.59`, y en `paquete/` el Compose y el hook de la 0.6.59 byte a byte. |

La CI lo vigila en cada push:

- `ci.yml`, job *Build, tamaño y humo*: `pnpm check:release` monta la release
  otra vez desde el código y la compara con la commiteada.
- `ace-player-neo.yml`: `tests/release.test.js`, los tests de la 0.6.59 y que
  `releases/0.6.59` y `paquete/` siguen siendo los del commit `22de271` (el que
  publicó la 0.6.59).

**La release se monta en Linux**, con `corepack pnpm@10.18.2 release:docker`
(desde `ace-player-neo/`, con Docker): clona HEAD dentro de la imagen de Node
de producción, compila y copia `releases/0.7.0` a la carpeta de la app. En
Windows, lightningcss redondea distinto algunos colores del CSS y el
`index-*.css` sale con otro hash, así que la referencia es la de Linux, la
misma que monta la CI. Para comprobarla desde Windows:
`corepack pnpm@10.18.2 check:release:docker`.

**Si alguien toca las fuentes** (`apps/server`, `apps/web`, `packages`,
`deploy/umbrel`, `scripts`, `package.json` o el lockfile), aunque sea un test,
`check:release` falla hasta que se vuelva a montar y commitear:
`RELEASE.json` lleva el último commit de las fuentes. Así lo que se publica es
siempre lo que dice el código.

## 2. Publicar

### Antes (recomendado)

1. Comprobar que la CI de `rewrite-v2` está en verde:
   `gh run list -R Ismaeloul/umbrel-app-store --branch rewrite-v2 --limit 10`.
2. Tener preparada la rama `rollback/0.7.1` (§6.1). Si la 0.7.0 falla, volver
   atrás es entonces un merge y una actualización.
3. Opcional: crear la etiqueta `ace-player-neo-v0.6.59` en `22de271` y las demás
   que faltan (empaquetado §7.9). La 0.7.0 no las necesita, pero dejan la
   historia completa antes de retirar releases viejas de `main`.

### Merge y etiqueta, a la vez

Con un **merge commit** o un avance rápido, nunca con *squash* ni *rebase*.
`RELEASE.json` lleva el SHA del último commit que tocó las fuentes: con squash o
rebase ese SHA no estaría en la historia de `main` y `check:release` fallaría en
`main`.

Desde un clon con `main` al día:

```bash
git fetch origin
git switch main
git pull --ff-only origin main
git merge --no-ff origin/rewrite-v2 -m "Ace Player Neo 0.7.0: reescritura completa (web nueva, sesiones compartidas, vigilante del motor y app de iPhone)"
git tag -a ace-player-neo-v0.7.0 -m "Ace Player Neo 0.7.0"
git push --atomic origin main ace-player-neo-v0.7.0   # rama y etiqueta en la misma operación
```

Con un PR de GitHub vale igual, siempre que se use *Create a merge commit*. La
etiqueta se crea sobre el commit de merge y se sube en cuanto termina, antes de
tocar el Umbrel:
`git fetch origin && git tag -a ace-player-neo-v0.7.0 -m "Ace Player Neo 0.7.0" origin/main && git push origin ace-player-neo-v0.7.0`.

La etiqueta es la segunda fuente del hook: si el Umbrel no tuviera la release
en su copia de la tienda, la bajaría de ahí antes que de `main`.

### En el Umbrel

1. **Que vea la versión nueva.** La tienda comunitaria se actualiza sola cada
   pocos minutos. Para forzarlo:
   ```bash
   ssh umbrel@<ip-del-umbrel> "umbreld client appStore.registry.query"
   ```
   Para comprobar que la copia de la tienda ya tiene el merge:
   `ssh umbrel@<ip-del-umbrel> 'for d in ~/umbrel/app-stores/*/; do git -C "$d" log -1 --oneline; done'`.
2. **Actualizar** desde la interfaz de Umbrel: en la ficha de Ace Player Neo,
   *Actualizar*. También se puede por SSH:
   `umbreld client apps.update.mutate --appId ismaeloul-ace-player-neo`.
   Si falla justo después del pull de la tienda (a veces se cruzan), esperar
   unos 20 s y repetir.

## 3. Qué pasa durante la actualización

1. umbreld copia `docker-compose.yml`, `hooks/` y `umbrel-app.yml` a los datos
   de la app. **No** copia `releases/` ni `monitoring/`. Luego descarga las
   imágenes: son los mismos digests que en la 0.6.59, así que no baja nada nuevo.
2. **Hook `pre-start` de la 0.7.0.** Saca la versión de Compose (0.7.0). Si el
   manifiesto dijera otra, solo avisa. Como `releases/0.7.0` no existe en los
   datos de la app, la restaura, por este orden:
   1. de la copia de la tienda que tiene el Umbrel (`SCRIPT_APP_REPO_DIR`), sin
      red. Es el caso normal;
   2. si no, de la etiqueta `ace-player-neo-v0.7.0`;
   3. si no, de `main`.

   La copia se hace en una carpeta aparte, se verifica entera con
   `sha256sum --check` y solo entonces se renombra a `releases/0.7.0`. Después
   ajusta los permisos para nginx y deja `.complete`. Lo que escribe
   (`Ace Player Neo 0.7.0: release restaurada desde la tienda local`) va al
   registro de umbreld.
3. Compose recrea `engine_control`, `storage` y `nginx`. Los dos motores
   AceStream no cambian de definición y no se tocan.
4. **Primer arranque de `server.js`.** Instala ffmpeg (desde `apk-cache`, con 60 s
   de plazo) y carga el estado:
   - guarda `data/state.pre-0.7.0.json`, una copia intocable del `state.json`
     de la 0.6.59, que nunca se sobrescribe;
   - migra `state.json` del esquema 1 al 2 **sin quitar nada** (la 0.6.59 lo
     sigue pudiendo leer);
   - crea `data/v2/` (dispositivos, sesiones y ajustes nuevos).

   Cuando `/api/v1/health/live` responde, Docker da `storage` por sano y
   arranca nginx.
5. **Primera carga de la web.** El `index.html` va sin caché y el service worker
   de la 0.6.59 pide la página a la red primero, así que la web nueva sale a la
   primera. El `sw.js` nuevo (`aceneo-0.7.0`) se instala y borra la caché
   `aceneo-0.6.59`. Si la app instalada en el móvil enseñara la versión vieja,
   basta con cerrarla y volver a abrirla.
6. `releases/0.6.59` se queda en los datos de la app. El hook la borra cuando
   su carpeta pasa de 30 días.

## 4. Comprobar que ha ido bien

En la web:

- sale el diseño nuevo y están los favoritos, los recientes y las listas;
- **Ajustes → Salud**: backend, motor y comprobador en verde;
- un canal se reproduce, con *Motor en línea* abajo a la izquierda y los datos
  técnicos llenándose;
- el mismo canal en otro dispositivo: los dos lo ven y ninguno se corta.

Por SSH (solo lectura):

```bash
ssh umbrel@<ip-del-umbrel>
cd ~/umbrel/app-data/ismaeloul-ace-player-neo
grep '^version' umbrel-app.yml                               # version: "0.7.0"
ls releases/0.7.0/.complete data/state.pre-0.7.0.json data/v2
(cd releases/0.7.0 && sha256sum --check --strict --quiet SHA256SUMS && echo "release íntegra")
curl -s http://127.0.0.1:7792/native/api/v1/ping             # {"ok":true,"app":"ace-player-neo","version":"0.7.0",…}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:7792/api/health   # redirección o 401: pide login, correcto
```

Y el vigilante, una vez reinstalado (§5):
`cat ~/.local/state/ismaeloul-ace-player-neo-monitor/status.json` con
`"appProxy":"ok:200"`.

**Probado en local** antes de cortar la rama (23-09):

- el hook de la 0.7.0 sobre unos datos de app falsos con la 0.6.59, con la
  carpeta de la app como copia de la tienda: restaura `releases/0.7.0`, deja
  `.complete` y `sha256sum --check` pasa;
- la release real de la carpeta de la app, montada tal cual en la pila de
  `deploy/local` (pasarela falsa y motor falso) con un `state.json` de la 0.6.x:
  migración con `state.pre-0.7.0.json`, `/api/health` y ping correctos,
  blindaje de `/native/`, la web en Chrome sin errores de consola, un favorito
  migrado reproduciéndose y la sesión cerrada al soltarla;
- el vigilante nuevo contra esa pila: `ok:200` con todo arriba, `failed:502`
  con nginx parado y `failed:running-0.7.0` si el manifiesto dice otra versión;
- los pasos de §6.1 en una copia de la carpeta: 133/133 tests de la 0.6.59
  contra la 0.7.1, y el hook de la 0.6.59 la restaura desde la tienda.

## 5. El vigilante (`monitoring/`): hay que reinstalarlo a mano

`monitoring/` **no llega al NAS con las actualizaciones**: umbreld solo copia
Compose, `hooks/`, el manifiesto y poco más (empaquetado U5 y D4). Además el
vigilante no vive en los datos de la app, sino en `~/.local/bin` y en las
unidades de systemd del usuario. Así que **cada cambio en `monitoring/` hay que
instalarlo a mano**, y lo que corre en el NAS es lo último que se instaló.

**Qué cambia en la 0.7.0** (empaquetado D3: el de antes mentía):

| Clave | Antes | Ahora |
|---|---|---|
| `appProxy` | `GET /` sin sesión: la pasarela redirige al login aunque nginx o el backend estén caídos, así que salía `ok` siempre | `GET /native/api/v1/ping`, la única ruta sin login (lista blanca de la pasarela) que contesta el backend sin token. `ok:200` solo si responde el JSON de la app con la versión del manifiesto. Si no: `failed:<código>`, `failed:not-ace-player-neo` o `failed:running-<versión>` |
| `scanner` | `GET /api/health` sin sesión: pide login, así que salía `failed` siempre | `unknown`, que no cuenta como fallo. Su estado solo se ve con login, en **Ajustes → Salud** |
| `appState`, `aceStream`, `ollama` | igual | igual |

El formato de `status.json` y de `health.log` no cambia.

**Instalarlo después de actualizar a la 0.7.0.** Antes, con la 0.6.59, el ping no
existe y daría `failed`. Desde la copia de la tienda que tiene el Umbrel:

```bash
ssh umbrel@<ip-del-umbrel>
SRC=$(ls -d ~/umbrel/app-stores/*/ismaeloul-ace-player-neo/monitoring | head -n 1)
install -D -m 755 "$SRC/ace-player-neo-healthcheck"         ~/.local/bin/ace-player-neo-healthcheck
install -D -m 644 "$SRC/ace-player-neo-healthcheck.service" ~/.config/systemd/user/ace-player-neo-healthcheck.service
install -D -m 644 "$SRC/ace-player-neo-healthcheck.timer"   ~/.config/systemd/user/ace-player-neo-healthcheck.timer
systemctl --user daemon-reload
systemctl --user enable --now ace-player-neo-healthcheck.timer
~/.local/bin/ace-player-neo-healthcheck; cat ~/.local/state/ismaeloul-ace-player-neo-monitor/status.json
systemctl --user list-timers | grep ace-player-neo          # siguiente pasada en menos de 5 min
```

Lo esperado en el NAS: `appProxy` `ok:200`, `appState` `ok`, `aceStream` `ok`
(el puerto 8621 sí está publicado), `scanner` `unknown` y `ollama` como antes.

## 6. Volver atrás a la 0.6.59

Umbrel no ofrece bajar de versión, así que se vuelve atrás **avanzando**: una
**0.7.1 que es la 0.6.59 re-empaquetada**, con su Compose, su hook y su release,
y el número cambiado en los tres sitios que lo llevan. Conviene prepararla
antes de publicar la 0.7.0 y dejarla sin publicar. Esta rama **no está creada**.

### 6.1 Preparar la rama `rollback/0.7.1`

En Git Bash o Linux, desde la raíz del repo. `paquete/` es copia exacta del
Compose y del hook de la 0.6.59 (la CI lo comprueba contra `22de271`):

```bash
git fetch origin
git switch -c rollback/0.7.1 origin/main          # main ya con la 0.7.0
APP=ismaeloul-ace-player-neo
PKG=$APP/tests/legacy-0.6.59/paquete

# 1. Compose y hook de la 0.6.59, apuntando a releases/0.7.1
sed 's#/releases/0\.6\.59/#/releases/0.7.1/#g' "$PKG/docker-compose.yml" > "$APP/docker-compose.yml"
cp "$PKG/hooks/pre-start" "$APP/hooks/pre-start"
git add --chmod=+x "$APP/hooks/pre-start"

# 2. La release: la 0.6.59 con otro número (APP_VERSION, User-Agent y el SW)
cp -r "$APP/releases/0.6.59" "$APP/releases/0.7.1"
sed -i 's/^const APP_VERSION = "0\.6\.59";$/const APP_VERSION = "0.7.1";/; s#"User-Agent": "AcePlayerNeo/0\.6\.59"#"User-Agent": "AcePlayerNeo/0.7.1"#' "$APP/releases/0.7.1/server.js"
sed -i 's/^const VERSION = "aceneo-0\.6\.59";$/const VERSION = "aceneo-0.7.1";/' "$APP/releases/0.7.1/sw.js"
grep -rn '0\.6\.59' "$APP/releases/0.7.1" || echo "sin restos de 0.6.59"
diff -r "$APP/releases/0.6.59" "$APP/releases/0.7.1" | grep -c '^[<>]'   # 6: tres líneas fuera y tres dentro

# 3. Manifiesto 0.7.1 (y sus notas, a mano) y entrada 0.7.1 en el CHANGELOG
sed -i 's/^version: "0\.7\.0"$/version: "0.7.1"/' "$APP/umbrel-app.yml"

# 4. Tests: el de coherencia es de la 0.7.0; los de la 0.6.59 se lanzan contra la 0.7.1
git rm "$APP/tests/release.test.js"
ACE_LEGACY_VERSION=0.7.1 ACE_LEGACY_PACKAGE_DIR=$APP AUTO_SYNC=false \
  node --test $APP/tests/legacy-0.6.59/server.test.js $APP/tests/legacy-0.6.59/player-controller.test.js
```

En `.github/workflows/ace-player-neo.yml`, cambiar el paso *Coherencia del
paquete de Umbrel* por el `node --test` de arriba, con las dos variables. Luego:

```bash
git add "$APP" .github/workflows/ace-player-neo.yml
git commit -m "Ace Player Neo 0.7.1: vuelta a la 0.6.59"
git push origin rollback/0.7.1
```

Notas de ejemplo para la 0.7.1: *Vuelta a la version 0.6.59 mientras se arregla
un problema de la 0.7.0. Tus favoritos, recientes y listas se conservan. La web
vuelve a ser la de antes y la app de iPhone deja de funcionar hasta la proxima
version.*

`releases/0.7.0` se queda en la rama. No estorba, `check:release` la sigue
comprobando y sirve de base para el siguiente intento.

### 6.2 Publicarla

Lo mismo que en §2: merge de `rollback/0.7.1` en `main` (merge commit),
etiqueta `ace-player-neo-v0.7.1` en la misma operación
(`git push --atomic origin main ace-player-neo-v0.7.1`), forzar el pull de la
tienda y *Actualizar*.

Qué pasa entonces:

- el hook de la 0.6.59 comprueba que manifiesto y Compose dicen 0.7.1 y restaura
  `releases/0.7.1` desde la copia de la tienda;
- nginx vuelve a servir la web de la 0.6.59 y el SW `aceneo-0.7.1` borra las
  cachés de la 0.7.0;
- el backend de la 0.6.59 lee el `state.json` que dejó la 0.7.0 (hay un test que
  lo comprueba) e ignora `data/v2/`;
- **la app de iPhone deja de funcionar** (la 0.6.59 no tiene `/native/`). Los
  emparejamientos se quedan en `data/v2/` y vuelven a valer en la 0.7.2;
- el vigilante nuevo daría `appProxy: failed` (no hay ping). Mientras dure la
  vuelta atrás, se para con
  `systemctl --user disable --now ace-player-neo-healthcheck.timer`.

### 6.3 Si hubiera que recuperar los datos de antes

Solo si la 0.6.59 no enseñara bien los datos. Se pierde lo que se cambió
estando en la 0.7.0. `data/` es de root (la crea Docker), así que hace falta
`sudo`:

```bash
ssh umbrel@<ip-del-umbrel>
umbreld client apps.stop.mutate --appId ismaeloul-ace-player-neo   # o Detener desde la interfaz
cd ~/umbrel/app-data/ismaeloul-ace-player-neo/data
sudo cp state.json state.json.desde-0.7.0
sudo cp state.pre-0.7.0.json state.json
umbreld client apps.start.mutate --appId ismaeloul-ace-player-neo
```

### 6.4 El siguiente intento: 0.7.2, nunca otra vez 0.7.0

Cada publicación lleva un número nuevo. Si se volviera a publicar una 0.7.0 con
otro contenido, el NAS no la recibiría: ya tiene `releases/0.7.0` con su
`.complete` y un `SHA256SUMS` que cuadra con lo viejo, así que el hook la daría
por buena.

## 7. Lo que tiene que hacer Isma

1. Revisar las notas de la versión (`umbrel-app.yml`, también en el
   `CHANGELOG.md` con fecha del 23-09; cámbiala si se publica otro día) y dar
   el OK.
2. Recomendado: preparar `rollback/0.7.1` (§6.1) y, si quiere, las etiquetas que
   faltan (§2).
3. Merge de `rewrite-v2` en `main` con merge commit y subir
   `ace-player-neo-v0.7.0` en la misma operación (§2).
4. Forzar el pull de la tienda si no aparece la 0.7.0 y *Actualizar* desde la
   interfaz de Umbrel.
5. Comprobar (§4).
6. **Reinstalar el vigilante** (§5). Es lo único que no llega solo.
7. **Emparejar el iPhone.** Instalar la IPA (artefacto `AceNeo-unsigned-…` de
   `ios.yml`, firmada con IPA Station) y en la web **Ajustes → Dispositivos →
   Emparejar un dispositivo**: código de 6 dígitos o QR, válidos 5 minutos.
   Qué dirección usar (Tailscale o la LAN): `docs/acceso-remoto.md`.
8. Decidir si quiere **"Un solo dispositivo a la vez"** (Ajustes). Por defecto,
   dos dispositivos con el mismo canal lo comparten (D5).
9. Más adelante: retirar `releases/0.6.1`-`0.6.58` de `main` después de
   etiquetarlas (empaquetado §7.9), y `releases/0.6.59` cuando la 0.7.x lleve un
   tiempo estable. Pasar a la imagen de GHCR (D3/D9) es decisión suya.
