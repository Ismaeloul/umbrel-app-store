# IPTV en Ace Player Neo: diseño

Rama `rediseno/iptv`, que sale de `rediseno/palco` en el commit `269fac2`, con el servidor 0.8.1 todavía sin
publicar. Lo pidió Isma el 26-sep-2026. Este documento sustituye al boceto de `docs/ideas-futuras.md` §3.

**Estado: cerrado tras dos revisiones** (seguridad y robustez; producto y coherencia). Los cambios que salieron de
ellas ya están en el texto; el anexo «Revisión» (§13) dice qué se cambió, qué se descartó y por qué.

**Implementado (26-sep-2026)** en `rediseno/iptv` (servidor y web; la app nativa no cambia). Lo que se desvía del
texto o quedó fuera:

- El E2E de §9.3 corre contra la pila entera: `apps/web/e2e/support/iptv.ts` lanza el proveedor falso en
  `[::1]:<iptv>` y `backend.ts` lleva `iptv.ace-e2e.example` hasta él. Las credenciales de prueba son las del
  proveedor falso (`usuario-e2e`); el canal suelto es «Antena 3 HD» guardado como favorito.
- El proveedor falso manda ahora una trama AC-3 de silencio real (antes solo cabecera y ceros): con la vieja, ffmpeg
  no podía pasar el audio a AAC y el remux no sacaba nada.
- En Windows (PC de desarrollo y E2E) ffmpeg escribe la lista sin `temp_file` y con barras «/»: el renombrado de
  `index.m3u8.tmp` falla en Windows mientras el backend lee la lista, e `init.mp4` acababa en el directorio de
  trabajo. En Linux (el Umbrel) los argumentos no cambian.
- El arranque depende del colchón del proveedor: con un TS en tiempo real sin colchón, ffmpeg tarda ~5 s en analizar
  la entrada y otros ~6 s en tener la lista, y el total (15-20 s en el PC) roza el plazo de 20 s del arranque
  (`iptv_timeout`). El proveedor falso manda 8 s de golpe en el E2E (`burstSeconds`, como un panel de verdad) y
  arranca en ~6 s. Conviene medirlo con un proveedor real antes de publicar.
- En la cabecera de un canal suelto, «Reproducir» ya no sale mientras suena la IPTV de ese canal (el selector de
  `useStore` se quedaba con la lista de fuentes vacía del primer render).
- Tras la revisión (26-sep): la guía exige la competición del partido (en el texto o, si el texto no nombra
  ninguna, en el canal) y descarta otros deportes, el femenino y las categorías inferiores (§4.5); «Un solo
  dispositivo a la vez» en el mismo canal IPTV echa al otro visor y **conserva** la sesión y la conexión con el
  proveedor (§7.6); el bootstrap no caduca en la caché de la web (`iptvActive()` seguía en falso a los 5 min sin
  Ajustes); en inmersivo «Volver a la IPTV» es una cápsula tocable sobre el vídeo (§7.2); el puente solo espera 60 s
  tras un **fallo** de la IPTV; pausar, eliminar o cambiar de proveedor corta también lo que se estaba abriendo y lo
  que suena del proveedor anterior; otra lista M3U del mismo host es otro proveedor; `-rw_timeout` a 55 s (el relé con cambio de variante llega a 49 s); las redes de Docker del Umbrel
  (10.21.0.0/16 y 172.17.0.0/16) nunca cuentan como casa; y una línea de log (host y código) si la guía no baja.
- Pendiente: «mantener caliente» el canal que funciona; una `location /api/v1/video/` propia en el nginx de
  `deploy/umbrel` (sin buffer, gzip ni registro, como `/remux/`), que tiene que ir con la release 0.8.1 porque el test
  del paquete de la tienda compara esa nginx.conf con la de la release commiteada; comprobar de quién es la sesión en `/api/v1/video` desde la
  web; medir el arranque con un proveedor real; la renovación del token de las listas M3U y la vuelta a la guía corta,
  sin probar contra un proveedor real.

Las rutas de ficheros son relativas a `ace-player-neo/` salvo que se diga otra cosa. Los textos entre «comillas» son
**literales**: se copian tal cual en el código, porque la app nativa los genera desde la web (`generar-textos.mjs`) y
los compara en `TextosTests`.

---

## 0. En pocas palabras

1. La IPTV se configura **solo en la web** (Ajustes → IPTV). Admite una lista M3U por URL o Xtream Codes. Se guarda
   **cifrada** en el Umbrel y nada de ella vuelve al navegador, al iPhone ni a los registros.
2. Cada canal IPTV recibe un **id sintético de 40 hex que se reconoce solo**: 32 hex de HMAC más una etiqueta de 8 hex
   firmada con una clave del servidor (§4.1). Para los contratos, la web y la app es «un hash más». La candidata lleva
   `source: 'iptv'` y se reproduce por el mismo `GET /api/v1/channels/:id/stream`. Con esto **la app 0.8.0 publicada
   ya reproduce IPTV sin cambios**, aunque sin distintivo.
3. El servidor empareja la IPTV con los canales de los partidos y con los de las listas de AceStream usando el mismo
   `channelMatchScore` y la protección Hypermotion, pero con un **umbral de 92** y una limpieza de nombres propia de la
   IPTV. La IPTV va **primera**, con **un cartel por canal y 2 como mucho**. La guía (XMLTV), que se usa solo por
   dentro, puede poner primero el canal que de verdad emite el partido.
4. El vídeo IPTV **siempre pasa por el servidor**. Un relé local en `127.0.0.1` descarga del proveedor (con la
   protección SSRF) y se lo da a ffmpeg, así que las credenciales nunca aparecen en los argumentos. ffmpeg lo remuxa a
   HLS fMP4 (vídeo copiado y audio a AAC). La web lo reproduce con **hls.js** (protocolo `hls`) y el iPhone con AVPlayer,
   como hoy.
5. Hay **una sola conexión al proveedor en toda la casa**. La sesión IPTV se coloca con el mismo cerrojo que las de
   AceStream, así que sigue valiendo «un canal a la vez». Se cierra al momento al pasar a otro canal y a los 3 s de
   dejar de mirar. Mientras se mira no se hace ninguna sonda a ese proveedor, y el arranque de una IPTV **no se
   sondea**: reproducirla ya es la prueba.
6. **Ninguna URL del proveedor se registra nunca**, ni de lista ni de stream: solo el host y el id del canal (§2.4).
7. Funciona como un puente: **si uno no va, va el otro**.
   - Si cae la IPTV, se pasa sola a la mejor AceStream verificada, con un aviso y la forma de volver a la IPTV con un
     toque.
   - Si cae AceStream y hay IPTV, se pasa sola a la IPTV.
   - Esto vale también después de elegir a mano y en los canales sueltos (también al tocarlos en Canales, el buscador,
     Favoritos o Recientes).
8. Cambios mínimos en la app nativa: un `case iptv`, el distintivo, los textos, ocultar las acciones de AceStream y la
   regla del puente (§10). Los ejemplos solo web van en una carpeta que la app no recorre, y los generados de la app
   se regeneran en un commit de `rediseno/nativa` con dueño y orden (§10.1).

---

## 1. Ajustes → IPTV (solo web)

### 1.1 Sitio y estructura

- **Sección nueva en `SECTIONS`** (`apps/web/src/features/settings/SettingsView.tsx`), justo después de «Listas»:
  `{ id: 'iptv', title: 'IPTV', icon: 'tv', hint: 'Tu proveedor, M3U o Xtream' }`.
  - Ruta: `?vista=ajustes/iptv`.
  - Región accesible: `getByRole('region', { name: 'IPTV' })`.
  - Descripción de la sección (`<Section description>`): «Si un canal o un partido está en tu IPTV, sale el primero. Si
    se cae, se pasa sola a la mejor fuente de AceStream.»
- **Componente:** `apps/web/src/features/iptv/IptvSection.tsx`, con su `model.ts` puro y su CSS, montado con `WhenNear`
  como las demás secciones pesadas.
  - **No** va por `external.tsx`: esa carpeta la buscan otras piezas y aquí basta con `React.lazy` en el `case 'iptv'`.
  - En la app nativa **no existe** esta sección (M7 no cambia).
- **Se reutiliza lo que ya hay:** `TextField`, `Button`, `Switch`, `Segmented`, `Capsule`, `useSecondTap`
  (`settings/second-tap.ts`), el estilo `dir-form` / `dir-card` / `dir-status` / `dir-note` de «Listas», `isHttpUrl`
  y `looksPrivateUrl` (de `features/directories/model.ts`, no de `@ace/shared`) y `errorMessage()` de `@ace/shared`.
- **Mismo vocabulario que «Listas»:** «Guardar …», «Actualizar», «Eliminar» con segundo toque «¿Borrar?», «… eliminada»
  y «Guardando y sincronizando la lista…».

### 1.2 Sin IPTV: formulario «Conectar tu IPTV»

```
Conectar tu IPTV                                   (h3.dir-form__title)
[ Lista M3U | Xtream Codes ]                       (Segmented, aria-label «Tipo de IPTV»)

— Lista M3U —
Nombre                 placeholder «Nombre, por ejemplo: Casa»        maxLength 40
Dirección de la lista  placeholder «https://…/lista.m3u»  type=url  autoComplete=off  spellCheck=false

— Xtream Codes —
Nombre                 placeholder «Nombre, por ejemplo: Casa»
Servidor               placeholder «http://proveedor.example:8080»  type=url
Usuario                autoComplete=off  autoCapitalize=off  spellCheck=false
Contraseña             type=password  autoComplete=off  data-1p-ignore  data-lpignore=true  data-bwignore

[Guardar IPTV] (primary)
«Tus credenciales se guardan cifradas en tu Umbrel y no salen de él: ni al navegador, ni al iPhone, ni a los registros.»   (p.dir-note)
<p.dir-status role=status|alert aria-live=polite>                      (línea de estado)
```

- **Pista de red local.** Si el campo URL o Servidor apunta a la red local (`looksPrivateUrl`), sale la misma pista de
  «Listas»: «Parece una dirección de tu red local: por seguridad el servidor las bloquea salvo que se hayan permitido
  al instalar.»
- **Validación local.** Una URL que no es http(s) da `errorMessage('bad_url')`. Un campo vacío da «Escribe la dirección
  de la lista», «Escribe el servidor», «Escribe el usuario» o «Escribe la contraseña» (tono `warn`).
- **Si falta el nombre,** el servidor usa «IPTV».

**Textos de la línea de estado (`dir-status`):**

No hay botón «Probar conexión»: «Guardar IPTV» ya hace la prueba rápida (§5.3) y no guarda si falla. El recuento de
canales llega después por SSE (`iptv.status`), sin una petición larga.

| Momento | Tono | Texto |
|---|---|---|
| Guardando (prueba rápida) | neutro (icono `refresh`) | «Guardando y sincronizando la lista…» |
| Guardada, sincronizando | neutro | «Conexión correcta. Descargando los canales de «{Casa}»…» |
| Sincronizada | ok | ««{Casa}»: {812} canales. Se actualiza sola cada 6 h.» |
| Error | err (`role=alert`) | el `message` del catálogo (§5.6) |

Toasts: «IPTV guardada: {812} canales» (ok, cuando llega el recuento) y «No se pudo guardar la IPTV. {motivo}» (err).

### 1.3 Con IPTV: tarjeta y acciones

```
Casa  [Activa]                                     (Capsule: ok «Activa» | neutral «En pausa» | weak «Con fallos»)
Xtream · 812 canales · actualizada 26 sept, 20:30  (meta, formato de sourceMeta)
proveedor.example:8080 · usuario y contraseña guardados        (Xtream)
proveedor.example · dirección guardada                         (M3U)
Cuenta activa hasta el 3 dic · 1 conexión a la vez             (solo Xtream, si hay datos de la cuenta)
Guía: 640 canales con programación · actualizada 26 sept, 14:00 (solo si hay guía; ver abajo)

[✓] Usar la IPTV        «En pausa se guarda, pero no se usa: todo sale de AceStream.»   (Switch)
[Actualizar]  [Cambiar datos]  [Eliminar]
<dir-status>
```

No hay línea «Coincide con N canales de tu lista activa»: nadie la pidió y obligaría a cruzar toda la biblioteca.

**Líneas que sustituyen a la de la cuenta, por orden de prioridad:**
- «La cuenta de tu IPTV ha caducado o está desactivada.» (tono err).
- «Tu cuenta tiene todas sus conexiones en uso fuera de Ace Player.» Sale cuando `activeConnections ≥ maxConnections`
  descontando las nuestras, las abiertas y las cerradas en los últimos 120 s (tono weak).
- La cuenta solo se da por caducada si lo dicen **dos** comprobaciones seguidas de `user_info` (§7.4).

**Si falló la última actualización:** «No se pudo actualizar: {motivo}. Se conserva la copia del {26 sept, 20:30}.»
(tono err). Es el mismo patrón que `DIRECTORY_NOTE`.

**La línea de la guía** es lo único visible de la guía (§3.6):
- Con guía: «Guía: {640} canales con programación · actualizada {26 sept, 14:00}».
- Si la última descarga falló pero hay una copia: «Guía: no se pudo actualizar; se usa la del {26 sept, 14:00}».
- Sin guía: no sale nada. Todo funciona igual.

**Acciones:**

| Acción | Llamada | Mientras | Al terminar |
|---|---|---|---|
| Switch «Usar la IPTV» | `iptvUpdate {enabled}` | deshabilitado | toast «IPTV activada» o «IPTV en pausa: todo sale de AceStream» |
| «Actualizar» | `iptvSync` | botón `busy`, estado «Actualizando la lista de «{Casa}»…» | toast «Lista de la IPTV actualizada: {812} canales» (llega por SSE `iptv.status`) |
| «Cambiar datos» | abre el formulario en modo edición (§1.4) | — | — |
| «Eliminar» | segundo toque «¿Borrar?» (5 s, `useSecondTap`), luego `iptvDelete` | `busy` | toast «IPTV eliminada» (icono `trash`) |

Nota debajo de «Eliminar», en `dir-note`, visible solo durante el segundo toque: «Eliminar la IPTV borra sus datos de
tu Umbrel.» Es verdad porque `iptvDelete` borra también el `.bak` y las copias apartadas (§5.3).

Guardar, pausar y eliminar **no esperan** a una sincronización en curso: la abortan (§3.5), así que responden en
segundos y la web nunca dice «falló» de algo que luego se guarda.

### 1.4 La contraseña nunca vuelve y cómo se edita sin reescribirla

**Qué devuelve el servidor.** `iptvGet` **nunca** incluye la URL de la lista, el usuario ni la contraseña (§5.3). Solo
devuelve:
- `host`, que es el nombre y el puerto, sin esquema, ruta ni query;
- en Xtream, `origin` (`http(s)://host:puerto`, sin ruta), para rellenar «Servidor»;
- `hasUsername` y `hasPassword`, o `hasUrl` en M3U.

**Formulario en modo edición.** Es el de §1.2 con el título «Cambiar los datos de tu IPTV» y el botón «Guardar
cambios», más «Cancelar» (quiet).
- «Nombre» y «Servidor» vienen rellenos.
- «Usuario», «Contraseña» y «Dirección de la lista» vienen **vacíos**, con placeholder:
  - Usuario: «Guardado · escríbelo solo para cambiarlo»
  - Contraseña: «Guardada · escríbela solo para cambiarla»
  - Dirección de la lista: «Guardada · escríbela solo para cambiarla»
- Un campo secreto vacío **no se envía**. Para el servidor, ausente significa «sin cambios» (§5.3). La prueba rápida
  de «Guardar cambios» usa entonces los guardados.

**Regla de seguridad.** Si cambia el **origen** del servidor Xtream, o el tipo (M3U ↔ Xtream), el servidor exige los
secretos otra vez: `400 iptv_credentials_required`, «Si cambias el servidor o el tipo, vuelve a escribir el usuario y
la contraseña.». Así nadie puede apuntar la IPTV a otro host y que el Umbrel le mande la contraseña guardada.
- En M3U la URL entera es secreta, así que cambiarla es escribirla otra vez.
- **Otro origen u otro tipo es otro proveedor:** se genera un `provider.id` nuevo, así que cambian todos los ids de
  canal y no sobreviven reglas aprendidas, veredictos ni vínculos de un servidor en el que el mismo `stream_id` es otro
  canal. Cambiar solo el nombre, el usuario o la contraseña conserva el `provider.id`.

**Higiene en el navegador.**
- Se llama con `api()` directo, **no** con `useApiMutation`, porque TanStack guarda `variables` en la caché de
  mutaciones.
- Los campos se vacían al guardar, al cancelar y al desmontar.
- Ni el cuerpo ni la respuesta de las rutas `iptv*` entran en diagnósticos del cliente ni en `console`.
- El campo de contraseña lleva `autoComplete="off"` y las marcas `data-1p-ignore`, `data-lpignore` y `data-bwignore`
  de los gestores de contraseñas. No se promete más: si el navegador ofrece guardarla o no, lo decide él.

### 1.5 Estado en vivo

`iptvGet` se invalida con el evento SSE `iptv.status`, que es solo para la web (§5.5). Mientras `status === 'syncing'`,
la tarjeta enseña «Actualizando la lista de «{Casa}»…». Sin SSE, se sondea `iptvGet` cada 3 s mientras dure `syncing`,
2 min como mucho.

### 1.6 Demo (`?demo=1`)

- `registerDemoHandlers` responde a `iptvGet` con un proveedor de ejemplo: «IPTV de ejemplo», Xtream, 812 canales,
  guía con 640, activa.
- `iptvSave`, `iptvSync`, `iptvUpdate` e `iptvDelete` devuelven `demo_unsupported`, como hoy los directorios.
- La IPTV de ejemplo aparece en **demo-5** (§8.5). demo-4 no cambia.

---

## 2. Guardado en el servidor

### 2.1 Dónde

| Fichero | Contenido | Forma |
|---|---|---|
| `v2/iptv.json` | configuración, secretos **cifrados**, `revision` y estado de la última sincronización, de la guía y de la cuenta (sin listas de ids) | `IptvFileSchema` (`packages/shared/src/state/v2.ts`), con `createDocumentStore` (escritura atómica, `.bak`, apartar lo corrupto) |
| `v2/iptv/catalogo.enc` | catálogo en caché, con las URLs de stream y la de la guía | AES-256-GCM sobre JSON en gzip |
| `v2/iptv/guia.enc` | ventana útil de la guía (ahora → +48 h), ya filtrada | AES-256-GCM sobre JSON en gzip |
| `v2/iptv/clave` | 32 bytes aleatorios, **solo** si no hay `ACE_SEED` / `ENGINE_CONTROL_TOKEN` | binario, 0600 |

- **Nada en `settings.json`.** Es `strictObject`, y un campo nuevo haría que la 0.8.0 lo apartara como corrupto y
  perdiera `sameChannelPolicy`.
- **Nada en `state.webSources`**, por el hash de 40 hex, el tope de 500 y 8 listas, y la compatibilidad con la 0.6.59.
- **Vuelta a la 0.8.0:** los ficheros nuevos se ignoran y no se rompe nada.
- **Permisos.** `createDocumentStore` gana la opción `fileMode?: number`, que aplica a la escritura atómica y al
  `.bak`. `iptv.json`, los `.enc` y `clave` se escriben con **0600**, y la carpeta `v2/iptv/` con 0700.

### 2.2 Forma de `v2/iptv.json`

```ts
IptvFileSchema = z.strictObject({
  version: z.literal(1),
  provider: z.strictObject({
    id: z.string().regex(/^p_[A-Za-z0-9_-]{8}$/),     // aleatorio al crear; nuevo al eliminar o al cambiar origen o tipo
    revision: z.number().int().nonnegative(),          // sube con cada cambio de datos (§3.4)
    kind: z.enum(['m3u', 'xtream']),
    name: z.string().min(1).max(40),
    enabled: z.boolean(),
    host: z.string().max(260),                         // nombre[:puerto], sin credenciales ni ruta
    origin: z.string().max(300).nullable(),            // solo Xtream: esquema://host[:puerto]
    secret: SealedSchema,                              // ver 2.3
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
    lastSync: z.strictObject({
      at: IsoDateTimeSchema, ok: z.boolean(), channels: z.number().int().nonnegative(),
      durationMs: z.number().nonnegative(), error: ShortCodeSchema.nullable(),
    }).nullable(),
    guide: z.strictObject({
      at: IsoDateTimeSchema, ok: z.boolean(), channelsWithGuide: z.number().int().nonnegative(),
      programmes: z.number().int().nonnegative(), error: ShortCodeSchema.nullable(),
    }).nullable(),
    account: z.strictObject({                           // solo Xtream (user_info)
      status: z.enum(['active', 'expired', 'banned', 'disabled', 'unknown']),
      expiresAt: IsoDateTimeSchema.nullable(),
      maxConnections: z.number().int().nonnegative().nullable(),
      activeConnections: z.number().int().nonnegative().nullable(),
      checkedAt: IsoDateTimeSchema,
    }).nullable(),
  }).nullable(),
})
```

- **No hay `retiredIds`.** Un id IPTV se reconoce solo por su etiqueta (§4.1), así que no hace falta guardar ids uno a
  uno. Nada de este documento puede crecer sin tope ni hacer fallar «Eliminar» o una sincronización por el esquema.

### 2.3 Cifrado de las credenciales

- **Claves.** Salen de `config/keys.ts`, con dos etiquetas nuevas en `KEY_LABELS`:
  - `iptvSecrets: 'ace-iptv-v1'`: AES-256-GCM de `secret`, `catalogo.enc` y `guia.enc`;
  - `iptvIds: 'ace-iptv-id-v1'`: HMAC de los ids de canal (§4.1);
  - `iptvIdTag: 'ace-iptv-tag-v1'`: la etiqueta que hace reconocible un id IPTV (§4.1).
- **Material.** El mismo que hoy (`ACE_SEED`, o en su defecto `ENGINE_CONTROL_TOKEN`, que es `${APP_SEED}` en Umbrel).
  Si no hay ninguno, **no** se usa `ephemeralSeed()`, porque las credenciales se perderían al reiniciar: se crea
  `v2/iptv/clave` con 0600 y se usa esa.
- **`SealedSchema`:** `{ alg: 'A256GCM', iv: base64url(12 B), tag: base64url(16 B), data: base64url }`.
  - El AAD es `ace-iptv|<provider.id>|<kind>`, para que no se pueda pegar un bloque de otro proveedor.
  - En claro contiene:
    - M3U: `{ url }`;
    - Xtream: `{ server, username, password }`, donde `server` es el origen más la ruta base si la hay.
- **Si no se puede descifrar** (se cambió el secreto de la app o se restauró una copia de otro Umbrel):
  - la IPTV queda `status: 'error'` con `iptv_secret_unreadable`;
  - no se ofrece IPTV;
  - la tarjeta dice «No se pueden leer los datos guardados de tu IPTV. Vuelve a escribirlos.».
- **En memoria,** los secretos descifrados viven solo dentro del módulo `iptv`: el cliente Xtream, el relé y la guía.
  Ninguna interfaz pública del módulo los devuelve.
- **Copias de seguridad de Umbrel.** Incluyen `/data` con los secretos cifrados. Con `ACE_SEED` o `APP_SEED` (lo normal
  en Umbrel) la clave no está en `/data` y la copia sí los protege. Si se usa `v2/iptv/clave`, la clave viaja en la
  misma copia y el cifrado solo protege frente a quien lea `iptv.json` suelto: se dice así en `docs/api.md`, sin
  prometer más.

### 2.4 Redacción en los registros, en ffmpeg y en los errores

**0. La regla principal: ninguna URL del proveedor se escribe nunca.** El módulo `iptv`, y `net` cuando lo llama
`iptv`, no registran, no ponen en `detail` y no devuelven fuera del relé ninguna URL del proveedor: ni de lista, ni de
guía, ni de stream, ni de redirección. Solo el `host` y el id del canal (o el `stream_id` de Xtream, que no es
secreto). Lo que sigue es la red de seguridad por si algo se escapa.

**1. Redactor con secretos conocidos** (`modules/iptv/redact.ts`).
- `redactor.clean(text)` sustituye por `•••` cada aparición exacta, en crudo y codificada con `encodeURIComponent`,
  de:
  - usuario y contraseña de Xtream (si miden 3 caracteres o más);
  - en M3U:
    - la URL completa de la lista y su query;
    - **cada valor** de la query de la URL de la lista que mida 3 caracteres o más, y en particular los de
      `username`/`user` y `password`/`pass` (la forma `get.php?username=U&password=P&type=m3u_plus` que generan los
      paneles Xtream);
    - los dos tramos de ruta anteriores al id en las URLs de stream cortas `/<u>/<p>/<id>` (con o sin `/live/`),
      cuando se repiten en la mayoría de los canales de la lista: se aprenden al parsear;
  - las URLs de guía y sus valores de query;
  - el ticket del relé.
- El módulo se lo pasa a quien puede ver textos del proveedor: `diagnostics.report`, el `onExit` del remux y el
  `logger` hijo del módulo.

**2. Redacción genérica** (`core/logger.ts`). Sirve aunque el redactor no conozca el secreto:
- `REDACTED_PATHS` suma `password`, `*.password`, `username`, `*.username`, `secret`, `*.secret` y `url` **solo dentro
  de** `iptv.*`.
- `redactUrl()`:
  - tapa además los parámetros `username`, `user`, `password`, `pass`, `pwd`, `auth`, `key`, `token`, `t` y `code`;
  - tapa `user:pass@`;
  - tapa los tramos Xtream `/(live|movie|series|timeshift)/<u>/<p>/` → `/$1/•••/•••/`;
  - tapa la forma corta `/<u>/<p>/<número>(.ext)?` al final de la ruta → `/•••/•••/<número>`;
  - tapa `/r/<ticket>/` del relé.
- Se aplica en `onResponse` **y** en el serializador de `err` (`err.message`, `err.detail`, `err.cause.message`).

**3. `net`.** `redirect_loop`, `bad_url` (hoy guarda `detail: location`) y los demás errores con `detail` guardan
`redactUrl(url)`, nunca la URL cruda (hoy `net/client.ts:197` la guarda entera). Cuando llama `iptv`, `detail` lleva
solo el host. Los errores de undici se envuelven: se conservan `code` y `host`, nunca `href`. `openStream` devuelve
`finalUrl`, pero el relé no la propaga: se queda dentro de él.

**4. ffmpeg.**
- Solo ve `http://127.0.0.1:<puerto>/r/<ticket>/…` (§6.1), así que en `/proc/<pid>/cmdline` y en su stderr no hay
  credenciales.
- Aun así, la cola de su registro (`RingLog`) pasa por `redactor.clean` y `redactUrl` antes de `logger.warn` y de
  `diagnostics.report`.

**5. Errores de la API.**
- El módulo `iptv` lanza `AppError` con códigos del catálogo (§5.6). Su `message` es el fijo del catálogo y su
  `detail` interno solo lleva `host` y el estado HTTP, nunca la URL.
- Los errores de validación de zod no repiten la entrada: zod 4 no incluye `input` salvo `reportInput`. Hay un test
  que lo vigila.

**6. Diagnósticos.** `diagnostics.jsonl`, `GET /api/v1/diagnostics` y `diagnostics.new` (que llega también al
iPhone) solo reciben texto ya limpio.

**7. Pruebas de fuga** (§9). Con usuario `usuario-e2e` y contraseña `Cl4ve-Secreta-E2E`, en Xtream **y** en una M3U
de tipo `get.php?username=…&password=…` cuyas URLs de stream son `/<u>/<p>/<id>` sin `/live/`, se comprueba que
ninguno de los dos aparece en:
- las respuestas;
- el SSE;
- los registros capturados;
- `diagnostics.jsonl`;
- el `iptv.json` crudo;
- los argumentos de ffmpeg.

---

## 3. La lista: descarga, parseo, caché y guía

### 3.1 Descarga con `net` (SSRF igual que en directories)

Todo pasa por `net`: resolución, rechazo de IPs privadas y nombres internos, **IP fijada** (`pinnedLookup`),
redirecciones manuales (5 como mucho, comprobando cada salto) y el interruptor `ALLOW_PRIVATE_SYNC_URLS`.

**Filtro más duro para la IPTV** (`net` con `purpose: 'iptv'`). Con IPTV, redirecciones, segmentos, `#EXT-X-KEY`,
`url-tvg` y `get_short_epg` son URLs que decide el proveedor. Por eso, **aunque `ALLOW_PRIVATE_SYNC_URLS` esté
activado**, se bloquean siempre:
- loopback (`127.0.0.0/8`, `::1`), link-local y metadatos (`169.254.0.0/16`, `fe80::/10`), multicast y `0.0.0.0/8`;
- nombres de una sola etiqueta (los de Docker, como `ismaeloul-ace-player-neo_acestream_1`);
- el puerto del relé.

Con el interruptor activado solo se permiten además las redes RFC1918 (`10/8`, `172.16/12`, `192.168/16`) y `fc00::/7`,
y **solo si el host que escribió Isma ya es de su red local**. Un proveedor público nunca puede redirigir a la red de
casa. El CLI del proveedor falso (§9.2) escucha por eso en la IP de red local del PC, no en `127.0.0.1`.

Hace falta una pieza nueva:

- **`net.openStream(url, { maxBytes?, totalMs?, idleMs, headers?, signal })`** devuelve
  `{ status, headers, body: Readable, finalUrl }`.
  - Aplica el mismo filtro que `fetchBuffer` y corta al pasar de `maxBytes` (`response_too_large`) o de los plazos.
  - La usan la lista M3U, la guía y el relé de vídeo (este último sin `maxBytes` ni `totalMs`).
- **`fetchBuffer` y `fetchJson`** admiten `maxBytes`, `totalMs` e `idleMs` por llamada (hoy son fijos: 2 MiB, 45 s y
  12 s).
- **Cabeceras.** `User-Agent: VLC/3.0.21 LibVLC/3.0.21` por defecto (`IPTV_USER_AGENT`), que muchos proveedores
  exigen. En M3U, de `#EXTVLCOPT` **solo** se aceptan `http-user-agent=` y `http-referrer=` de cada canal, con 256
  caracteres como mucho y sin CR, LF ni caracteres de control. Cualquier otra opción se ignora.
- **Una URL con `user:pass@`** sigue rechazada (`bad_url`), como hoy.
- **Compresión.** Se sigue pidiendo `Accept-Encoding: identity` y se sigue rechazando otro `Content-Encoding`
  (`unsupported_encoding`), salvo `gzip`, que se acepta solo con `purpose: 'iptv'`. Además se descomprime si los
  primeros bytes son `1f 8b` (ficheros `.gz` servidos tal cual). En los dos casos, con `node:zlib.createGunzip()` y tope
  de bytes **descomprimidos** contra bombas.

### 3.2 M3U con streams http(s)

Parser nuevo: `modules/iptv/m3u.ts`. `directories/parsers.ts` no se toca, porque sigue siendo solo AceStream. Lee
**línea a línea** sobre el `Readable`, sin cargar la lista entera, con un **tope de 16 KiB por línea**: lo que pase se
descarta hasta el siguiente salto, sin acumularlo.

- **Cabecera** `#EXTM3U`: `url-tvg` / `x-tvg-url` (lista separada por comas: se toman las 2 primeras http(s)) y
  `tvg-shift` global.
- **`#EXTINF:-1 …,Título`:** `tvg-id`, `tvg-name`, `tvg-logo` (se ignora), `group-title`, `tvg-shift` por canal y el
  título tras la última coma que no esté entre comillas.
- **`#EXTGRP:`** hace de `group-title` si falta. **`#EXTVLCOPT:`** se lee como en §3.1. `#KODIPROP` y demás se ignoran.
- **URL:** solo `http://` o `https://`.
  - Se descartan `acestream://`, `rtmp`, `udp` y `rtp` (lo AceStream va en «Listas»).
  - Se descarta el VOD: rutas con `/movie/` o `/series/`, o terminadas en `.mp4`, `.mkv`, `.avi`, `.mp3` o `.m4a`.
  - Quedan `.m3u8`, `.ts` y las rutas sin extensión al estilo Xtream (`/u/p/123`).
- **Secretos de la lista.** Al parsear se alimentan el redactor (§2.4): valores de la query de la URL de la lista y
  tramos `/<u>/<p>/` que se repiten en las URLs de stream.
- **Si no hay canales válidos:** `iptv_empty`. Si no empieza por `#EXTM3U`: `iptv_bad_list`.

### 3.3 Xtream Codes (`player_api.php`)

Cliente: `modules/iptv/xtream.ts`. Todas las llamadas son `GET {server}/player_api.php?username=U&password=P[&action=…]`.

| Llamada | Para qué | Límite |
|---|---|---|
| sin `action` | `user_info` (`auth`, `status`, `exp_date`, `max_connections`, `active_cons`, `allowed_output_formats`) y `server_info` | 256 KiB, 8 s |
| `action=get_live_categories` | nombre de categoría (país y tipo) para cada `category_id` | 2 MiB, 20 s |
| `action=get_live_streams` | catálogo: `stream_id`, `name`, `epg_channel_id`, `category_id` y `stream_type === 'live'` | 48 MiB, 90 s, 20 s de inactividad; **en streaming** (ver abajo) |
| `action=get_short_epg&stream_id=X&limit=12` | guía de respaldo (§3.6); `title` y `description` en base64 | 256 KiB, 8 s |

- **`get_live_streams` en streaming** (`modules/iptv/json-array.ts`). No pasa por `fetchJson`, que acumula el Buffer
  entero y luego hace `JSON.parse` de 100 000 objetos (250-300 MB de pico en un contenedor con `mem_limit: 768m`). Se
  lee con `net.openStream` y un **troceador propio del array JSON**: recorre los bytes, respeta cadenas y escapes,
  corta cada objeto de primer nivel (objetos planos, 16 KiB como mucho cada uno) y hace `JSON.parse` de ese objeto
  solo. Se quedan los 5 campos que hacen falta y el tope de 100 000 canales se aplica **mientras se lee**. Sin
  dependencias, con la misma filosofía que el tokenizador XMLTV.
- **Tipos.** Los números llegan a menudo como texto (`"1"`): se aceptan los dos con un zod tolerante. `auth: 0` o un
  401/403 dan `iptv_auth_failed`. `status` distinto de `Active` da `iptv_account_expired`.
- **URL de stream:** `{server}/live/{U}/{P}/{stream_id}.{ext}`, con `ext = 'ts'` si está en `allowed_output_formats`
  (o si la lista viene vacía) y si no `m3u8`.
  - Se prefiere `ts`, porque es una sola conexión continua y la más estable a través del relé (§6.1).
- **No se usa `direct_source`,** ni `server_info.url`/`port` para la API: manda el servidor que escribió Isma. Las
  redirecciones del proveedor a sus balanceadores se siguen con normalidad, pero **cada apertura y cada reconexión
  empieza en la URL original**, nunca en la `finalUrl` de la vez anterior, porque los `?token=` de los balanceadores
  caducan.

### 3.4 Catálogo en memoria

- **Entrada:**
  `{ id, name, base, quality, backup, hevc, country, tvgId, group, ref }`.
  - `ref` es el `stream_id` en Xtream y la URL en M3U. **Nunca sale del módulo.**
  - `base`, `quality`, `backup`, `hevc` y `country` salen de `cleanIptvTitle()` (§4.2).
- **Índice.** Por `normalizeChannelKey(base)` y por palabras, para no pasar `channelMatchScore` sobre 30 000 entradas
  en cada resolución: primero se filtra por palabras compartidas y luego se puntúa.
- **Variantes.** Las entradas con la misma `base` (FHD, HD, reserva) forman un **grupo**. Hacia fuera solo sale el id
  de la mejor variante (§4.3); las demás quedan dentro del servidor como respaldo del relé.
- **Topes.** 100 000 canales en directo (`iptv_too_large` si pasa, sin guardar nada). La lista M3U pesa 64 MiB como
  mucho comprimida y 160 MiB descomprimida. El tiempo total es de 120 s.
- **Aplicación de un resultado.**
  - Solo se aplica si `provider.id` **y** `provider.revision` no cambiaron durante la descarga. `revision` sube con
    cada cambio de datos (guardar, cambiar datos), así que una sincronización con el servidor viejo nunca pisa la
    configuración nueva.
  - Se guarda cifrado en `catalogo.enc` y se carga al arrancar (sin red).
  - Si falla, se conserva el catálogo anterior y `lastSync.ok = false`.
- **Ids que desaparecen.** No se guardan: un id IPTV se reconoce por su etiqueta aunque ya no esté en el catálogo
  (§4.1).

### 3.5 Refresco

- **Cuándo.**
  - Al guardar.
  - Al arrancar si el catálogo tiene más de 6 h.
  - Cada **6 h**.
  - Con «Actualizar ahora».
  - En segundo plano desde una resolución si tiene más de 6 h (como `refreshStaleInBackground`).
  - Con «Rebuscar» si tiene más de 30 min.
  - **En M3U, cuando un canal responde 401, 403 o 404 al abrirlo o al reconectar** (tokens caducados en la URL): se
    refresca la lista con un tope de **una vez por minuto**, se busca el mismo id y se reintenta la apertura **una
    vez** con la URL nueva. En Xtream, un 404 lanza el refresco en segundo plano (antirrebote de 10 min).
- **Cuenta Xtream** (`user_info`): cada 10 min con la IPTV activa, y en cada resolución si tiene más de 2 min (plazo
  de 5 s, que no bloquea: si tarda, se usa el último dato). No gasta conexión de stream.
- **Un solo trabajo pesado IPTV a la vez en todo el servidor.** Sincronización de la lista, descarga de la guía y
  refresco por token caducado comparten un único cerrojo. Si llega otro trabajo del mismo tipo, se engancha al que
  está en marcha (misma promesa) en vez de lanzar otra descarga. Así nunca coinciden dos descargas de decenas de MB con
  ffmpeg y el servidor en los 768 MB del contenedor.
- **Los cambios de configuración mandan.** Guardar, cambiar datos, pausar y eliminar **abortan** con `AbortSignal` la
  sincronización, la guía y la sonda en curso, y no hacen cola detrás de ellas. Si hay que sincronizar, se empieza de
  nuevo con la `revision` nueva.
- Tras un fallo, espera exponencial de 5 min a 6 h, como en directories.
- **Sin pisar la reproducción.** Si alguien está viendo lo que sea, el refresco periódico de la lista (no la cuenta) se
  retrasa hasta 1 h, para no cargar la red del N300.

### 3.6 Guía XMLTV (solo por dentro)

**De dónde sale:**
- Xtream: `{server}/xmltv.php?username=U&password=P`;
- M3U: `url-tvg` / `x-tvg-url`.
- Sus URLs llevan credenciales: se guardan cifradas dentro de `catalogo.enc` y se redactan (§2.4).

**Descarga y parseo en streaming** (`modules/iptv/xmltv.ts`).
- Se descarga con `net.openStream`, se descomprime si hace falta y se parsea con un **tokenizador XML propio y
  mínimo**. No añade dependencia. Entiende:
  - `<channel id>` y `<display-name>`;
  - `<programme start stop channel>` con `<title>`, `<sub-title>`, `<desc>`, `<category>`, `<previously-shown/>`,
    `<new/>` y `<live/>`;
  - entidades (las 5 con nombre y las numéricas), CDATA y comentarios.
  - El resto se salta sin guardarlo.
- **Defensas ante guías hostiles:**
  - `<!DOCTYPE>` y las entidades declaradas se **ignoran** (nada de «billion laughs»): solo valen las 5 con nombre y
    las numéricas; una entidad desconocida se deja tal cual;
  - tope de **8 KiB por texto** (`<desc>`, `<title>`…) **y por atributo**: lo que pase se descarta sin acumularlo;
  - profundidad máxima de 8 niveles y 64 atributos por elemento; si se pasa, se salta el elemento entero.
- **Fechas:** `YYYYMMDDhhmmss ±hhmm`. Sin zona se toma UTC, más el `tvg-shift` del canal o el global de la M3U.
- **Topes:** 64 MiB comprimida, 512 MiB descomprimida y procesada (no se guarda), 180 s en total y 30 s de inactividad.

**Qué se guarda** (en `guia.enc` y en memoria, `Map<tvgId, Programme[]>`):
- solo la ventana **de ahora a +48 h**;
- solo programas de canales del catálogo que pasan el filtro de país (§4.2);
- solo lo que parece un evento: texto con un separador de enfrentamiento (`-`, `–`, `vs`, `v`, `x`, `×`, `contra`)
  entre dos grupos de palabras, o `<category>` con sport, deporte, fútbol, football o soccer.
- Tope de 60 000 programas; si se pasa, se quedan los más cercanos.

**Refresco:**
- cada **8 h** (3 veces al día), al arrancar si tiene más de 8 h y tras una sincronización que cambie la URL de guía;
- con el cerrojo único de trabajos pesados (§3.5): nunca a la vez que una sincronización;
- se retrasa hasta 2 h si hay alguien viendo algo;
- tras un fallo, espera de 30 min a 8 h.

**Respaldo en Xtream** si `xmltv.php` da 404, llega vacía o pasa de los topes:
- se usa `get_short_epg` para **40 canales como mucho**: los que casan (≥ 70) con algún canal emisor de los partidos
  de hoy y mañana, o cuya categoría contiene deporte/sport/dazn/movistar/laliga;
- 2 llamadas a la vez, cada 3 h.

**Sin guía,** todo funciona igual: el emparejado es solo por nombre.

**Estado visible:** `guide` en `iptvGet` (canales con guía y fecha) y la línea de §1.3. Nada más.

---

## 4. Emparejado

### 4.1 El id de un canal IPTV

```
h   = hex(HMAC-SHA256(k_iptvIds,   provider.id + '\n' + clave)).slice(0, 32)
tag = hex(HMAC-SHA256(k_iptvIdTag, h)).slice(0, 8)
id  = h + tag                                   // 40 hex: cumple HashSchema y HASH_RE
```

**`clave`:**
- Xtream: `x:<stream_id>`.
- M3U: `m:<tvg-id>:<normalizeChannelKey(título)>:<n>`, donde `<n>` es el orden entre repetidos con la misma pareja.
  - La URL **no** entra: muchos proveedores rotan tokens en ella y el id tiene que ser estable.

**Propiedades del id:**
- Es estable entre sincronizaciones.
- No se puede invertir y no contiene credenciales.
- Cambia si se elimina la IPTV y se vuelve a poner, o si cambian el origen o el tipo, porque `provider.id` es nuevo.
- **Se reconoce solo.** `isIptvId(id)` (puro, sin estado) recalcula la etiqueta a partir de los 32 primeros hex. Si
  coincide, es un id IPTV de este Umbrel, de cualquier proveedor pasado o presente. Un hash de AceStream tiene una
  etiqueta válida por casualidad con probabilidad 2⁻³² (una entre 4 300 millones), y además tendría que coincidir con
  un canal del catálogo para que se usara como IPTV.
- Por eso **ya no hay `retiredIds`** ni `isRetired`: nada que guardar, nada que crezca, y «Eliminar» no puede fallar
  por el esquema.

**Cómo decide el servidor** antes de mandar un id al motor (en `channelStream`, la resolución, favoritos, historial y
el comprobador):
1. `iptv.owns(id)`: está en el catálogo vigente y la IPTV está activa → IPTV.
2. `isIptvId(id)` pero no es del catálogo vigente, o la IPTV está en pausa o eliminada → `channelStream` responde
   `404 iptv_gone`, `409 iptv_disabled` o `410 iptv_removed` **sin tocar el motor**; la resolución lo descarta.
3. Ninguna de las dos: es AceStream, el camino de siempre.

Si cambia la semilla de la app (§2.3, `iptv_secret_unreadable`), los ids viejos dejan de reconocerse y un id así que
llegue al motor solo da «no encontrado» (§12.2, riesgo 7).

### 4.2 Limpieza de nombres (`modules/iptv/names.ts`, `cleanIptvTitle`)

Los nombres IPTV traen prefijos y adornos que, con el tope de 58 de `distinctiveTokens`, romperían el emparejado.
«ES: DAZN LaLiga FHD», por ejemplo, tendría la palabra de más «es». Antes de puntuar se limpia así:

1. **País.**
   - Prefijo `^[|\[(]?\s*([A-Z]{2,3}|ESPAÑA|SPAIN)\s*[|\]):\-–]` en el título, o país en `group-title` / categoría
     («ES | DEPORTES», «SPAIN SPORTS», «UK| SPORTS»).
   - ES, ESP, SPA, SP, ESPAÑA y SPAIN dan `country: 'ES'`. Otro código da ese código. Sin nada, `null`.
2. **Adornos.** Fuera emojis, banderas, `★◉●▶►|`, corchetes vacíos, y superíndices `ᴴᴰ ᶠᴴᴰ ᵁᴴᴰ ˢᴰ`, que se leen como
   calidad.
3. **Calidad.**
   - `FHD`, `1080p?` y `Full HD` → `fhd`;
   - `UHD`, `4K` y `2160p?` → `uhd`;
   - `HD` y `720p?` → `hd`;
   - `SD`, `480p?` y `576p?` → `sd`.
   - `HEVC`, `H265` y `H.265` → `hevc: true`. `50FPS`/`60FPS` se quitan.
4. **Reserva.** `backup`, `bkp`, `bk`, `alt`, `alternativo/a`, `reserva`, `respaldo` y `multi` → `backup: true`. **Los
   números no se tocan aquí**: «DAZN LaLiga 2» es otro canal.
5. **Grafías de la IPTV** (solo en `cleanIptvTitle`, **no** en el `normalizeChannelKey` compartido, que tiene la matriz
   0.6.59 congelada):
   - «la liga» (con o sin espacio, en cualquier caja) se une en «laliga». Medido con `channelMatchScore` real, «DAZN
     LaLiga» contra «DAZN LA LIGA» y «M+ LaLiga TV» contra «M+ LA LIGA TV» dan hoy 0;
   - alias curados `IPTV_CHANNEL_ALIASES`, pocos y con test: «M+ Hypermotion» / «Movistar Hypermotion» → «LaLiga TV
     Hypermotion»; «M+ LaLiga» → «M+ LaLiga TV»; «Movistar Liga de Campeones» → «M+ Liga de Campeones». Se amplía solo
     con casos reales del corpus.
6. **Lo que queda es `base`,** que pasa por `channelMatchScore` y ya normaliza tildes, «M+» → movistar, la flecha,
   etc.

**El « 1» final.** Muchas listas llaman «M+ LaLiga TV 1» o «M+ Liga de Campeones 1» al canal que la agenda llama sin
número (hoy dan 78, por debajo del umbral). En el emparejado (no en la limpieza), si el canal **pedido no lleva
número** y la entrada IPTV acaba en « 1», se puntúa también sin ese « 1», con la misma idea que
`semanticNumbersCompatible`. Nunca al revés: «DAZN 1» pedido no casa con «DAZN», y «DAZN 1» no casa con «DAZN F1».

**Corpus.** `match.test.ts` y `names.test.ts` llevan un corpus de 100-200 nombres reales de listas españolas
(anonimizados, sin URLs) con el resultado esperado. Las trampas medidas deben seguir fuera: Hypermotion contra LaLiga
TV (58), «Bar» (58), «Antena 3 Internacional» (58), «DAZN 1» contra «DAZN F1» (0).

**Filtro de país.** Solo entran en el emparejado las entradas con `country` ES o `null`. «UK: Sky Sports» o «IT: DAZN
1» no pueden casar con «DAZN 1». Es una decisión por defecto (§12).

### 4.3 IPTV ↔ canal emisor de un partido

Hay una capa nueva en `resolveFootballChannel()` (`football/resolution.ts`), que se consulta **siempre** si la IPTV
está activa y el catálogo cargado. No depende del motor, así que también funciona con el motor caído
(`engineAvailable: false`).

1. **Canales pedidos:** los mismos `resolutionChannels()` de hoy (8 como mucho).
2. **Puntuación.** Para cada canal y cada entrada IPTV preseleccionada por palabras:
   `scoreResolutionCandidate({ title: base, alias: tvgId })`, **la misma función**.
   - Así se hereda la protección Hypermotion: «LaLiga TV Hypermotion» contra «LaLiga TV» se queda en ≤ 58.
   - También `channelAllowsFamilyFallback()` y la regla de los números («DAZN 1» ≠ «DAZN 2»).
3. **Umbral estricto: 92** (`IPTV_MIN_SCORE = RESOLUTION_EXACT_SCORE`), no 70.
   - Una familia numerada (78) nunca entra. En catálogos de miles de canales, mejor no emparejar que emparejar mal.
     La única excepción es la del « 1» final cuando el canal pedido no lleva número (§4.2), que se puntúa sin él.
   - `sources.applyLearnedRules()` se aplica igual: un «Canal incorrecto» de Isma aparta esa IPTV para ese canal, y un
     «Es el canal correcto» la sube a 98.
4. **Un cartel por canal IPTV.** Las variantes con la misma `base` (FHD, HD, reserva) se juntan y sale **una sola**
   candidata, la mejor según estos desempates:
   1. no `hevc` antes que `hevc` (la web no reproduce HEVC, D6);
   2. calidad `fhd` > `hd` > `uhd` > `sd` > sin marca;
   3. no `backup` antes que `backup`;
   4. fiabilidad de Wilson (veredictos del reproductor);
   5. orden del catálogo.
   - Las demás variantes (hasta 2, la mejor `backup` incluida si existe) quedan **dentro del servidor** como respaldo:
     si la principal da `iptv_gone`, `iptv_timeout` o `iptv_dropped`, el relé prueba la siguiente variante **antes** de
     dar la IPTV por caída (§6.1). Si el fallo es de cuenta (`iptv_busy`, `iptv_auth_failed`,
     `iptv_account_expired`), no se prueban variantes: se salta directamente a AceStream.
5. **Tope: 2 candidatas IPTV en total** por resolución (dos canales distintos, por ejemplo «DAZN LaLiga» y «M+ LaLiga
   TV»). Es «una fuente más con su distintivo», no una fila de carteles del mismo canal.
6. **Guía (§4.5).** Una IPTV confirmada por la guía ocupa una de esas 2 plazas, con puntuación 100 y `matchedChannel` =
   el nombre del canal IPTV limpio. Si la guía y el nombre dan el mismo canal (misma `base`), sale una vez, con
   `guide: true`.

### 4.4 IPTV ↔ canales de las listas de AceStream (canales sueltos)

Es la misma capa, llamada con `scope=channel` (§5.2) y con el título del canal que se abre (por ejemplo «Antena 3»)
como único canal pedido. Umbral 92, los mismos desempates, un cartel por canal y 2 IPTV como mucho.

**Alcance:** la IPTV **complementa** canales y partidos que ya existen.
- No entra en la biblioteca, ni en «Listas», ni en el buscador, ni en la agenda.
- Un canal que solo está en la IPTV no se ve en ningún sitio.
- **Pregunta abierta para Isma antes de implementar** (§12, D10). Su propio ejemplo es Antena 3, y los canales en
  abierto muchas veces no vienen en las listas de AceStream: si sus listas no lo traen, no podrá ver Antena 3 por su
  IPTV. Si lo quiere, se adelanta lo que hoy está aparcado: un grupo discreto «En tu IPTV», con 5 resultados como mucho,
  al final del buscador de Canales, solo con 3 letras o más y cuando AceStream da menos de 3 resultados.

### 4.5 La guía para encontrar el canal del partido (`modules/iptv/guide-match.ts`, puro)

Entrada: el partido de la agenda (`home`, `away`, `competition`, `start`) y los programas de la ventana. Una entrada
IPTV queda **confirmada por la guía** solo si **todo** esto se cumple:

1. **Hora.**
   - El programa empieza entre **30 min antes y 15 min después** del saque inicial.
   - Dura entre 80 y 240 min.
   - Acaba al menos 90 min después del saque.
2. **Equipos.**
   - Los dos equipos aparecen **en el mismo campo** (`title`, `sub-title` o `desc`), a menos de 40 caracteres uno de
     otro y separados por un separador de enfrentamiento (`-`, `–`, `vs`, `v`, `x`, `×`, `contra`, `/`).
   - Se compara sobre texto sin tildes y en minúsculas, por **palabra completa**.
   - Alias de cada equipo:
     - `footballTeamKey(nombre)`;
     - la clave sin prefijos (`real`, `club`, `cd`, `ud`, `sd`, `rcd`, `rc`, `ca`, `fc`, `cf`) si queda con 5 letras o
       más;
     - la tabla curada `EPG_TEAM_ALIASES`: barça/barca → barcelona; atleti/atlético → atletico madrid; athletic →
       athletic club; betis → real betis; celta; espanyol; rayo → rayo vallecano; osasuna; etc.;
     - si `teams` los tiene, `strTeamAlternate` y `strTeamShort`.
   - Las abreviaturas de 3 letras (`RMA`, `BAR`) **solo** valen en el patrón compacto `AAA-BBB` / `AAA v BBB`, con las
     dos como abreviatura.
   - Nunca valen como alias sueltos `real`, `madrid`, `sporting`, `racing`, `union`, `deportivo`, `club` ni `city`.
   - Un alias seguido de ` B`, `C`, `II`, `Femenino`, `Fem`, `Sub-19`, `Juvenil`, `Atlètic`, `Castilla`, `Atlético`
     (Sevilla Atlético), `Deportivo` (Betis Deportivo) o `Promesas` no cuenta: es el filial o el equipo femenino.
     «Bilbao Athletic» no cuenta como Athletic Club.
3. **Marcas de «no es el partido».** Sobre `title`, `sub-title` y `desc`, sin tildes y por palabra, cualquiera de estas
   lo descarta:
   - `(R)`, `[R]`, `R:` al principio, `(D)`;
   - `repeticion`, `reemision`, `diferido`, `en diferido`, `grabado`, `replay`;
   - `resumen`, `resumenes`, `highlights`, `mejores momentos`, `goles de`;
   - `previa`, `prepartido`, `pre-partido`, `postpartido`, `post partido`;
   - `rueda de prensa`, `analisis`, `tertulia`, `magazine`.
   - También lo descartan el elemento `<previously-shown/>` y una `<category>` News/Magazine/Talk/Noticias.
   - `<live/>`, «directo», «en vivo» o «(L)» no son obligatorios: solo desempatan entre dos programas válidos.
4. **Competición.**
   - El texto (título, subtítulo, descripción y categorías) tiene que nombrar la familia del partido de
     `COMPETITION_FAMILIES` (LaLiga Primera, Hypermotion/Segunda, Liga F, Champions, Europa League, Conference, Copa
     del Rey, Supercopa, Premier, Serie A, Bundesliga, Ligue 1, Nations League, Mundial, Eurocopa) **y ninguna otra**.
   - Si no nombra ninguna, solo vale si la nombra el canal («DAZN LaLiga», «M+ LaLiga TV 2»). En un generalista
     («La 1», «DAZN 1») sin la competición en la guía, no se confirma: mejor no emparejar que emparejar mal.
   - Sin familia conocida del partido (un amistoso), no se exige.
   - Tampoco valen, en ningún campo ni categoría: otros deportes (baloncesto, ACB, Liga Endesa, Euroliga, fútbol
     sala, futsal, balonmano, voleibol, hockey, rugby, tenis, pádel…), el femenino («Femenino», «(Fem.)», «Femenina»,
     «Women»; salvo que el partido sea de Liga F) ni las categorías inferiores (Youth League, juvenil, Sub-19…).
     «(Dif.)» cuenta como diferido y «Barcelona SC» como otro equipo.
5. **Canal.**
   - **País ES explícito**, más estricto que el filtro general: un canal sin país (`null`) solo vale si además casa
     (≥ 70) con algún canal emisor de la agenda. Si la agenda no trae canales, solo valen canales ES explícitos. Así un
     canal extranjero sin prefijo, con otro idioma, no se pone primero por la guía.
   - **El nombre del canal no puede nombrar otra competición.** Si el nombre (limpio) nombra una familia de
     `COMPETITION_FAMILIES` distinta de la del partido, se descarta: «M+ Liga de Campeones» o «Champions» con un
     partido de LaLiga, «Liga F» con uno masculino, «Premier» con uno español, etc. Es la regla Hypermotion ampliada a
     todas las familias: `hypermotion`, `smartbank` o `segunda` con un partido que no es de Hypermotion
     (`matchIsLaLigaHypermotion`) se descarta, y al revés, un canal de Primera («LaLiga TV» sin Hypermotion, «DAZN
     LaLiga») con un partido de Hypermotion también.
   - Los canales generalistas, sin familia en el nombre («La 1», «DAZN 1», «M+ Vamos»), pasan esta regla.
6. **Ambigüedad.**
   - Tras juntar las variantes (misma `base`), si quedan más de 3 canales distintos, solo se quedan los que **también**
     casan (≥ 70) con algún canal emisor de la agenda.
   - Si no queda ninguno, **no se confirma nada**.

**Qué se hace con una entrada confirmada:**
- va **primera**, aunque la agenda no la anuncie o anuncie otro canal;
- lleva `iptv.guide = true` y puntuación 100;
- se calcula por partido y se guarda en caché 10 min.

**Partido sin canales en la agenda.** Hoy la web no llama al servidor. Con este cambio llama a `footballResolve?match=`
(§8.4), **solo si la IPTV está activa** (`features.iptv`, §5.1). Sin canales, el servidor **solo consulta la guía**
(IPTV confirmadas y pistas de AceStream que salgan de ella): no lanza el buscador del motor, ni la IA, ni devuelve
`choices`. Si no encuentra nada, devuelve `not_found` **sin trabajo del comprobador**, y la web se queda en
`no_channels` con «El canal todavía no está anunciado», como hoy, sin abrir «Encontrar canal». La agenda no cambia.

**Pista para AceStream.** Los nombres de canal confirmados por la guía (2 como mucho) se añaden a los canales de la
resolución como **pistas**.
- Una candidata AceStream que solo casa con una pista (≥ 70, las reglas de siempre) entra con esa pista como
  `matchedChannel`.
- Su nivel de marca queda **topado en el de ≥ 70**, así que nunca adelanta a una candidata que casa ≥ 92 con un canal
  de la agenda.
- No cambia el umbral, ni Hypermotion, ni las reglas aprendidas.

### 4.6 Orden final

En `sources/ranking.ts`, `DEFAULT_SOURCE_ORDER` pasa a
`['iptv', 'saved', 'm3u', 'favorites', 'history', 'acestream']`.

Como toda IPTV tiene ≥ 92, siempre está en el nivel de marca alto, y dentro de él la procedencia la pone primera:
1. primero las IPTV confirmadas por la guía;
2. luego las IPTV por nombre;
3. luego lo guardado y AceStream, como hoy.

Una IPTV **nunca** adelanta por nombre a nada: no hay IPTV por debajo de 92.

Un vínculo guardado (`saved`) de AceStream queda **detrás** de la IPTV, porque «si hay ese canal en la IPTV, sale
primero».

**Ids IPTV en vínculos, favoritos e historial.** Todo id que llega de `saved`, de `libraryResolutionCandidates`
(`source: 'favorites'` o `'history'`) o de las hermanas de la biblioteca pasa por la decisión de §4.1 **antes** de
deduplicar:
- si es del catálogo vigente y la IPTV está activa, se convierte en `source: 'iptv'` con su campo `iptv` (y cuenta
  dentro del tope de 2);
- si es un id IPTV que ya no vale (en pausa, eliminada, otro proveedor, fuera del catálogo), **se descarta**;
- así nunca sale un cartel de AceStream con «Copiar hash» apuntando a un canal IPTV.

Además, la web y la app no llenan Favoritos ni Recientes de ids IPTV: una IPTV se reproduce con `record: false` y su
cartel no ofrece «Favorito» (§8.1). Un canal de AceStream favorito que tiene IPTV ya la trae primero al tocarlo
(§8.4).

`status`:
- `found` si la primera es IPTV (≥ 92) o lo de siempre;
- `candidate` = la IPTV.
- `checked` suma `'iptv'` cuando la capa se consultó.

---

## 5. Contrato de la API (`packages/shared`, zod)

### 5.1 Una candidata IPTV es una candidata más

No cambia **ningún** formato de id: `HashSchema` sigue siendo de 40 hex. Cambia esto:

```ts
// api/common.ts
CandidateSourceSchema = z.enum(['saved', 'm3u', 'favorites', 'history', 'acestream', 'iptv']);

export const IptvQualitySchema = z.enum(['uhd', 'fhd', 'hd', 'sd']);
export const CandidateIptvInfoSchema = z.strictObject({
  provider: z.string().max(40),        // nombre que puso Isma («Casa»)
  quality: IptvQualitySchema.nullable(),
  backup: z.boolean(),
  guide: z.boolean(),                  // confirmada por la guía (no se enseña; diagnóstico y tests)
});

ResolutionCandidateSchema = z.strictObject({ ...lo de hoy..., iptv: CandidateIptvInfoSchema.optional() });
```

Así queda una candidata IPTV. Lleva **todos** los campos obligatorios de hoy, así que la app 0.8.0 la decodifica:

```json
{ "id": "3f7c…40 hex", "title": "DAZN LaLiga --> Casa", "alias": "DAZNLaLiga.es", "ih": false,
  "source": "iptv", "score": 100, "matchedChannel": "DAZN LaLiga", "soloFamilia": false,
  "familyFallbackAllowed": false, "listaId": "p_Ab3dE5gH", "availability": null, "bitrate": null,
  "learned": null, "reported": null, "rejectedByLearning": false, "quarantined": false,
  "iptv": { "provider": "Casa", "quality": "fhd", "backup": false, "guide": false } }
```

- **`title`:** el nombre limpio más `--> {proveedor}`. `normalizeChannelKey` quita lo que va tras la flecha, y la
  presentación corta de la web y de la app toma el proveedor de ahí.
- **`alias`:** el `tvg-id` o `null`.
- **`bitrate`:** lo que mida la sonda de fondo (§7.3), en la misma unidad que hoy, o `null` (lo normal).
- **`id`:** el de la mejor variante del canal (§4.3). Las demás variantes no salen nunca del servidor.

**Otros cambios, todos opcionales o de enum,** que las apps toleran (`EnumTolerante` y claves desconocidas ignoradas):
- `BootstrapResponseSchema.features.iptv: z.boolean().optional()`: «hay IPTV activa con catálogo cargado». Es el dato
  barato (`access: 'any'`) con el que la web y la app deciden si merece la pena preguntar por la IPTV al tocar un canal
  (§8.4) o al abrir un partido sin canales. La web invalida `bootstrap` con `iptv.status`. **El fixture
  `v1/bootstrap.json` no lo lleva** (es opcional), para que la ida y vuelta de `FixturesTests` en la app no cambie.
- `ResolveQuerySchema.scope: z.enum(['match', 'channel']).optional()` (§5.2).
- `StreamGrantSchema.source: z.enum(['engine', 'iptv']).optional()` y
  `SessionSummarySchema.source: z.enum(['engine', 'iptv']).optional()`. Sirven para los textos del reproductor y para
  «Dónde se está reproduciendo».
- `ScanCandidate.reason` sigue siendo texto libre. Motivos nuevos:
  `IPTV_REASONS = ['iptv_busy', 'iptv_auth_failed', 'iptv_account_expired', 'iptv_gone', 'iptv_timeout', 'iptv_unreachable', 'iptv_dropped', 'iptv_unsupported']`
  (en `constants/`). No hay `iptv_ready`: una cuenta activa no es un stream verificado (§7.3).

### 5.2 `footballResolve` con `scope=channel` (canales sueltos)

`GET /api/v1/football/resolve?channel=<título>&scope=channel&client=<visor>`, sin `match`.

**Con `scope=channel`, el servidor:**
- consulta solo vínculos guardados, la biblioteca (`libraryResolutionCandidates`, las mismas hermanas que
  `librarySiblings`) y **la IPTV**;
- **no** usa el buscador del motor ni la IA;
- tarda menos de 300 ms (todo está en memoria).

**Respuesta:**
- **Sin ninguna candidata IPTV:** `{ status: 'not_found', candidates: [], candidate: null, scan: null }`. No encola
  trabajo. La web sigue exactamente como hoy (§8.4). Se usa esta forma para no mezclar dos significados en la misma
  respuesta.
- **Con IPTV:** la `Resolution` normal. Las IPTV van primero y detrás las hermanas ≥ 92. Se encola un trabajo del
  comprobador (`interactive`, `clientKey` = visor) **solo con las AceStream** y la comprobación de cuenta de las IPTV
  (nivel 1). **Ninguna sonda de stream** a una IPTV desde una resolución interactiva: la reproducción ya es la prueba
  (§7.3).
- Si la web no adopta la respuesta (llegó tarde, §6.6), ese trabajo lo sustituye el siguiente `interactive` del mismo
  `clientKey`. Al implementar se comprueba que el comprobador ya lo hace así; si no, playback lo cancela cuando ese
  visor adquiere otra sesión.

**`footballResolve` en general** (con partido): el mismo reparto. Las IPTV entran en `candidates`, el trabajo del
comprobador lleva las AceStream y el nivel 1 de las IPTV, y nunca una sonda de stream IPTV.

### 5.3 Rutas nuevas de ajustes (todas `access: 'web'`)

El iPhone recibe `403 origin_forbidden` sin tocar nada más. La app no las llama: solo se regenera `RutaID` (§10.1).
Son 5 rutas: no hay `iptvTest` (§1.2).

| id | método y ruta | cuerpo | respuesta | errores |
|---|---|---|---|---|
| `iptvGet` | `GET /api/v1/iptv` | — | `IptvView` | — |
| `iptvSave` | `PUT /api/v1/iptv` | `IptvSaveBody` | `IptvView` (`status: 'syncing'`) | `bad_url`, `private_url`, `dns_failed`, `iptv_*` de conexión, `iptv_credentials_required` |
| `iptvUpdate` | `PATCH /api/v1/iptv` | `{ enabled?: boolean, name?: string }` | `IptvView` | `iptv_not_configured` |
| `iptvSync` | `POST /api/v1/iptv/sync` | — | `IptvView` (`status: 'syncing'`) | `iptv_not_configured`, `iptv_disabled` |
| `iptvDelete` | `DELETE /api/v1/iptv` | — | `IptvView` (`provider: null`) | — |

Esquemas en `packages/shared/src/api/v1/iptv.ts`:

```ts
const Name = z.string().trim().min(1).max(40);
const Url = z.string().trim().max(2048);
export const IptvSaveBodySchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('m3u'), name: Name.optional(), url: Url.optional() }),
  z.strictObject({ kind: z.literal('xtream'), name: Name.optional(), server: Url.optional(),
                   username: z.string().min(1).max(200).optional(),
                   password: z.string().min(1).max(200).optional() }),
]);
// Ausente = «el guardado». Al crear, o si cambia el tipo o el origen del servidor, son obligatorios → iptv_credentials_required.

export const IptvStatusSchema = z.strictObject({
  status: z.enum(['syncing', 'ok', 'error', 'disabled']),
  channels: z.number().int().nonnegative(),
  updatedAt: IsoDateTimeSchema.nullable(),
  error: z.strictObject({ code: ShortCodeSchema, message: z.string() }).nullable(),
  staleSince: IsoDateTimeSchema.nullable(),          // hay copia anterior en uso
  account: z.strictObject({
    status: z.enum(['active', 'expired', 'banned', 'disabled', 'unknown']),
    expiresAt: IsoDateTimeSchema.nullable(),
    maxConnections: z.number().int().nonnegative().nullable(),
    activeConnections: z.number().int().nonnegative().nullable(),
    ours: z.number().int().nonnegative(),            // conexiones abiertas por Ace Player ahora
  }).nullable(),
  guide: z.strictObject({
    available: z.boolean(),
    channelsWithGuide: z.number().int().nonnegative(),
    updatedAt: IsoDateTimeSchema.nullable(),
    failedAt: IsoDateTimeSchema.nullable(),
  }),
});

export const IptvViewSchema = z.strictObject({
  provider: z.strictObject({
    kind: z.enum(['m3u', 'xtream']),
    name: Name,
    enabled: z.boolean(),
    host: z.string(),
    origin: z.string().nullable(),                   // solo xtream
    hasUrl: z.boolean(), hasUsername: z.boolean(), hasPassword: z.boolean(),
    ...IptvStatusSchema.shape,
  }).nullable(),
  refreshHours: z.literal(6),
});
```

**Guardado.**
- `iptvSave` hace **solo una prueba rápida** (Xtream: `user_info`, 8 s; M3U: los primeros 256 KiB con `#EXTM3U` y al
  menos un stream http, 20 s).
  - Si falla, **no guarda** y devuelve el error.
  - Si va bien, cifra, guarda (con `revision` + 1), responde `syncing` y lanza la sincronización completa en segundo
    plano. El recuento de canales llega por `iptv.status`.
  - Aborta antes cualquier sincronización, guía o sonda en curso (§3.5).
- **Plazos de la web** (`api/client.ts` → `TIMEOUTS`): `iptvSave: 30_000`, `iptvSync: 12_000`. Ninguna ruta IPTV
  necesita más de los 60 s de nginx.

**Eliminar** (`iptvDelete`):
- aborta los trabajos en curso y cierra las sesiones IPTV vivas (§7.4);
- borra `provider`, `catalogo.enc`, `guia.enc`, **`iptv.json.bak` y las copias de `iptv` apartadas como corruptas**
  (`createDocumentStore` gana `purge()` para esto), y escribe `iptv.json` con `provider: null`;
- no necesita apuntar ningún id: los ids IPTV se siguen reconociendo por su etiqueta (§4.1) y dan `410 iptv_removed`.

**Pausa** (`enabled: false`):
- deja de ofrecer IPTV;
- cierra las sesiones vivas igual que al eliminar;
- conserva el catálogo.

### 5.4 Ruta de vídeo para la web

`video` (`GET /api/v1/video/:sid/:file`) pasa de `access: 'native'` a **`access: 'any'`**. Hoy la credencial
`video-token` necesita el `deviceId` de un dispositivo emparejado (`signVideoToken`, `playback/routes.ts:70`) y solo se
verifica con origen `native` (`app.ts:298`); la web no tiene dispositivo. Por eso el contrato queda así:
- **Origen `web`:** `VideoQuerySchema.t` pasa a **opcional** y se **ignora**; la web ya pasa por el login de Umbrel,
  como el resto de `/api/`. La concesión lleva `url: '/api/v1/video/<sid>/index.m3u8'`, sin token. `serveFile()` no
  añade `?t=` a las URIs del m3u8 si la petición no lo traía. La sesión `sid` tiene que existir y ser IPTV o remux vivo;
  si no, `404` como hoy.
- **Origen `native`:** todo igual que hoy. `/native/api/v1/video/…` sin `t`, o con uno inválido, sigue dando
  `video_token_invalid`, y hay un test que lo vigila.

### 5.5 Eventos SSE

- **Nuevo `iptv.status`,** `data: IptvStatusSchema`. Se emite al empezar y terminar una sincronización, al cambiar la
  guía o la cuenta, y al activar, pausar o eliminar. Va en **`WEB_ONLY_EVENT_TYPES`**: nunca llega a `/native`.
- **Sin ámbito nuevo en `STATE_SCOPES`.** El iPhone no tiene nada que invalidar: las resoluciones se piden cada vez.
- **Los eventos de hoy valen tal cual con ids IPTV:** `scan.verdict`, `scan.progress`, `playback.*`, `stream.ready` y
  `stream.stats`.
  - En `stream.stats` de una IPTV: `status: 'iptv'`, `peers: 0`, `speedUp: 0`, `speedDown` = KB/s que entran por el
    relé y `downloaded` = bytes.
- **`stream.closed` de una IPTV** usa siempre `reason: 'remux_failed'` con `code: 'iptv_…'` (`iptv_dropped`,
  `iptv_disabled`, `iptv_removed`, `iptv_busy`), sin valores de enum nuevos. Una app sin cambios lo trata como un corte
  de fuente (reconecta y la da por agotada), que es justo lo que se quiere.
- **`stream.reopened` con `reason: 'remux_restart'`** (valor que ya existe) cuando el relé reconecta y el TS del
  proveedor llega con otra base de tiempos (§6.1): mismo `sid`, ffmpeg nuevo, URL nueva. hls.js y AVPlayer se
  reenganchan como tras un reinicio del motor.

### 5.6 Códigos de error nuevos (`errors.ts`, `legacyStatus: null`, `public: true`)

| código | HTTP | mensaje |
|---|---|---|
| `iptv_not_configured` | 409 | «Todavía no has conectado ninguna IPTV.» |
| `iptv_disabled` | 409 | «Tu IPTV está en pausa.» |
| `iptv_removed` | 410 | «Has eliminado tu IPTV.» |
| `iptv_credentials_required` | 400 | «Si cambias el servidor o el tipo, vuelve a escribir el usuario y la contraseña.» |
| `iptv_secret_unreadable` | 409 | «No se pueden leer los datos guardados de tu IPTV. Vuelve a escribirlos.» |
| `iptv_auth_failed` | 502 | «Tu proveedor de IPTV no acepta ese usuario y contraseña.» |
| `iptv_account_expired` | 502 | «La cuenta de tu IPTV ha caducado o está desactivada.» |
| `iptv_unreachable` | 502 | «Tu proveedor de IPTV no responde.» |
| `iptv_timeout` | 504 | «Tu IPTV no respondió a tiempo.» |
| `iptv_busy` | 503 | «Tu IPTV ya tiene todas sus conexiones en uso. Cierra la otra reproducción o espera un momento.» |
| `iptv_gone` | 404 | «Ese canal ya no está en tu IPTV.» |
| `iptv_dropped` | 502 | «Tu IPTV ha cortado la emisión.» |
| `iptv_unsupported` | 422 | «Ese canal de tu IPTV usa un formato que no se puede reproducir aquí.» |
| `iptv_bad_list` | 422 | «La dirección respondió, pero no es una lista M3U con canales en directo.» |
| `iptv_empty` | 422 | «La lista no trae ningún canal en directo que se pueda usar.» |
| `iptv_too_large` | 502 | «La lista de tu IPTV es demasiado grande para el Umbrel.» |

Son 16 códigos. **Ninguno** entra en `SYSTEM_ERRORS` de la web ni en su equivalente de la app. Son errores **de
fuente**: agotan la fuente y permiten el salto (§7).

### 5.7 Fixtures, openapi y documentación

La app de `rediseno/nativa` recorre **todos** los `fixtures/v1/*.json` y `fixtures/events/*.json`: `FixturesTests`
exige un tipo Swift para cada uno y el mismo número de eventos que `SSEEvent.tiposConocidos`, y `GeneradosTests` exige
que cada nombre de `v1/` sea un `RutaID`. Por eso lo solo web y las variantes van **aparte**, en carpetas que la app no
recorre:

- **`fixtures/web/v1/`:** `iptvGet.json`, `iptvSave.json`, `iptvUpdate.json`, `iptvSync.json` e `iptvDelete.json` (las
  rutas con `access: 'web'` nuevas).
- **`fixtures/web/events/`:** `iptv.status.json` (los tipos de `WEB_ONLY_EVENT_TYPES`).
- **`fixtures/variantes/`:** `footballResolve.iptv.json`, con una IPTV primera confirmada por la guía, otra IPTV por
  nombre y dos AceStream, y `channelStream.iptv.json`, con `protocol: 'hls'`, `url` `/api/v1/video/<sid>/index.m3u8` y
  `source: 'iptv'`. Se validan contra el esquema de la ruta cuyo id es el nombre antes del primer punto.
- **`fixtures/v1/` y `fixtures/events/` no cambian**: ni `footballResolve.json`, ni `channelStream.json`, ni
  `bootstrap.json` (sin `features.iptv`). La demo y los golden de la app los usan.
- **`contracts.test.ts`** («ninguno sobra») se adapta con una lista explícita `WEB_FIXTURE_ROUTE_IDS` (las 5 rutas
  `iptv*`; `healthLive` y las demás rutas `web` de antes se quedan en `v1/`, donde la app ya las conoce):
  - `v1/` = rutas JSON menos `WEB_FIXTURE_ROUTE_IDS`; `web/v1/` = `WEB_FIXTURE_ROUTE_IDS`;
  - `events/` = `SSE_EVENT_TYPES` menos `WEB_ONLY_EVENT_TYPES`; `web/events/` = `WEB_ONLY_EVENT_TYPES`;
  - cada fichero de `variantes/` valida con su esquema.
  - No existe un `fixtures.test.ts` aparte: todo va en `contracts.test.ts`.
- **Otros ficheros generados y de documentación:**
  - `pnpm --filter @ace/shared openapi` regenera `docs/openapi-v2.yaml` (`docs/openapi.yaml` es la 0.6.59, a mano);
  - `docs/api.md` gana una sección «IPTV» con las rutas, `scope=channel` y la ruta `video` abierta a la web;
  - `docs/contratos.md` gana una línea sobre los ids sintéticos.

---

## 6. Reproducción por el servidor

### 6.1 El camino del vídeo

```
proveedor ──(net: SSRF, IP fijada, UA)──► relé 127.0.0.1:<p>/r/<ticket>/… ──► ffmpeg (-c:v copy, AAC)
          ◄── 1 sola conexión por canal                                         │
                                                                               ▼
                                             remuxDir/<id>/index.m3u8 + init.mp4 + index<N>.m4s
                                              │                                   │
                               web: /api/v1/video/<sid>/… (sin t)  iPhone: /native/api/v1/video/<sid>/…?t=
                                    hls.js (protocolo 'hls')            AVPlayer ('hls-fmp4')
```

**Relé** (`modules/iptv/relay.ts`).
- Es un `http.createServer` propio del módulo, escuchando **solo en `127.0.0.1`** en un puerto efímero. No es una ruta
  de Fastify, así que no es accesible desde nginx ni desde otro contenedor.
- Cada sesión IPTV tiene un `ticket` aleatorio de 128 bits, que solo vale mientras vive la sesión y que se redacta en
  los registros.
- **Una sola conexión al proveedor por ticket.** Una segunda petición a `in.ts` del mismo ticket mientras la primera
  sigue abierta recibe `409` y **nunca** abre otra conexión al proveedor. En HLS, la lista y los segmentos se piden de
  uno en uno por ticket.
- **El relé nunca devuelve un 3xx a ffmpeg.** Sigue las redirecciones él mismo con `net` (con el filtro SSRF en cada
  salto).
- **Ciclo de vida atado al de ffmpeg.** El relé aborta la conexión con el proveedor **en cuanto** se cierra el socket
  de ffmpeg, y ante cualquier `closeLocked` u `onExit` del remux de esa sesión (desalojo por `makeRoomLocked`, recolector
  por inactividad, ffmpeg que muere solo). Nunca queda una conexión colgada ocupando la plaza.
- **Reconexión desde la URL original**, nunca desde la `finalUrl` anterior (§3.3). En M3U, un 401/403/404 al
  reconectar refresca la lista una vez (§3.5).

**Origen TS** (Xtream `.ts` o M3U `.ts` / sin extensión): `GET /r/<ticket>/in.ts`.
- El relé abre `net.openStream(urlReal)` y copia el cuerpo tal cual.
- **Reconexión.** Si el origen se corta o no manda bytes en 10 s:
  1. el relé **cierra siempre el socket viejo** antes de abrir el nuevo;
  2. reintenta con espera creciente de **1, 2 y 4 s**, con 8 s como mucho para las cabeceras en cada intento, y **3
     intentos en 60 s** como mucho;
  3. 403, 429, 456, 458 y 509 cuentan como «plaza ocupada» (el proveedor aún cuenta el socket viejo) y se reintentan
     igual, sin gastar variantes;
  4. mientras tanto **no cierra** la conexión con ffmpeg.
  - El peor caso son 10 + (1 + 8) + (2 + 8) + (4 + 8) = **41 s** sin bytes (49 s si después abre otra variante),
    por debajo del `-rw_timeout` de ffmpeg (55 s, §6.3). ffmpeg nunca muere antes de que el relé termine de
    intentarlo.
- **Otra base de tiempos tras reconectar.** El relé mira el primer PTS y el PCR de lo que llega tras reconectar. Si
  saltan más de **5 s** respecto a lo último que pasó (hacia delante o hacia atrás), **no empalma**: corta la entrada
  de ese ffmpeg y playback reinicia el remux en la misma sesión, con `stream.reopened { reason: 'remux_restart' }`
  (§5.5). Con `-c:v copy` y sin discontinuidad, empalmar haría saltar el HLS de salida y atascaría a hls.js y a
  AVPlayer.
- **Variantes.** Si el canal da `iptv_gone`, `iptv_timeout` o `iptv_dropped` y tiene otra variante (§4.3), el relé la
  prueba **una vez** (con reinicio de remux, como arriba) antes de dar la IPTV por caída. Con un fallo de cuenta, no.
- **Si se agota:** primero se cierra la sesión en playback con `iptv_dropped` (§7.4) y **después** se mata ffmpeg. Así
  gana `iptv_dropped` y no un `remux_died` que la web o la 0.8.0 reintentarían 3 veces contra un proveedor caído.

**Origen HLS** (`.m3u8`): `GET /r/<ticket>/index.m3u8`.
- **Lista maestra.** El relé elige **una** variante: la de mayor `BANDWIDTH` con `RESOLUTION` ≤ 1920×1080, o la mayor
  si no hay resolución, **entre las que llevan el audio muxeado**. Si todas usan una rendición de audio aparte
  (`#EXT-X-MEDIA TYPE=AUDIO` con `URI`), el canal da `iptv_unsupported`: mejor decirlo que dar vídeo mudo. La sirve
  aplanada como lista de medios, para que ffmpeg no abra todas las variantes.
- **Lista de medios: reescritura por lista blanca.** Solo pasan `#EXTM3U`, `#EXT-X-VERSION`, `#EXT-X-TARGETDURATION`,
  `#EXT-X-MEDIA-SEQUENCE`, `#EXT-X-DISCONTINUITY-SEQUENCE`, `#EXT-X-DISCONTINUITY`, `#EXT-X-PROGRAM-DATE-TIME`,
  `#EXT-X-ENDLIST`, `#EXTINF` y sus URIs de segmento, `#EXT-X-MAP` y `#EXT-X-KEY` (`METHOD=NONE` o `AES-128`). Todo lo
  demás se **descarta**: `EXT-X-MEDIA`, `I-FRAME`, `SESSION-KEY`, `PART`, `PRELOAD-HINT`, `SKIP`, etiquetas
  desconocidas y cualquier URI que no sea de una de esas etiquetas.
  - Cada URI conservada se reescribe a `/r/<ticket>/s/<seq>.<ext>` o `/r/<ticket>/k/<n>`. El relé guarda `seq → URL
    real` (los 40 últimos) y descarga cada segmento por `net` al pedirlo.
  - **`<ext>` normalizada** según el tipo real (`.ts`, `.m4s`, `.aac`, `.mp4` para el `MAP`), mirando los primeros
    bytes y el `Content-Type`, aunque el proveedor sirva segmentos sin extensión o `.php`. Así pasan
    `allowed_extensions` y `extension_picky` de ffmpeg 7.1+.
- La lista del proveedor se pide como mucho una vez por segundo: las peticiones seguidas de ffmpeg se atienden desde
  caché.
- Un 404 de un segmento que ya salió de la ventana se contesta con 404 y ffmpeg lo salta. Tres fallos seguidos de la
  lista de medios, o 15 s sin lista nueva, cuentan como corte y siguen la misma regla de reconexión que en TS. Un salto
  de `#EXT-X-DISCONTINUITY-SEQUENCE` o de base de tiempos se trata como en TS (reinicio del remux).

**Lo que ve ffmpeg**: solo URLs del relé. Así:
- no hay credenciales en `/proc/<pid>/cmdline`;
- su stderr solo repite URLs de `127.0.0.1` con ticket;
- ffmpeg **no se salta el filtro SSRF ni la regla de una conexión**, porque ninguna URI del proveedor le llega y nunca
  recibe una redirección.

### 6.2 Cuándo se reescribe y cuándo se remuxa

**Siempre se remuxa** con ffmpeg: `-c:v copy` y audio AAC a 160k estéreo. **La lista del origen solo se reescribe
dentro del relé,** para que ffmpeg lea a través de él. Nunca se sirve a un cliente. Las razones:
1. Las URLs de segmento del proveedor llevan credenciales.
2. Mucho IPTV español lleva audio AC3/E-AC3 o MP2, y Chrome no lo reproduce en MSE. El remux lo pasa a AAC.
3. Así sale un solo formato (fMP4) para la web y el iPhone, con los mismos tiempos y la misma pieza probada (`remux`).
4. Es una sola conexión al proveedor por canal, con un solo lector.

El vídeo no se transcodifica nunca:
- **HEVC** vale en el iPhone, pero en la web queda `playableOn.web = false` (D6).
- **MPEG-2** da `iptv_unsupported` en las dos.

**Optimización aparcada:** un «paso directo» que sirva la lista reescrita del origen sin ffmpeg cuando el origen ya sea
HLS H.264 con AAC. No entra ahora.

### 6.3 Cambios en `remux`

- `RemuxSource` gana `inputUrl?: string`, que es absoluta y sustituye a `engineBase + playbackUrl`, y
  `origin: 'engine' | 'iptv'`. La carpeta sigue siendo `remuxDir/<id>` y `byHash` sigue funcionando: el id sintético
  cumple `HASH_RE`.
- **`buildRemuxArgs` con `origin: 'iptv'`:**
  - sin `-reconnect*` (reconecta el relé);
  - con `-rw_timeout 55000000` (**en microsegundos**, como el `20000000` de hoy en `args.ts`; «15s» no es un valor
    válido y haría fallar la apertura). 55 s es más que el peor caso del relé (41 s, y 49 s si además abre otra
    variante, §6.1);
  - con `-protocol_whitelist http,tcp,crypto` (solo le llegan URLs del relé en `127.0.0.1`);
  - con `-live_start_index -3` si la entrada es HLS;
  - con `-metadata ace_session=<sid>` como hoy (los huérfanos se siguen encontrando);
  - el resto, igual: HLS fMP4 de 2 s en ventana de 15.
- **`waitReady`:** con IPTV, 2 segmentos o **20 s como mucho** (no 45). Pasado eso, `iptv_timeout`.
- La cola del registro pasa por el redactor (§2.4) antes de `logger.warn` y `diagnostics.report`.
- `MAX_REMUX_SESSIONS` sigue en 3, compartido con el remux de AceStream del iPhone. Si se llena con una IPTV, el código
  es `remux_busy`, pero la web lo trata como fallo **de fuente** cuando la fuente es IPTV (§7.2).
- **Reinicio en la misma sesión** (`remux.restart(sid)`): lo usa el relé cuando cambia la base de tiempos o la variante
  (§6.1). Mata el ffmpeg, vacía la carpeta, arranca otro con la misma entrada del relé y emite `stream.reopened`
  `remux_restart`.
- Si el remux de una sesión IPTV se cierra por su cuenta (desalojo, recolector, `onExit`), avisa al relé para que
  aborte la conexión con el proveedor (§6.1) y a playback, que cierra la sesión con `iptv_dropped`, no con
  `remux_died`.

### 6.4 Sesión (`playback`)

- **`SessionRec.kind: 'engine' | 'iptv'`**, decidido en `acquireInternal` con la decisión de §4.1 (`iptv.owns(id)` /
  `isIptvId(id)`) **antes** de mirar el estado del motor. Con el motor caído, una IPTV se abre igual.
- **La colocación es la de siempre.** La sesión IPTV se coloca **con el mismo `engineLock`**, que aquí hace de
  **cerrojo de la casa**, y por el mismo `placeLocked` / `placeWaitingLocked` (`playback/service.ts`, ~l.740-790). Ahí
  viven «un canal a la vez en casa», el traspaso `playback.handoff other_channel` / `same_channel` y el «cerrar antes
  de abrir». Así, la web abriendo la IPTV A y el iPhone abriendo la AceStream B (u otra IPTV) a la vez **nunca** acaban
  con dos sesiones vivas: una gana y la otra recibe el traspaso.
- **Con `iptv` solo cambia la apertura** dentro de esa colocación:
  - `iptv.openInput` en lugar de `openEngine`;
  - **sin** `engine.reportOpenSuccess/Failure()`, sin `pollStats` / `stat_url` y sin `sessions.json` (su esquema exige
    `commandUrl`, y el ffmpeg huérfano ya lo mata la marca);
  - `onEngineStatus` no la reabre.
- **Apertura:** `iptv.openInput(id, { signal })`:
  1. aborta cualquier sonda en curso de ese proveedor y **espera a que suelte el socket** (§7.3);
  2. abre el relé y devuelve `{ inputUrl, isHls, stats(), close(), onDropped }`.
  - Luego viene `remux.ensure({ …, inputUrl, origin: 'iptv' })`.
- **`consumes`:** es `remux` **también con `client: 'web'`** cuando la sesión es IPTV.
- **Concesión** (`grant.ts`):
  - web: `protocol: 'hls'`, `url: '/api/v1/video/<sid>/index.m3u8'`, sin token (§5.4);
  - iPhone: `protocol: 'hls-fmp4'` con la URL nativa de hoy;
  - en los dos, `remux: true`, `source: 'iptv'`, `codec` de la sonda (`source: 'ffprobe'`) o `unknown`, y la latencia
    del remux.
- **Estadísticas:** cada 2 s, del relé → `stream.stats` (§5.5).
- **`playback.activity`** lleva `source: 'engine' | 'iptv'`.
  - El vigilante del motor y el buscador **ignoran** la de IPTV: el motor principal está libre, así que no hay umbrales
    agresivos y las búsquedas van al motor principal.
  - El comprobador **sí** mantiene su espaciado de 20 s, porque la red es la misma.
- **Cierre:**
  - **Gracia de 3 s, solo en un caso:** el último visor se va **sin pedir otra cosa** (liberación o latido perdido a
    los 45 s). Así, volver al mismo canal enseguida (atrás y adelante) no reabre la conexión.
  - **Cualquier otra cosa cancela la gracia y cierra al momento:** un `placeLocked` de **otro** id (IPTV o AceStream),
    un traspaso, una pausa o eliminación de la IPTV. Y la nueva apertura **espera** a que el relé haya soltado el
    socket con el proveedor antes de seguir. «Cerrar antes de abrir» gana siempre a la gracia.
  - Cerrar es: abortar el relé (y con él la conexión al proveedor), matar ffmpeg y apuntar la hora del cierre por
    proveedor (§6.5).
  - No espera a los 90 s del recolector del remux.

### 6.5 Una sola conexión al proveedor, compartida

- **Una sesión por id IPTV,** y todos sus visores comparten el mismo ffmpeg y, por tanto, **una sola conexión al
  proveedor**. Da igual que sea la web y el iPhone a la vez.
- **Se mantiene la regla de hoy: un canal a la vez en casa.**
  - Canales distintos (ids distintos, IPTV o AceStream) → traspaso (`playback.handoff other_channel`).
  - Con «Un solo dispositivo a la vez», el último manda también en el mismo canal (`same_channel`).
  - En la práctica, Ace Player tiene como mucho **1** conexión abierta con el proveedor, y `max_connections = 1` se
    respeta sin más.
- **Cerrar antes de abrir.** Al pasar de IPTV a AceStream, o de un canal IPTV a otro, la colocación bajo el cerrojo de
  la casa suelta la sesión anterior **antes** de abrir la nueva, como hoy, y en IPTV espera a que el relé suelte el
  socket (sin gracia, §6.4).
- **Plaza que tarda en liberarse.** Muchos paneles siguen contando una conexión 30-120 s después de cerrarla.
  - Playback apunta, por proveedor, **nuestros cierres de los últimos 120 s** (sesiones y sondas).
  - Si al abrir el proveedor responde 403, 429, 456, 458 o 509, **y** hubo un cierre nuestro en esos 120 s, se
    reintenta con espera creciente de 2, 4 y 8 s (14 s en total, dentro del plazo de `channelStream`).
  - Los `active_cons` de Xtream se leen **descontando** esos cierres recientes y las sesiones abiertas: no son «de
    otro».
  - Si no hubo cierre nuestro, o si sigue ocupado tras los reintentos, `iptv_busy`.
- **Sondas.** Nunca hay una sonda de stream a un proveedor con una sesión IPTV viva, ni en los 120 s siguientes a un
  cierre nuestro, ni con `active_cons > 0` (§7.3).

### 6.6 Tiempos de arranque y de corte

| Paso | Objetivo | Tope | Si se pasa |
|---|---|---|---|
| Resolución de un canal (`scope=channel`), solo con `features.iptv` | < 300 ms en el servidor | la web espera 2,5 s | la web sigue como hoy, sin IPTV |
| Cabeceras del proveedor (relé) | < 2 s | 8 s | `iptv_timeout` (o reintento si la plaza estaba recién cerrada) |
| Lista lista (2 segmentos de 2 s) | 4–8 s | 20 s | `iptv_timeout` |
| `channelStream` completo | 5–10 s | 60 s (el de hoy) | — |
| Corte: sin bytes | — | 10 s | reconexión del relé |
| Reconexión del relé | < 3 s | esperas de 1, 2 y 4 s, 8 s de cabeceras cada una, 3 en 60 s (peor caso 41 s) | otra variante si la hay; si no, `stream.closed remux_failed` + `iptv_dropped` |
| ffmpeg sin datos (`-rw_timeout`) | — | 55 s | nunca antes que el relé (41 s, 49 s con otra variante) |
| Base de tiempos distinta tras reconectar | — | salto > 5 s | reinicio del remux + `stream.reopened remux_restart` |
| Del corte definitivo a pedir AceStream | inmediato | — | la web salta sin sus 3 reconexiones (§7.2) |

**Nginx** (`deploy/umbrel/nginx.conf`):
- `location /api/v1/video/`, con las mismas cabeceras de origen que `/api/`, más `proxy_buffering off`, `gzip off` y
  `proxy_read_timeout 120s`;
- no hace falta ninguna `location` con más plazo: no hay `iptvTest` (§5.3);
- su test (`test:nginx`) se amplía.

**Vite:** `/api` ya está en `PROXIED`.

---

## 7. Prioridad y respaldo

### 7.1 IPTV primero

- **Servidor:** la IPTV encabeza `candidates` y es la `candidate` (§4.6).
- **Web** (`pickAutoSource` en `features/sources/model.ts`), regla nueva al principio:
  - la primera entrada `origin === 'iptv'` que no esté reportada ni tenga `autoTried`, y cuyo estado efectivo **no**
    sea `failed`, se arranca **sin esperar** a que el comprobador la dé por `working`. `weak` (por ejemplo
    `iptv_busy`, que es dudoso) no la frena: abrir es la prueba de verdad;
  - el reproductor ya la verifica con `origin: 'auto'`: 1 reconexión antes de la primera imagen.
  - Aviso: «Arrancando tu IPTV» (señal, a la línea de estado).
- **El comprobador sigue con AceStream de fondo** exactamente como hoy: una sonda cada vez, 20 s entre sondas con
  alguien viendo y nunca el hash que se ve.

### 7.2 Si uno no va, va el otro (el puente)

Es una regla nueva, la **P16.6**, en `apps/web/src/features/match-center/README.md` y en `handleSourceFailed`
(`features/sources/session.ts`). Vale en automático, **en manual y en canales sueltos con IPTV**. Las reglas 3 y 4 de
P16 siguen para saltar entre dos AceStream.

Cada aviso tiene dos partes: la **línea de estado** del reproductor (lo que hoy dice `exhaust`, «Esta fuente no
responde: probando la siguiente…») y, solo si hace falta un botón, un **toast con acción**.

| Cae… | y hay… | Qué pasa | Línea de estado | Toast con acción |
|---|---|---|---|---|
| IPTV | una AceStream `working` no probada | se pasa a la mejor (`pickAutoSource` sobre las no IPTV), con `haptic('warning')` | «Tu IPTV no responde: seguimos por AceStream (fuente {N})» | «Volver a la IPTV» |
| IPTV con `iptv_busy` | ídem | ídem | «Tu IPTV tiene la conexión ocupada: seguimos por AceStream (fuente {N})» | «Volver a la IPTV» |
| IPTV | ninguna verificada todavía, comprobador en marcha | espera a la primera `working`, como hoy | «Tu IPTV no responde. Sigo comprobando las fuentes de AceStream y arranco la primera que funcione.» | «Volver a la IPTV» |
| IPTV en un canal suelto | ninguna verificada | se prueba el hash que se tocó en la biblioteca (el `initial`) | «Tu IPTV no responde: seguimos por AceStream» | «Volver a la IPTV» |
| AceStream (auto o manual) | una IPTV no «Sin señal» y no **caída** en los últimos 60 s (una que sonaba bien y se dejó a mano, sí) | se pasa a la IPTV | «Esta fuente no responde: pasamos a tu IPTV» | — |
| AceStream por `engine_unavailable` | una IPTV | se trata como fuente agotada, no como error de sistema → IPTV | «El motor AceStream no responde: pasamos a tu IPTV» | — |
| las dos, y no queda **ninguna** fuente sin probar | nada | `failureText` | «Ni tu IPTV ni las fuentes de AceStream dan señal ahora mismo. Prueba «Rebuscar» en unos minutos.» | — |
| IPTV en pausa o eliminada durante la reproducción | AceStream | como la primera fila | «Tu IPTV está en pausa: seguimos por AceStream (fuente {N})» | — |

- **Un solo aviso de texto.** `handleSourceFailed` devuelve el texto de la tabla y `exhaust` lo pone en la línea de
  estado **en lugar** del genérico. El toast no repite el texto largo: es el botón. Texto del toast: «Seguimos por
  AceStream» · acción **«Volver a la IPTV»**, con `icon: 'tv'`, `tone: 'warn'` y `ms: 8000`, para que dé tiempo a
  tocar.
- **En inmersivo** (móvil en horizontal, pantalla completa o modo teatro) el `Toaster` no pinta nada
  (`data-immersive`), que es justo como se ve el fútbol, y los carteles no están en pantalla. Por eso «Volver a la
  IPTV» va dos veces con la misma acción y el mismo plazo de 8 s: el toast (fuera de inmersivo) y una **cápsula
  tocable sobre el vídeo**, arriba y al centro («Seguimos por AceStream» · **«Volver a la IPTV»**,
  `notices/immersiveAction.ts`, la pinta `PlayerSurface`). Cada una se ve solo en su modo, así girar el móvil no la
  pierde, y un toque quita las dos. Con teclado, la línea de estado añade además « Para volver, pulsa {1}.». Bajo el
  vídeo la línea parte en dos renglones en vez de cortarse a 390 px. El cartel, su número y el gesto de deslizar
  valen siempre (§7.5).
- **El toast va atado** al id de la sesión de fuentes y al partido o canal. Si Isma navega a otro partido o canal, o la
  sesión de fuentes cambia, el toast se descarta y su acción no hace nada. «Volver a la IPTV» solo actúa si esa IPTV
  sigue en la lista de esa misma sesión.
- **Contra los bucles:** como mucho **2 saltos de puente automáticos (IPTV ↔ AceStream) cada 3 min** por sesión. Al
  llegar al tope se deja **solo** de saltar entre IPTV y AceStream: se sigue con las reglas de P16 entre las fuentes de
  AceStream que queden. El `failureText` sale solo cuando de verdad no queda ninguna.
  - Si el puente salta a una AceStream que falla enseguida (antes de la primera imagen), ese salto cuenta dentro de los
    2; el contador no se reinicia por empezar otra fuente.
- **`autoTried` de una IPTV** solo se limpia si llega un veredicto `working` del servidor **posterior** al fallo y han
  pasado al menos 60 s.

**En el reproductor** (`player/runtime.ts`):
- **Errores `iptv_*` al abrir:** van a `fail()` como **no reintentables**, así que se agota la fuente al momento: el
  servidor ya reintentó.
- **`stream.closed` con `code` `iptv_*`:** la fuente se agota **al momento**, sin las 3 reconexiones.
- **Cualquier `remux_*` (`remux_busy`, `remux_died`, `remux_failed`…) y `ffmpeg_missing` con la fuente IPTV:** se
  tratan como fallo de fuente **inmediato**, sin las 3 reconexiones (salto a AceStream, que en la web no necesita
  remux), no como `failSystem`. Es la red de seguridad por si un `remux_died` gana la carrera a `iptv_dropped`.
- **`stream.reopened` con `remux_restart`:** se reengancha a la URL nueva como hoy, sin contarlo como fallo.
- **`engine_unavailable` con fuente AceStream:** se pregunta a `onSourceFailed` si la sesión tiene una IPTV utilizable.
  Si no, `failSystem` como hoy.

### 7.3 Comprobación ligera de la IPTV

La IPTV tiene su propio **carril** dentro de `ScannerServiceImpl`. En `probe()` se desvía con la decisión de §4.1 y no
espera detrás de las sondas de 30 s de AceStream.
- Concurrencia 1 por proveedor.
- Sin el espaciado de 20 s: no usa el motor comprobador.

**Nivel 1, la cuenta**, siempre y sin gastar conexión:
- Xtream: `user_info` (caché de 2 min). M3U: el canal está en el catálogo vigente.
- Resultados:
  - cuenta activa y canal presente → **ningún veredicto**. El cartel queda «Sin comprobar»: una cuenta activa no es un
    stream verificado, así que nunca sale «Verificada» por esto. La regla de `pickAutoSource` (§7.1) ya arranca la
    IPTV sin exigir `working`;
  - `auth` falla → `failed`, `iptv_auth_failed`;
  - caducada (dos comprobaciones seguidas, §7.4) → `failed`, `iptv_account_expired`;
  - canal ausente → `failed`, `iptv_gone`;
  - `active_cons ≥ max_connections` descontando las nuestras (abiertas y cerradas en los últimos 120 s, §6.5) →
    **`weak`**, `iptv_busy`, con reintento a los 2 min. Es un estado dudoso, no `failed`: no le quita el primer puesto
    a la IPTV, porque abrir es la prueba real.

**Nivel 2, la sonda de stream**, **solo en trabajos de fondo sin visor** (el precalentamiento de la agenda,
`kind: 'preheat'`), **nunca** en una resolución interactiva: ahí la reproducción es la prueba, y una sonda de 6 s
abriendo a la vez que el reproductor contra `max_connections = 1` haría que uno de los dos recibiera 403/458. Además
tienen que cumplirse **todas** estas condiciones:
- el proveedor es **Xtream** (en M3U no hay `user_info` y no se puede saber si la cuenta está en uso en la tele);
- `active_cons == 0` según un `user_info` de hace menos de 2 min;
- no hay ninguna sesión IPTV viva en casa ni un cierre nuestro con ese proveedor en los últimos 120 s;
- un canal por partido como mucho, y no se sondeó ese canal en los últimos 30 min.

**La sonda:**
- abre por el relé **una sola vez** y lee **hasta 6 s o 1,5 MiB** a un fichero temporal en `remuxDir/.sondas/`;
- pasa ffprobe **sobre ese fichero** con un `transport.inspectFile(path)` nuevo. No reutiliza `inspect(pathname)`, que
  solo acepta una ruta sobre la base del motor comprobador y abriría otra petición (y otra conexión al proveedor);
- `playable_media` con códec y caudal (`rateKbps`, `videoCodec`, `audioCodecs`, `bitrate`), o `iptv_timeout`,
  `iptv_unreachable`, `iptv_unsupported` o `iptv_gone`;
- **cierra en cuanto termina**, borra el fichero y apunta el cierre como «nuestro» (§6.5);
- **se aborta** si se abre una sesión IPTV (§6.4): la sesión espera a que la sonda suelte el socket.

**`playableOn`:**
- H.264 → `{ web: true, ios: true }`;
- HEVC → `{ web: false, ios: true }`;
- MPEG-2 → `{ web: false, ios: false }`;
- sin sonda, `{ web: true, ios: true }`.

El audio no cuenta, porque se pasa a AAC.

**Mientras se ve una IPTV** no se sondea su proveedor. Su estado lo dan:
- el reproductor (`sources/outcome`: `arranco`, `sigue`, `cayo`), que ya manda 3 min;
- el relé: con bytes entrando se registra `working` (`playable_media`) por `player` cada 60 s.

**Retrasos de reintento de las IPTV fallidas:** 2 min (no 10), porque la plaza del proveedor se libera sola.

La suavización de hoy vale igual: una `working` que falla una vez por causa ajena al vídeo queda `weak`.

**Mantener caliente el respaldo.** Mientras un visor mira una IPTV, cada 10 min el comprobador revalida las **2 mejores
AceStream `working`** del trabajo de ese visor (`scanner.refreshWorking(jobId, 2)`), con el espaciado de siempre. Emite
`scan.verdict` con ese `jobId`, así que cuando la IPTV caiga, «la mejor verificada» lo será de verdad.
- La web sigue escuchando `scan.verdict` de su trabajo aunque esté `done`, mientras la fuente activa sea IPTV.
- Aun así, el estado puede tener hasta 10 min. Si el puente salta a una AceStream que falla enseguida, cuenta dentro de
  los 2 saltos (§7.2) y se sigue con la siguiente, sin volver a empezar.

### 7.4 Cierres que decide el servidor

- **Pausa, eliminar, cuenta caducada o relé agotado:** se cierra la sesión IPTV con
  `stream.closed { reason: 'remux_failed', code }` (§5.5) y `sources.outcome` interno `cayo`. Se cierra primero en
  playback y después se mata ffmpeg (§6.1).
- **Cuenta caducada durante la reproducción:** solo si lo confirman **dos** `user_info` seguidos (con 1 min entre
  ellos) **o** si además falla el stream. Un `auth: 0` o un `status` raro suelto, por un panel cargado, no corta un
  stream que funciona.
- La web salta por el puente.
- Una app sin cambios reconecta: recibe `iptv_disabled`, `iptv_removed` o `iptv_gone` al pedir el stream, no está en
  sus errores de sistema, agota la fuente y, en automático, pasa a la siguiente.

### 7.5 Volver con un toque

- **Botón del aviso.** «Volver a la IPTV» llama a `selectSource(idIptv)`, que pone `manualChosen: true` (P16.3), solo
  si el toast sigue atado a la sesión de fuentes y al partido o canal que se ven (§7.2). Con el puente, si la IPTV
  vuelve a caer, se pasa otra vez a AceStream.
- **Selector de fuentes.** La IPTV **nunca se pliega** en el selector (ni con `failed`, ni mientras comprueba el
  comprobador), así que volver a ella es un toque en su cartel. También valen la tecla de su número y deslizar.
- **No hay vuelta automática a la IPTV,** para no ir y volver sin parar (§12, D7).
- **Aviso de `selectSource` con IPTV:** «Fuente {N} · IPTV · {Casa}», sin trozo de hash.

### 7.6 Encaje con «Un solo dispositivo a la vez»

| Situación | `share` (por defecto) | `handoff` (interruptor activado) |
|---|---|---|
| Web e iPhone, mismo canal IPTV (mismo id) | comparten sesión, ffmpeg y **una** conexión al proveedor | el último manda; el otro recibe `playback.handoff same_channel` y la sesión IPTV **se conserva** (sin cerrar ni reabrir la conexión con el proveedor: muchos paneles siguen contando la plaza 30-120 s y el segundo se quedaría sin IPTV) |
| Web en IPTV, iPhone abre otro canal (IPTV o AceStream) | traspaso: la web se para (`other_channel`), como hoy | ídem |
| Web en IPTV, iPhone abre el mismo partido | el iPhone arranca la IPTV (misma primera) → comparten | el iPhone manda |
| Web en AceStream del partido, iPhone en la IPTV del mismo partido | ids distintos → traspaso (regla de hoy) | ídem |

El texto del interruptor de hoy sigue siendo verdad y no cambia.

### 7.7 La señal de la agenda

La señal de la agenda y del partido sale del precalentamiento (`football/preheat.ts`: `no_sources` → «No hay fuentes
para este partido» en `agenda/domain.ts`). Sin cambios, la tarjeta diría que no hay nada justo cuando la IPTV lo
reproduce. Por eso:
- el precalentamiento usa la misma `resolveFootballChannel` con la capa IPTV, así que una IPTV emparejada (≥ 92 o
  confirmada por la guía) cuenta como candidata y el partido queda `discovered`, no `no_sources`;
- el medidor de la agenda cuenta esa IPTV como fuente jugable mientras no esté `failed`;
- se quedan la palabra y el medidor de siempre. No hay nada visible nuevo.

---

## 8. Web

### 8.1 Cartel de una fuente IPTV (`SourcePoster.tsx`)

- **Atributos.** `data-origin="iptv"` en el `<button class="src-poster">`, que es el localizador de las e2e.
- **Distintivo.** `<Capsule tone="neutral" icon="tv">IPTV</Capsule>` arriba a la izquierda de la tesela. «En pantalla»
  sigue en oro.
- **Debajo:**
  - `presentation.short` = `iptv.provider` («Casa»);
  - `TYPE_LABEL.iptv = 'IPTV'`, así que `presentation.label` = «IPTV · Casa»;
  - la calidad sale de `iptv.quality` si no hay `bitrate`/códec: `fhd` → «1080p», `hd` → «720p», `uhd` → «4K»,
    `sd` → «SD»;
  - `backup` añade «reserva» (solo si la mejor variante es una reserva: las demás no salen, §4.3).
- **Estado:** el mismo `SignalRing` con los estados de siempre. `REASON_PHRASE` suma:
  - `iptv_busy: 'conexión ocupada'`
  - `iptv_auth_failed: 'la cuenta no entra'`
  - `iptv_account_expired: 'cuenta caducada'`
  - `iptv_gone: 'ya no está en la lista'`
  - `iptv_timeout: 'no respondió a tiempo'`
  - `iptv_unreachable: 'el proveedor no responde'`
  - `iptv_dropped: 'se cortó en el proveedor'`
  - `iptv_unsupported: 'formato no compatible'`
- **`describeSource`** para IPTV, **sin** `Hash …`: «Fuente {N}: {DAZN LaLiga} · IPTV · {Casa} · {1080p} · {frase} ·
  {Mbit/s}».
- **Menú contextual:** «Ver esta fuente» / «Ya está en pantalla», «Es el canal correcto» y «Reportar…». **Se quitan**
  «Copiar hash» y «Abrir en la app de AceStream».
- **`SourceInspector`** con la IPTV activa:
  - se quedan «Rebuscar», «Pegar hash», «Es el canal correcto» y «Reportar»;
  - **se quitan** «Favorito», «Copiar hash» y «Abrir en…» (con sus tres opciones). Un id IPTV no se guarda en
    Favoritos: el favorito es el canal de AceStream, que ya trae la IPTV primero al tocarlo (§4.6, §8.4).
- **Reproducir una IPTV** siempre con `record: false`: no entra en Recientes.
- **Datos técnicos** (`player/NerdPanel.tsx`): «Origen: IPTV · {Casa}». «Pares» pasa a «—» y la fila «Hash» no sale.
  La velocidad sale de `stream.stats.speedDown`.
- **«Dónde se está reproduciendo»** (`features/where-playing`): con `SessionSummary.source === 'iptv'`, la línea del
  canal suma « · IPTV».
- **`resolutionSourceLabel.iptv`** = «Tu IPTV» y **`checkedLabel.iptv`** = «IPTV».

### 8.2 Orden

El del servidor, sin reordenar, como hoy. El número de fuente es la posición. En los canales sueltos con IPTV:
1. las IPTV;
2. **el hash que se tocó** (el `initial`);
3. el resto de las hermanas en el orden del servidor.
4. Las hermanas locales que el servidor no devolvió se añaden al final.

### 8.3 Estados

- **Poster:** «Verificada» (solo con `playable_media`, es decir, con el stream visto de verdad), «Comprobando», «Sin
  comprobar» (lo normal antes de verla, aunque la cuenta esté activa), «Floja» (por ejemplo `iptv_busy`), «Sin señal»,
  «Reportada». Son los de siempre.
- **La IPTV no se pliega nunca** (`isShownWhileScanning` y el plegado de `SourceList` la dejan siempre visible).
- **Reproductor** (`player/status.ts`, que hoy dice por defecto «Conectando con AceStream…»):
  - «Conectando con tu IPTV…»
  - «Reconectando con tu IPTV…»
  - `IDLE_MESSAGES` para una IPTV que falla sin alternativa: «Tu IPTV no da señal ahora mismo.»
- **Se decide por** `PlayChannel.source === 'iptv'` antes de la concesión, y por `grant.source` después.
- `wording.test.ts` sigue pasando: «IPTV» y «HLS» están permitidos.

### 8.4 Entradas

**Tocar un canal** (Canales, el buscador, Favoritos, Recientes). Hoy `playChannel()`
(`features/library/play.ts`) hace `play()` con el hash de AceStream **antes** de navegar a `partido/canal/<hash>`, y
`enterChannel` solo reproduce si el reproductor está `idle`. Con IPTV, eso haría sonar AceStream primero. Por eso la
decisión se lleva a `playChannel`:
- **Sin IPTV activa** (`bootstrap.features.iptv` falso o ausente): **exactamente lo de hoy**. Nadie paga ninguna
  espera.
- **Con IPTV activa:** `playChannel` **no** llama a `play()`; solo navega, y `enterChannel` resuelve y arranca:
  - llama a `api('footballResolve', { query: { channel: title, scope: 'channel', client }, timeoutMs: 2_500 })`;
  - si trae IPTV: `kind` sigue siendo `'channel'`, pero con `iptvBridge: true`. Hay entradas del servidor y trabajo
    del comprobador (`watchJob`), y se arranca con `tryAutoStart`, IPTV primero;
  - si no trae IPTV, o da error o se pasa del plazo: reproduce el hash tocado con sus hermanas, como hoy (con el
    `record` y el `kind` que traía la petición de `playChannel`).
- Pasan por `playChannel` `SearchView` y `useChannelActions`, así que el cambio cubre todas las entradas. El «Pegar
  hash» (`origin: 'pegado'`) sigue igual: es un hash concreto que Isma quiere ver.

**`enterMatch` sin canales:** solo con `features.iptv`, llama a `footballResolve?match=<id>` con `timeoutMs: 5_000`.
- Si trae candidatas (IPTV confirmadas por la guía): se sigue como un partido normal.
- Si no (`not_found`, error o plazo): `phase: 'no_channels'` y «El canal todavía no está anunciado», como hoy, sin
  abrir «Encontrar canal» (§4.5).

**Favoritos y Recientes** no guardan ids IPTV (§4.6, §8.1). Si queda alguno de antes, el servidor lo convierte o lo
descarta en la resolución, y `channelStream` con un id IPTV que ya no vale da `iptv_gone`, `iptv_disabled` o
`iptv_removed`, que agotan la fuente y el puente pasa a las hermanas.

### 8.5 Ficheros de la web

| Fichero | Cambio |
|---|---|
| `features/iptv/{IptvSection.tsx, IptvSection.css, model.ts}` (nuevos) | sección de Ajustes (§1), textos, validación y cuerpo sin secretos vacíos |
| `features/settings/SettingsView.tsx`, `app/routes.ts` | entrada `iptv` y su `case` |
| `features/library/play.ts`, `features/library/useChannelActions.tsx`, `features/search/SearchView.tsx` | `playChannel` sin `play()` con IPTV activa (§8.4); sin «Favorito» ni Recientes para ids IPTV |
| `api/boot.ts` (o donde se lea `bootstrap`) | leer `features.iptv` e invalidar `bootstrap` con `iptv.status` |
| `features/sources/model.ts` | `SourceOrigin 'iptv'`, `TYPE_LABEL`, `REASON_PHRASE`, `pickAutoSource` (IPTV primero, `weak` no frena), `pickBridgeTarget`, no plegar IPTV, calidad, `describeSource` |
| `features/sources/session.ts` | `enterChannel` y `enterMatch` (§8.4), puente en `handleSourceFailed` con el texto para `exhaust`, avisos y toast atado de §7.2, tope de saltos, `selectSource` con IPTV, seguir `scan.verdict` con IPTV activa |
| `features/sources/{SourcePoster, SourceList, SourceInspector, useSources}.tsx/ts` | distintivo, `data-origin`, menús sin «Favorito», «Copiar hash» ni «Abrir en…», y plegado |
| `player/api.ts`, `player/runtime.ts`, `player/status.ts` | `PlayChannel.source: 'iptv'`, textos, errores `iptv_*`, `remux_*` con IPTV y `stream.closed` con código IPTV (§7.2), texto de `exhaust` desde la sesión, «Para volver a la IPTV…» en pantalla completa |
| `player/NerdPanel.tsx` | «Origen: IPTV · {Casa}», «Pares» «—», sin fila «Hash» |
| `features/where-playing/*` | « · IPTV» |
| `features/agenda/*` | la señal cuenta la IPTV (§7.7), si hace falta tocar el cálculo del medidor |
| `features/match-center/README.md` | P16.6 |
| `api/client.ts` | `TIMEOUTS` de §5.3 |
| `api/demo/*`, `features/sources/demo-data.ts` | rutas IPTV en la demo; **demo-5** gana una IPTV primera «Casa», 1080p. **demo-4 no cambia**: es el único caso de «ninguna verificada del todo → probamos la fuente 3» |

«Pegar hash» (`features/paste-hash/PasteHashSheet.tsx`) también llama a `playChannel`, con `origin: 'pegado'`: esa
entrada no cambia.

No hay dependencias nuevas: hls.js ya está y `chooseEngine('hls')` elige hls.js con MSE y HLS nativo en Safari.

---

## 9. Pruebas

### 9.1 Unitarias

**`packages/shared`** (`contracts.test.ts`, no hay `fixtures.test.ts` aparte):
- `ResolutionCandidate` con `source: 'iptv'` e `iptv`;
- `IptvSaveBody` rechaza claves de más;
- `IptvView` no tiene **ningún** campo llamado `url`, `username` ni `password` (test de forma sobre el esquema);
- `iptv.status` está en `WEB_ONLY_EVENT_TYPES`;
- reparto de ejemplos: `v1/`, `web/v1/`, `events/`, `web/events/` y `variantes/` (§5.7); `v1/bootstrap.json`,
  `v1/footballResolve.json` y `v1/channelStream.json` no cambian.

**`apps/server/src/modules/iptv/*.test.ts`:**

| Fichero | Qué cubre |
|---|---|
| `m3u.test.ts` | cabecera con `url-tvg` y `x-tvg-url` separadas por comas; comas entre comillas; `#EXTVLCOPT` (solo UA y referrer, sin CR/LF); descarte de VOD, rtmp y acestream; `.gz` por bytes mágicos; tope de canales; **línea gigante** de 100 MiB sin salto (no la acumula); lista sin `#EXTM3U` (`iptv_bad_list`); secretos aprendidos de `get.php?username=…` y de `/<u>/<p>/<id>` |
| `json-array.test.ts` | troceador del array de `get_live_streams`: trozos de 1 byte, cadenas con `{`, `}` y escapes, objeto de más de 16 KiB descartado, tope de 100 000 mientras lee |
| `xtream.test.ts` | números como texto; `auth: 0`; `Expired`; `allowed_output_formats` sin `ts` (usa m3u8); `get_live_streams` gigante (`response_too_large`); `get_short_epg` en base64 |
| `names.test.ts` | «ES: DAZN LaLiga FHD», «\|ES\| M+ LaLiga ᴴᴰ», «DAZN LaLiga (Backup)», «UK: Sky Sports», «DAZN LaLiga 2» (el 2 se queda), «DAZN LA LIGA» → «dazn laliga», alias «M+ Hypermotion»; **corpus** de 100-200 nombres reales |
| `match.test.ts` | umbral 92; «LaLiga TV Hypermotion» no casa con «LaLiga TV»; «DAZN» no casa con «DAZN 1»; «DAZN 1» no casa con «DAZN F1»; «M+ LaLiga TV 1» casa con «M+ LaLiga TV» pedido sin número; filtro de país; **un cartel por canal** con la mejor variante (FHD > HD > 4K > SD, no HEVC antes que HEVC, reserva al final); tope de 2 en total; «Canal incorrecto» aprendido aparta; corpus |
| `ids.test.ts` | `isIptvId` reconoce ids de proveedores pasados; un hash AceStream al azar no pasa (10⁶ muestras); estabilidad entre sincronizaciones; id nuevo al cambiar origen o tipo |
| `xmltv.test.ts` | streaming a trozos de 1 byte; entidades; CDATA; zona horaria y `tvg-shift`; ventana de 48 h; bomba gzip (corta al tope); **`<desc>` enorme** (tope de 8 KiB); **DOCTYPE con entidades** declaradas (se ignoran); profundidad |
| `guide-match.test.ts` | partido en directo confirmado; «(R)», «Resumen» y «Previa» no cuentan; hora fuera de ventana; filiales («Barcelona B», «Real Madrid Castilla», «Sevilla Atlético», «Betis Deportivo», «Bilbao Athletic»…); texto de otra competición; **canal de otra competición** («M+ Liga de Campeones» con un partido de LaLiga); canal Hypermotion con partido de Primera; canal sin país que no casa con la agenda; más de 3 canales ambiguos → nada; abreviaturas solo en `AAA-BBB`; formatos reales de Movistar y DAZN («LaLiga EA Sports. Jornada 7: A-B») anonimizados |
| `crypto.test.ts` | ida y vuelta AES-GCM; AAD de otro proveedor falla; sin semilla se crea `clave` con 0600 |
| `redact.test.ts` | secretos en crudo y codificados; `/live/u/p/`; **forma corta `/u/p/123` sin `/live/`**; **`get.php?username=&password=`**; query; `user:pass@`; ticket del relé |
| `relay.test.ts` | TS con reconexión (esperas 1-2-4 s, 3 en 60 s, socket viejo cerrado antes); 403/458 al reconectar como plaza ocupada; **salto de PTS → reinicio del remux**; variante de reserva antes de caer; segunda petición a `in.ts` → 409 sin otra conexión; maestra aplanada a una variante con audio muxeado; maestra con solo `EXT-X-MEDIA TYPE=AUDIO` → `iptv_unsupported`; reescritura por **lista blanca** (`#EXT-X-MAP`, `#EXT-X-KEY`; se descartan `EXT-X-MEDIA`, `PART`, `PRELOAD-HINT` y una URI absoluta desconocida); **302 de un segmento** seguido por el relé, nunca reenviado; extensión normalizada para un segmento `.php`; lista en caché 1 s; ticket inválido → 404; solo escucha en 127.0.0.1; aborta el upstream al cerrarse el socket de ffmpeg |
| `probe.test.ts` | nunca en una resolución interactiva; solo Xtream con `active_cons == 0`; no sondea con sesión viva ni 120 s después de un cierre; lee una sola vez y ffprobe sobre el fichero; se aborta al abrir una sesión; motivos y `playableOn` |
| `service.test.ts` | guardar hace la prueba rápida y no guarda si falla; `iptv_credentials_required` al cambiar el origen; `provider.id` nuevo al cambiar origen o tipo; un resultado de otra `revision` no se aplica; guardar, pausar y eliminar abortan la sincronización en curso (sin cola); un solo trabajo pesado a la vez (el segundo se engancha); eliminar borra `.bak` y copias apartadas; cuenta caducada solo con dos comprobaciones; refresco con espera exponencial; M3U con 403 al abrir → refresco (1/min) y reintento con la URL nueva |
| `memoria.test.ts` (etiqueta `@lento`) | sincronización de 100 000 canales Xtream con `--max-old-space-size` como en producción: el pico de heap queda por debajo de un tope fijado (objetivo < 150 MB) |

**Otros módulos del servidor:**
- `football/resolution.test.ts`: IPTV primera; la guía gana a la agenda; la pista de la guía no adelanta a AceStream
  ≥ 92; `scope=channel` sin IPTV → `not_found` sin trabajo; partido sin canales → solo guía, `not_found` sin trabajo;
  ids IPTV de favoritos e historial convertidos a `iptv` o descartados; el trabajo del comprobador no lleva sondas de
  stream IPTV; motor caído → sigue la IPTV.
- `football/preheat.test.ts`: un partido con IPTV emparejada queda `discovered`.
- `playback/*.test.ts`: sesión IPTV colocada con el cerrojo de la casa, sin `reportOpen*` y sin `sessions.json`;
  `consumes: remux` en la web; dos visores → una sola apertura; **dos `acquire` simultáneos, web con IPTV e iPhone con
  AceStream → una sola sesión viva, traspaso y `conexiones() ≤ 1`**; gracia de 3 s solo sin otra petición; cambiar de
  canal cancela la gracia y espera al relé; reintento de plaza recién cerrada (2-4-8 s); desalojar el remux IPTV →
  `conexiones() = 0` y cierre con `iptv_dropped`.
- `remux/pure.test.ts`: argumentos con `inputUrl` del relé, sin credenciales, con `protocol_whitelist` y
  `-rw_timeout 45000000`.
- `net/*.test.ts`: filtro IPTV con `ALLOW_PRIVATE_SYNC_URLS=true` (loopback, 169.254, nombre de una etiqueta y puerto
  del relé bloqueados; RFC1918 solo si el host configurado es privado); `detail` de `bad_url` y `redirect_loop`
  tapados.
- `app` / rutas: `/api/v1/video` web sin `t` sirve; `/native/api/v1/video` sin `t` → `video_token_invalid`.
- `core/logger.test.ts`: el nuevo `redactUrl`.

**`apps/web`:**
- `features/sources/model.test.ts`: IPTV primero sin `working` (y con `weak`); puente IPTV → mejor AceStream y
  AceStream → IPTV; tope de 2 saltos en 3 min y después sigue P16 entre AceStream; IPTV nunca plegada;
  `describeSource` sin hash.
- `session.test.ts`:
  - `handleSourceFailed` con IPTV en automático, manual y canal, devolviendo el texto de la línea de estado;
  - toast solo fuera de pantalla completa; toast descartado al navegar;
  - `engine_unavailable` → IPTV;
  - `enterChannel` con y sin IPTV, y con el plazo agotado (comportamiento de hoy);
  - `enterMatch` sin canales, con guía y sin `features.iptv` (no llama).
- `library/play.test.ts`: con `features.iptv` no llama a `play()`; sin él, igual que hoy; «Pegar hash» igual que hoy.
- `SourcesPanel.test.tsx`: distintivo «IPTV» y menú sin «Favorito», «Copiar hash» ni «Abrir en…».
- `IptvSection.test.tsx` y `iptv/model.test.ts`:
  - formularios, textos literales y modo edición con secretos vacíos no enviados;
  - la contraseña no queda en el DOM tras guardar;
  - no se usa `useApiMutation`.
- `runtime.test.ts`: `iptv_*` y `remux_*` con IPTV agotan sin reintentos; `stream.reopened remux_restart` se
  reengancha; textos «tu IPTV».
- `wording.test.ts`: sigue pasando.

### 9.2 Integración del servidor con un proveedor IPTV falso

**`apps/server/test/fake-iptv/`** (nuevo): un servidor HTTP local que **reutiliza el generador TS del motor falso**
(`test/fake-engine/mpegts.ts`: H.264 con audio **AC3**, para probar el paso a AAC). No hace falta ffmpeg para el
proveedor.

**Rutas del proveedor falso:**
- `/lista.m3u` (y `/lista.m3u.gz`), con `url-tvg="…/guia.xml.gz"`. Canales:
  - «ES: DAZN LaLiga FHD» (HLS);
  - «ES: DAZN LaLiga HD» (TS);
  - «ES: DAZN LaLiga (Backup)»;
  - «ES: M+ LaLiga TV 2 FHD»;
  - «ES: LaLiga TV Hypermotion FHD» (trampa Hypermotion);
  - «ES: M+ Liga de Campeones FHD» (trampa de competición);
  - «ES: La 1 HD»;
  - «ES: Antena 3 FHD»;
  - «UK: DAZN 1» (trampa de país);
  - dos entradas VOD `/movie/`.
- `/get.php?username=…&password=…&type=m3u_plus`: la misma lista con URLs de stream cortas `/<u>/<p>/<id>` sin
  `/live/`, para la prueba de fuga en M3U.
- `/player_api.php`: auth, `get_live_categories`, `get_live_streams`, `get_short_epg` y `user_info` con
  `max_connections: 1` y `active_cons` **real** (cuenta los streams abiertos, y los sigue contando `retenerPlaza` s
  después de cerrarlos, para simular paneles lentos).
- `/xmltv.php` y `/guia.xml.gz`. La guía trae, para el partido «DAZN LaLiga» del **catálogo E2E del backend**
  (`e2e/support/catalogo.ts`, el que se llama demo-4 allí; no es la demo-4 de la web):
  - el partido en directo a su hora en «ES: M+ LaLiga TV 2 FHD». Es otro canal que el de la agenda («DAZN LaLiga»),
    creíble para un partido de LaLiga, y prueba que la guía gana;
  - el mismo partido, a la misma hora, en «ES: M+ Liga de Campeones FHD»: **no** debe confirmarse (canal de otra
    competición);
  - una **repetición** «(R)» a la mañana siguiente;
  - un **resumen** «Resumen: …» al acabar;
  - una **previa** 30 min antes.
- `/live/<u>/<p>/<id>.ts` (TS continuo) y `/live/<u>/<p>/<id>.m3u8` (HLS de segmentos TS en ventana).

**Control y modo manual:**
- **Control** `/__iptv/*`:
  - `modo(id, 'ok' | 'down' | '401' | '404' | 'busy' | 'lento' | 'corta-a-los:N' | 'corta-a-los:N:pts')`, donde
    `:pts` reanuda con **otra base de PTS/PCR**;
  - `conexiones()` devuelve las abiertas por cuenta;
  - `peticiones()` devuelve las URLs recibidas, para comprobar que nadie más que el relé pide streams.
- **CLI** `tsx test/fake-iptv/cli.ts --host <IP de red local del PC> --port 7300`, para que Isma lo pruebe a mano en el
  PC con `ALLOW_PRIVATE_SYNC_URLS=true`. Escucha en la IP de red local y no en `127.0.0.1`, porque la IPTV bloquea
  siempre loopback (§3.1).

**`apps/server/test/integration/iptv.test.ts`**, con el arnés de `harness.ts`, `NetResolver` falso (el host del
proveedor resuelve a una IP pública, con el filtro SSRF real) y el ffmpeg falso de `remux/test-support.ts` ampliado:
el `FAKE_FFMPEG_SCRIPT` **lee de verdad** su `-i`, cuenta bytes y escribe segmentos cuando llegan. Casos:

1. Guardar Xtream → sincroniza → `footballResolve` del partido «DAZN LaLiga» trae primero la IPTV «M+ LaLiga TV 2»
   confirmada por la guía, luego la IPTV «DAZN LaLiga» por nombre (un solo cartel, la FHD) y luego AceStream. La
   repetición, el resumen y la previa no aparecen. «M+ Liga de Campeones», «UK: DAZN 1» y el canal Hypermotion no
   aparecen. Ninguna petición de stream al proveedor durante la resolución (`peticiones()`).
2. `channelStream` web de la IPTV → `protocol: 'hls'` y URL `/api/v1/video/<sid>/index.m3u8` sin token.
   `conexiones()` = 1 con dos visores (web e iPhone).
3. Cambiar a una AceStream → `conexiones()` = 0 **antes** de que se abra el motor (la gracia no se aplica).
4. **Dos `acquire` simultáneos**, web con la IPTV e iPhone con una AceStream → una sola sesión viva, un
   `playback.handoff` y `conexiones() ≤ 1` en todo momento.
5. Corte del proveedor (`corta-a-los:5`) → el relé reconecta sin cerrar ffmpeg. Con `corta-a-los:5:pts` → reinicio del
   remux y `stream.reopened remux_restart`. Con `down` → prueba la variante HD y, si también cae, `stream.closed`
   `remux_failed` + `iptv_dropped` (nunca `remux_died`).
6. `busy` justo después de cerrar (con `retenerPlaza`) → reintentos → abre. `busy` ajeno → `iptv_busy`.
7. Sondas: con una sesión viva no hay ninguna petición de stream del comprobador (`peticiones()`); una sonda de fondo
   en curso se aborta al abrir una sesión y no hay dos conexiones.
8. **Fugas**, en Xtream y en la M3U `get.php`: usuario y contraseña ausentes de todas las respuestas, del SSE, de los
   registros capturados, de `diagnostics.jsonl`, del `iptv.json` crudo y de los argumentos del ffmpeg falso, también
   tras provocar `bad_url`, `redirect_loop` y un 404 de stream.
9. Motor AceStream caído → la IPTV se resuelve y se reproduce.
10. Eliminar → `iptv.json.bak` y copias apartadas borradas; un id IPTV de antes da `410 iptv_removed` sin tocar el
    motor.

Con ffmpeg real hay un caso más, `describe.runIf(hayFfmpeg)`: TS H.264 con AC3 → segmentos fMP4 con AAC reales.

**Ensayo con la IPTV real de Isma** (`apps/server/scripts/iptv-ensayo.ts`, sin tocar ningún stream). Lee el catálogo
y la guía ya guardados (`catalogo.enc`, `guia.enc`) y la agenda en caché, y dice, **ya tapado** (sin URLs), qué IPTV
saldría para cada partido de hoy y mañana, con su puntuación y si la confirma la guía. Así Isma lo comprueba antes de
un partido sin reproducir nada. Se compila con el servidor y se lanza dentro del contenedor de la app, o con `tsx` en
el PC contra una copia de `/data`.

### 9.3 E2E con Playwright (`apps/web/e2e/iptv.spec.ts`)

**Pila:**
- `support/backend.ts` sirve el host `iptv.ace-e2e.example`: lo resuelve a `93.184.215.14` y el `NetTransport` lo
  reenvía al proveedor falso de `apps/server/test/fake-iptv`, que lanza `stack.ts`.
- **Necesita ffmpeg real** para el remux. La CI general instala `ffmpeg` en el job E2E
  (`sudo apt-get install -y --no-install-recommends ffmpeg`).
- En local, si falta ffmpeg, se marca `test.skip` con aviso.
- Etiqueta `@video`: corre en chrome-escritorio, como hoy.
- El partido es «DAZN LaLiga» del catálogo E2E del backend (el que allí se llama demo-4), no la demo de la web.

**Casos:**

1. **Configurar.**
   - Ajustes → IPTV → Xtream → «Guardar IPTV» → «Conexión correcta. Descargando los canales de «Casa»…» → la tarjeta
     enseña «Activa», «Xtream · N canales» cuando llega `iptv.status`.
   - La contraseña **no** aparece en el DOM ni en ninguna respuesta (`page.on('response')` sobre `/api/`).
   - «Cambiar datos» con la contraseña vacía guarda sin pedirla. Cambiar el servidor la exige.
2. **Reproducir IPTV.**
   - Se abre el partido. El primer cartel es `data-origin="iptv"`, con el distintivo «IPTV» y «reproduciendo ahora».
     Hay 2 carteles IPTV como mucho.
   - `estadoReproductor` dice que el motor es hls.js (`window.__acePlayer.get()`).
   - El vídeo avanza (`esperarQueAvance`).
3. **Caída → AceStream con aviso.**
   - `/__iptv/modo(id,'down')` para todas sus variantes → la línea de estado dice «Tu IPTV no responde: seguimos por
     AceStream (fuente N)» y sale el toast «Seguimos por AceStream» con «Volver a la IPTV».
   - Pasa a reproducir un cartel AceStream verificado.
   - El cartel IPTV sigue visible (no plegado).
4. **Volver.**
   - `/__iptv/modo(id,'ok')` → toque en «Volver a la IPTV» → el cartel IPTV vuelve a estar «reproduciendo ahora».
5. **Al revés:** con la IPTV elegida a mano y luego AceStream elegida a mano,
   `motor.modo(hash,'failedContent')` → pasa sola a la IPTV con «Esta fuente no responde: pasamos a tu IPTV».
6. **Canal suelto desde Canales:** Canales → «Antena 3» → suena primero la IPTV (el reproductor nunca conecta antes con
   AceStream). Cae → pasa al hash tocado.
7. **Pausa:** el switch «Usar la IPTV» apagado → el partido sin IPTV, como hoy, y tocar un canal vuelve al camino de
   hoy.

---

## 10. Impacto en la app nativa (`rediseno/nativa`)

**Sin cambiar nada, incluida la 0.8.0 publicada:**
- La IPTV llega en cabeza de `candidates` y como `candidate`, se puede elegir a mano con un toque y se reproduce por la
  ruta nativa de siempre (`hls-fmp4`).
- Si su regla de arranque automático exige `working` (la de la web hoy lo hace), puede arrancar antes una AceStream
  verificada, porque la IPTV ya no llega `working` por tener la cuenta activa (§7.3). Es el precio de no mentir con
  «Verificada»; la regla nueva de §7.1 lo arregla cuando la app la copie.
- Si cae la IPTV, salta a AceStream en automático (`stream.closed` con `remux_failed`, y los `iptv_*` no son errores
  de sistema).
- Los favoritos y los recientes que tenga no se estropean: el servidor convierte o descarta los ids IPTV (§4.6).

**Lo que falla sin cambios:**
- la IPTV sale sin distintivo («Fuente»);
- se ofrecen «Copiar hash», «Abrir en la app de AceStream» y «Favorito»;
- el reproductor dice «Conectando con AceStream…»;
- tras caer, la IPTV se pliega;
- al tocar un canal, arranca AceStream primero (no pregunta por la IPTV).

Cambios mínimos, cuando existan las pantallas. Los ficheros marcados con * **todavía no existen** en
`rediseno/nativa`: son los previstos por el plan de la fase 3 (b-arquitectura) y el nombre final lo pone su dueño.

| Módulo | Fichero o carpeta | Cambio |
|---|---|---|
| M1 | `Sources/Core/Models/Futbol.swift` | `case iptv` en `CandidateSource`; `CandidateIptvInfo? iptv` opcional en `ResolutionCandidate` (`provider`, `quality`, `backup`, `guide`); `scope` en la consulta de `footballResolve` |
| M1 | `Sources/Core/Models/Reproduccion.swift` | `source: FuenteSesion?` (`engine`, `iptv`, tolerante) en `StreamGrant` y `SessionSummary` |
| M1 | modelo de `bootstrap` | `features.iptv: Bool?` opcional (el fixture no lo lleva, §5.7) |
| M1 | `Sources/Core/Networking/` (`RutaID.generado.swift`, `ErrorCatalog.swift`, `PlazosWeb.generado.swift`) | regenerar (§10.1): 5 rutas `web` nuevas, `video` pasa a `any` y 16 códigos `iptv_*`. **No hay rutas nuevas en `Rutas.swift`** |
| M3 | `Sources/Core/Reglas/Fuentes/ReglasFuentes.swift` | lo mismo que `model.ts`: etiqueta «IPTV», `REASON_PHRASE` `iptv_*`, `pickAutoSource` IPTV primero (`weak` no frena), `pickBridgeTarget`, tope de saltos, IPTV nunca plegada, calidad de `iptv.quality`; vectores regenerados desde `scripts/vectores/fuentes.ts` |
| M3 | `Sources/Core/Reglas/Fuentes/OpcionesFuente.swift`* | sin «Copiar hash», «Abrir en la app de AceStream» ni «Favorito» para IPTV |
| M3 | `Sources/Core/Reglas/Avisos/LineaEstado.swift` y `Sources/Core/Reglas/Reproduccion/{TextosReproductor, EstadoVisible}.swift`* | «Conectando con tu IPTV…», «Reconectando con tu IPTV…», «Tu IPTV no da señal ahora mismo.» y los textos de la línea de estado de §7.2 (regenerados en `textos-web.json`) |
| M3 | `Sources/Player/Fuentes/SesionFuentes.swift` y `SesionFuentesPartido.swift` | puente P16.6 (tabla de §7.2) con el texto en la línea de estado y el toast «Volver a la IPTV» atado a la sesión → `elegir(idIptv)`; `entrarCanal` con `scope=channel` (2,5 s) solo con `features.iptv`, **sin arrancar AceStream antes**; `entrarPartido` sin canales → resolver (solo con `features.iptv`); seguir `scan.verdict` con IPTV activa; `record: false` para IPTV |
| M3 | `Sources/Player/Reproductor.swift` | `iptv_*`, `remux_*` con IPTV y `stream.closed` con código IPTV agotan la fuente sin reintentos; `engine_unavailable` con IPTV disponible es fallo de fuente; `stream.reopened remux_restart` se reengancha |
| M6 | `Sources/Pantallas/Partido/` | cápsula «IPTV» en el cartel (`Capsula` neutra con icono `tv`); Datos técnicos: «Origen: IPTV · {Casa}», «Pares» «—» y sin fila «Hash» |
| M2 | `Sources/Debug/ServidorDemo.swift`, golden | si la demo de la app copia la de la web, regenerar **demo-5** (gana una fuente IPTV); demo-4 no cambia |
| M7 | Ajustes | **nada**: la IPTV no se configura en el iPhone |

### 10.1 Contratos y CI de iOS: dueño y orden

Lo que **no** rompe la CI de iOS, por diseño (§5.7):
- los ejemplos de las rutas IPTV y de `iptv.status` van en `fixtures/web/`, y las variantes en `fixtures/variantes/`,
  carpetas que `FixturesTests` y `GeneradosTests` no recorren;
- `fixtures/v1/` y `fixtures/events/` no cambian, así que ni hay tipos Swift nuevos obligatorios ni cambia el número de
  eventos frente a `SSEEvent.tiposConocidos`.

Lo que **sí** la rompe, porque los generadores de la app leen `packages/shared` con `--check`:
- `generar-rutas.mjs --check` (5 rutas nuevas y `video` a `any`);
- `generar-catalogo-errores.mjs --check` (16 códigos nuevos);
- `generar-plazos.mjs --check` (`iptvSave` e `iptvSync` en `TIMEOUTS`);
- `textos-web.json`, cuando la web tenga los textos nuevos.

**Dueño y orden:**
1. El contrato (§11.1) se sube a `rediseno/iptv`. Nadie de `rediseno/iptv` toca `apps/ios` (regla de la fase 3).
2. **Antes** de fusionar `rediseno/iptv` en `rediseno/palco` o en `rediseno/nativa`, el dueño de `rediseno/nativa`
   (el agente de datos de la fase 3, M1) hace **un commit en `rediseno/nativa`** que fusiona el contrato y regenera
   con los tres generadores `RutaID.generado.swift`, `ErrorCatalog.swift` y `PlazosWeb.generado.swift`. Es mecánico y
   no cambia comportamiento.
3. La fusión de la web (textos) va después, con la regeneración de `textos-web.json` en el mismo commit de nativa que
   la adopta.
4. Hasta entonces, `ios.yml` no se dispara en `rediseno/iptv` salvo por cambios en `packages/shared/src/**` o
   `fixtures/**`; si se dispara, su fallo en `--check` es el esperado y se anota en el PR.

---

## 11. Reparto para implementar en paralelo

### 11.1 «contrato» (va primero; objetivo: medio día)

**Carpetas:**
- `packages/shared/src/**`: `api/common.ts`, `api/v1/iptv.ts` (nuevo), `api/v1/football.ts`, `api/v1/playback.ts`,
  `api/v1/system.ts` (`features.iptv`), `routes.ts` (5 rutas y `video` a `any` con `t` opcional para web), `events.ts`,
  `errors.ts`, `state/v2.ts` y `constants/` (`IPTV_REASONS`, `IPTV_MIN_SCORE`, `IPTV_USER_AGENT`, límites de §3);
- `packages/shared/scripts/fixtures.ts` y `packages/shared/fixtures/**` (con `web/` y `variantes/`);
- `packages/shared/test/**` (`contracts.test.ts` adaptado, §5.7);
- `docs/openapi-v2.yaml` (regenerado), `docs/api.md` y `docs/contratos.md`.

**Entrega:**
- todo lo de §5;
- fixtures y variantes en su sitio;
- `corepack pnpm@10.18.2 -r typecheck` y `corepack pnpm@10.18.2 --filter @ace/shared test` en verde;
- la lista de §10.1 para el dueño de `rediseno/nativa`.
- **Nada** de lógica: ni emparejado ni textos de la web.

**Nadie más toca `packages/shared`.** Si el servidor o la web necesitan un cambio, se lo piden al contrato, que lo
hace en un commit pequeño aparte.

### 11.2 «servidor» (en cuanto el contrato esté subido)

**Carpetas:**
- `apps/server/src/modules/iptv/**` (nuevo): `crypto`, `redact`, `ids`, `m3u`, `json-array`, `xtream`, `names`,
  `match`, `xmltv`, `guide-match`, `relay`, `probe`, `service`, `store`;
- en `apps/server/src/`:
  - `modules/{net, football, sources, scanner, playback, remux, events, state, diagnostics}/**` (incluidos
    `football/preheat.ts` para la señal de la agenda, `playback/service.ts` para la colocación con el cerrojo de la
    casa, `scanner/transport.ts` para `inspectFile` y `state` para `purge()` y `fileMode` de `createDocumentStore`);
  - `app.ts` (ruta `video` con origen web sin token);
  - `config/keys.ts`, `core/logger.ts` y `services.ts`. `iptv` se crea **justo después de `net`**, porque depende de
    state, net y bus. scanner (carril IPTV), remux (redactor y reinicio), playback y football lo reciben. Los informes
    a diagnostics van por el bus, porque diagnostics se crea después;
- `apps/server/scripts/iptv-ensayo.ts` (nuevo);
- `apps/server/test/fake-iptv/**` (nuevo) y `apps/server/test/integration/iptv.test.ts`;
- `deploy/umbrel/nginx.conf` (`location /api/v1/video/`) y su test.

**Qué simula de la web:** nada, porque las pruebas son HTTP. Usa `app.inject` con cabecera de origen web y native para
comprobar el 403 de `/native` y la ruta `video`, y los fixtures del contrato para las formas.

**Orden recomendado:**
1. `crypto`, `redact` e `ids`, más `net.openStream`, el filtro IPTV de `net`, `logger` y `keys`;
2. `store` y rutas de ajustes (con `revision`, abortar y `purge`);
3. M3U, `json-array`, Xtream y catálogo (con el cerrojo único de trabajos pesados);
4. `names` y `match` en la resolución (con favoritos e historial y el precalentamiento);
5. relé, remux y playback (cerrojo de la casa primero, luego reconexión y reinicio);
6. comprobador (nivel 1 y la sonda de fondo);
7. guía;
8. integración y ensayo.

**Entrega para la web:** el proveedor falso con CLI y su control `/__iptv/*`, que el E2E importa.

### 11.3 «web» (en paralelo con el servidor, en cuanto el contrato esté subido)

**Carpetas:**
- `apps/web/src/features/{iptv, settings, sources, match-center, library, search, where-playing, agenda}/**` (en
  `library` y `search`, solo `play.ts`, `useChannelActions.tsx` y `SearchView.tsx`; en `agenda`, solo si hace falta
  para el medidor, §7.7);
- `apps/web/src/player/{api, runtime, status}.ts` y `apps/web/src/player/NerdPanel.tsx`;
- `apps/web/src/api/{client.ts, boot.ts, demo/**, demo-registry.ts}`;
- `apps/web/e2e/iptv.spec.ts` y `apps/web/e2e/support/{backend, catalogo, stack}.ts`;
- el paso de ffmpeg del job E2E en `.github/workflows/ci.yml`.

**Qué simula del servidor mientras tanto:**
- la demo (`registerDemoHandlers` para las rutas IPTV y la IPTV de **demo-5** en `demo-data.ts`);
- los fixtures `variantes/footballResolve.iptv.json` y `variantes/channelStream.iptv.json` en los tests unitarios con
  `api` simulada;
- en el reproductor, `engines/demo.ts` falla si el título contiene «caíd», lo que sirve para probar el puente sin
  backend.
- El E2E (§9.3) se escribe al final, cuando el servidor haya subido el proveedor falso y la reproducción.

**Textos:** todos literales en `features/iptv/*`, `features/sources/session.ts`, `player/*` o `notices/*`, para que
`generar-textos.mjs` de la app los encuentre.

### 11.4 Cierre (cualquiera de los tres, al final)

- `corepack pnpm@10.18.2 -r typecheck`, `corepack pnpm@10.18.2 -r test` (hay un test intermitente conocido: repetir
  antes de darlo por roto), lint y E2E.
- La CI de la rama en verde salvo `check:release`, que es lo esperado hasta la 0.8.1.
- Actualizar este documento con lo que haya cambiado.
- Pasar a los dueños de M1/M3/M6 la lista de §10 y el orden de §10.1.
- Pedir a Isma que pase el ensayo (§9.2) con su IPTV antes del primer partido.

---

## 12. Riesgos y decisiones tomadas por defecto

### 12.1 Decisiones por defecto (Isma puede cambiarlas)

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Un solo proveedor IPTV** | Isma habla de «la IPTV». El contrato (`provider` nullable) se puede ampliar a una lista más adelante |
| D2 | **Id sintético de 40 hex que se reconoce solo** (32 hex de HMAC + 8 de etiqueta) en vez de un tipo de id nuevo | cero cambios de formato en contratos, SSE, favoritos, comprobador y app; la 0.8.0 funciona; sin listas de ids retirados |
| D3 | **Siempre remux por ffmpeg, con relé local** | credenciales fuera de ffmpeg, audio AC3 → AAC, una conexión y un formato |
| D4 | **Web con hls.js** (protocolo `hls` sobre el remux fMP4) | Isma no quiere mpegts.js para esto; `hls-fmp4` podría elegir el HLS nativo del navegador de escritorio |
| D5 | **Un canal a la vez en casa, también con IPTV**, con el mismo cerrojo | es la regla de hoy; respeta `max_connections = 1` sin más lógica |
| D6 | **El puente IPTV ↔ AceStream vale también en manual y en canales sueltos** | «si uno no va, va el otro»; los saltos entre dos AceStream siguen como hoy (P16.3 y P16.4) |
| D7 | **Volver a la IPTV solo con un toque**, nunca solo | evita ir y volver sin parar; el aviso lleva el botón |
| D8 | **Umbral 92 para la IPTV** (70 para las listas), con limpieza de grafías propia | catálogos de miles de canales: mejor no emparejar que emparejar mal |
| D9 | **Filtro de país: ES o sin país; para la guía, ES explícito** (o sin país que case con la agenda) | «IT: DAZN 1» no es «DAZN 1»; si hace falta, se abre como ajuste |
| D10 | **La IPTV no entra en biblioteca, buscador ni agenda** — **pendiente de confirmar con Isma** (§4.4) | alcance pedido; pero su ejemplo es Antena 3, que puede no estar en sus listas de AceStream |
| D11 | **Cambiar servidor o tipo exige reescribir credenciales y crea otro `provider.id`** | nadie puede mandar la contraseña guardada a otro host, y nada de un servidor se aplica a otro |
| D12 | **Lista cada 6 h, guía cada 8 h, cuenta cada 10 min** | «unas pocas veces al día»; los tres se retrasan si se está viendo |
| D13 | **`iptv.status` solo para la web; sin ámbito nuevo en `state.changed`** | el iPhone no tiene nada que invalidar y así no hay enums nuevos |
| D14 | **Canales sueltos: `footballResolve` con `scope=channel`** (sin buscador ni IA), solo con `features.iptv` | da comprobador y puente sin inventar otra ruta; sin IPTV todo sigue igual y sin espera |
| D15 | **Partido sin canales: se pregunta al servidor** (solo guía) por si la encuentra | nada visible nuevo en la agenda |
| D16 | **Ninguna dependencia nueva** (XMLTV y array JSON con troceadores propios y `node:zlib`) | la regla del repo: solo si es imprescindible |
| D17 | **User-Agent de VLC por defecto**, más `#EXTVLCOPT` (solo UA y referrer) por canal; sin campo en Ajustes | lo que exigen la mayoría de proveedores; se añade un campo si algún proveedor falla |
| D18 | **AES-256-GCM con clave HKDF `ace-iptv-v1`**, y fichero `clave` si no hay semilla | se aprovecha el esquema de claves que ya existe; con semilla, las copias de Umbrel quedan protegidas |
| D19 | **La ruta `video` pasa a `any`**: la web sin token (login de Umbrel), el iPhone con `video-token` como hoy | la web no tiene dispositivo para firmar; evita una ruta paralela |
| D20 | **demo-5 gana una IPTV; demo-4 no cambia** | la demo enseña la función sin borrar el único caso de «probamos la fuente 3» |
| D21 | **HEVC no se transcodifica**: fuera de la web, válido en el iPhone | la CPU del N300; es la misma regla D6 que AceStream |
| D22 | **Sin «Probar conexión»**: «Guardar IPTV» prueba rápido y el recuento llega por SSE | como «Listas»; sin peticiones de 130 s ni `location` especial en nginx |
| D23 | **Un cartel por canal IPTV y 2 como mucho**; las variantes, dentro del servidor | «una fuente más con su distintivo» |
| D24 | **Sin sonda de stream en resoluciones interactivas**; solo de fondo, en Xtream y con `active_cons == 0` | la reproducción es la prueba y no se molesta a la tele de Isma |

### 12.2 Riesgos

1. **Conexiones del proveedor.** Con `max_connections = 1` y la misma cuenta abierta en la tele, Ace Player recibirá
   `iptv_busy` y saltará a AceStream, que es lo correcto.
   - Ajustes lo avisa con «Tu cuenta tiene todas sus conexiones en uso fuera de Ace Player.».
   - Los paneles que tardan en liberar la plaza (30-120 s) se cubren descontando nuestros cierres de 120 s y con los
     reintentos 2-4-8 s. Si en la práctica no basta, se alargan.
2. **Proveedores quisquillosos.** Hay proveedores que bloquean por User-Agent, que exigen `Referer` o que redirigen a
   hosts que resuelven a IPs privadas (bloqueadas siempre si el host configurado es público, §3.1).
   - El error sale como `iptv_unreachable` o `private_url`, con el host en diagnósticos.
3. **Formatos de vídeo.**
   - 1080i entrelazado: se ve, pero peinado en algunos navegadores.
   - MPEG-2 SD: no se reproduce.
   - HEVC: solo en el iPhone.
   - HLS con audio en rendición aparte: `iptv_unsupported`.
   - Se verá en «Datos técnicos».
4. **Guía mal fechada.** Guías sin zona horaria o desplazadas pueden romper la ventana de ±30 min. En ese caso **no se
   empareja** (es lo seguro), y queda el emparejado por nombre.
5. **Emparejado por guía o por nombre equivocado.** Queda mitigado por las condiciones de §4.5, el corpus y el ensayo
   (§9.2). Si ocurre, «Reportar → Canal incorrecto» aprende a apartar esa IPTV para ese canal.
6. **Memoria y CPU en el N300** (contenedor con `mem_limit: 768m`).
   - Catálogos de 100 000 canales ocupan unos 20–30 MB en memoria.
   - `get_live_streams` se trocea en streaming: sin el pico de 250-300 MB de un `JSON.parse` entero. Hay un test de
     memoria.
   - Un solo trabajo pesado IPTV a la vez (lista o guía).
   - El audio AAC de ffmpeg gasta poco. `MAX_REMUX_SESSIONS = 3` es compartido.
7. **Ids sintéticos en caminos antiguos.** Un id IPTV que llegue al motor (app 0.8.0 con «Abrir en la app de AceStream»,
   `/remux/<hash>` antiguo o buscador) solo da «no encontrado». No rompe nada, pero ensucia diagnósticos del motor. Por
   eso el servidor comprueba `owns` / `isIptvId` antes. Si cambia la semilla, los ids viejos dejan de reconocerse.
8. **Cambio del secreto de la app o restaurar en otro Umbrel:** se pierden las credenciales
   (`iptv_secret_unreadable`) y hay que escribirlas otra vez.
9. **nginx.** `/api/v1/video/` necesita `proxy_buffering off`, o los segmentos llegarán a golpes. Ninguna ruta IPTV
   pasa de los 60 s de `/api/`.
10. **Contratos y generados de la app.** Los ejemplos solo web y las variantes no tocan la CI de iOS (§5.7), pero
    `RutaID`, `ErrorCatalog`, `PlazosWeb` y `textos-web.json` hay que regenerarlos en `rediseno/nativa` antes de
    fusionar, con el dueño y el orden de §10.1.
11. **Tiempo para la 0.8.1.** Si no da tiempo a todo, el orden de recorte es:
    1. primero cae la guía;
    2. luego la sonda de stream de fondo (queda la de cuenta);
    3. luego «mantener caliente».
    - Lo que **no** se recorta: el cifrado, la redacción, el cerrojo de la casa, el relé y el puente.

---

## 13. Anexo: Revisión

Dos revisiones (lente de seguridad y robustez; lente de producto y coherencia) encontraron 32 problemas, 11 de ellos
graves. **Todos los graves están aplicados.** De los demás, se aplicó lo razonable; lo descartado, o aplicado solo en
parte, va con su motivo.

### 13.1 Graves (todos aplicados)

| # | Problema | Qué se cambió | Dónde |
|---|---|---|---|
| S1 | La IPTV se saltaba `engineLock`, donde vive «un canal a la vez»; la gracia de 3 s chocaba con «cerrar antes de abrir» | La sesión IPTV se coloca con el mismo cerrojo (de la casa) y solo cambia la apertura. La gracia vale solo si el último visor se va sin pedir otra cosa; cualquier otro `placeLocked` o traspaso la cancela y espera al relé. Test de dos `acquire` simultáneos | §6.4, §6.5, §9.1, §9.2 caso 4 |
| S2 | Carrera entre la sonda y el reproductor por la única plaza; la sonda abría dos conexiones (muestra + ffprobe) y `inspect` no acepta URLs | Nunca se sondea una IPTV en una resolución interactiva; la sonda queda para trabajos de fondo, lee una vez a fichero y usa `inspectFile`; abrir una sesión aborta la sonda y espera al socket; el relé da 409 a una segunda petición | §5.2, §6.1, §6.4, §7.3 |
| S3 | ffmpeg moría antes de que el relé reconectara; `-rw_timeout 15s` no es válido; cambio de base de PTS tras reconectar | `-rw_timeout 45000000` (µs) por encima del peor caso del relé (41 s, con esperas 1-2-4 s); salto de PTS > 5 s → reinicio del remux y `stream.reopened remux_restart` | §6.1, §6.3, §6.6, §5.5 |
| S4 / P5 | Fuga de credenciales con M3U `get.php` y URLs cortas `/U/P/id` | Regla principal: ninguna URL del proveedor se registra (solo host e id); el redactor aprende los secretos de la M3U; `redactUrl` tapa la forma corta; `detail` de `bad_url` y `redirect_loop` tapados; `finalUrl` no sale del relé; prueba de fuga repetida con `get.php` | §2.4, §3.2, §9 |
| S5 | `retiredIds` con tope 5000 hacía fallar «Quitar» y la sincronización por el esquema | Id que se reconoce solo (32 hex + etiqueta HMAC de 8 hex); fuera `retiredIds` e `isRetired` | §2.2, §4.1, §5.3 |
| S6 | Memoria: `get_live_streams` entero, `iptvTest` de 130 s repetible, trabajos simultáneos en 768 MB | Troceador del array JSON en streaming con el tope aplicado al leer; un solo trabajo pesado IPTV a la vez; fuera `iptvTest`; test de memoria con 100 000 canales | §3.3, §3.5, §5.3, §9.1 |
| P1 | Al tocar un canal, `playChannel` arrancaba AceStream antes de preguntar por la IPTV | Con `features.iptv` (nuevo en `bootstrap`, `access: 'any'`), `playChannel` no llama a `play()` y `enterChannel` arranca la IPTV primero; sin IPTV, igual que hoy y sin espera | §5.1, §8.4, §8.5 |
| P2 | El contrato rompía la CI de iOS (`FixturesTests`, `GeneradosTests`, `--check`) | Ejemplos solo web en `fixtures/web/`, variantes en `fixtures/variantes/`, `contracts.test.ts` adaptado; `bootstrap.json` sin `features.iptv`; regeneración de `RutaID`, `ErrorCatalog` y `PlazosWeb` en `rediseno/nativa` con dueño y orden | §5.7, §10.1 |
| P3 | «DAZN LaLiga» ≠ «DAZN LA LIGA», «M+ LaLiga TV 1» a 78, «M+ Hypermotion» a 0 | En `cleanIptvTitle` (no en el `normalizeChannelKey` compartido): «la liga» → «laliga», alias curados, « 1» final si el pedido no lleva número; corpus de nombres reales | §4.2, §9.1 |
| P4 | La guía ponía primero un canal de otra competición (y el E2E lo daba por bueno); canales sin país | Regla 5 ampliada a todas las familias por el nombre del canal; guía con país ES explícito o casando con la agenda; nuevo caso de prueba («M+ LaLiga TV 2» sí, «M+ Liga de Campeones» no) | §4.5, §9.2 |
| P6 | Favoritos, Recientes e historial se llenaban de ids IPTV que salían como carteles de AceStream | La resolución convierte o descarta todo id IPTV de vínculos, favoritos e historial; la web reproduce la IPTV con `record: false` y sin «Favorito» | §4.6, §8.1, §8.4 |

### 13.2 No graves aplicados

| # | Problema | Qué se cambió |
|---|---|---|
| S7 | `ALLOW_PRIVATE_SYNC_URLS` quitaba todo el filtro para URLs que decide el proveedor | Con IPTV se bloquean siempre loopback, link-local, metadatos, multicast, nombres de una etiqueta y el puerto del relé; RFC1918 solo si el host configurado ya es privado; el CLI escucha en la IP de red local (§3.1, §9.2) |
| S8 | El relé dejaba pasar URIs no reescritas, reenviaba 3xx, audio en rendición aparte, extensiones que ffmpeg 7.1 rechaza | Reescritura por lista blanca, el relé sigue las redirecciones, `iptv_unsupported` sin audio muxeado, extensión normalizada (§6.1) |
| S9 | Relé y remux sin ciclo de vida común; `remux_died` ganaba a `iptv_dropped` | El relé aborta con el socket de ffmpeg y con cualquier cierre del remux; se cierra en playback antes de matar ffmpeg; y en la web cualquier `remux_*` con IPTV es fallo de fuente inmediato (§6.1, §6.3, §7.2) |
| S10 | Paneles que cuentan la conexión 30-120 s; `busy` marcaba la IPTV como fallida | `iptv_busy` es `weak`, no `failed`; cierres propios recordados 120 s y descontados; reintentos 2-4-8 s al abrir y 1-2-4 s en el relé, cerrando antes el socket viejo (§6.5, §7.3) |
| S11 | Carreras con la configuración (mismo `provider.id` tras cambiar de servidor; guardar esperando 120 s) | `revision` en el documento; `provider.id` nuevo al cambiar origen o tipo; guardar, pausar y eliminar abortan en vez de hacer cola (§1.4, §3.4, §3.5) |
| S12 | URLs con token que caduca; cierre por cuenta caducada ante un fallo pasajero | Reconexión desde la URL original; en M3U, 401/403/404 → refresco (1/min) y un reintento; caducada solo con dos comprobaciones o si falla el stream (§3.3, §3.5, §7.4) |
| S13 | La ruta `video` para la web no encajaba con el token por dispositivo | Web sin token (`t` opcional e ignorado), native como hoy, con test (§5.4) |
| S14 | Parsers ante listas o guías hostiles; gzip frente a `identity` | 16 KiB por línea M3U; 8 KiB por texto o atributo, profundidad y DOCTYPE ignorado en XMLTV; `identity` + bytes mágicos, o `Content-Encoding: gzip` solo para IPTV; `#EXTVLCOPT` solo UA y referrer sin CR/LF (§3.1, §3.2, §3.6) |
| S15 | «Quitar» dejaba `.bak` y copias apartadas; la copia «cifrada» con clave local; `new-password` | `purge()` de `.bak` y copias apartadas; texto matizado sobre copias con clave local; `autoComplete="off"` con marcas de gestores y sin prometer más (§1.4, §2.3, §5.3) |
| S16 (en parte) | Toast con `idIptv` viejo; trabajo de `scope=channel` huérfano; puente con estado de hace 10 min | Toast atado a la sesión y al partido o canal; un salto a una AceStream que falla enseguida cuenta en el tope. **Descartado:** una ruta `scanCancel` nueva (más contrato para un caso menor); en su lugar, el siguiente trabajo `interactive` del mismo visor sustituye al huérfano, y si el comprobador no lo hace ya, playback lo cancela al adquirir otra sesión (§5.2, §7.2, §7.3) |
| P7 | Dos avisos a la vez; en pantalla completa no se ve el toast | Un solo texto en la línea de estado (el de `exhaust`), el toast solo es el botón y solo fuera de pantalla completa; en pantalla completa, la línea dice cómo volver (§7.2) |
| P8 | La agenda diría «Sin fuentes» con la IPTV lista | El precalentamiento cuenta la IPTV emparejada como jugable (§7.7) |
| P9 | Hasta 7 carteles IPTV; la reserva dentro de la IPTV nunca se usaba | Un cartel por canal y 2 como mucho; las variantes, en el relé, antes de dar la IPTV por caída (§4.3, §6.1) |
| P10 | La sonda molestaba a la tele; «Verificada» por tener la cuenta activa | Sin sonda en M3U; en Xtream solo con `active_cons == 0` y solo de fondo; el nivel 1 no emite veredicto al ir bien (queda «Sin comprobar»); fuera `iptv_ready` (§7.3, §8.3) |
| P11 | Faltaban ficheros en el reparto; helpers mal ubicados; ficheros de la app que no existen | Añadidos `play.ts`, `useChannelActions.tsx`, `SearchView.tsx`, `status.ts`, `NerdPanel.tsx`, `where-playing`, `agenda`, `preheat`; `isHttpUrl`/`looksPrivateUrl` vienen de `features/directories/model.ts`; ficheros de la app marcados con * (§1.1, §8.5, §10, §11) |
| P12 | Ajustes pedía «Probar conexión» de 130 s, otro vocabulario y `matchedLibrary` | Un solo «Guardar IPTV»; «Actualizar», «Eliminar», «¿Borrar?», «IPTV eliminada», «Guardando y sincronizando la lista…» como «Listas»; fuera `matchedLibrary` y la `location` de 150 s (§1, §5.3, §6.6) |
| P13 | demo-4 cambiaba de papel y se confundía con la demo-4 del E2E | La IPTV de la demo va en demo-5; el E2E usa la demo-4 del catálogo del backend y lo dice (§1.6, §8.5, §9.2, §9.3) |
| P14 | El tope de 2 saltos acababa con un texto falso | Al llegar al tope solo se deja de saltar entre IPTV y AceStream; el texto final solo sin fuentes (§7.2) |
| P15 | No estaba dicho qué hace el servidor con un partido sin canales | Solo guía; si no hay nada, `not_found` sin trabajo; la web se queda en `no_channels` (§4.5, §8.4) |
| P17 | Pruebas insuficientes para fiarse con la IPTV real | Corpus de nombres, guías reales anonimizadas, filiales que faltaban y script de ensayo local (§4.2, §4.5, §9) |

### 13.3 Pendiente de Isma

- **P16 · Canales que solo están en la IPTV (D10).** No se ha implementado nada nuevo: hay que preguntarle antes. Si
  quiere ver Antena 3 aunque sus listas de AceStream no la traigan, se adelanta el grupo discreto «En tu IPTV» del
  buscador de Canales (§4.4).

### 13.4 Descartado

- **Que el backend rechace peticiones sin `X-Ace-Origin` que no vengan de nginx** (parte opcional de S7). Afecta a
  todas las rutas y al arnés de pruebas, y con el filtro IPTV (loopback siempre bloqueado) ya no hay forma de que una
  URL del proveedor llegue a `127.0.0.1:3000`. Se apunta para una revisión general de `net`.
- **Relleno TS (paquetes nulos) mientras el relé reconecta** (alternativa de S3). Con `-rw_timeout` a 45 s no hace
  falta, y el relleno complica el empalme con el reinicio por salto de PTS.
- **Conjunto compacto o Bloom de ids retirados en un fichero aparte** (alternativa de S5). La etiqueta en el id lo
  resuelve sin estado.
- **`scanCancel`** (parte de S16): ver §13.2.
