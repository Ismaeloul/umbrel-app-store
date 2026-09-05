# Saldo

Control del saldo prepago y las suscripciones de varias cuentas de tiendas de
aplicaciones (App Store, Google Play…).

Si no quieres meter la tarjeta en las tiendas y recargas con saldo, el problema
no es cuánto tienes: es **cuánto te dura y cuándo hay que recargar antes de que
falle un cobro**. Eso es lo que responde esta app.

- **El margen se calcula cobro a cobro, no con una media.** Si tienes saldo para
  ocho cobros mensuales pero hay una anual que cae dentro de tres meses y no
  cabe, lo que te quedan son **tres** meses, no ocho.
- **El simulador va en vivo.** El motor de proyección es TypeScript puro y corre
  también en el navegador: mueves la barra de «si recargo…» y la fecha se
  recalcula al instante, sin pedirle nada al servidor.
- **Cada cuenta, su divisa y su tienda.** Los decimales salen de la tabla ISO
  4217 (euros dos, yenes ninguno, dinares tres) y el dinero se enseña como lo
  enseña su tienda: `12,35 €`, `$31.00`, `￥3,200`. Nunca se suman, restan ni
  comparan importes de divisas distintas, y no hay conversión.
- **Te avisa por correo.** Un solo correo al día como mucho, con todo junto: las
  cuentas con poco margen, las pruebas gratuitas a punto de pasar a cobro y lo
  que se haya perdido. El de poco saldo **insiste todos los días** hasta que
  recargues (se puede espaciar en Ajustes); los demás se dicen una vez.
- **Una cuenta, una tarjeta.** Cada cuenta se da de alta de un tirón con su
  correo, su tienda, su región, su saldo, sus suscripciones y sus notas.
- **Los datos los metes tú.** La app no habla con Apple ni con Google y no pide
  credenciales de ninguna tienda. Es un **simulador de saldo**, no un lector.

Sin usuarios ni contraseñas: está pensada para vivir en un Umbrel y entrar por
la red privada.

## Arrancar

```sh
docker compose up --build
```

Y abre <http://localhost:7797>.

Para probar los avisos **sin tocar una cuenta de correo de verdad**, hay un
buzón de mentira (Mailpit) que se traga todo lo que le mandes:

```sh
docker compose -f docker-compose.yml -f docker-compose.pruebas.yml up -d --build
```

La app sigue en <http://localhost:7797> y el buzón queda en
<http://localhost:8025>.

### Sin Docker

```sh
npm install
npm run dev      # http://localhost:5173
```

## El correo

Lo normal es configurarlo **desde la propia app**: el engranaje del panel lleva a
Ajustes, donde pones la cuenta desde la que se envía, a quién avisar y cada
cuántos días. Hay un botón de «Guardar y enviar una prueba» que manda un correo
de verdad para que compruebes que llega, y si el servidor protesta te lo cuenta
en cristiano en vez de escupir el error de SMTP.

Con Gmail, la clave **no es la contraseña de tu cuenta**: es una *contraseña de
aplicación*, que se genera en la cuenta de Google con la verificación en dos
pasos activada. Se guarda tal cual en `saldo.db`, así que trátala como lo que es:
una llave revocable desde Google. Nunca se devuelve a la pantalla, y hay un botón
para borrarla.

También se puede dejar preconfigurado por variables de entorno (copiando
`.env.ejemplo` a `.env`). **Lo que guardes en Ajustes manda sobre el entorno**:
las variables son solo el valor de partida.

| Variable | Para qué |
| --- | --- |
| `SALDO_SMTP_HOST` · `SALDO_SMTP_PUERTO` · `SALDO_SMTP_SEGURO` | El servidor de salida |
| `SALDO_SMTP_USUARIO` · `SALDO_SMTP_CLAVE` | Credenciales; la clave, de aplicación |
| `SALDO_CORREO_DE` · `SALDO_CORREO_PARA` | Remitente y destinatario |
| `SALDO_AVISO_DIAS` | Avisar con estos días de margen o menos (30) |
| `SALDO_AVISO_PRUEBA_DIAS` | Avisar si una prueba pasa a cobro dentro de tantos días (7) |
| `SALDO_RECORDAR_CADA` | Cada cuántos días repetir el aviso de poco saldo (1) |
| `SALDO_HORA_TAREA` | Hora local de la pasada diaria (3) |
| `SALDO_TAREAS_DE_FONDO` | A `0` se apagan la pasada diaria y la de arranque |
| `SALDO_DATA_DIR` · `TZ` | Dónde vive la base y con qué huso se decide qué día es hoy |

Sin correo configurado la app funciona igual: los avisos salen por el log
(`docker compose logs -f saldo`) y se quedan pendientes, así que saldrán el día
que lo configures.

## Una cuenta, una tarjeta

«Añadir cuenta» pide de una vez todo lo de esa cuenta —**correo**, tienda,
región, saldo, sus suscripciones y unas notas— y con eso queda su tarjeta en el
panel. Las suscripciones se añaden ahí mismo, tantas como quieras, sin tener que
crear la cuenta primero y volver luego.

El **correo es lo que distingue una cuenta de otra** cuando tienes tres App Store
distintas, así que sale en la tarjeta debajo del nombre de la tienda. Es
opcional, y tanto él como las notas se pueden cambiar después desde la pantalla
de la cuenta.

## La base de datos y la copia de seguridad

Todo vive en **un solo fichero SQLite**, en `./data/saldo.db`. El esquema se crea
solo al arrancar y es idempotente: no hay migraciones que lanzar a mano.

Para respaldar, con la app parada basta con copiar el fichero:

```sh
docker compose down
cp data/saldo.db copias/saldo-$(date +%F).db
docker compose up -d
```

Para empezar de cero: `docker compose down && rm -rf data`.

## Tests

```sh
npm test
```

Congelan «hoy» con una fecha fija que se inyecta. Cubren las reglas de fechas
(el 31 en febrero que vuelve al 31 en marzo, el 29 de febrero a cuatro años
vista), el formateo y el parseo con 0, 2 y 3 decimales, el motor con sus
pérdidas parciales, el materializador con su idempotencia y su puesta al día, el
alta de cuentas y los ajustes del correo.

## Cómo está montada

| Capa | Tecnología |
| --- | --- |
| Todo | SvelteKit 2 + Svelte 5 + TypeScript, un contenedor y un puerto |
| Base de datos | SQLite con `node:sqlite`, sin dependencias nativas |
| Correo | nodemailer |
| Imagen | Dockerfile multi-stage: Vite compila, Node sirve |

```
saldo/
  src/lib/motor/        EL MOTOR: TypeScript puro, sin BD y sin reloj
    fechas.ts           reglas de fechas de cobro (anclas)
    proyeccion.ts       simulación cobro a cobro
  src/lib/servidor/     lo que solo existe en el servidor
    db.ts · esquema.ts  SQLite
    consultas.ts        filas ↔ motor (único sitio que lee precios)
    materializador.ts   convierte cobros vencidos en movimientos reales
    ajustes.ts          lo que se toca desde la pantalla (manda sobre el entorno)
    avisos.ts           qué hay que mirar hoy, sin repetirse
    correo.ts           el envío
    tareas.ts           la pasada de arranque y la diaria
    reloj.ts            ÚNICO sitio que mira el reloj de verdad
  src/lib/dinero.ts     exponentes ISO 4217, formateo y parseo
  src/routes/           el panel, el detalle de cuenta y los ajustes
  src/service-worker.ts para que la PWA abra sin red
```

### Invariantes que no se negocian

1. **Dinero entero.** Todo importe se guarda como entero en la unidad menor de
   su divisa. Los decimales salen de `dinero.ts`. **Nunca** asumas dos.
2. **Una divisa por cuenta.** Prohibido sumar, restar o comparar importes de
   divisas distintas. No hay vista de total agregado.
3. **El saldo nunca es negativo.** Si un cargo no cabe, no se aplica.
4. **El precio se lee de `precios`**, jamás de `suscripciones`. Cambiar de
   precio añade una fila; no actualiza ninguna.
5. **El ancla no se mueve dentro de un ciclo.** `ancla_dia` / `ancla_mes` se
   derivan de la fecha del primer cobro y son lo que evita la deriva de fechas.
6. **`hoy` se inyecta.** La lógica de negocio recibe la fecha por parámetro.
   El reloj real solo se mira en `reloj.ts`.

## Instalarla en Umbrel

La carpeta de la app en la tienda es `../ismaeloul-saldo/` y lleva **solo tres
ficheros**: el `docker-compose.yml` en formato Umbrel (con `app_proxy` y una
`image:` del registro local), `umbrel-app.yml` e `icon.svg`. Aquí no hay ningún
paso de copiar ficheros a mano: umbreld hace `docker pull` de la imagen y punto.

La imagen la construye y la publica **GitHub solo**, en cada `push` que toque
`saldo/` (ver `.github/workflows/saldo.yml`). Sale a `ghcr.io/ismaeloul/saldo`,
que es público, así que el Umbrel se la baja sin credenciales ni registros
locales: nada que construir a mano en el NAS.

Instalarla es entonces lo de siempre: en umbrelOS, actualizar la tienda para que
vea el commit nuevo e instalar Saldo.

Para sacar una versión nueva: subir el número en `umbrel-app.yml` **y** en su
`docker-compose.yml`, y empujar. El workflow etiqueta la imagen con esa misma
versión, así que los dos ficheros y la imagen no se pueden desincronizar.

Los ajustes (la cuenta de correo, los umbrales) viven en `saldo.db`, así que en el
Umbrel hay que rellenarlos otra vez desde la pantalla de Ajustes — o copiar allí
el fichero de la base de datos.

El aviso honesto: el service worker solo se registra en `localhost` o por
HTTPS. Entrando por `http://umbrel.local` la app funciona, pero sin la parte de
abrir offline; por Tailscale con HTTPS, sí.
