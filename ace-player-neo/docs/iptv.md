# IPTV en Ace Player Neo: diseño

Rama `rediseno/iptv`, que sale de `rediseno/palco` en el commit `269fac2`, con el servidor 0.8.1 todavía sin
publicar. Lo pidió Isma el 26-sep-2026. Este documento sustituye al boceto de `docs/ideas-futuras.md` §3.

Las rutas de ficheros son relativas a `ace-player-neo/` salvo que se diga otra cosa. Los textos entre «comillas» son
**literales**: se copian tal cual en el código, porque la app nativa los genera desde la web (`generar-textos.mjs`) y
los compara en `TextosTests`.

---

## 0. En pocas palabras

1. La IPTV se configura **solo en la web** (Ajustes → IPTV). Admite una lista M3U por URL o Xtream Codes. Se guarda
   **cifrada** en el Umbrel y nada de ella vuelve al navegador, al iPhone ni a los registros.
2. Cada canal IPTV recibe un **id sintético de 40 hex** (HMAC con una clave del servidor). Para los contratos, la web y
   la app es «un hash más». La candidata lleva `source: 'iptv'` y se reproduce por el mismo
   `GET /api/v1/channels/:id/stream`. Con esto **la app 0.8.0 publicada ya reproduce IPTV sin cambios**, aunque sin
   distintivo.
3. El servidor empareja la IPTV con los canales de los partidos y con los de las listas de AceStream usando el mismo
   `channelMatchScore` y la protección Hypermotion, pero con un **umbral de 92**. La IPTV va **primera**. La guía
   (XMLTV), que se usa solo por dentro, puede poner primero el canal que de verdad emite el partido.
4. El vídeo IPTV **siempre pasa por el servidor**. Un relé local en `127.0.0.1` descarga del proveedor (con la
   protección SSRF) y se lo da a ffmpeg, así que las credenciales nunca aparecen en los argumentos. ffmpeg lo remuxa a
   HLS fMP4 (vídeo copiado y audio a AAC). La web lo reproduce con **hls.js** (protocolo `hls`) y el iPhone con AVPlayer,
   como hoy.
5. Hay **una sola conexión al proveedor por canal**, compartida por todos los que miran. Se cierra al pasar a AceStream
   y a los 3 s de dejar de mirar. Mientras se mira no se hace ninguna sonda a ese proveedor.
6. Funciona como un puente: **si uno no va, va el otro**.
   - Si cae la IPTV, se pasa sola a la mejor AceStream verificada, con un aviso con el botón «Volver a la IPTV».
   - Si cae AceStream y hay IPTV, se pasa sola a la IPTV.
   - Esto vale también después de elegir a mano y en los canales sueltos.
7. Cambios mínimos en la app nativa: un `case iptv`, el distintivo, los textos, ocultar las acciones de AceStream y la
   regla del puente (§10).

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
  (`settings/second-tap.ts`), el estilo `dir-form` / `dir-card` / `dir-status` / `dir-note` de «Listas», `isHttpUrl`,
  `looksPrivateUrl` y `errorMessage()` de `@ace/shared`.

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
Contraseña             type=password  autoComplete=new-password

[Probar conexión] (quiet)   [Guardar IPTV] (primary)
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

| Momento | Tono | Texto |
|---|---|---|
| Probando | neutro (icono `refresh`) | «Probando la conexión…» |
| Prueba correcta en Xtream | ok | «Conexión correcta: cuenta activa hasta el {3 dic}, {812} canales en directo, {1} conexión a la vez.» (si no hay fecha de caducidad: «cuenta activa, …») |
| Prueba correcta en M3U | ok | «Conexión correcta: {812} canales en directo.» |
| Guardando | neutro | «Guardando y descargando la lista…» |
| Guardada | ok | ««{Casa}»: {812} canales. Se actualiza sola cada 6 h.» |
| Error | err (`role=alert`) | el `message` del catálogo (§5.6) |

Toasts: «IPTV guardada: {812} canales» (ok) y «No se pudo guardar la IPTV. {motivo}» (err).

### 1.3 Con IPTV: tarjeta y acciones

```
Casa  [Activa]                                     (Capsule: ok «Activa» | neutral «En pausa» | weak «Con fallos»)
Xtream · 812 canales · actualizada 26 sept, 20:30  (meta, formato de sourceMeta)
proveedor.example:8080 · usuario y contraseña guardados        (Xtream)
proveedor.example · dirección guardada                         (M3U)
Cuenta activa hasta el 3 dic · 1 conexión a la vez             (solo Xtream, si hay datos de la cuenta)
Coincide con 23 canales de tu lista activa                     (si > 0)
Guía: 640 canales con programación · actualizada 26 sept, 14:00 (solo si hay guía; ver abajo)

[✓] Usar la IPTV        «En pausa se guarda, pero no se usa: todo sale de AceStream.»   (Switch)
[Actualizar ahora]  [Cambiar datos]  [Quitar]
<dir-status>
```

**Líneas que sustituyen a la de la cuenta, por orden de prioridad:**
- «La cuenta de tu IPTV ha caducado o está desactivada.» (tono err).
- «Tu cuenta tiene todas sus conexiones en uso fuera de Ace Player.» Sale cuando `activeConnections ≥ maxConnections` y
  ninguna es nuestra (tono weak).

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
| «Actualizar ahora» | `iptvSync` | botón `busy`, estado «Actualizando la lista de «{Casa}»…» | toast «Lista de la IPTV actualizada: {812} canales» (llega por SSE `iptv.status`) |
| «Cambiar datos» | abre el formulario en modo edición (§1.4) | — | — |
| «Quitar» | segundo toque «¿Quitar?» (5 s, `useSecondTap`), luego `iptvDelete` | `busy` | toast «IPTV quitada» (icono `trash`) |

Nota debajo de «Quitar», en `dir-note`, visible solo durante el segundo toque: «Quitar la IPTV borra sus datos de tu
Umbrel.»

### 1.4 La contraseña nunca vuelve y cómo se edita sin reescribirla

**Qué devuelve el servidor.** `iptvGet` **nunca** incluye la URL de la lista, el usuario ni la contraseña (§5.3). Solo
devuelve:
- `host`, que es el nombre y el puerto, sin esquema, ruta ni query;
- en Xtream, `origin` (`http(s)://host:puerto`, sin ruta), para rellenar «Servidor»;
- `hasUsername` y `hasPassword`, o `hasUrl` en M3U.

**Formulario en modo edición.** Es el de §1.2 con el título «Cambiar los datos de tu IPTV» y los botones «Probar
conexión» y «Guardar cambios», más «Cancelar» (quiet).
- «Nombre» y «Servidor» vienen rellenos.
- «Usuario», «Contraseña» y «Dirección de la lista» vienen **vacíos**, con placeholder:
  - Usuario: «Guardado · escríbelo solo para cambiarlo»
  - Contraseña: «Guardada · escríbela solo para cambiarla»
  - Dirección de la lista: «Guardada · escríbela solo para cambiarla»
- Un campo secreto vacío **no se envía**. Para el servidor, ausente significa «sin cambios» (§5.3).
- «Probar conexión» con los secretos vacíos prueba con los guardados.

**Regla de seguridad.** Si cambia el **origen** del servidor Xtream, o el tipo (M3U ↔ Xtream), el servidor exige los
secretos otra vez: `400 iptv_credentials_required`, «Si cambias el servidor o el tipo, vuelve a escribir el usuario y
la contraseña.». Así nadie puede apuntar la IPTV a otro host y que el Umbrel le mande la contraseña guardada.
- En M3U la URL entera es secreta, así que cambiarla es escribirla otra vez.

**Higiene en el navegador.**
- Se llama con `api()` directo, **no** con `useApiMutation`, porque TanStack guarda `variables` en la caché de
  mutaciones.
- Los campos se vacían al guardar, al cancelar y al desmontar.
- Ni el cuerpo ni la respuesta de las rutas `iptv*` entran en diagnósticos del cliente ni en `console`.
- El campo de contraseña lleva `autoComplete="new-password"`, para que el navegador no ofrezca guardarla con el
  dominio del Umbrel ni la autorrellene.

### 1.5 Estado en vivo

`iptvGet` se invalida con el evento SSE `iptv.status`, que es solo para la web (§5.5). Mientras `status === 'syncing'`,
la tarjeta enseña «Actualizando la lista de «{Casa}»…». Sin SSE, se sondea `iptvGet` cada 3 s mientras dure `syncing`,
2 min como mucho.

### 1.6 Demo (`?demo=1`)

- `registerDemoHandlers` responde a `iptvGet` con un proveedor de ejemplo: «IPTV de ejemplo», Xtream, 812 canales,
  guía con 640, activa.
- `iptvSave`, `iptvTest`, `iptvSync`, `iptvUpdate` e `iptvDelete` devuelven `demo_unsupported`, como hoy los
  directorios.

---

## 2. Guardado en el servidor

### 2.1 Dónde

| Fichero | Contenido | Forma |
|---|---|---|
| `v2/iptv.json` | configuración, secretos **cifrados**, estado de la última sincronización, de la guía y de la cuenta, e ids retirados | `IptvFileSchema` (`packages/shared/src/state/v2.ts`), con `createDocumentStore` (escritura atómica, `.bak`, apartar lo corrupto) |
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
    id: z.string().regex(/^p_[A-Za-z0-9_-]{8}$/),     // aleatorio al crear; cambia al Quitar
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
  retiredIds: z.array(HashSchema).max(5000),           // ids de canales IPTV que ya no existen (30 días)
})
```

### 2.3 Cifrado de las credenciales

- **Claves.** Salen de `config/keys.ts`, con dos etiquetas nuevas en `KEY_LABELS`:
  - `iptvSecrets: 'ace-iptv-v1'`: AES-256-GCM de `secret`, `catalogo.enc` y `guia.enc`;
  - `iptvIds: 'ace-iptv-id-v1'`: HMAC de los ids de canal (§4.1).
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
- **Copias de seguridad de Umbrel.** Incluyen `/data`, pero con los secretos cifrados.

### 2.4 Redacción en los registros, en ffmpeg y en los errores

**1. Redactor con secretos conocidos** (`modules/iptv/redact.ts`).
- `redactor.clean(text)` sustituye por `•••` cada aparición exacta, en crudo y codificada con `encodeURIComponent`,
  de:
  - usuario y contraseña (si miden 3 caracteres o más);
  - la URL M3U completa y su query;
  - las URLs de guía;
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
  - tapa `/r/<ticket>/` del relé.
- Se aplica en `onResponse` **y** en el serializador de `err` (`err.message`, `err.detail`, `err.cause.message`).

**3. `net`.** `redirect_loop` y los demás errores con `detail` guardan `redactUrl(url)`, nunca la URL cruda (hoy
`net/client.ts:197` la guarda entera). Los errores de undici se envuelven: se conservan `code` y `host`, nunca `href`.

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

**7. Pruebas de fuga** (§9). Con usuario `usuario-e2e` y contraseña `Cl4ve-Secreta-E2E`, se comprueba que ninguno de
los dos aparece en:
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
redirecciones manuales (5 como mucho, comprobando cada salto) y el interruptor `ALLOW_PRIVATE_SYNC_URLS`. Hace falta
una pieza nueva:

- **`net.openStream(url, { maxBytes?, totalMs?, idleMs, headers?, signal })`** devuelve
  `{ status, headers, body: Readable, finalUrl }`.
  - Aplica el mismo filtro que `fetchBuffer` y corta al pasar de `maxBytes` (`response_too_large`) o de los plazos.
  - La usan la lista M3U, la guía y el relé de vídeo (este último sin `maxBytes` ni `totalMs`).
- **`fetchBuffer` y `fetchJson`** admiten `maxBytes`, `totalMs` e `idleMs` por llamada (hoy son fijos: 2 MiB, 45 s y
  12 s).
- **Cabeceras.** `User-Agent: VLC/3.0.21 LibVLC/3.0.21` por defecto (`IPTV_USER_AGENT`), que muchos proveedores
  exigen. En M3U se respetan `#EXTVLCOPT:http-user-agent=` y `#EXTVLCOPT:http-referrer=` de cada canal.
- **Una URL con `user:pass@`** sigue rechazada (`bad_url`), como hoy.
- **Compresión.** Se descomprime gzip si lo dice `Content-Encoding` **o** si los primeros bytes son `1f 8b` (listas y
  guías `.gz`), con `node:zlib.createGunzip()` y tope de bytes **descomprimidos** contra bombas.

### 3.2 M3U con streams http(s)

Parser nuevo: `modules/iptv/m3u.ts`. `directories/parsers.ts` no se toca, porque sigue siendo solo AceStream. Lee
**línea a línea** sobre el `Readable`, sin cargar la lista entera.

- **Cabecera** `#EXTM3U`: `url-tvg` / `x-tvg-url` (lista separada por comas: se toman las 2 primeras http(s)) y
  `tvg-shift` global.
- **`#EXTINF:-1 …,Título`:** `tvg-id`, `tvg-name`, `tvg-logo` (se ignora), `group-title`, `tvg-shift` por canal y el
  título tras la última coma que no esté entre comillas.
- **`#EXTGRP:`** hace de `group-title` si falta. **`#EXTVLCOPT:`** se lee como en §3.1. `#KODIPROP` y demás se ignoran.
- **URL:** solo `http://` o `https://`.
  - Se descartan `acestream://`, `rtmp`, `udp` y `rtp` (lo AceStream va en «Listas»).
  - Se descarta el VOD: rutas con `/movie/` o `/series/`, o terminadas en `.mp4`, `.mkv`, `.avi`, `.mp3` o `.m4a`.
  - Quedan `.m3u8`, `.ts` y las rutas sin extensión al estilo Xtream (`/u/p/123`).
- **Si no hay canales válidos:** `iptv_empty`. Si no empieza por `#EXTM3U`: `iptv_bad_list`.

### 3.3 Xtream Codes (`player_api.php`)

Cliente: `modules/iptv/xtream.ts`. Todas las llamadas son `GET {server}/player_api.php?username=U&password=P[&action=…]`.

| Llamada | Para qué | Límite |
|---|---|---|
| sin `action` | `user_info` (`auth`, `status`, `exp_date`, `max_connections`, `active_cons`, `allowed_output_formats`) y `server_info` | 256 KiB, 8 s |
| `action=get_live_categories` | nombre de categoría (país y tipo) para cada `category_id` | 2 MiB, 20 s |
| `action=get_live_streams` | catálogo: `stream_id`, `name`, `epg_channel_id`, `category_id` y `stream_type === 'live'` | 48 MiB, 90 s, 20 s de inactividad |
| `action=get_short_epg&stream_id=X&limit=12` | guía de respaldo (§3.6); `title` y `description` en base64 | 256 KiB, 8 s |

- **Tipos.** Los números llegan a menudo como texto (`"1"`): se aceptan los dos con un zod tolerante. `auth: 0` o un
  401/403 dan `iptv_auth_failed`. `status` distinto de `Active` da `iptv_account_expired`.
- **URL de stream:** `{server}/live/{U}/{P}/{stream_id}.{ext}`, con `ext = 'ts'` si está en `allowed_output_formats`
  (o si la lista viene vacía) y si no `m3u8`.
  - Se prefiere `ts`, porque es una sola conexión continua y la más estable a través del relé (§6.1).
- **No se usa `direct_source`,** ni `server_info.url`/`port` para la API: manda el servidor que escribió Isma. Las
  redirecciones del proveedor a sus balanceadores se siguen con normalidad.

### 3.4 Catálogo en memoria

- **Entrada:**
  `{ id, name, base, quality, backup, hevc, country, tvgId, group, ref }`.
  - `ref` es el `stream_id` en Xtream y la URL en M3U. **Nunca sale del módulo.**
  - `base`, `quality`, `backup`, `hevc` y `country` salen de `cleanIptvTitle()` (§4.2).
- **Índice.** Por `normalizeChannelKey(base)` y por palabras, para no pasar `channelMatchScore` sobre 30 000 entradas
  en cada resolución: primero se filtra por palabras compartidas y luego se puntúa.
- **Topes.** 100 000 canales en directo (`iptv_too_large` si pasa, sin guardar nada). La lista M3U pesa 64 MiB como
  mucho comprimida y 160 MiB descomprimida. El tiempo total es de 120 s.
- **Aplicación de un resultado.**
  - Solo se aplica si el proveedor (`id`) no cambió durante la descarga, igual que en directories.
  - Se guarda cifrado en `catalogo.enc` y se carga al arrancar (sin red).
  - Si falla, se conserva el catálogo anterior y `lastSync.ok = false`.
- **Ids retirados.** Los que desaparecen entre dos sincronizaciones pasan a `retiredIds`, 30 días y 5000 como mucho,
  para reconocerlos después (§4.1).

### 3.5 Refresco

- **Cuándo.**
  - Al guardar.
  - Al arrancar si el catálogo tiene más de 6 h.
  - Cada **6 h**.
  - Con «Actualizar ahora».
  - En segundo plano desde una resolución si tiene más de 6 h (como `refreshStaleInBackground`).
  - Con «Rebuscar» si tiene más de 30 min.
  - Cuando un canal responde 404 al abrirlo (con antirrebote de 10 min).
- **Cuenta Xtream** (`user_info`): cada 10 min con la IPTV activa, y en cada resolución si tiene más de 2 min (plazo
  de 5 s, que no bloquea: si tarda, se usa el último dato). No gasta conexión de stream.
- **Cerrojo propio,** FIFO, uno por proveedor. Tras un fallo, espera exponencial de 5 min a 6 h, como en directories.
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

`id = hex(HMAC-SHA256(k_iptvIds, provider.id + '\n' + clave)).slice(0, 40)`.

**`clave`:**
- Xtream: `x:<stream_id>`.
- M3U: `m:<tvg-id>:<normalizeChannelKey(título)>:<n>`, donde `<n>` es el orden entre repetidos con la misma pareja.
  - La URL **no** entra: muchos proveedores rotan tokens en ella y el id tiene que ser estable.

**Propiedades del id:**
- Es estable entre sincronizaciones.
- No se puede invertir y no contiene credenciales.
- Cambia si se quita la IPTV y se vuelve a poner, porque `provider.id` es nuevo.
- Choca con un hash de AceStream con probabilidad 2⁻¹⁶⁰. Aun así, **el servidor siempre pregunta primero**
  `iptv.owns(id)` (catálogo vigente) e `iptv.isRetired(id)` antes de mandar un id al motor.

**Qué pasa con un id conocido fuera de uso:**
- Retirado, o con la IPTV quitada o en pausa: `channelStream` responde `404 iptv_gone` o `409 iptv_disabled` sin tocar
  el motor.
- Un id desconocido que no es IPTV sigue el camino de AceStream de siempre.

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
   números no se tocan**: «DAZN LaLiga 2» es otro canal.
5. **Lo que queda es `base`,** que pasa por `channelMatchScore` y ya normaliza tildes, «M+» → movistar, la flecha,
   etc.

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
   - `sources.applyLearnedRules()` se aplica igual: un «Canal incorrecto» de Isma aparta esa IPTV para ese canal, y un
     «Es el canal correcto» la sube a 98.
4. **Desempates entre IPTV con la misma puntuación:**
   1. no `hevc` antes que `hevc` (la web no reproduce HEVC, D6);
   2. calidad `fhd` > `hd` > `uhd` > `sd` > sin marca;
   3. no `backup` antes que `backup`;
   4. fiabilidad de Wilson (veredictos del reproductor);
   5. orden del catálogo.
5. **Tope:** 3 IPTV por canal pedido y **4 en total** por resolución. Si hay 3 del mismo canal, al menos una tiene que
   ser la mejor `backup`, si existe, para que haya reserva dentro de la IPTV.
6. **Guía (§4.5).** Añade como mucho 3 IPTV confirmadas por la guía, con puntuación 100 y
   `matchedChannel` = el nombre del canal IPTV limpio.

### 4.4 IPTV ↔ canales de las listas de AceStream (canales sueltos)

Es la misma capa, llamada con `scope=channel` (§5.2) y con el título del canal que se abre (por ejemplo «Antena 3»)
como único canal pedido. Umbral 92, los mismos desempates y 3 IPTV como mucho.

**Alcance:** la IPTV **complementa** canales y partidos que ya existen.
- No entra en la biblioteca, ni en «Listas», ni en el buscador, ni en la agenda.
- Un canal que solo está en la IPTV no se ve en ningún sitio.
- Queda aparcado para más adelante (§12, D10), si Isma lo quiere: un grupo discreto «En tu IPTV», con 5 resultados como
  mucho, al final del buscador de Canales, solo con 3 letras o más y cuando AceStream da menos de 3 resultados.

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
   - Un alias seguido de ` B`, `II`, `Femenino`, `Fem`, `Sub-19`, `Juvenil` o `Atlètic` no cuenta: es el filial o el
     equipo femenino.
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
   - Si el texto nombra una competición de `COMPETITION_FAMILIES` (LaLiga Primera, Hypermotion/Segunda, Liga F,
     Champions, Europa League, Conference, Copa del Rey, Supercopa, Premier, Serie A, Bundesliga, Ligue 1, Nations
     League, Mundial, Eurocopa) y es **otra** familia que la del partido, se descarta.
   - Si no nombra ninguna, vale: con los dos equipos basta.
5. **Canal.**
   - La entrada IPTV pasa el filtro de país.
   - Si su nombre lleva `hypermotion`, `smartbank` o `segunda` y el partido no es de Hypermotion
     (`matchIsLaLigaHypermotion`), se descarta. Y al revés: un canal de Primera con un partido de Hypermotion también.
6. **Ambigüedad.**
   - Tras juntar las variantes (misma `base`), si quedan más de 3 canales distintos, solo se quedan los que **también**
     casan (≥ 70) con algún canal emisor de la agenda.
   - Si no queda ninguno, **no se confirma nada**.

**Qué se hace con una entrada confirmada:**
- va **primera**, aunque la agenda no la anuncie o anuncie otro canal;
- lleva `iptv.guide = true` y puntuación 100;
- se calcula por partido y se guarda en caché 10 min.

**Partido sin canales en la agenda.** Hoy la web no llama al servidor. Con este cambio llama a `footballResolve?match=`
(§8.4). Si la guía encuentra el canal, sale la IPTV. Si no, «El canal todavía no está anunciado», como hoy. La agenda no
cambia.

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
primero». Un vínculo guardado que apunta a un id IPTV es IPTV.

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
- **`bitrate`:** lo que mida la sonda (§7.3), en la misma unidad que hoy, o `null`.

**Otros cambios, todos opcionales o de enum,** que las apps toleran (`EnumTolerante` y claves desconocidas ignoradas):
- `ResolveQuerySchema.scope: z.enum(['match', 'channel']).optional()` (§5.2).
- `StreamGrantSchema.source: z.enum(['engine', 'iptv']).optional()` y
  `SessionSummarySchema.source: z.enum(['engine', 'iptv']).optional()`. Sirven para los textos del reproductor y para
  «Dónde se está reproduciendo».
- `ScanCandidate.reason` sigue siendo texto libre. Motivos nuevos:
  `IPTV_REASONS = ['iptv_ready', 'iptv_busy', 'iptv_auth_failed', 'iptv_account_expired', 'iptv_gone', 'iptv_timeout', 'iptv_unreachable', 'iptv_dropped']`
  (en `constants/`).

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
  comprobador (`interactive`, `clientKey` = visor) con las AceStream y la comprobación ligera de las IPTV (§7.3).

### 5.3 Rutas nuevas de ajustes (todas `access: 'web'`)

El iPhone recibe `403 origin_forbidden` sin tocar nada más. La app no las llama: solo se regenera `RutaID`.

| id | método y ruta | cuerpo | respuesta | errores |
|---|---|---|---|---|
| `iptvGet` | `GET /api/v1/iptv` | — | `IptvView` | — |
| `iptvTest` | `POST /api/v1/iptv/test` | `IptvSaveBody` | `IptvTestResult` | `bad_url`, `private_url`, `dns_failed`, `iptv_*` de conexión, `iptv_credentials_required` |
| `iptvSave` | `PUT /api/v1/iptv` | `IptvSaveBody` | `IptvView` (`status: 'syncing'`) | los mismos |
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
  matchedLibrary: z.number().int().nonnegative(),    // canales de la lista activa con IPTV ≥ 92
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

export const IptvTestResultSchema = z.strictObject({
  ok: z.literal(true),
  kind: z.enum(['m3u', 'xtream']),
  channels: z.number().int().nonnegative(),
  guide: z.boolean(),
  account: IptvStatusSchema.shape.account,
});
```

**Pruebas y guardado.**
- `iptvTest` hace la descarga completa (Xtream: `user_info` más `get_live_streams`; M3U: la lista entera) con los
  límites de §3, **sin guardar**.
- `iptvSave` hace una prueba rápida (Xtream: `user_info`; M3U: los primeros 256 KiB con `#EXTM3U` y al menos un stream
  http).
  - Si falla, **no guarda** y devuelve el error.
  - Si va bien, cifra, guarda, responde `syncing` y lanza la sincronización completa en segundo plano.
  - Si hay una prueba correcta del mismo cuerpo de hace menos de 2 min (comparando el sha256 del cuerpo en memoria),
    reutiliza su catálogo y no descarga dos veces.
- **Plazos de la web** (`api/client.ts` → `TIMEOUTS`): `iptvTest: 130_000`, `iptvSave: 30_000`, `iptvSync: 12_000`.
  nginx corta `/api/` a 60 s, así que `iptvTest` necesita el `location` de §6.6 con 150 s, o se devuelve en cuanto
  llega `user_info` y el recuento va por SSE. **Por defecto:** `location = /api/v1/iptv/test` con
  `proxy_read_timeout 150s`.

**Quitar** (`iptvDelete`):
- borra `provider`, `catalogo.enc` y `guia.enc`;
- pasa todos los ids del catálogo a `retiredIds`;
- cierra las sesiones IPTV vivas (§7.4).

**Pausa** (`enabled: false`):
- deja de ofrecer IPTV;
- cierra las sesiones vivas igual que al quitar;
- conserva el catálogo.

### 5.4 Ruta de vídeo para la web

`video` (`GET /api/v1/video/:sid/:file`) pasa de `access: 'native'` a **`access: 'any'`**, con la misma credencial
`video-token` (`?t=` firmado por sesión). La web recibe `url: '/api/v1/video/<sid>/index.m3u8?t=…'`. El iPhone sigue con
`/native/api/v1/video/…`. `serveFile()` ya reescribe cada URI del m3u8 con `?t=`.

### 5.5 Eventos SSE

- **Nuevo `iptv.status`,** `data: IptvStatusSchema`. Se emite al empezar y terminar una sincronización, al cambiar la
  guía o la cuenta, y al activar, pausar o quitar. Va en **`WEB_ONLY_EVENT_TYPES`**: nunca llega a `/native`.
- **Sin ámbito nuevo en `STATE_SCOPES`.** El iPhone no tiene nada que invalidar: las resoluciones se piden cada vez.
- **Los eventos de hoy valen tal cual con ids IPTV:** `scan.verdict`, `scan.progress`, `playback.*`, `stream.ready` y
  `stream.stats`.
  - En `stream.stats` de una IPTV: `status: 'iptv'`, `peers: 0`, `speedUp: 0`, `speedDown` = KB/s que entran por el
    relé y `downloaded` = bytes.
- **`stream.closed` de una IPTV** usa siempre `reason: 'remux_failed'` con `code: 'iptv_…'` (`iptv_dropped`,
  `iptv_disabled`, `iptv_removed`, `iptv_busy`), sin valores de enum nuevos. Una app sin cambios lo trata como un corte
  de fuente (reconecta y la da por agotada), que es justo lo que se quiere.

### 5.6 Códigos de error nuevos (`errors.ts`, `legacyStatus: null`, `public: true`)

| código | HTTP | mensaje |
|---|---|---|
| `iptv_not_configured` | 409 | «Todavía no has conectado ninguna IPTV.» |
| `iptv_disabled` | 409 | «Tu IPTV está en pausa.» |
| `iptv_removed` | 410 | «Has quitado tu IPTV.» |
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

**Ninguno** entra en `SYSTEM_ERRORS` de la web ni en su equivalente de la app. Son errores **de fuente**: agotan la
fuente y permiten el salto (§7).

### 5.7 Fixtures, openapi y documentación

- **`scripts/fixtures.ts`:**
  - `v1/iptvGet.json`, `iptvTest.json`, `iptvSave.json`, `iptvUpdate.json`, `iptvSync.json` e `iptvDelete.json`;
  - `events/iptv.status.json`;
  - **variantes** `v1/footballResolve.iptv.json`, con una IPTV primera confirmada por la guía, otra `backup` y dos
    AceStream, y `v1/channelStream.iptv.json`, con `protocol: 'hls'`, `url` de `/api/v1/video/…` y `source: 'iptv'`.
  - Las variantes se añaden con un sufijo `.<nombre>` que `fixtures.test.ts` valida contra el esquema de la ruta base.
    `v1/footballResolve.json` **no cambia**, porque la demo y los golden de la app lo usan.
- **Otros ficheros generados y de documentación:**
  - `pnpm --filter @ace/shared openapi` regenera `docs/openapi.yaml`;
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
                               web: /api/v1/video/<sid>/…?t=      iPhone: /native/api/v1/video/<sid>/…?t=
                                    hls.js (protocolo 'hls')            AVPlayer ('hls-fmp4')
```

**Relé** (`modules/iptv/relay.ts`).
- Es un `http.createServer` propio del módulo, escuchando **solo en `127.0.0.1`** en un puerto efímero. No es una ruta
  de Fastify, así que no es accesible desde nginx ni desde otro contenedor.
- Cada sesión IPTV tiene un `ticket` aleatorio de 128 bits, que solo vale mientras vive la sesión y que se redacta en
  los registros.

**Origen TS** (Xtream `.ts` o M3U `.ts` / sin extensión): `GET /r/<ticket>/in.ts`.
- El relé abre `net.openStream(urlReal)` y copia el cuerpo tal cual.
- **Reconexión transparente.** Si el origen se corta o no manda bytes en 10 s, el relé reabre, con 8 s como mucho para
  las cabeceras y **3 veces en 60 s** como mucho, **sin cerrar** la conexión con ffmpeg (el TS se resincroniza solo).
- Si se agota, cierra. ffmpeg recibe fin de fichero, el remux sale y la sesión se cierra con `iptv_dropped` (§7.4).

**Origen HLS** (`.m3u8`): `GET /r/<ticket>/index.m3u8`.
- **Lista maestra.** El relé elige **una** variante: la de mayor `BANDWIDTH` con `RESOLUTION` ≤ 1920×1080, o la mayor
  si no hay resolución. La sirve aplanada como lista de medios, para que ffmpeg no abra todas las variantes.
- **Lista de medios.** Se reescribe cada URI de segmento, `#EXT-X-MAP` y `#EXT-X-KEY` a `/r/<ticket>/s/<seq>.<ext>` y
  `/r/<ticket>/k/<n>`. El relé guarda `seq → URL real` (los 40 últimos) y descarga cada segmento por `net` al pedirlo.
- La lista del proveedor se pide como mucho una vez por segundo: las peticiones seguidas de ffmpeg se atienden desde
  caché.
- Un 404 de un segmento que ya salió de la ventana se contesta con 404 y ffmpeg lo salta. Tres fallos seguidos de la
  lista de medios, o 15 s sin lista nueva, cuentan como corte y siguen la misma regla de reconexión que en TS.

**Lo que ve ffmpeg**: solo URLs del relé. Así:
- no hay credenciales en `/proc/<pid>/cmdline`;
- su stderr solo repite URLs de `127.0.0.1` con ticket;
- ffmpeg **no se salta el filtro SSRF**, porque no resuelve ni sigue redirecciones por su cuenta.

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
  - con `-rw_timeout 15s`;
  - con `-protocol_whitelist http,tcp,crypto`;
  - con `-live_start_index -3` si la entrada es HLS;
  - con `-metadata ace_session=<sid>` como hoy (los huérfanos se siguen encontrando);
  - el resto, igual: HLS fMP4 de 2 s en ventana de 15.
- **`waitReady`:** con IPTV, 2 segmentos o **20 s como mucho** (no 45). Pasado eso, `iptv_timeout`.
- La cola del registro pasa por el redactor (§2.4) antes de `logger.warn` y `diagnostics.report`.
- `MAX_REMUX_SESSIONS` sigue en 3, compartido con el remux de AceStream del iPhone. Si se llena con una IPTV, el código
  es `remux_busy`, pero la web lo trata como fallo **de fuente** cuando la fuente es IPTV (§7.2).

### 6.4 Sesión (`playback`)

- **`SessionRec.kind: 'engine' | 'iptv'`**, decidido en `acquireInternal` con `iptv.owns(id)` **antes** de mirar el
  estado del motor.
- **Con `iptv`:**
  - **no** hay `engineLock`, `openSession`, `engine.reportOpenSuccess/Failure()` ni `pollStats` / `stat_url`;
  - **no** se persiste en `sessions.json`: su esquema exige `commandUrl`, y ffmpeg huérfano ya lo mata la marca;
  - `onEngineStatus` no la reabre.
- **Apertura:** `iptv.openInput(id, { signal })` devuelve `{ inputUrl, isHls, stats(), close(), onDropped }`. Luego
  viene `remux.ensure({ …, inputUrl, origin: 'iptv' })`.
- **`consumes`:** es `remux` **también con `client: 'web'`** cuando la sesión es IPTV.
- **Concesión** (`grant.ts`):
  - web: `protocol: 'hls'`, `url: '/api/v1/video/<sid>/index.m3u8?t=…'`;
  - iPhone: `protocol: 'hls-fmp4'` con la URL nativa de hoy;
  - en los dos, `remux: true`, `source: 'iptv'`, `codec` de la sonda (`source: 'ffprobe'`) o `unknown`, y la latencia
    del remux.
- **Estadísticas:** cada 2 s, del relé → `stream.stats` (§5.5).
- **`playback.activity`** lleva `source: 'engine' | 'iptv'`.
  - El vigilante del motor y el buscador **ignoran** la de IPTV: el motor principal está libre, así que no hay umbrales
    agresivos y las búsquedas van al motor principal.
  - El comprobador **sí** mantiene su espaciado de 20 s, porque la red es la misma.
- **Cierre:**
  - el último visor que se va (liberación, latido perdido a los 45 s o traspaso) cierra la sesión IPTV a los **3 s de
    gracia**, para que un zapping rápido no reabra la conexión;
  - cierra el relé (y con él la conexión al proveedor) y mata ffmpeg;
  - no espera a los 90 s del recolector del remux.

### 6.5 Una sola conexión al proveedor, compartida

- **Una sesión por id IPTV,** y todos sus visores comparten el mismo ffmpeg y, por tanto, **una sola conexión al
  proveedor**. Da igual que sea la web y el iPhone a la vez.
- **Se mantiene la regla de hoy: un canal a la vez en casa.**
  - Canales distintos (ids distintos, IPTV o AceStream) → traspaso (`playback.handoff other_channel`).
  - Con «Un solo dispositivo a la vez», el último manda también en el mismo canal (`same_channel`).
  - En la práctica, Ace Player tiene como mucho **1** conexión abierta con el proveedor, y `max_connections = 1` se
    respeta sin más.
- **Cerrar antes de abrir.** Al pasar de IPTV a AceStream, o de un canal IPTV a otro, la cola por visor suelta la
  sesión anterior **antes** de abrir la nueva, como hoy. En IPTV, el relé cierra el socket al momento.
- **Plaza que tarda en liberarse.**
  - Si al abrir el proveedor responde 403, 429, 456, 458 o 509, o Xtream da `active_cons ≥ max_connections`, **y**
    Ace Player cerró una conexión con ese proveedor hace menos de 15 s, se reintenta a los 2 s y a los 4 s.
  - Si no, o si sigue ocupado, `iptv_busy`.
- **Sondas.** Nunca hay una sonda de stream a un proveedor con una sesión IPTV viva, ni en los 15 s siguientes a
  cerrarla, ni con `active_cons ≥ max_connections` (§7.3).

### 6.6 Tiempos de arranque y de corte

| Paso | Objetivo | Tope | Si se pasa |
|---|---|---|---|
| Resolución de un canal (`scope=channel`) | < 300 ms en el servidor | la web espera 2,5 s | la web sigue como hoy, sin IPTV |
| Cabeceras del proveedor (relé) | < 2 s | 8 s | `iptv_timeout` (o reintento si la plaza estaba recién cerrada) |
| Lista lista (2 segmentos de 2 s) | 4–8 s | 20 s | `iptv_timeout` |
| `channelStream` completo | 5–10 s | 60 s (el de hoy) | — |
| Corte: sin bytes | — | 10 s | reconexión del relé |
| Reconexión del relé | < 3 s | 8 s cada una, 3 en 60 s | `stream.closed remux_failed` + `iptv_dropped` |
| Del corte definitivo a pedir AceStream | inmediato | — | la web salta sin sus 3 reconexiones (§7.2) |

**Nginx** (`deploy/umbrel/nginx.conf`):
- `location /api/v1/video/`, con las mismas cabeceras de origen que `/api/`, más `proxy_buffering off`, `gzip off` y
  `proxy_read_timeout 120s`;
- `location = /api/v1/iptv/test` con `proxy_read_timeout 150s`;
- su test (`test:nginx`) se amplía.

**Vite:** `/api` ya está en `PROXIED`.

---

## 7. Prioridad y respaldo

### 7.1 IPTV primero

- **Servidor:** la IPTV encabeza `candidates` y es la `candidate` (§4.6).
- **Web** (`pickAutoSource` en `features/sources/model.ts`), regla nueva al principio:
  - la primera entrada `origin === 'iptv'` que no esté reportada ni tenga `autoTried`, y cuyo estado efectivo **no**
    sea `failed`, se arranca **sin esperar** a que el comprobador la dé por `working`;
  - el reproductor ya la verifica con `origin: 'auto'`: 1 reconexión antes de la primera imagen.
  - Aviso: «Arrancando tu IPTV» (señal, a la línea de estado).
- **El comprobador sigue con AceStream de fondo** exactamente como hoy: una sonda cada vez, 20 s entre sondas con
  alguien viendo y nunca el hash que se ve.

### 7.2 Si uno no va, va el otro (el puente)

Es una regla nueva, la **P16.6**, en `apps/web/src/features/match-center/README.md` y en `handleSourceFailed`
(`features/sources/session.ts`). Vale en automático, **en manual y en canales sueltos con IPTV**. Las reglas 3 y 4 de
P16 siguen para saltar entre dos AceStream.

| Cae… | y hay… | Qué pasa | Aviso |
|---|---|---|---|
| IPTV | una AceStream `working` no probada | se pasa a la mejor (`pickAutoSource` sobre las no IPTV), con `haptic('warning')` | toast con acción: «Tu IPTV no responde: seguimos por AceStream (fuente {N})» · **«Volver a la IPTV»** |
| IPTV con `iptv_busy` | ídem | ídem | «Tu IPTV tiene la conexión ocupada: seguimos por AceStream (fuente {N})» · «Volver a la IPTV» |
| IPTV | ninguna verificada todavía, comprobador en marcha | espera a la primera `working`, como hoy | «Tu IPTV no responde. Sigo comprobando las fuentes de AceStream y arranco la primera que funcione.» · «Volver a la IPTV» |
| IPTV en un canal suelto | ninguna verificada | se prueba el hash que se tocó en la biblioteca (el `initial`) | «Tu IPTV no responde: seguimos por AceStream» · «Volver a la IPTV» |
| AceStream (auto o manual) | una IPTV no fallida y no probada en los últimos 60 s | se pasa a la IPTV | «Esta fuente no responde: pasamos a tu IPTV» (señal) |
| AceStream por `engine_unavailable` | una IPTV | se trata como fuente agotada, no como error de sistema → IPTV | «El motor AceStream no responde: pasamos a tu IPTV» (señal) |
| las dos | nada | `failureText` | «Ni tu IPTV ni las fuentes de AceStream dan señal ahora mismo. Prueba «Rebuscar» en unos minutos.» |
| IPTV en pausa o quitada durante la reproducción | AceStream | como la primera fila | «Tu IPTV está en pausa: seguimos por AceStream (fuente {N})» (sin acción) |

- **Los avisos con acción** van siempre a toast (`notify` con `action`), con `icon: 'tv'`, `tone: 'warn'` y
  `ms: 8000`, para que dé tiempo a tocar.
- **Contra los bucles:** como mucho **2 saltos de puente automáticos cada 3 min** por sesión. Al tercero se para y sale
  el `failureText` de la tabla.
- **`autoTried` de una IPTV** solo se limpia si llega un veredicto `working` del servidor **posterior** al fallo y han
  pasado al menos 60 s.

**En el reproductor** (`player/runtime.ts`):
- **Errores `iptv_*` al abrir:** van a `fail()` como **no reintentables**, así que se agota la fuente al momento: el
  servidor ya reintentó.
- **`stream.closed` con `code` `iptv_*`:** la fuente se agota **al momento**, sin las 3 reconexiones.
- **`remux_busy` y `ffmpeg_missing` con la fuente IPTV:** se tratan como fallo de fuente (salto a AceStream, que en la
  web no necesita remux), no como `failSystem`.
- **`engine_unavailable` con fuente AceStream:** se pregunta a `onSourceFailed` si la sesión tiene una IPTV utilizable.
  Si no, `failSystem` como hoy.

### 7.3 Comprobación ligera de la IPTV

La IPTV tiene su propio **carril** dentro de `ScannerServiceImpl`. En `probe()` se desvía con `iptv.owns(id)` y no
espera detrás de las sondas de 30 s de AceStream.
- Concurrencia 1 por proveedor.
- Sin el espaciado de 20 s: no usa el motor comprobador.

**Nivel 1, la cuenta**, siempre y sin gastar conexión:
- Xtream: `user_info` (caché de 2 min). M3U: el canal está en el catálogo vigente.
- Resultados:
  - cuenta activa y canal presente → `working`, `iptv_ready` («cuenta activa»);
  - `auth` falla → `failed`, `iptv_auth_failed`;
  - caducada → `failed`, `iptv_account_expired`;
  - canal ausente → `failed`, `iptv_gone`;
  - `active_cons ≥ max_connections` sin ser nuestras → `failed`, `iptv_busy` con reintento a los 2 min.

**Nivel 2, la sonda de stream**, solo si **todo** esto se cumple:
- el canal está entre las 2 primeras IPTV de la resolución;
- no hay ninguna sesión IPTV viva con ese proveedor ni se cerró una hace menos de 15 s;
- `active_cons < max_connections`;
- no se sondeó ese canal en los últimos 30 min.

**La sonda:**
- abre por el relé, lee **hasta 6 s o 1,5 MiB** y pasa ffprobe (`transport.inspect`);
- `playable_media` con códec y caudal (`rateKbps`, `videoCodec`, `audioCodecs`, `bitrate`), o `iptv_timeout`,
  `iptv_unreachable`, `iptv_unsupported` o `iptv_gone`;
- **cierra en cuanto termina**.

**`playableOn`:**
- H.264 → `{ web: true, ios: true }`;
- HEVC → `{ web: false, ios: true }`;
- MPEG-2 → `{ web: false, ios: false }`;
- sin sonda, `{ web: true, ios: true }`.

El audio no cuenta, porque se pasa a AAC.

**Mientras se ve una IPTV** no se sondea su proveedor. Su estado lo dan:
- el reproductor (`sources/outcome`: `arranco`, `sigue`, `cayo`), que ya manda 3 min;
- el relé: con bytes entrando se registra `working` por `player` cada 60 s.

**Retrasos de reintento de las IPTV fallidas:** 2 min (no 10), porque la plaza del proveedor se libera sola.

La suavización de hoy vale igual: una `working` que falla una vez por causa ajena al vídeo queda `weak`.

**Mantener caliente el respaldo.** Mientras un visor mira una IPTV, cada 10 min el comprobador revalida las **2 mejores
AceStream `working`** del trabajo de ese visor (`scanner.refreshWorking(jobId, 2)`), con el espaciado de siempre. Emite
`scan.verdict` con ese `jobId`, así que cuando la IPTV caiga, «la mejor verificada» lo será de verdad.
- La web sigue escuchando `scan.verdict` de su trabajo aunque esté `done`, mientras la fuente activa sea IPTV.

### 7.4 Cierres que decide el servidor

- **Pausa, quitar, cuenta caducada** (detectada por `user_info` durante la reproducción) **o relé agotado:** se cierra
  la sesión IPTV con `stream.closed { reason: 'remux_failed', code }` (§5.5) y `sources.outcome` interno `cayo`.
- La web salta por el puente.
- Una app sin cambios reconecta: recibe `iptv_disabled`, `iptv_removed` o `iptv_gone` al pedir el stream, no está en
  sus errores de sistema, agota la fuente y, en automático, pasa a la siguiente.

### 7.5 Volver con un toque

- **Botón del aviso.** «Volver a la IPTV» llama a `selectSource(idIptv)`, que pone `manualChosen: true` (P16.3). Con el
  puente, si la IPTV vuelve a caer, se pasa otra vez a AceStream.
- **Selector de fuentes.** La IPTV **nunca se pliega** en el selector (ni con `failed`, ni mientras comprueba el
  comprobador), así que volver a ella es un toque en su cartel. También valen la tecla de su número y deslizar.
- **No hay vuelta automática a la IPTV,** para no ir y volver sin parar (§12, D7).
- **Aviso de `selectSource` con IPTV:** «Fuente {N} · IPTV · {Casa}», sin trozo de hash.

### 7.6 Encaje con «Un solo dispositivo a la vez»

| Situación | `share` (por defecto) | `handoff` (interruptor activado) |
|---|---|---|
| Web e iPhone, mismo canal IPTV (mismo id) | comparten sesión, ffmpeg y **una** conexión al proveedor | el último manda; el otro recibe `playback.handoff same_channel` |
| Web en IPTV, iPhone abre otro canal (IPTV o AceStream) | traspaso: la web se para (`other_channel`), como hoy | ídem |
| Web en IPTV, iPhone abre el mismo partido | el iPhone arranca la IPTV (misma primera) → comparten | el iPhone manda |
| Web en AceStream del partido, iPhone en la IPTV del mismo partido | ids distintos → traspaso (regla de hoy) | ídem |

El texto del interruptor de hoy sigue siendo verdad y no cambia.

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
  - `backup` añade «reserva».
- **Estado:** el mismo `SignalRing` con los estados de siempre. `REASON_PHRASE` suma:
  - `iptv_ready: 'cuenta activa'`
  - `iptv_busy: 'conexión ocupada'`
  - `iptv_auth_failed: 'la cuenta no entra'`
  - `iptv_account_expired: 'cuenta caducada'`
  - `iptv_gone: 'ya no está en la lista'`
  - `iptv_timeout: 'no respondió a tiempo'`
  - `iptv_unreachable: 'el proveedor no responde'`
  - `iptv_dropped: 'se cortó en el proveedor'`
- **`describeSource`** para IPTV, **sin** `Hash …`: «Fuente {N}: {DAZN LaLiga} · IPTV · {Casa} · {1080p} · {frase} ·
  {Mbit/s}».
- **Menú contextual:** «Ver esta fuente» / «Ya está en pantalla», «Es el canal correcto» y «Reportar…». **Se quitan**
  «Copiar hash» y «Abrir en la app de AceStream».
- **`SourceInspector`** con la IPTV activa:
  - se quedan «Favorito», «Rebuscar», «Pegar hash», «Es el canal correcto» y «Reportar»;
  - **se quitan** «Copiar hash» y «Abrir en…» (con sus tres opciones).
- **Datos técnicos:** «Origen: IPTV · {Casa}». «Pares» pasa a «—» y la fila «Hash» no sale. La velocidad sale de
  `stream.stats.speedDown`.
- **«Dónde se está reproduciendo»:** con `SessionSummary.source === 'iptv'`, la línea del canal suma « · IPTV».
- **`resolutionSourceLabel.iptv`** = «Tu IPTV» y **`checkedLabel.iptv`** = «IPTV».

### 8.2 Orden

El del servidor, sin reordenar, como hoy. El número de fuente es la posición. En los canales sueltos con IPTV:
1. las IPTV;
2. **el hash que se tocó** (el `initial`);
3. el resto de las hermanas en el orden del servidor.
4. Las hermanas locales que el servidor no devolvió se añaden al final.

### 8.3 Estados

- **Poster:** «Verificada» (con `iptv_ready` o `playable_media`), «Comprobando», «Sin comprobar», «Floja», «Sin
  señal», «Reportada». Son los de siempre.
- **La IPTV no se pliega nunca** (`isShownWhileScanning` y el plegado de `SourceList` la dejan siempre visible).
- **Reproductor:**
  - «Conectando con tu IPTV…»
  - «Reconectando con tu IPTV…»
  - `IDLE_MESSAGES` para una IPTV que falla sin alternativa: «Tu IPTV no da señal ahora mismo.»
- **Se decide por** `PlayChannel.source === 'iptv'` antes de la concesión, y por `grant.source` después.
- `wording.test.ts` sigue pasando: «IPTV» y «HLS» están permitidos.

### 8.4 Entradas

- **`enterChannel`** llama primero a
  `api('footballResolve', { query: { channel: title, scope: 'channel', client }, timeoutMs: 2_500 })`.
  - Si trae IPTV: `kind` sigue siendo `'channel'`, pero con `iptvBridge: true`. Hay entradas del servidor y trabajo del
    comprobador (`watchJob`), y se arranca con `tryAutoStart`, IPTV primero.
  - Si no trae IPTV, o da error o se pasa del plazo: **exactamente lo de hoy** (reproduce el hash con sus hermanas).
- **`enterMatch` sin canales:** llama a `footballResolve?match=<id>` con `timeoutMs: 5_000`.
  - Si trae candidatas (IPTV confirmadas por la guía): se sigue como un partido normal.
  - Si no: `phase: 'no_channels'` y «El canal todavía no está anunciado», como hoy.
- **Favoritos y recientes con id IPTV:** entran por `enterChannel` con su título, como cualquier canal. Si el id ya no
  existe, `iptv_gone` agota la fuente y el puente pasa a las hermanas.

### 8.5 Ficheros de la web

| Fichero | Cambio |
|---|---|
| `features/iptv/{IptvSection.tsx, IptvSection.css, model.ts}` (nuevos) | sección de Ajustes (§1), textos, validación y cuerpo sin secretos vacíos |
| `features/settings/SettingsView.tsx`, `app/routes.ts` | entrada `iptv` y su `case` |
| `features/sources/model.ts` | `SourceOrigin 'iptv'`, `TYPE_LABEL`, `REASON_PHRASE`, `pickAutoSource` (IPTV primero), `pickBridgeTarget`, no plegar IPTV, calidad, `describeSource` |
| `features/sources/session.ts` | `enterChannel` y `enterMatch` (§8.4), puente en `handleSourceFailed`, avisos de §7.2, `selectSource` con IPTV, seguir `scan.verdict` con IPTV activa |
| `features/sources/{SourcePoster, SourceList, SourceInspector, useSources}.tsx/ts` | distintivo, `data-origin`, menús y plegado |
| `player/api.ts`, `player/runtime.ts` | `PlayChannel.source: 'iptv'`, textos, errores `iptv_*` y `stream.closed` con código IPTV (§7.2) |
| `features/match-center/README.md` | P16.6 |
| `api/client.ts` | `TIMEOUTS` de §5.3 |
| `api/demo/*`, `features/sources/demo-data.ts` | rutas IPTV en la demo; **demo-4** («DAZN LaLiga», hoy una sola floja) gana una IPTV primera «Casa», 1080p |

No hay dependencias nuevas: hls.js ya está y `chooseEngine('hls')` elige hls.js con MSE y HLS nativo en Safari.

---

## 9. Pruebas

### 9.1 Unitarias

**`packages/shared`:**
- `contracts.test.ts`:
  - `ResolutionCandidate` con `source: 'iptv'` e `iptv`;
  - `IptvSaveBody` rechaza claves de más;
  - `IptvView` no tiene **ningún** campo llamado `url`, `username` ni `password` (test de forma sobre el esquema);
  - `iptv.status` está en `WEB_ONLY_EVENT_TYPES`.
- `fixtures.test.ts`: las variantes nuevas validan.

**`apps/server/src/modules/iptv/*.test.ts`:**

| Fichero | Qué cubre |
|---|---|
| `m3u.test.ts` | cabecera con `url-tvg` y `x-tvg-url` separadas por comas; comas entre comillas; `#EXTVLCOPT`; descarte de VOD, rtmp y acestream; `.gz` por bytes mágicos; tope de canales; lista sin `#EXTM3U` (`iptv_bad_list`) |
| `xtream.test.ts` | números como texto; `auth: 0`; `Expired`; `allowed_output_formats` sin `ts` (usa m3u8); `get_live_streams` gigante (`response_too_large`); `get_short_epg` en base64 |
| `names.test.ts` | «ES: DAZN LaLiga FHD», «\|ES\| M+ LaLiga ᴴᴰ», «DAZN LaLiga (Backup)», «UK: Sky Sports», «DAZN LaLiga 2» (el 2 se queda) |
| `match.test.ts` | umbral 92; «LaLiga TV Hypermotion» no casa con «LaLiga TV»; «DAZN» no casa con «DAZN 1»; filtro de país; desempates FHD > HD > 4K > SD; no HEVC antes que HEVC; reserva al final; tope 3 por canal y 4 en total; «Canal incorrecto» aprendido aparta |
| `xmltv.test.ts` | streaming a trozos de 1 byte; entidades; CDATA; zona horaria y `tvg-shift`; ventana de 48 h; bomba gzip (corta al tope) |
| `guide-match.test.ts` | partido en directo confirmado; «(R)», «Resumen» y «Previa» no cuentan; hora fuera de ventana; filial «Barcelona B»; texto de otra competición; canal Hypermotion con partido de Primera; más de 3 canales ambiguos → nada; abreviaturas solo en `AAA-BBB` |
| `crypto.test.ts` | ida y vuelta AES-GCM; AAD de otro proveedor falla; sin semilla se crea `clave` con 0600 |
| `redact.test.ts` | secretos en crudo y codificados; `/live/u/p/`; query; `user:pass@`; ticket del relé |
| `relay.test.ts` | TS con reconexión transparente (3 en 60 s); maestra aplanada a una variante; reescritura de `#EXT-X-MAP` y `#EXT-X-KEY`; lista en caché 1 s; ticket inválido → 404; solo escucha en 127.0.0.1 |
| `probe.test.ts` | no sondea con sesión viva, ni 15 s después de cerrar, ni con `active_cons ≥ max`; motivos y `playableOn` |
| `service.test.ts` | prueba sin guardar; guardar reutiliza la prueba; `iptv_credentials_required` al cambiar el origen; pausa y quitar cierran sesiones y retiran ids; refresco con espera exponencial |

**Otros módulos del servidor:**
- `football/resolution.test.ts`: IPTV primera; la guía gana a la agenda; la pista de la guía no adelanta a AceStream
  ≥ 92; `scope=channel` sin IPTV → `not_found` sin trabajo; motor caído → sigue la IPTV.
- `playback/*.test.ts`: sesión IPTV sin motor, sin `reportOpen*` y sin `sessions.json`; `consumes: remux` en la web;
  dos visores → una sola apertura; cierre a los 3 s; reintento de plaza recién cerrada; traspaso entre IPTV y AceStream.
- `remux/pure.test.ts`: argumentos con `inputUrl` del relé, sin credenciales y con `protocol_whitelist`.
- `core/logger.test.ts`: el nuevo `redactUrl`.

**`apps/web`:**
- `features/sources/model.test.ts`: IPTV primero sin `working`; puente IPTV → mejor AceStream y AceStream → IPTV; tope
  de 2 saltos en 3 min; IPTV nunca plegada; `describeSource` sin hash.
- `session.test.ts`:
  - `handleSourceFailed` con IPTV en automático, manual y canal;
  - `engine_unavailable` → IPTV;
  - `enterChannel` con y sin IPTV, y con el plazo agotado (comportamiento de hoy);
  - `enterMatch` sin canales y con guía.
- `SourcesPanel.test.tsx`: distintivo «IPTV» y menú sin «Copiar hash».
- `IptvSection.test.tsx` y `iptv/model.test.ts`:
  - formularios, textos literales y modo edición con secretos vacíos no enviados;
  - la contraseña no queda en el DOM tras guardar;
  - no se usa `useApiMutation`.
- `runtime.test.ts`: `iptv_*` agota sin reintentos; `remux_busy` con IPTV es fallo de fuente; textos «tu IPTV».
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
  - «ES: LaLiga TV Hypermotion FHD» (trampa Hypermotion);
  - «ES: M+ Liga de Campeones FHD»;
  - «ES: La 1 HD»;
  - «ES: Antena 3 FHD»;
  - «UK: DAZN 1» (trampa de país);
  - dos entradas VOD `/movie/`.
- `/player_api.php`: auth, `get_live_categories`, `get_live_streams`, `get_short_epg` y `user_info` con
  `max_connections: 1` y `active_cons` **real** (cuenta los streams abiertos).
- `/xmltv.php` y `/guia.xml.gz`. La guía trae, para el partido de la demo (catálogo E2E demo-4, «DAZN LaLiga»):
  - el partido en directo a su hora en «ES: M+ Liga de Campeones FHD». Es otro canal que el de la agenda, para probar
    que la guía gana;
  - una **repetición** «(R)» a la mañana siguiente;
  - un **resumen** «Resumen: …» al acabar;
  - una **previa** 30 min antes.
- `/live/<u>/<p>/<id>.ts` (TS continuo) y `/live/<u>/<p>/<id>.m3u8` (HLS de segmentos TS en ventana).

**Control y modo manual:**
- **Control** `/__iptv/*`:
  - `modo(id, 'ok' | 'down' | '401' | '404' | 'busy' | 'lento' | 'corta-a-los:N')`;
  - `conexiones()` devuelve las abiertas por cuenta;
  - `peticiones()` devuelve las URLs recibidas, para comprobar que nadie más que el relé pide streams.
- **CLI** `tsx test/fake-iptv/cli.ts --port 7300`, para que Isma lo pruebe a mano en el PC con
  `ALLOW_PRIVATE_SYNC_URLS=true`.

**`apps/server/test/integration/iptv.test.ts`**, con el arnés de `harness.ts`, `NetResolver` falso (el host del
proveedor resuelve a una IP pública, con el filtro SSRF real) y el ffmpeg falso de `remux/test-support.ts` ampliado:
el `FAKE_FFMPEG_SCRIPT` **lee de verdad** su `-i`, cuenta bytes y escribe segmentos cuando llegan. Casos:

1. Guardar Xtream → sincroniza → `footballResolve` de demo-4 trae primero la IPTV confirmada por la guía, luego la IPTV
   por nombre y luego AceStream. La repetición, el resumen y la previa no aparecen. «UK: DAZN 1» y el canal Hypermotion
   no aparecen.
2. `channelStream` web de la IPTV → `protocol: 'hls'` y URL `/api/v1/video/…`. `conexiones()` = 1 con dos visores (web
   e iPhone).
3. Cambiar a una AceStream → `conexiones()` = 0 antes de que se abra el motor.
4. Corte del proveedor (`corta-a-los:5`) → el relé reconecta sin cerrar ffmpeg. Con `down` → `stream.closed`
   `remux_failed` + `iptv_dropped`.
5. `busy` justo después de cerrar → reintento → abre. `busy` ajeno → `iptv_busy`.
6. Sondas: con una sesión viva no hay ninguna petición de stream del comprobador (`peticiones()`).
7. **Fugas:** usuario y contraseña ausentes de todas las respuestas, del SSE, de los registros capturados, de
   `diagnostics.jsonl`, del `iptv.json` crudo y de los argumentos del ffmpeg falso.
8. Motor AceStream caído → la IPTV se resuelve y se reproduce.

Con ffmpeg real hay un caso más, `describe.runIf(hayFfmpeg)`: TS H.264 con AC3 → segmentos fMP4 con AAC reales.

### 9.3 E2E con Playwright (`apps/web/e2e/iptv.spec.ts`)

**Pila:**
- `support/backend.ts` sirve el host `iptv.ace-e2e.example`: lo resuelve a `93.184.215.14` y el `NetTransport` lo
  reenvía al proveedor falso de `apps/server/test/fake-iptv`, que lanza `stack.ts`.
- **Necesita ffmpeg real** para el remux. La CI general instala `ffmpeg` en el job E2E
  (`sudo apt-get install -y --no-install-recommends ffmpeg`).
- En local, si falta ffmpeg, se marca `test.skip` con aviso.
- Etiqueta `@video`: corre en chrome-escritorio, como hoy.

**Casos:**

1. **Configurar.**
   - Ajustes → IPTV → Xtream → «Probar conexión» → «Conexión correcta: …» → «Guardar IPTV».
   - La tarjeta enseña «Activa», «Xtream · N canales».
   - La contraseña **no** aparece en el DOM ni en ninguna respuesta (`page.on('response')` sobre `/api/`).
   - «Cambiar datos» con la contraseña vacía guarda sin pedirla. Cambiar el servidor la exige.
2. **Reproducir IPTV.**
   - Se abre demo-4. El primer cartel es `data-origin="iptv"`, con el distintivo «IPTV» y «reproduciendo ahora».
   - `estadoReproductor` dice que el motor es hls.js (`window.__acePlayer.get()`).
   - El vídeo avanza (`esperarQueAvance`).
3. **Caída → AceStream con aviso.**
   - `/__iptv/modo(id,'down')` → toast «Tu IPTV no responde: seguimos por AceStream (fuente N)».
   - Pasa a reproducir un cartel AceStream verificado.
   - El cartel IPTV sigue visible (no plegado).
4. **Volver.**
   - `/__iptv/modo(id,'ok')` → toque en «Volver a la IPTV» → el cartel IPTV vuelve a estar «reproduciendo ahora».
5. **Al revés:** con la IPTV elegida a mano y luego AceStream elegida a mano,
   `motor.modo(hash,'failedContent')` → pasa sola a la IPTV con «Esta fuente no responde: pasamos a tu IPTV».
6. **Canal suelto:** Canales → «Antena 3» → primero la IPTV. Cae → pasa al hash tocado.
7. **Pausa:** el switch «Usar la IPTV» apagado → demo-4 sin IPTV, como hoy.

---

## 10. Impacto en la app nativa (`rediseno/nativa`)

**Sin cambiar nada, incluida la 0.8.0 publicada:**
- La app reproduce la IPTV primero, porque la IPTV llega `working` y en cabeza.
- Salta a AceStream si cae, en automático.
- Se puede elegir a mano, y los favoritos funcionan.

**Lo que falla sin cambios:**
- la IPTV sale sin distintivo («Fuente»);
- se ofrecen «Copiar hash» y «Abrir en la app de AceStream»;
- el reproductor dice «Conectando con AceStream…»;
- tras caer, la IPTV se pliega.

Cambios mínimos, cuando existan las pantallas:

| Módulo | Fichero o carpeta | Cambio |
|---|---|---|
| M1 | `Sources/Core/Models/Futbol.swift` | `case iptv` en `CandidateSource`; `CandidateIptvInfo? iptv` opcional en `ResolutionCandidate` (`provider`, `quality`, `backup`, `guide`); `scope` en la consulta de `footballResolve` |
| M1 | `Sources/Core/Models/Reproduccion.swift` | `source: FuenteSesion?` (`engine`, `iptv`, tolerante) en `StreamGrant` y `SessionSummary` |
| M1 | `Sources/Core/Networking/` (`RutaID.generado.swift`, `ErrorCatalog.swift`, `PlazosWeb.generado.swift`) | regenerar con `--check`: 6 rutas `web`, `video` pasa a `any` y 16 códigos `iptv_*`. **No hay rutas nuevas en `Rutas.swift`** |
| M3 | `Sources/Core/Reglas/Fuentes/ReglasFuentes.swift` | lo mismo que `model.ts`: etiqueta «IPTV», `REASON_PHRASE` `iptv_*`, `pickAutoSource` IPTV primero, `pickBridgeTarget`, IPTV nunca plegada, calidad de `iptv.quality`; vectores regenerados desde `scripts/vectores/fuentes.ts` |
| M3 | `Sources/Core/Reglas/Fuentes/OpcionesFuente.swift` | sin «Copiar hash» ni «Abrir en la app de AceStream» para IPTV |
| M3 | `Sources/Core/Reglas/Reproduccion/{TextosReproductor, EstadoVisible}.swift` | «Conectando con tu IPTV…», «Reconectando con tu IPTV…», «Tu IPTV no da señal ahora mismo.» y los avisos de §7.2 (regenerados en `textos-web.json`) |
| M3 | `Sources/Player/Fuentes/SesionFuentes.swift` | puente P16.6 (tabla de §7.2) con toast «Volver a la IPTV» → `elegir(idIptv)`; `entrarCanal` con `scope=channel` (2,5 s); `entrarPartido` sin canales → resolver; seguir `scan.verdict` con IPTV activa |
| M3 | `Sources/Player/Reproductor.swift` | `iptv_*` y `stream.closed` con código IPTV agotan la fuente sin reintentos; `remux_busy` con IPTV y `engine_unavailable` con IPTV disponible son fallo de fuente |
| M6 | `Sources/Pantallas/Partido/` | cápsula «IPTV» en el cartel (`Capsula` neutra con icono `tv`); Datos técnicos: «Origen: IPTV · {Casa}», «Pares» «—» y sin fila «Hash» |
| M2 | `Sources/Debug/ServidorDemo`, golden | regenerar demo-4 (gana una fuente IPTV) |
| M7 | Ajustes | **nada**: la IPTV no se configura en el iPhone |

---

## 11. Reparto para implementar en paralelo

### 11.1 «contrato» (va primero; objetivo: medio día)

**Carpetas:**
- `packages/shared/src/**`: `api/common.ts`, `api/v1/iptv.ts` (nuevo), `api/v1/football.ts`, `api/v1/playback.ts`,
  `routes.ts`, `events.ts`, `errors.ts`, `state/v2.ts` y `constants/` (`IPTV_REASONS`, `IPTV_MIN_SCORE`,
  `IPTV_USER_AGENT`, límites de §3);
- `packages/shared/scripts/fixtures.ts` y `packages/shared/fixtures/**`;
- `packages/shared/test/**`;
- `docs/openapi.yaml` (regenerado), `docs/api.md` y `docs/contratos.md`.

**Entrega:**
- todo lo de §5;
- fixtures y variantes;
- `corepack pnpm@10.18.2 -r typecheck` y `corepack pnpm@10.18.2 --filter @ace/shared test` en verde.
- **Nada** de lógica: ni emparejado ni textos de la web.

**Nadie más toca `packages/shared`.** Si el servidor o la web necesitan un cambio, se lo piden al contrato, que lo
hace en un commit pequeño aparte.

### 11.2 «servidor» (en cuanto el contrato esté subido)

**Carpetas:**
- `apps/server/src/modules/iptv/**` (nuevo);
- en `apps/server/src/`:
  - `modules/{net, football, sources, scanner, playback, remux, events, state, diagnostics}/**`;
  - `config/keys.ts`, `core/logger.ts` y `services.ts`. `iptv` se crea **justo después de `net`**, porque depende de
    state, net y bus. scanner (carril IPTV), remux (redactor), playback y football lo reciben. Los informes a
    diagnostics van por el bus, porque diagnostics se crea después;
- `apps/server/test/fake-iptv/**` (nuevo) y `apps/server/test/integration/iptv.test.ts`;
- `deploy/umbrel/nginx.conf` y su test.

**Qué simula de la web:** nada, porque las pruebas son HTTP. Usa `app.inject` con cabecera de origen web y native para
comprobar el 403 de `/native`, y los fixtures del contrato para las formas.

**Orden recomendado:**
1. `crypto` y `redact`, más `net.openStream`, `logger` y `keys`;
2. `store` y rutas de ajustes;
3. M3U, Xtream y catálogo;
4. `names` y `match` en la resolución;
5. relé, remux y playback;
6. comprobador;
7. guía;
8. integración.

**Entrega para la web:** el proveedor falso con CLI y su control `/__iptv/*`, que el E2E importa.

### 11.3 «web» (en paralelo con el servidor, en cuanto el contrato esté subido)

**Carpetas:**
- `apps/web/src/features/{iptv, settings, sources, match-center}/**`;
- `apps/web/src/player/{api, runtime}.ts`;
- `apps/web/src/api/{client.ts, demo/**, demo-registry.ts}`;
- `apps/web/e2e/iptv.spec.ts` y `apps/web/e2e/support/{backend, catalogo, stack}.ts`;
- el paso de ffmpeg del job E2E en `.github/workflows/ci.yml`.

**Qué simula del servidor mientras tanto:**
- la demo (`registerDemoHandlers` para las rutas IPTV y la IPTV de demo-4 en `demo-data.ts`);
- los fixtures `footballResolve.iptv.json` y `channelStream.iptv.json` en los tests unitarios con `api` simulada;
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
- Pasar a los dueños de M1/M3/M6 la lista de §10.

---

## 12. Riesgos y decisiones tomadas por defecto

### 12.1 Decisiones por defecto (Isma puede cambiarlas)

| # | Decisión | Por qué |
|---|---|---|
| D1 | **Un solo proveedor IPTV** | Isma habla de «la IPTV». El contrato (`provider` nullable) se puede ampliar a una lista más adelante |
| D2 | **Id sintético de 40 hex** (HMAC) en vez de un tipo de id nuevo | cero cambios de formato en contratos, SSE, favoritos, comprobador y app; la 0.8.0 funciona |
| D3 | **Siempre remux por ffmpeg, con relé local** | credenciales fuera de ffmpeg, audio AC3 → AAC, una conexión y un formato |
| D4 | **Web con hls.js** (protocolo `hls` sobre el remux fMP4) | Isma no quiere mpegts.js para esto; `hls-fmp4` podría elegir el HLS nativo del navegador de escritorio |
| D5 | **Un canal a la vez en casa, también con IPTV** | es la regla de hoy; respeta `max_connections = 1` sin más lógica |
| D6 | **El puente IPTV ↔ AceStream vale también en manual y en canales sueltos** | «si uno no va, va el otro»; los saltos entre dos AceStream siguen como hoy (P16.3 y P16.4) |
| D7 | **Volver a la IPTV solo con un toque**, nunca solo | evita ir y volver sin parar; el aviso lleva el botón |
| D8 | **Umbral 92 para la IPTV** (70 para las listas) | catálogos de miles de canales: mejor no emparejar que emparejar mal |
| D9 | **Filtro de país: ES o sin país** | «IT: DAZN 1» no es «DAZN 1»; si hace falta, se abre como ajuste |
| D10 | **La IPTV no entra en biblioteca, buscador ni agenda** | alcance pedido; el buscador discreto queda aparcado (§4.4) |
| D11 | **Cambiar servidor o tipo exige reescribir credenciales** | nadie puede mandar la contraseña guardada a otro host |
| D12 | **Lista cada 6 h, guía cada 8 h, cuenta cada 10 min** | «unas pocas veces al día»; los tres se retrasan si se está viendo |
| D13 | **`iptv.status` solo para la web; sin ámbito nuevo en `state.changed`** | el iPhone no tiene nada que invalidar y así no hay enums nuevos |
| D14 | **Canales sueltos: `footballResolve` con `scope=channel`** (sin buscador ni IA) | da comprobador y puente sin inventar otra ruta; sin IPTV todo sigue igual |
| D15 | **Partido sin canales: se pregunta al servidor** por si la guía lo encuentra | nada visible nuevo en la agenda |
| D16 | **Ninguna dependencia nueva** (XMLTV con tokenizador propio y `node:zlib`) | la regla del repo: solo si es imprescindible |
| D17 | **User-Agent de VLC por defecto**, más `#EXTVLCOPT` por canal; sin campo en Ajustes | lo que exigen la mayoría de proveedores; se añade un campo si algún proveedor falla |
| D18 | **AES-256-GCM con clave HKDF `ace-iptv-v1`**, y fichero `clave` si no hay semilla | se aprovecha el esquema de claves que ya existe; las copias de Umbrel quedan cifradas |
| D19 | **La ruta `video` pasa a `any`** | ya firma por sesión; evita una ruta paralela |
| D20 | **demo-4 gana una IPTV** | la demo enseña la función; hay que regenerar el golden de la app para demo-4 |
| D21 | **HEVC no se transcodifica**: fuera de la web, válido en el iPhone | la CPU del N300; es la misma regla D6 que AceStream |

### 12.2 Riesgos

1. **Conexiones del proveedor.** Con `max_connections = 1` y la misma cuenta abierta en la tele, Ace Player recibirá
   `iptv_busy` y saltará a AceStream, que es lo correcto.
   - Ajustes lo avisa con «Tu cuenta tiene todas sus conexiones en uso fuera de Ace Player.».
   - Algunos proveedores tardan más de 6 s en liberar la plaza. Si se ve en la práctica, se sube el reintento.
2. **Proveedores quisquillosos.** Hay proveedores que bloquean por User-Agent, que exigen `Referer` o que redirigen a
   hosts que resuelven a IPs privadas (bloqueadas por SSRF salvo `ALLOW_PRIVATE_SYNC_URLS`).
   - El error sale como `iptv_unreachable` o `private_url`, con el host en diagnósticos.
3. **Formatos de vídeo.**
   - 1080i entrelazado: se ve, pero peinado en algunos navegadores.
   - MPEG-2 SD: no se reproduce.
   - HEVC: solo en el iPhone.
   - Se verá en la sonda y en «Datos técnicos».
4. **Guía mal fechada.** Guías sin zona horaria o desplazadas pueden romper la ventana de ±30 min. En ese caso **no se
   empareja** (es lo seguro), y queda el emparejado por nombre.
5. **Emparejado por guía equivocado.** Queda mitigado por las 6 condiciones de §4.5 y sus tests. Si ocurre, «Reportar →
   Canal incorrecto» aprende a apartar esa IPTV para ese canal.
6. **Memoria y CPU en el N300.**
   - Catálogos de 100 000 canales ocupan unos 20–30 MB en memoria.
   - `JSON.parse` de 48 MiB tiene un pico de unos 200 MB durante segundos, 4 veces al día como mucho.
   - El audio AAC de ffmpeg gasta poco.
   - `MAX_REMUX_SESSIONS = 3` es compartido.
7. **Ids sintéticos en caminos antiguos.** Un id IPTV que llegue al motor (app 0.8.0 con «Abrir en la app de AceStream»,
   `/remux/<hash>` antiguo o buscador) solo da «no encontrado». No rompe nada, pero ensucia diagnósticos del motor. Por
   eso el servidor comprueba `owns` / `isRetired` antes.
8. **Cambio del secreto de la app o restaurar en otro Umbrel:** se pierden las credenciales
   (`iptv_secret_unreadable`) y hay que escribirlas otra vez.
9. **nginx y plazos.** `iptvTest` con listas enormes necesita la `location` de 150 s. Si no, se corta a 60 s.
   `/api/v1/video/` necesita `proxy_buffering off`, o los segmentos llegarán a golpes.
10. **Contratos y generados de la app.** Los cambios son aditivos (enum tolerante y claves opcionales), pero la CI de
    iOS fallará en `--check` hasta regenerar `RutaID`, `ErrorCatalog`, `PlazosWeb` y `textos-web.json`. Es mecánico,
    pero hay que coordinarlo con `rediseno/nativa`.
11. **Tiempo para la 0.8.1.** Si no da tiempo a todo, el orden de recorte es:
    1. primero cae la guía;
    2. luego la sonda de stream (queda la ligera de cuenta);
    3. luego «mantener caliente».
    - Lo que **no** se recorta: el cifrado, la redacción, el relé y el puente.
