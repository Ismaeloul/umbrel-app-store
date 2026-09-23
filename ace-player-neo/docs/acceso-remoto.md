# Acceso desde el iPhone: Tailscale, la LAN y por qué no Cloudflare Tunnel

La app iOS habla con el Umbrel por la ruta **`/native/`** del mismo puerto que
la web (**7792**). Esa ruta está en la lista blanca de la pasarela de Umbrel
(`PROXY_AUTH_WHITELIST: "/native/*"`), así que **no pide el login de Umbrel**:
la protege el token del dispositivo que se consigue al emparejar. Cómo está
montado: [`arquitectura.md` §5.12, §7.3 y §8](arquitectura.md) y decisión D4
en [`decisiones.md`](decisiones.md).

En la app se pueden guardar **dos direcciones a la vez** (la de Tailscale y la
de casa). La app hace ping a las dos, usa la primera que responde y vuelve a
elegir cuando el teléfono cambia de red.

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
  token como única barrera. No se hace; para fuera de casa, Tailscale.

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

Si algún día hiciera falta acceso sin Tailscale, lo razonable es solo la web
(detrás del login de Umbrel) y nunca el vídeo.

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
