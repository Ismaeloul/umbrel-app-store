# Decisiones tomadas en modo autónomo

Cada entrada: qué decidí, qué alternativas había y por qué. Todas se pueden
revertir; si alguna no te convence, dímelo y la cambio.

## D1. Dónde trabajar: clon del repo de la tienda, rama `rewrite-v2`

- **Decisión**: clonar `Ismaeloul/umbrel-app-store` dentro de
  `Desktop\Actualización aceplayer\umbrel-app-store` y trabajar en la rama
  `rewrite-v2`, que sale de `origin/main` (0.6.59).
- **Alternativas**: (a) convertir en repo la copia sin git del escritorio;
  (b) trabajar en `C:\Users\Isma\umbrel-app-store`, que se quedó en la 0.6.7;
  (c) crear un repo nuevo en GitHub.
- **Por qué**: el hook `pre-start` descarga las releases de las etiquetas de
  ese repo y la tienda de Umbrel lee de él, así que la v2 tiene que vivir ahí
  para que el mecanismo de actualización siga funcionando. Crear un repo nuevo
  es publicar algo que no pediste. El otro checkout lo dejo como estaba.

## D2. El monorepo va en `ace-player-neo/`, no dentro de la carpeta de la app

- **Decisión**: `ace-player-neo/{apps,packages,docs}` en la raíz del repo.
  `ismaeloul-ace-player-neo/` sigue siendo solo el paquete de Umbrel, con la
  release ya compilada en `releases/0.7.0/`.
- **Alternativa**: meter `apps/` y `packages/` dentro de
  `ismaeloul-ace-player-neo/`, como sugiere el esquema del prompt.
- **Por qué**: al instalar, umbreld hace
  `rsync --archive <carpeta de la app>/. <APP_DATA_DIR>` (visto en
  `legacy-compat/app-script`). Con el monorepo dentro, el NAS recibiría el
  código fuente, la app de iOS y cientos de capturas. `saldo/` ya sigue este
  patrón en el mismo repo.

## D3. Despliegue en Umbrel: imagen oficial de Node + servidor empaquetado

- **Decisión**: la 0.7.0 sigue ejecutando el backend con la imagen oficial
  `node:24.19.0-alpine3.24` fijada por digest, montando `releases/0.7.0/`. El
  servidor TypeScript se compila con esbuild a **un solo** `server.js` con
  sus dependencias dentro, y la web se compila con Vite dentro de la misma
  release. El `Dockerfile` multi-stage (usuario no root, ffmpeg y
  healthcheck) existe, se construye en CI y lo usa el perfil `test` de
  `docker compose`, pero el compose de producción **no depende de él**.
- **Alternativa**: publicar la imagen en GHCR y apuntar el compose a ella.
- **Por qué**: un paquete nuevo de GHCR nace **privado**, y umbreld hace
  `docker pull` de cada imagen antes de arrancar y aborta si falla (lo
  comprobé en su código). Una imagen privada dejaría la app sin arrancar
  tras actualizar. Cuando hagas público el paquete, basta con cambiar una
  línea del compose; lo dejo explicado en `docs/plan.md`.

## D4. Acceso de la app de iOS: `/native/*` por el mismo puerto, blindado

- **Decisión**: `PROXY_AUTH_WHITELIST: "/native/*"` en `app_proxy`, de modo
  que la app de iOS entra por el 7792 (LAN o Tailscale) sin el login de
  Umbrel, y todo lo que cuelga de `/native/` exige el token del dispositivo.
- **Blindaje obligatorio** (lo vi en el código de la pasarela de umbreld):
  la pasarela decide con `new URL(url).pathname`, que resuelve `..` y
  `%2e%2e` pero **no** `%2f`, y reenvía la URL original. Así,
  `/native/..%2fapi/state` pasaría sin login y nginx, al normalizar, la
  mandaría a `/api/`. Por eso: (1) nginx rechaza con 400 cualquier URI con
  `%2f`, `%2e`, `%5c` o `..`; (2) el origen (nativo o web) se calcula con un
  `map` sobre `$request_uri` y viaja siempre en `X-Ace-Origin`, sobrescribiendo
  lo que mande el cliente; (3) el backend exige token si el origen es nativo,
  sea cual sea la ruta. Hay tests de las tres cosas.
- **Alternativa**: publicar otro puerto solo para la app. Es otra puerta
  abierta en la LAN y otra regla de firewall que recordar; la lista blanca
  reutiliza el mismo puerto que ya usas por Tailscale.

## D5. Sesiones del motor: el backend es el dueño; se comparten por HLS

Probado contra el motor real (`docs/analisis/motor-real.md`):
- pedir otra sesión del mismo contenido **mata la anterior** (403);
- una sesión **HLS** la pueden leer varios clientes a la vez;
- una sesión **progresiva** (la de mpegts.js) solo admite un consumidor;
- ffmpeg puede hacer el remux de iOS leyendo el HLS del motor.

**Decisión**:
1. Ningún cliente vuelve a pedir sesiones al motor: las abre, guarda,
   comparte y cierra el backend (`SessionManager`), **una por contenido**.
   Cada espectador manda un latido; sin latido en 45 s se le da por ido y,
   sin espectadores, se hace `stop` de la sesión. Se acabaron las sesiones
   zombi.
2. Con **un solo espectador** se mantiene lo que ya funciona: escritorio y
   Android por progresivo + mpegts.js (menos retraso respecto al directo);
   iPhone por remux fMP4.
3. Si se une un **segundo dispositivo al mismo canal**, el backend pasa la
   sesión a HLS: abre la sesión HLS, avisa por SSE al primer espectador (que
   se reengancha solo con hls.js) y el remux de iOS pasa a leer ese HLS. Así
   los dos ven el canal sin pisarse.
4. Con **canales distintos** en dos dispositivos se conserva el traspaso de
   la 0.6.5 (el último que da al play se queda el mando y el otro se para
   con aviso), porque no he podido demostrar que el motor aguante dos
   canales a la vez (la prueba no fue concluyente). Queda anotado en
   `docs/dudas.md`.
- **Choque con el CHANGELOG**: el traspaso de la 0.6.5 echaba al otro
  dispositivo **aunque viera el mismo canal**. El prompt pide compartir la
  sesión, así que en ese caso concreto cambio el comportamiento. Es la
  decisión que más conviene que revises.

## D6. HEVC: el veredicto de una fuente depende del cliente

- **Decisión**: el comprobador sigue marcando una fuente HEVC como
  `unsupported_codec` para la **web** (igual que hoy: mpegts.js no garantiza
  HEVC), pero el veredicto lleva `playableOn: { web, ios }` y en **iOS** esa
  fuente cuenta como reproducible, porque el remux la pasa a fMP4 sin
  transcodificar (desde la 0.6.6).
- **Alternativas**: dejarlo como hoy (el iPhone pierde fuentes que sí puede
  ver) o darla por buena en todos lados (la web intentaría reproducir algo que
  quizá no puede).
- **Por qué**: no cambia nada de lo que ve la web y le da al iPhone fuentes
  que hoy se le esconden sin motivo.

## D7. "Abrir en reproductor externo" es una función nueva, no un hueco

- **Decisión**: el inventario del prompt la cita, pero la 0.6.59 no la tiene
  (solo copia el hash, el enlace `acestream://` o el nombre). En la v2 se
  añade un menú "Abrir en…" con el enlace `acestream://` (lo abre la app de
  AceStream si está instalada) y "Copiar URL del stream" para VLC, además de
  las tres copias de siempre.
- **Por qué**: no quita nada y cumple el inventario. No se usa `vlc://`
  porque no está bien soportado en iOS ni en escritorio.
