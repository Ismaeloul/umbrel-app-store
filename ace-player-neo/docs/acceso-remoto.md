# Acceso desde el iPhone: Tailscale, la LAN, el dominio y por qué no Cloudflare Tunnel

La app iOS habla con el Umbrel por la ruta **`/native/`** del mismo puerto que
la web (**7792**). Esa ruta está en la lista blanca de la pasarela de Umbrel
(`PROXY_AUTH_WHITELIST: "/native/*"`), así que **no pide el login de Umbrel**:
la protege el token del dispositivo que se consigue al emparejar. Cómo está
montado: [`arquitectura.md` §5.12, §7.3 y §8](arquitectura.md) y decisión D4
en [`decisiones.md`](decisiones.md).

En la app se pueden guardar **varias direcciones a la vez** (la de Tailscale, la
de casa y, si hay dominio, `https://tv.ismaeloul.es`: ver «Por el dominio»). La
app hace ping a todas, usa la primera que responde (mejor la de casa o la de
Tailscale que el dominio) y vuelve a elegir cuando el teléfono cambia de red.

## Opción recomendada: Tailscale

Es la forma buena de ver la tele fuera de casa: el tráfico va cifrado de punta
a punta (WireGuard), casi siempre directo entre el iPhone y el Umbrel (sin
pasar por servidores de terceros) y sin abrir nada en el router.

1. En el Umbrel: instala la app **Tailscale** de la tienda de Umbrel e inicia
   sesión con tu cuenta.
2. En el iPhone: instala **Tailscale** del App Store, entra con **la misma
   cuenta** y activa la VPN.
3. En la consola de Tailscale (o en la app del iPhone) mira el nombre del
   Umbrel. La dirección para Ace Neo es una de estas:
   - `http://<nombre>.<tu-tailnet>.ts.net:7792` (nombre MagicDNS completo, por
     ejemplo `http://umbrel.tail1234.ts.net:7792`);
   - `http://<nombre>:7792` (nombre corto, si tienes MagicDNS activado);
   - `http://100.x.y.z:7792` (la IP de Tailscale del Umbrel, siempre en el
     rango `100.64.0.0/10`).
4. Emparejar: en la web, **Ajustes → Dispositivos → Emparejar un
   dispositivo**; en la app, escanea el QR o escribe esa dirección y el código
   de 6 dígitos (vale 5 minutos y una sola vez).

Notas:

- Es `http://`, no `https://`, y no pasa nada: el túnel de Tailscale ya cifra
  todo. La app tiene permitido `http://` **solo** para `*.ts.net`, las IP de
  Tailscale y las IP privadas de casa (ATS, ver
  [`apps/ios/README.md`](../apps/ios/README.md)); una IP pública por `http://`
  la bloquea iOS.
- Si iOS rechazara la IP `100.x` (pendiente de comprobar en un iPhone real),
  usa el nombre `.ts.net`.
- Con la VPN de Tailscale apagada en el iPhone, la dirección de Tailscale no
  responde y la app pasa sola a la de casa (si estás en casa).

## En casa: la LAN

Sin instalar nada: el iPhone en la misma Wi-Fi que el Umbrel.

- `http://umbrel.local:7792` (el nombre que anuncia el Umbrel por mDNS), o
- `http://<IP del Umbrel en casa>:7792`, una IP privada del estilo
  `192.168.x.y` o `10.x.y.z` (la ves en el router o en los ajustes de Umbrel).

Aquí el tráfico **no** va cifrado: el token y el vídeo viajan en claro por la
Wi-Fi de casa. Es un riesgo aceptado dentro de casa (arquitectura §10.2); en
una Wi-Fi que no controles, usa Tailscale.

## Qué protege el token y qué no

**Protege:**

- Todo lo que entra por `/native/` necesita `Authorization: Bearer <token>`,
  salvo dos rutas: `GET /native/api/v1/ping` (dice que hay un Ace Player Neo) y
  `POST /native/api/v1/pairing/claim` (canjear un código). Sin token o con uno
  revocado: **401**.
- Por `/native/` no se llega a las rutas antiguas (`/api/*`): responden 403
  con o sin token. Y nginx tira las rutas trucadas (`%2f`, `%2e`, `%5c`, `..`)
  antes de que lleguen a nada, para que `/native/..%2fapi/…` no se cuele sin
  login (arquitectura §8).
- Un dispositivo emparejado puede hacer lo mismo que la app (agenda, canales,
  reproducir, favoritos, ajustes de `/api/v1`), pero **no** puede crear
  códigos de emparejamiento, ver la lista de dispositivos ni revocar: eso es
  solo de la web, detrás del login de Umbrel.
- El token es un secreto de 256 bits; el servidor solo guarda su `sha256`
  (`data/v2/devices.json`) y en el iPhone vive en el **Llavero**.
- El código de emparejamiento: 6 dígitos, 5 minutos, un solo uso, 5 intentos
  por código y 10 por minuto en total.
- Las URLs de vídeo (AVPlayer no puede poner cabeceras) van **firmadas** con
  HMAC, llevan el dispositivo dentro, hay que empezar a usarlas en 60 s y
  tienen un tope de 6 h. Al revocar el dispositivo dejan de valer al momento.

**No protege:**

- **El tráfico por la LAN**: por `http://` en casa, quien espíe la Wi-Fi puede
  copiar el token o una URL de vídeo. Por Tailscale no pasa: va cifrado.
- **Una URL de vídeo copiada**: mientras su sesión siga viva (y como mucho
  6 h), funciona para quien la tenga. No la compartas.
- **Un iPhone desbloqueado en otras manos**: la app ya está emparejada.
  Revócalo (abajo).
- **La web**: la protege el login de Umbrel, no el token.
- **Un `APP_SEED` filtrado**: de él salen las claves de las URLs de vídeo y del
  emparejamiento (riesgo R-3 de [`seguridad.md`](seguridad.md)).
- **Exponer el puerto 7792 a internet** (abrirlo en el router o publicarlo con
  un túnel): la ruta `/native/` quedaría a la vista de todo el mundo con el
  token como única barrera. No se hace. Para fuera de casa, Tailscale o el
  dominio (abajo), que NO es abrir el 7792: va por Caddy, con lista blanca,
  permiso por aparato, bloqueos y límites.

## Por qué el vídeo no debe pasar por Cloudflare Tunnel

Cloudflare Tunnel sirve bien para abrir la web de una app al exterior, pero no
para mandar la tele del Umbrel al iPhone:

1. **Condiciones de uso.** Las condiciones de Cloudflare no permiten usar su
   red (CDN, y Tunnel va por ella) para servir vídeo o una parte
   desproporcionada de ficheros grandes salvo con sus productos de pago
   pensados para eso (Stream, R2…). Un flujo de varios Mbit/s durante horas
   es justo eso: se arriesga a que limiten o suspendan la cuenta, y con ella
   todo lo demás que se tenga publicado por el túnel.
2. **Latencia.** Cada segmento hace iPhone → centro de datos de Cloudflare →
   túnel → Umbrel y vuelta. Tailscale suele ir directo entre los dos equipos:
   menos saltos, arranque del canal más rápido y menos parones.
3. **Conexiones largas que se cortan.** Cloudflare corta una petición si el
   origen tarda más de ~100 s en responder, cierra conexiones inactivas y
   reinicia las del túnel cuando actualiza `cloudflared` o su red. El
   reproductor vive de conexiones largas (el flujo continuo de vídeo y los
   eventos en tiempo real por SSE): se notarían cortes y reconexiones.
4. **Ancho de banda.** Todo el vídeo sale por la subida de casa y da la vuelta
   por Cloudflare; con Tailscale también sale por la subida de casa, pero sin
   intermediarios que lo limiten o lo midan.
5. **Seguridad.** Publicar `/native/` en internet deja el token como única
   protección (ver arriba); con Tailscale solo llegan tus propios equipos.

Para usar la app fuera sin Tailscale está el dominio propio (abajo): va directo
del iPhone al NAS por la conexión de casa, sin intermediarios que midan o corten
el vídeo.

## Por el dominio: `https://tv.ismaeloul.es` (sin VPN)

Para ver la tele fuera de casa cuando Tailscale va a trompicones. El iPhone
habla con **`https://tv.ismaeloul.es`** (TLS 1.3, certificado propio de Let's
Encrypt) y por ahí entra **solo la app**, con su token y con un permiso que se
da aparato por aparato desde la web. `sala.ismaeloul.es` no cambia: sigue
siendo solo de las salas de «Ver juntos».

### Cómo va una petición

```
iPhone (4G) --TLS 1.3, SNI tv.ismaeloul.es--> 82.65.65.99:443 (Freebox)
  --> NAS:8443 (servicio sala, Caddy: sitio caddy/tv-on.caddy)
        ruta rara (%2f %2e %5c .. \ //)                         -> 400
        borra X-Ace-*, X-Forwarded-*, Forwarded y X-Real-IP del cliente
        lista blanca exacta de /native/api/v1 + Authorization con forma
        de token, o el vídeo firmado con ?t=                     -> al backend
        todo lo demás                                            -> 404
  --> storage:3002 (un SEGUNDO puerto del backend, que nginx no conoce y
      que no se publica)
        ¿la conexión viene de la IP del contenedor de Caddy?      si no, 403
        interruptor general, ruta permitida, token o URL firmada,
        permiso de fuera del aparato, bloqueo por IP y límites
```

La lista blanca sale de la tabla de rutas (`remote` en
`packages/shared/src/routes.ts`; `pnpm --filter @ace/shared caddy-tv` la escribe
en `deploy/umbrel/caddy/tv-on.caddy` y `deploy/test/caddy-native.test.ts` la
compara en los dos sentidos). El orden exacto de lo que mira el backend está en
`apps/server/src/core/remote-gate.ts`.

### Ponerlo en marcha

1. **DNS (DonDominio, a mano):** un registro **A** `tv` → `82.65.65.99` (la IP
   fija de Free). El comodín `*` de DonDominio va al aparcamiento: hace falta el
   registro propio. Se comprueba con `nslookup tv.ismaeloul.es`.
2. **Freebox:** nada. Ya manda el 443 de fuera al 8443 del NAS (lo usa la sala).
3. **Compose:** ya viene así (`NATIVE_SITE: "on"` y `NATIVE_DOMAIN` en `sala`;
   `ACE_EDGE_PORT`, `ACE_EDGE_PEER` y `NATIVE_PUBLIC_URL` en `storage`). Al
   arrancar, Caddy saca el certificado de `tv.ismaeloul.es` solo (TLS-ALPN en el
   mismo 8443) y lo guarda junto al de la sala.
4. **Emparejar desde casa** (o por Tailscale), como siempre. El QR lleva ahora
   una tercera dirección, `https://tv.ismaeloul.es`. Un iPhone ya emparejado se
   la puede añadir a mano o volver a emparejarse.
5. **Dar permiso:** en la web, **Ajustes → Dispositivos**, el interruptor
   «Acceso desde fuera de casa (tv.ismaeloul.es)» de ese aparato, con su
   caducidad (24 h, 7 días, 30 días —la propuesta— o sin caducidad). Apagado
   por defecto en todos.

**Antes de dar el visto bueno, medir y probar** (con el Caddy de verdad, como
la prueba de [`ver-juntos.md` §9](ver-juntos.md)):

- **Que Caddy acepta la configuración.** `caddy validate --config
  /releases/<v>/Caddyfile --adapter caddyfile` con `NATIVE_SITE=on`,
  `NATIVE_DOMAIN=tv.ismaeloul.es` y `PARTY_DOMAIN=sala.ismaeloul.es` en el
  entorno, con la imagen 2.11.7. Lo hace la CI (job `caddy` de
  `.github/workflows/ace-player-neo.yml`, con `NATIVE_SITE` en `on` y en `off`,
  la imagen del Compose); en el PC de desarrollo no hay Docker ni Caddy. Un
  error en `caddy/tv-on.caddy` tumba también la sala (es el mismo proceso): ya
  pasó con una barra invertida de menos en `@raro` (`\.` no es un escape de
  CEL), y `deploy/test/caddy-native.test.ts` ahora lee esa cadena como cel-go.
  Lo más delicado: la variable dentro del
  `import` (`caddy/tv-{$NATIVE_SITE:off}.caddy`), los `handle` con el
  fragmento `(tv_backend)`, `query t=*`, `max_size 512KiB` y los globales nuevos
  (`strict_sni_host`, `timeouts`, `max_header_size`), que tocan también a la sala.
- **Que la IP real llega.** Desde el 4G, abrir la app por el dominio y mirar en
  Ajustes → Dispositivos el «Último acceso desde fuera»: tiene que salir la IP
  del operador, no una `172.x` ni `192.168.1.254`. Si sale una de dentro (Docker
  con `userland-proxy` en el 8443, o el NAT de retorno de la Freebox al usar el
  dominio desde la Wi-Fi de casa), la web lo dice («La IP real no llega») y el
  backend NO bloquea por esa IP: solo quedan los límites por aparato.
- **Desde fuera**, con `curl`: `curl -sI https://tv.ismaeloul.es/` da 404 y sin
  `Server`; `curl -s -o /dev/null -w '%{http_code}' https://tv.ismaeloul.es/native/api/v1/ping`
  da 404 (sin token no se presenta); con un `Bearer` inventado con forma buena
  (`abcd.` y 43 `A`) también 404 vacío, sin `x-request-id` (el backend no se
  presenta mientras no hay un token bueno); con el token de un iPhone sin
  permiso da 403 `remote_forbidden`; `curl -sk --resolve sala.ismaeloul.es:443:82.65.65.99
  -H 'Host: tv.ismaeloul.es' https://sala.ismaeloul.es/` da 421 (`strict_sni_host`).
  Y la sala sigue igual (enlace de invitado, vídeo, chat).

### Qué protege

- **Dos cerraduras.** Caddy solo deja llegar la lista blanca de la app con un
  `Authorization` con forma de token (`Bearer <deviceId>.<secreto de 43>`) o el
  vídeo firmado; a un escáner solo le da un certificado y 404, sin huella de la
  app. Y el backend, aunque Caddy fallara, vuelve a mirarlo todo. **Sin huella
  tampoco en el backend:** mientras no hay un token bueno (o una URL firmada
  buena), cualquier error (token inventado, dominio cerrado, ruta prohibida,
  IP bloqueada, límite) sale como 404 sin cuerpo y sin cabeceras propias, igual
  que el de Caddy. El motivo de verdad queda en el registro de la web. El JSON
  de error solo lo ve un aparato emparejado.
- **Token y permiso por aparato.** Todas las rutas piden token por el dominio
  (también `ping`). Un aparato emparejado sin el permiso recibe 403
  `remote_forbidden` y en la web sale «Tu «iPhone X» intentó entrar desde fuera
  y no tiene permiso · Permitir». El permiso caduca, y quitarlo, que caduque,
  cerrar el dominio o revocar el aparato corta al momento lo que tenga abierto
  por el dominio: los eventos en tiempo real, una descarga de película a medias
  y el siguiente segmento de vídeo. Lo de casa sigue. Por el dominio un aparato
  solo se entera de los cambios de sí mismo (`devices.changed`), no de los ids
  ni de las altas de los demás.
- **Emparejar solo desde casa o Tailscale.** El canje del código por el dominio
  da 403 `pairing_local_only` por dentro, que fuera se ve como 404 vacío (Caddy
  ni lo deja pasar).
- **Nada de administrar desde fuera.** Crear códigos, ver la lista de aparatos,
  revocar otros, cambiar ajustes o directorios, las salas y todo lo que es solo
  de la web: 403 `remote_forbidden_route` por dentro (se mira antes que el
  token, así que fuera es el 404 vacío). «Olvidar este iPhone» sí vale (solo
  sobre sí mismo; sobre otro aparato, 403 en JSON, porque ya hay token bueno).
- **Bloqueo por fuerza bruta.** 8 respuestas 401/403/404 desde una IP en 10 min
  la bloquean 15 min (429 `remote_blocked` con `Retry-After`); cada reincidencia
  ×4 (1 h, 4 h, 16 h y 24 h de tope) y el nivel se olvida a los 7 días. Una IPv6
  cuenta por su /64. Los bloqueos sobreviven a un reinicio. **La llave buena
  pasa**: un token bueno entra aunque su IP esté bloqueada (las IPs de los
  móviles se comparten por CGNAT: así un ataque desde la misma red no te deja
  fuera); si no tiene permiso, le dice `remote_forbidden`, no el bloqueo. Lo
  que le pase a un aparato emparejado no cuenta como fallo (un permiso
  caducado no acaba bloqueando la IP de su dueño), ni los 429 de los límites,
  ni el `remote_disabled`.
- **Límites** (en el backend: la imagen de Caddy no trae `rate_limit`): API
  ráfaga 120 y 10/s por IP, 240 y 20/s por aparato; vídeo 200 y 30/s por IP,
  120 y 15/s por aparato; 8 SSE por IP y 4 por aparato (se cierra el más viejo;
  por IP es el doble para que dos aparatos tras la misma IP puedan reconectar);
  20 sesiones nuevas por IP y minuto. Cuerpos de 512 KiB como mucho (en Caddy y
  en el backend). Los cubos por IP solo los gasta quien no tiene permiso: un
  vecino de CGNAT con tokens inventados no deja sin cubo al iPhone con permiso
  (a ese solo le cuentan los suyos, por aparato).
- **El origen no se puede falsificar.** Que algo viene del dominio lo decide el
  puerto 3002, no una cabecera. Por el 7792 (nginx) `X-Ace-Via` y
  `X-Ace-Client-Ip` se ignoran y nginx las borra; ningún `proxy_pass` va al
  3002. Y el 3002 solo acepta conexiones de la IP del contenedor de Caddy (si no
  la resuelve, lo rechaza todo).
- **Interruptor general** y botón rojo **«Cerrar el dominio ya»** en Ajustes →
  Dispositivos: apagado, todo lo del dominio recibe 403 `remote_disabled` (por
  fuera, el 404 vacío de siempre: no se sabe si está cerrado o no existe).
- **Registro de accesos** en la web: último acceso e IP de cada aparato, IPs
  bloqueadas («Desbloquear»), sucesos (IP nueva, rechazos, bloqueos,
  caducidades) y un aviso arriba con los intentos bloqueados de las últimas
  24 h. Las IPs solo están ahí (`v2/remote-events.json` y
  `v2/remote-access.json`, 0600): ni en el registro del servidor ni en el de
  Caddy, ni en nada que vea un iPhone (el aviso por SSE, `remote.changed`, va
  sin datos y solo a la web). País: no, solo la IP (ver «Fase 2»). **El
  registro no se deja vaciar desde fuera:** los bloqueos de un mismo minuto
  pasados los 5 primeros van en un solo suceso («N IPs más bloqueadas»), los
  rechazos repetidos se juntan por /64 y lo que puede provocar cualquiera
  (bloqueos, rechazos, el par que no es Caddy) ocupa como mucho la mitad del
  anillo de 500 si hay de lo otro: un ataque no borra el «Entró desde una IP
  nueva» de un token robado. `remote-blocks.json` se escribe como mucho cada
  5 s y el aviso a la web, como mucho una vez por segundo.
- **Cabeceras duras:** HSTS, `nosniff`, `no-referrer`, `noindex, nofollow`,
  `X-Frame-Options: DENY`, `Cross-Origin-Resource-Policy`, CSP que no deja
  cargar nada y sin `Server`.
- **Volver atrás no rompe nada:** lo nuevo va en ficheros aparte
  (`v2/remote-*.json`); `devices.json` no cambia de forma y la 1.1.2 no los lee.

### Qué NO protege (dicho claro)

- **Tu nombre y la IP de casa quedan públicos y ligados.** La transparencia de
  certificados publica `tv.ismaeloul.es` en minutos y llegarán escáneres (solo
  verán 404). Un certificado comodín lo escondería, pero necesita el reto DNS de
  DonDominio, que la imagen estándar de Caddy no trae.
- **El SNI y el DNS** dicen a tu operador (y a quien mire la red) que el iPhone
  habla con `tv.ismaeloul.es`. El contenido va cifrado.
- **Un token robado de un aparato con permiso** entra desde cualquier sitio
  hasta que caduque o se revoque. Lo mitigan la caducidad, el aviso de IP nueva
  y revocar al momento. Atar el token al hardware (App Attest) queda para la
  fase 2.
- **Un ataque de muchas IPs** (botnet) puede saturar Caddy y la subida de casa
  antes de llegar al backend. «Cerrar el dominio ya» corta en el backend, pero
  Caddy sigue aceptando TLS. **Lo único que lo cierra del todo es quitar la
  redirección del 443 en la Freebox** (y con eso cae también la sala).
- **La CGNAT de los móviles**: el bloqueo por IP puede tocar a desconocidos que
  compartan IP y protege poco contra quien cambia de IP; por eso lo que más pesa
  son los límites por aparato y que la llave buena siempre pase.
- **La IP real puede no llegar** (arriba): entonces no hay bloqueo por IP.
- **Lo que se ve en casa**: un iPhone con permiso ve por SSE y en `playback`
  qué se está viendo en casa (R-2). Si se pierde, revócalo.
- **Un fallo de Caddy 2.11.7** queda expuesto a internet (ya pasaba con la
  sala). El contenedor es de solo lectura y no tiene secretos.
- **R-1 y R-3 siguen** ([`seguridad.md`](seguridad.md)): otro contenedor del NAS
  entra como web por el 3000 (el 3002 no lo arregla ni lo empeora), y un
  `APP_SEED` filtrado permite firmar URLs de vídeo (por el dominio, solo para
  aparatos con permiso).

### Cerrar o revocar

- **Un aparato:** su interruptor en Ajustes → Dispositivos (al momento) o
  «Revocar» (borra también su permiso).
- **Todo el dominio:** «Cerrar el dominio ya». Para que ni siquiera responda
  Caddy: `NATIVE_SITE: "off"` en el Compose (el sitio deja de existir) o quitar
  la redirección en la Freebox.
- **Una IP bloqueada por error** (la tuya tras teclear mal): «Desbloquear».

### Fase 2 (no está hecho)

- **Calidad ligera por el dominio** para los datos móviles, solo en Películas y
  series (la del directo no existe): un ajuste por aparato «Datos móviles:
  original / ligera / automática». Exige ampliar los ficheros del vídeo
  (`lo_index…`, `lo_init.mp4`) en `VideoParamsSchema` y en `@video`. Hoy
  `ACE_NATIVE_LITE: "0"` y el campo `quality` de `remote-access.json` existen
  pero no hacen nada.
- **País de cada IP** sin servicios de terceros: la base `dbip-country-lite`
  (CC-BY, unos 6 MB) dentro de la release, con su fecha a la vista.
- **App Attest / DeviceCheck** para atar el token al iPhone.
- Una tercera capa entre Caddy y el backend: un secreto aleatorio en un
  volumen que Caddy monte de solo lectura (no el `APP_SEED`: daría al
  contenedor expuesto lo necesario para firmar URLs de vídeo).

## Revocar un dispositivo

1. En la web: **Ajustes → Dispositivos**. Salen todos los emparejados con su
   nombre y la última vez que se conectaron.
2. **Revocar el acceso** en el que sobre (un iPhone perdido, vendido o que ya
   no uses).

Al momento: se cierran sus eventos en tiempo real, sus URLs de vídeo dejan de
valer, sus peticiones reciben **401** y la app borra el token y vuelve a la
pantalla de emparejar. Para volver a usarlo, se empareja de nuevo con un
código nuevo.

Si sospechas que se ha filtrado el `APP_SEED` del Umbrel: con él se pueden
firmar URLs de vídeo, pero solo para un dispositivo **no revocado**. Revoca
todos y vuelve a emparejar solo los tuyos (cada emparejamiento crea un
dispositivo nuevo, con otro identificador).
