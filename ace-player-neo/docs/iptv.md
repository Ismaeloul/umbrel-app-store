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

**Probado con una lista pública real (26-sep-2026)**, solo en la pila local y eliminada al acabar: 7 arreglos (guía en
la segunda cabecera, audio muxeado de las maestras, ffmpeg y el relé esperándose con segmentos grandes, «GEO», URLs con
macros, canales de la agenda y el ensayo). Arranque medido: primera imagen en ~4 s desde el toque. Cómo repetirlo con
otra lista: §15.

**D10 resuelto (26-sep-2026) e implementado el mismo día en `rediseno/iptv`:** la IPTV entra en el buscador junto con AceStream. El anexo
§14 lo diseña y **manda** sobre lo que digan de favoritos, recientes y buscador §4.4, §4.6, §8.1 y §8.4.

**Todo desbloqueado y variantes de resolución (Isma, 26-sep-2026; implementado el mismo día en `rediseno/iptv`):**
«mejor déjalo todo desbloqueado» y «en las IPTV hay muchos canales que se llaman igual pero tienen una resolución
diferente». El buscador enseña todos los canales de la IPTV (cualquier país y los grupos para adultos); el país pasa a
ser una **preferencia de orden** en el emparejado automático; las variantes de un canal («DAZN 1 FHD», «DAZN 1 HD»,
«ES: DAZN 1 1080p», «DAZN 1 (backup)»…) son **una fila** en el buscador, con sus calidades, y **un cartel por
resolución** en el panel de fuentes (4 como mucho), que arranca por la 1080p y pasa a la siguiente variante IPTV antes
de saltar a AceStream. El anexo §16 lo diseña y **manda** sobre §0.3, §3.4, §4.2 a §4.4, §6.1, §8.1, §14.2, §14.3,
§14.7 y D9, D23 y D25.

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
   IPTV. La IPTV va **primera**, con **un cartel por variante de resolución (1080p, 4K, 720p, SD) y 4 como mucho**
   (§16; antes, «un cartel por canal y 2 como mucho»). La guía (XMLTV), que se usa solo por dentro, puede poner primero
   el canal que de verdad emite el partido.
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
- **Variantes.** Las entradas con la misma `base` (FHD, HD, reserva) forman un **grupo**. **Cambia con §16:** dentro
  del grupo, España y sin país son un canal y cada otro país es otro (`buckets`); de cada canal sale un cartel por
  resolución (4 como mucho) y las copias de una resolución que ya tiene cartel quedan dentro como respaldo del relé.
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

**País: preferencia, no filtro (cambia con §16, Isma 26-sep: «déjalo todo desbloqueado»).** Antes solo entraban en
el emparejado las entradas ES o sin país. Ahora entran todas: España y sin país son un canal y cada otro país es otro
del mismo nombre; con la misma puntuación, el de España o sin país va antes. Así «DAZN 1» de España va antes que «DE:
DAZN 1», pero si solo existe el extranjero y casa por nombre, sale. El umbral 92 y Hypermotion no cambian. La guía sigue
exigiendo España (§4.5, regla 5): es lo que pone un canal primero sin que la agenda lo anuncie.

**Lista real (§18).** Con la lista de Isma del 26-sep la limpieza suma: cabeceras y «NO MATCH» fuera del catálogo,
«ES TI - », «ES-» pegado, la «Ñ» final, el país de `CONTINENTE | PAÍS | TEMA`, ᴿᴬᵂ como reserva, notas entre
corchetes, «(BK-1)» como reserva y la grafía única `channelSpelling` (@ace/shared: «M.», «M+», «MOVISTAR PLUS+» →
Movistar; «LA SEXTA» = «LASEXTA»; «LALIGA+» → «LaLiga Plus»…). Detalle en §18.2.

**Variantes (§16).** Además de lo de arriba, la limpieza reconoce `1080p50`/`720p60`, `HD+`, `H264`/`AVC`, `HDR`,
`VIP`, la reserva con número pegado (`bk2`), la copia del final entre paréntesis (`(1)`, `(2)`: de la 2 en adelante,
reserva), España al final entre corchetes o barras (`[ES]`, `|ES|`) y lo que va delante del país sin serlo (`VIP |
ES: …`, `FHD | ES: …`). Un «Canal Sur (2)» sin ningún «Canal Sur» al lado es «Canal Sur 2», no una copia.

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
   - **Cambian con §16 (Isma, 26-sep):** los puntos 4 y 5. Sale **un cartel IPTV por variante de resolución**, en el
     orden 1080p, 4K, 720p, SD y detrás las reservas y las URLs con macros (HEVC solo si el canal no tiene otra cosa),
     **4 carteles como mucho** entre todos los canales (los 2 primeros canales de verdad tienen uno asegurado). Las
     copias de una resolución que ya tiene cartel quedan dentro, de respaldo del relé.
6. **Guía (§4.5).** Una IPTV confirmada por la guía ocupa una de esas 2 plazas, con puntuación 100 y `matchedChannel` =
   el nombre del canal IPTV limpio. Si la guía y el nombre dan el mismo canal (misma `base`), sale una vez, con
   `guide: true`.

### 4.4 IPTV ↔ canales de las listas de AceStream (canales sueltos)

Es la misma capa, llamada con `scope=channel` (§5.2) y con el título del canal que se abre (por ejemplo «Antena 3»)
como único canal pedido. Umbral 92, los mismos desempates, un cartel por canal y 2 IPTV como mucho (**cambia con
§16**: un cartel por variante de resolución, 4 como mucho).

**Alcance (D10, resuelto por Isma el 26-sep; diseño en §14):** la IPTV complementa los canales y partidos que ya
existen **y además entra en el buscador**.
- En **Buscar** y en el **filtro de Canales** salen a la vez los canales de tu IPTV y los de AceStream. Un canal que
  solo está en la IPTV (Antena 3, si tus listas no la traen) también sale.
- Si el mismo canal está en los dos sitios, sale **una vez**, con el distintivo «IPTV». Al tocarlo se reproduce como un
  partido: IPTV primero, sus fuentes de AceStream comprobándose de fondo y el puente de §7.2.
- Si solo está en la IPTV, se reproduce por la IPTV y el servidor busca además, de fondo, ese canal en AceStream con
  este mismo emparejado (umbral 92 y protección Hypermotion) para tener respaldo (§14.4).
- Un canal de la IPTV se puede guardar en **Favoritos** y entra en **Recientes**, con su id de §4.1 (§14.6).
- Todo es automático: no hay que elegir «IPTV» o «AceStream» en ningún sitio.
- Sigue **sin** entrar en la agenda ni en «Listas», y nunca se listan canales IPTV sin buscar (2 letras o más, §14.7).
- Queda anulada la condición aparcada del primer diseño («5 como mucho», «solo con 3 letras», «solo si AceStream da
  menos de 3 resultados»).

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
- **Cambia con §14.6:** un canal IPTV del **buscador** sí se guarda en Favoritos y el canal **tocado** entra en
  Recientes, con su id IPTV. El cartel de fuente IPTV del reproductor sigue sin «Favorito» y las fuentes que suenan
  por el puente siguen sin apuntarse. Un id IPTV guardado que ya no es del catálogo se sigue descartando aquí; el
  re-emparejado por nombre lo hace la sincronización (§14.6).

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
  **Cambia con §16:** el relé solo prueba detrás de un cartel las variantes **sin cartel propio** que le tocan (las
  copias de su misma resolución; las que no tienen cartel de su resolución, detrás del último), 2 como mucho. Las
  variantes con cartel las prueba la web, una tras otra, antes de saltar a AceStream: así se ve en cuál estás.
  Además, al aplanar una maestra el relé avisa al servicio de la `RESOLUTION` elegida: es la calidad real de esa
  variante.
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
- **Dentro de la tesela**, bajo el distintivo y donde los demás carteles llevan su proveedor (Isma, 26-sep):
  `presentation.short` = `iptv.provider` («Casa»), con `ChannelMark label`.
- **Debajo:**
  - solo el nombre del canal, sin el proveedor (`channelNameWithoutProvider(channelNameOf(entry), …)`);
  - `TYPE_LABEL.iptv = 'IPTV'`, así que `presentation.label` = «IPTV · Casa»;
  - la calidad sale de `iptv.quality` si no hay `bitrate`/códec: `fhd` → «1080p», `hd` → «720p», `uhd` → «4K»,
    `sd` → «SD»;
  - `backup` añade «reserva» (solo si la mejor variante es una reserva: las demás no salen, §4.3).
  - **Cambia con §16:** hay un cartel por variante de resolución, cada uno con su etiqueta de calidad (la del stream
    real si el servidor la conoce), «reserva» en el de la reserva y el país delante si no es España («DE»).
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
- **Reproducir una IPTV** siempre con `record: false`: no entra en Recientes. (Con §14.6 lo que entra en Recientes es
  el canal **tocado**, una vez por sesión de canal, sea un hash de AceStream o un canal IPTV del buscador.)
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
`iptv_removed`, que agotan la fuente y el puente pasa a las hermanas. **Cambia con §14:** el buscador guarda canales
IPTV en Favoritos y Recientes, y tocar un id IPTV nunca llega a `channelStream` sin pasar antes por la resolución
(§14.5).

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

El buscador con IPTV (D10) suma lo de §14.10 a esta sección, las variantes de resolución y el «todo desbloqueado»,
lo de §16.9, y la normalización con la lista real, la etiqueta «AceStream» y el dorsal sin resolución, lo de §18.8.

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
| D9 | **Resuelto por Isma (26-sep): país como preferencia, no como filtro** (§16). Entran todos los países; España y sin país son un canal y cada otro país es otro del mismo nombre; con la misma puntuación, España o sin país va antes. **La guía sigue exigiendo ES explícito** (o sin país que case con la agenda), y la guía solo guarda programas de canales ES o sin país (por dentro, no se ve) | «mejor déjalo todo desbloqueado»; «DAZN 1» de España antes que «DE: DAZN 1», pero si solo existe el extranjero y casa por nombre, sale |
| D10 | **Resuelto por Isma (26-sep): la IPTV entra en el buscador** (Buscar y el filtro de Canales), junto con AceStream; un canal solo de la IPTV también sale y se guarda en Favoritos. Sigue fuera de la agenda y de «Listas» (§4.4, §14) | «quiero que en el buscador salgan los dos»: su ejemplo es Antena 3, que puede no estar en sus listas de AceStream |
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
| D23 | **Cambiada por Isma (26-sep): un cartel IPTV por variante de resolución, 4 como mucho** (1080p, 4K, 720p, SD y detrás las reservas y las URLs con macros); las copias de una resolución que ya tiene cartel, dentro del servidor como respaldo del relé (§16). Antes: un cartel por canal y 2 como mucho | «para saber cuál va a 1080 y cuál a 720» |
| D24 | **Sin sonda de stream en resoluciones interactivas**; solo de fondo, en Xtream y con `active_cons == 0` | la reproducción es la prueba y no se molesta a la tele de Isma |
| D25 | **Resuelto por Isma (26-sep): el buscador enseña todo** (§16): canales de cualquier país (con su país en una etiqueta) y también los grupos para adultos. Una fila por canal: las variantes de resolución van juntas, con sus calidades; el mismo nombre en otro país es otra fila | «mejor déjalo todo desbloqueado» |
| D26 | **Un canal, una fila**: si está en tu biblioteca, manda su fila (con «IPTV»); si no, la fila IPTV; los resultados del motor que son ese canal se esconden (§14.3) | «sale una vez y lleva el distintivo IPTV»; tus favoritos no desaparecen del buscador |
| D27 | **`iptvChannels` nace con `access: 'web'`** y pasa a `any` cuando la app calque el buscador (§14.10) | no rompe `FixturesTests` de la app antes de tiempo; el contenido no tiene nada secreto |
| D28 | **Re-emparejado de favoritos y recientes IPTV al sincronizar**; un favorito que no casa se quita a las 24 h, un reciente al momento (§14.6) | «se vuelve a emparejar por nombre o se descarta sin errores feos», sin perder un favorito por una sincronización rara |

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

- **P16 · Canales que solo están en la IPTV (D10). Resuelto el 26-sep.** Isma: «quiero que en el buscador salgan los
  dos, o sea que sea automático cuando seleccione un partido pero si quiero buscar otro canal que sea automático». Se
  descarta el grupo discreto aparcado (5 como mucho, solo si AceStream daba menos de 3): la IPTV y AceStream salen
  juntas en Buscar y en el filtro de Canales, un canal por fila, y un canal solo de la IPTV se reproduce, se guarda en
  Favoritos y tiene respaldo de AceStream buscado de fondo. Diseño en §14, **implementado** (26-sep).

### 13.4 Descartado

- **Que el backend rechace peticiones sin `X-Ace-Origin` que no vengan de nginx** (parte opcional de S7). Afecta a
  todas las rutas y al arnés de pruebas, y con el filtro IPTV (loopback siempre bloqueado) ya no hay forma de que una
  URL del proveedor llegue a `127.0.0.1:3000`. Se apunta para una revisión general de `net`.
- **Relleno TS (paquetes nulos) mientras el relé reconecta** (alternativa de S3). Con `-rw_timeout` a 45 s no hace
  falta, y el relleno complica el empalme con el reinicio por salto de PTS.
- **Conjunto compacto o Bloom de ids retirados en un fichero aparte** (alternativa de S5). La etiqueta en el id lo
  resuelve sin estado.
- **`scanCancel`** (parte de S16): ver §13.2.

---

## 14. Anexo: Buscador: IPTV y AceStream juntos (D10 resuelto)

Lo pidió Isma el 26-sep, al responder a D10: «quiero que en el buscador salgan los dos, o sea que sea automático cuando
seleccione un partido pero si quiero buscar otro canal que sea automático, ¿sabes?». **Implementado (26-sep-2026)**
en `rediseno/iptv`: contrato, servidor y web, con unitarias, integración (casos 11 a 14) y E2E
(`apps/web/e2e/iptv-buscador.spec.ts`, casos 8 a 13). Lo que se desvía del texto:

- La búsqueda en el catálogo usa un índice propio con **todas** las palabras de cada clave (también «la» o «1», que
  la preselección de §3.4 no guarda) y, con 3 letras o más, una palabra también casa dentro de otra («liga» en
  «laliga»): así «liga m+» encuentra «M+ LaLiga TV» y «la 1» encuentra «La 1».
- `sameChannel` puntúa además el otro nombre limpio como un nombre IPTV (si no dice otro país): «DAZN LA LIGA 1080»
  es «DAZN LaLiga». La regla del « 1» final vale en los dos sentidos.
- Renombrar un favorito guardado desde el buscador (categoría «IPTV») guarda el nombre de antes como `alias` si no lo
  tenía: al guardarlo, un alias igual al título no se guarda (`normalizeItem`), y el re-emparejado lo necesita.
- El filtro de Canales enseña «Ver todo en Buscar» también si el servidor tiene más canales que los 50 devueltos.
- La demo anota con `iptv` todos los resultados del motor que son un canal de la «IPTV de ejemplo», no solo «DAZN
  LaLiga», para que se vea que un canal sale una vez.
- Si todo lo que da el motor ya sale arriba (biblioteca o «En tu IPTV»), la sección del motor no se pinta.
- Un id IPTV que no está en tu IPTV y sí en AceStream, sin comprobador, arranca la mejor AceStream como un partido
  sin comprobador.
Este anexo manda sobre lo que digan §4.4, §4.6, §8.1 y §8.4 de favoritos, recientes y buscador.

### 14.1 En pocas palabras

1. **Buscar** (y el **filtro de Canales**) enseñan a la vez tu IPTV y AceStream. Un canal que solo está en la IPTV
   también sale. No hay pestañas ni filtros «IPTV / AceStream»: todo es automático.
2. **Un canal, una fila** (D26). Si el canal está en tu biblioteca, sale su fila de siempre con el distintivo «IPTV»;
   si no, sale la fila IPTV. Los resultados del motor que son ese mismo canal se esconden.
3. **Tocar un canal IPTV es como tocar un partido:** IPTV primero, las fuentes de AceStream de ese canal comprobándose
   de fondo, el puente de §7.2 si una cae y «Volver a la IPTV» con un toque.
4. **Un canal solo de la IPTV** se reproduce por la IPTV y el servidor lo busca además, de fondo, en AceStream (listas
   y motor) con el mismo emparejado de §4.3: umbral 92 y protección Hypermotion. Si aparece, es su respaldo.
5. **Favoritos y Recientes** guardan canales IPTV con su id de §4.1. Si cambia el proveedor, la sincronización los
   vuelve a emparejar por nombre; si no casan, se quitan sin errores (D28).
6. **Sin inundar:** nunca se listan canales IPTV sin buscar (2 letras o más), 5 filas IPTV a la vista con «Ver más» y
   50 como mucho por búsqueda.
7. Sigue en pie: la IPTV se configura **solo en la web** y nada del proveedor sale del Umbrel. El buscador solo
   devuelve nombres limpios, el nombre que Isma puso al proveedor e ids sintéticos.

### 14.2 Contrato (`packages/shared`, zod)

Cuatro cambios: una ruta nueva y tres campos opcionales en rutas que ya existen. Ningún formato de id cambia.

**1. Ruta nueva `iptvChannels`** (`packages/shared/src/api/v1/iptv.ts`, `routes.ts`, módulo `iptv`):

| id | método y ruta | acceso | consulta | respuesta | errores |
|---|---|---|---|---|---|
| `iptvChannels` | `GET /api/v1/iptv/channels` | **`web`** (D27; pasa a `any` en §14.10) | `IptvChannelsQuery` | `IptvChannelsResponse` | `empty_query` |

```ts
// packages/shared/src/constants/iptv.ts
export const IPTV_SEARCH = {
  /** Filas por búsqueda: por defecto y como mucho. */
  limit: 50,
  /** `total` cuenta hasta aquí; si hay más, `capped: true`. */
  totalCap: 200,
  /** Filas IPTV a la vista antes de «Ver más»: en Buscar y en el filtro de Canales. */
  shownInSearch: 5,
  shownInLibrary: 3,
  /** Ids de tu biblioteca que se devuelven por canal IPTV, y cuántos de la biblioteca se miran como mucho. */
  libraryMatchesMax: 20,
  libraryCandidatesMax: 200,
  /** Consultas al motor de la búsqueda inversa (§14.4). */
  reverseQueriesMax: 2,
  /** Con menos fuentes de AceStream que esto, la sesión del canal pide la búsqueda inversa. */
  reverseBelowAce: 3,
  /** Un favorito IPTV que no casa tras cambiar de proveedor se quita pasado esto (§14.6). */
  relinkGraceMs: 24 * HOUR,
} as const;
// IPTV_CLIENT gana:
//   searchMs: 4_000          → TIMEOUTS.iptvChannels de la web
//   channelEngineMs: 20_000  → la llamada con engine=1 (§14.4)

// packages/shared/src/api/v1/iptv.ts
export const IptvChannelsQuerySchema = z.strictObject({
  /** Se limpia como en `search` (espacios colapsados, recorte, 80); con menos de 2 letras, 400 `empty_query`. */
  q: z.string().max(500).default(''),
  limit: z.coerce.number().int().min(1).max(IPTV_SEARCH.limit).optional(),   // por defecto 50
});

export const IptvChannelSchema = z.strictObject({
  /** Id de §4.1 de la mejor variante del grupo (§4.3): el mismo que usa la resolución. */
  id: HashSchema,
  /** Nombre limpio («Antena 3»): sin país, adornos, calidad ni reserva. */
  title: z.string().min(1).max(120),
  quality: IptvQualitySchema.nullable(),
  /** §16: todas las calidades del canal, de mayor a menor resolución («4K · 1080p · 720p»). */
  qualities: z.array(IptvQualitySchema).max(4).optional(),
  /** §16: país si no es España ni sin país («DE»). */
  country: z.string().min(2).max(8).nullable().optional(),
  /** El nombre que Isma puso al proveedor («Casa»). */
  provider: z.string().max(IPTV_NAME_MAX),
  /** Ids de tu biblioteca (favoritos, recientes o la lista activa) que son este canal (≥ 92), de mejor a peor. */
  library: z.array(HashSchema).max(IPTV_SEARCH.libraryMatchesMax),
});

export const IptvChannelsResponseSchema = z.strictObject({
  query: z.string().max(SEARCH_QUERY_MAX),
  /** Canales que casan, hasta `totalCap`. */
  total: z.number().int().nonnegative(),
  capped: z.boolean(),
  channels: z.array(IptvChannelSchema).max(IPTV_SEARCH.limit),
});
```

- **Sin IPTV activa** (sin proveedor, en pausa o sin catálogo cargado: `iptv.active()` falso), responde `200` con
  `{ query, total: 0, capped: false, channels: [] }`. No es un error: la web puede preguntar justo mientras se pausa.
- **Nunca** lleva URL, `ref`, `stream_id`, `tvg-id`, grupo ni nada del proveedor aparte de `provider`. El test de
  fugas (§9.2, caso 8) suma esta ruta.
- La respuesta no se registra (como las demás `iptv*`), porque la consulta es lo que Isma escribe.

**2. `SearchResultSchema` (`api/common.ts`) gana un campo opcional:**

```ts
/** Solo en /api/v1/search y con IPTV activa: el canal de tu IPTV que es este resultado (≥ 92, §14.3). */
iptv: HashSchema.optional(),
```

- La ruta antigua `/api/search` no lo lleva (como `playableOn`, que solo va en v1).
- El servidor lo calcula para **todos** los resultados (100 como mucho) y para cualquier origen: la 0.8.0 ignora la
  clave. `v1/search.json` **no cambia**; el caso con IPTV va en `fixtures/variantes/search.iptv.json`.

**3. `ResolveQuerySchema` (`api/v1/football.ts`) gana dos campos opcionales, solo con `scope=channel`:**

```ts
/** El canal IPTV tocado, o el hash tocado si no se sabe (el servidor lo ignora si no es un id IPTV, §4.1). */
iptv: HashSchema.optional(),
/** '1': busca también en el motor AceStream (búsqueda inversa, §14.4). Sin él, < 300 ms como hoy. */
engine: z.enum(['0', '1']).optional(),
```

**4. `LibraryViewSchema` (`api/v1/library.ts`, solo la respuesta; el estado persistido no cambia) gana:**

```ts
/** Solo si hay ids IPTV en favoritos o recientes: el estado de cada uno ahora (§14.6). */
iptvIds: z.record(HashSchema, z.enum(['ok', 'iptv_gone', 'iptv_disabled', 'iptv_removed'])).optional(),
```

- Lo llevan `libraryGet` y la respuesta de `libraryMutate`. `ItemSchema` **no** cambia: es `strictObject` y está en el
  estado que lee la 0.8.0.
- `v1/libraryGet.json` no cambia; el caso va en `fixtures/variantes/libraryGet.iptv.json`.

**Ejemplos y generados** (reparto de §5.7):
- `fixtures/web/v1/iptvChannels.json` y `iptvChannels` en `WEB_FIXTURE_ROUTE_IDS` (son ya 6);
- `fixtures/variantes/search.iptv.json`, `libraryGet.iptv.json` y `footballResolve.iptv-canal.json` (un canal solo de
  la IPTV con dos AceStream de la búsqueda inversa detrás);
- `v1/` y `events/` no cambian: ni tipos Swift nuevos obligatorios ni eventos nuevos;
- `TIMEOUTS.iptvChannels = 4_000` en `api/client.ts`;
- `openapi-v2.yaml` regenerado y `docs/api.md` §7 con la ruta, los campos nuevos y un ejemplo.

### 14.3 Cómo busca y cómo se mezcla

**En el servidor** (`modules/iptv/search.ts`, puro; lo llama `iptv.search()`):

1. **Qué casa.** La consulta pasa por la misma limpieza que un nombre IPTV (`cleanIptvTitle` e `iptvSpelling`, así
   «m+ la liga» es «movistar laliga») y se trocea en palabras. Un **grupo** del catálogo casa si **cada** palabra de la
   consulta es el principio de alguna palabra de su clave (`normalizeChannelKey(base)`, en cualquier orden), o si la
   clave contiene la consulta entera.
   - Se usa el índice de palabras de la preselección (§3.4): para cada palabra de la consulta se juntan los grupos de
     las palabras del índice que empiezan por ella y se intersecan. Nada recorre las 100 000 entradas.
2. **Qué no sale nunca:** solo el VOD (ya no está en el catálogo, §3.2). **Cambia con §16 (D25):** ya no se quitan
   los canales de otros países ni los grupos para adultos.
3. **Una fila por canal** (§16): las variantes de resolución de un canal son una fila; el mismo nombre en otro país
   es otra fila. El id es el de la variante que arranca primero (la 1080p si la hay), con su `quality`, y `qualities`
   trae todas las del canal.
4. **Orden:** clave igual a la consulta → clave que empieza por la consulta → palabras en el mismo orden → el resto;
   dentro de cada nivel, la clave más corta, los canales del mismo nombre juntos (España o sin país primero) y luego
   el orden del catálogo.
5. **`library` de cada fila.** Se miran los elementos de favoritos, recientes y la lista activa cuyo título o categoría
   contiene la consulta sin tildes ni mayúsculas (lo mismo que enseñan «En tu biblioteca» y el filtro de Canales), 200
   como mucho, y se quedan los que son **ese canal** según `sameChannel` (abajo). Un id IPTV de la biblioteca cuenta si
   es del mismo grupo.
6. **Objetivo:** menos de **50 ms** con 100 000 canales (test de §14.9).

**`sameChannel(base, otroTitulo, scorer)`** (`modules/iptv/match.ts`, puro). Es la regla única de «es el mismo canal»
del buscador, la búsqueda inversa y el re-emparejado:
- `max(scorer([base], { title: otro }), scorer([base], { title: iptvSpelling(otro) }))`, con la regla del « 1» final
  de §4.2;
- `scorer` es `scoreResolutionCandidate` inyectado desde `services.ts` (el módulo `iptv` no importa `football`), así
  que hereda Hypermotion (≤ 58), la regla de los números («DAZN 1» ≠ «DAZN 2») y la de la familia;
- umbral **92** (`IPTV_MIN_SCORE`).
- «LaLiga TV Hypermotion» nunca es «LaLiga TV»; «DAZN LA LIGA 1080» sí es «DAZN LaLiga».

**`SearchResult.iptv`** (`search/routes.ts`, con `iptv` como dependencia opcional de `search`, que ya se crea después).
Con la IPTV activa, para cada resultado del motor se preseleccionan grupos por palabras (50 como mucho) y se queda el de
mayor `sameChannel(grupo.base, resultado.title)` ≥ 92 (desempate: orden del catálogo). Su id va en `iptv`.

**En la web** (`features/search/iptv.ts`, puro: `mergeSearch({ local, iptv, engine, iptvIds })`). Reglas, en orden:

1. **Biblioteca primero.** Una fila de «En tu biblioteca» (5 como mucho, como hoy) lleva el distintivo «IPTV» si su id
   está en el `library` de algún canal IPTV de la respuesta, o si es un id IPTV (`iptvIds`). Ese canal queda
   **representado** por ella.
2. **«En tu IPTV»:** los canales de la respuesta que no están representados, en el orden del servidor. Se ven 5; el
   resto, con «Ver más».
3. **«En el motor AceStream»:** un resultado con `iptv` cuyo canal está representado (fila de la biblioteca o de «En tu
   IPTV», también si está detrás de «Ver más») **se esconde** y suma al contador de ese canal. Si su canal no está (por
   ejemplo, pasó del límite de 50), se queda **el primero** de ese canal con el distintivo «IPTV» y se esconden los
   demás.
4. El contador de la sección del motor cuenta solo los que se ven.

Así «Antena 3 HD» de tu biblioteca sale una vez con «IPTV», «Telecinco» (solo en la IPTV) sale en «En tu IPTV», y «La 1»
de la IPTV sale una vez con «también en AceStream» aunque el motor tenga cinco «La 1 HD --> …».

**Llamadas de la web.** Con `iptvActive()` (el `features.iptv` de siempre), Buscar lanza a la vez `search` (el motor,
como hoy) e `iptvChannels` con el mismo texto confirmado (450 ms tras la última tecla, o Intro) y `limit` 50, así el
filtro de Canales comparte la misma consulta en caché. Sin IPTV activa, `iptvChannels` no se llama y todo es como hoy.
- `staleTime` de 60 s, como el motor. Se invalidan con `iptv.status` y con los cambios de la biblioteca (el `library` de
  cada fila depende de ella). `libraryGet` se invalida también con `iptv.status` (por `iptvIds`).
- Las respuestas atrasadas no pintan nunca: una consulta por texto, como hoy.
- El filtro de Canales usa su propia espera de 140 ms para la lista, pero pregunta a `iptvChannels` con el texto
  estable 450 ms, como Buscar, para no lanzar una petición por tecla.

### 14.4 Tocar un resultado

Todas las filas pasan por `playChannel`. `PlayRequest` gana `iptv?: string` (el id IPTV del canal, si se sabe) y
`TappedChannel` gana `iptv: string | null`.

| Se toca… | `playChannel` recibe | Qué pasa |
|---|---|---|
| Fila de «En tu IPTV» | `hash` = `iptv` = id IPTV, título limpio, `ih: false`, `record: true` | sesión de canal (§8.4) con `iptv` |
| Fila de la biblioteca con «IPTV» | su hash de siempre y `iptv` = el canal IPTV que la representa | igual que hoy con IPTV activa (§8.4), con `iptv` |
| Resultado del motor con «IPTV» | su infohash (`ih: true`) y `iptv` = `result.iptv` | igual, con `iptv` |
| Favorito o reciente que es un id IPTV | `hash` = `iptv` = ese id | sesión de canal con `iptv`, **aunque la IPTV no esté activa** |
| Cualquier otra fila | lo de hoy | lo de hoy (§8.4) |

`playChannel` toma el camino de la sesión de canal si `origin !== 'pegado'` **y** (`iptvActive()` **o** `iptv ===
hash`). Un id IPTV nunca se manda a `play()` directamente: el motor no lo entiende y `channelStream` daría un error de
reproductor.

**Primera llamada (rápida, la de hoy):**
`footballResolve { channel: título, scope: 'channel', iptv: tapped.iptv ?? tapped.hash, client }`, con los 2,5 s de
`IPTV_CLIENT.channelResolveMs`.
- En el servidor, si `iptv` es del catálogo vigente (`classify` = `owned`), se convierte en la candidata de **su
  grupo** (la mejor variante, §4.3) con puntuación 100 y `matchedChannel` = su nombre limpio, y va **primera**. Cuenta
  dentro del tope de 2 IPTV. Si no es un id IPTV, o ya no es del catálogo, se ignora y manda el emparejado por nombre
  de siempre: así un favorito de otro proveedor encuentra su canal nuevo.
- Lo demás es §5.2: vínculos, biblioteca e IPTV, sin motor ni IA, < 300 ms.
- Abrir `partido/canal/<id IPTV>` con el enlace (sin tocar nada) también manda `iptv` = ese id, así que suena la IPTV
  aunque la web no sepa todavía que es un canal IPTV.

**Segunda llamada, la búsqueda inversa (`engine=1`),** de fondo, con `IPTV_CLIENT.channelEngineMs` (20 s). La web la
pide si:
- la primera trajo IPTV y la sesión tiene **menos de 3** fuentes de AceStream (`IPTV_SEARCH.reverseBelowAce`); o
- lo tocado es un id IPTV y la primera **no trajo nada** (`not_found`, error o plazo).

En el servidor, con `scope=channel&engine=1`:
- **Canales pedidos:** el título y, si `iptv` es del catálogo, también su nombre limpio (sin repetir).
- **Consultas al motor:** `aceSearchQueries` de esos canales, **2 como mucho**, por `via: 'auto'`. Con solo IPTV
  sonando, el motor principal está libre (§6.4).
- **Puntuación:** cada resultado con `sameChannel` contra cada canal pedido, y entra solo con **≥ 92**, con las reglas
  aprendidas aplicadas («Canal incorrecto» aparta). Los ids IPTV que devuelva el motor se descartan (§4.1).
- **Deja de valer la regla «sin IPTV, `not_found`» de §5.2:** con `engine=1` se devuelve lo que haya (IPTV, biblioteca
  y motor), y `not_found` solo si no hay nada.
- **Comprobador:** un trabajo `interactive` nuevo para el mismo `clientKey` con todas las candidatas. Sustituye al de la
  primera llamada, y el comprobador reutiliza los veredictos en caché, así que lo ya comprobado no se vuelve a sondear.
  Ninguna sonda de stream IPTV (§7.3).
- **Motor caído:** `engineAvailable: false` y lo demás igual; la web no avisa de nada.

**En la web** (`features/sources/session.ts`):
- La respuesta de `engine=1` se **mezcla** con lo que hay: las entradas que ya estaban conservan su estado, su número y
  su veredicto, y las AceStream nuevas se añaden **al final** en el orden del servidor. Nada se reordena mientras
  suena algo. `watchJob` pasa al trabajo nuevo.
- Si llega tarde (otro canal, salir), se descarta por `generation`, como la primera.
- Sin ruido: no hay aviso cuando llega el respaldo; los carteles nuevos aparecen en el panel de fuentes.
- Si lo tocado es un id IPTV y **las dos** llamadas vuelven vacías, no se abre el reproductor con un error: se queda
  en espera con el texto de §14.5 según `iptvIds`.

**El puente en un canal solo de la IPTV** (filas nuevas de la tabla de §7.2; el resto de §7.2 no cambia):

| Cae… | y hay… | Qué pasa | Línea de estado | Toast con acción |
|---|---|---|---|---|
| IPTV de un canal solo de la IPTV | la búsqueda inversa en marcha, o AceStream sin ninguna verificada | espera a la primera `working`, como en un partido | «Tu IPTV no responde. Busco este canal en AceStream y arranco la primera fuente que funcione.» | «Volver a la IPTV» |
| ídem | la búsqueda inversa terminó sin ninguna AceStream | `failureText` | «Tu IPTV no responde y este canal no está en AceStream. Prueba otra vez en unos minutos.» | «Volver a la IPTV» |
| ídem | una AceStream `working` | la fila 1 de §7.2 («Tu IPTV no responde: seguimos por AceStream (fuente {N})») | — | «Volver a la IPTV» |

La fila «IPTV en un canal suelto → se prueba el hash que se tocó» de §7.2 sigue valiendo cuando lo tocado es un hash de
AceStream.

### 14.5 Textos (literales, en `features/search/*`, `features/library/*` y `features/sources/session.ts`)

**Buscar, con IPTV activa** (sin IPTV activa, los textos de hoy):

| Dónde | Texto |
|---|---|
| Etiqueta del campo (oculta) | «Buscar en tu IPTV y en el motor AceStream» |
| Pista sin texto (sustituye a «Busca canales publicados en el motor AceStream.») | «Busca canales en tu IPTV y en el motor AceStream.» |
| Título de la sección nueva, entre «En tu biblioteca» y «En el motor AceStream» | «En tu IPTV», con el contador (`total`, o «200+» si `capped`) |
| Distintivo de fila (el de `SourcePoster`: `Capsule` neutra, icono `tv`) | «IPTV» |
| Subtítulo de una fila IPTV | «{Casa}»; las calidades van detrás en etiquetas pequeñas, de mayor a menor resolución («4K» «1080p» «720p» «SD»), con el país delante si no es España («DE») (§16; antes «{Casa} · {1080p}») |
| … si también está en AceStream (`library` no vacío o resultados del motor escondidos) | añade « · también en AceStream» |
| Botón bajo las 5 primeras | «Ver {N} más de tu IPTV» / «Ver menos» |
| Nota con `capped` o `total` > 50, al desplegar | «Hay más canales con «{q}» en tu IPTV: escribe algo más concreto.» |
| Fallo de `iptvChannels` (dentro de la sección, sin toast) | «No se pudo buscar en tu IPTV.» + botón quiet «Reintentar» |
| Región viva con resultados | «{n} en tu IPTV y {m} en el motor para «{q}».»; con filas de tu biblioteca, «{l} en tu biblioteca, {n} en tu IPTV y {m} en el motor para «{q}».» |
| Motor vacío con tu IPTV en error (en vez del vacío grande) | «El motor AceStream no tiene nada para «{q}».» |
| Vacío en los dos (sustituye al vacío de hoy) | título «Sin resultados para «{q}».», texto «No está en tu IPTV ni en el motor AceStream. Prueba con otro nombre o menos palabras.» |

- Si solo la IPTV tiene resultados, la sección del motor enseña su vacío de hoy («Sin resultados para «{q}».»); si el
  motor falla, su error de hoy y el toast «La búsqueda falló. ¿Está el motor AceStream en línea?». La IPTV se ve igual.
- Sin resultados IPTV y sin error, la sección «En tu IPTV» no sale.
- Mientras carga `iptvChannels` no se pinta nada de la sección (es rápida): sin esqueleto, para que no salte.

**Filtro de Canales, con IPTV activa** (texto de 2 letras o más):

| Dónde | Texto |
|---|---|
| Sección al final de la lista filtrada (3 filas como mucho, sin las representadas por filas de esa pestaña) | «En tu IPTV» |
| Botón bajo la sección si hay más | «Ver todo en Buscar» (`goToEngineSearch(navigate, q)`) |
| El botón de hoy «Buscar «{q}» en el motor AceStream» | «Buscar «{q}» en tu IPTV y el motor» (sin el segundo «en»: así cabe en un renglón a 390 px con consultas cortas) |
| El vacío de hoy «Nada en esta pestaña con «{q}».» | igual; la sección «En tu IPTV» sale debajo si hay |

**Filas que son un id IPTV (Favoritos, Recientes, «En tu biblioteca»)**, según `iptvIds`:

| Estado | Subtítulo |
|---|---|
| `ok` | «Tu IPTV» |
| `iptv_gone` | «Ya no está en tu IPTV» |
| `iptv_disabled` | «Tu IPTV está en pausa» |
| `iptv_removed` | «Has eliminado tu IPTV» |

**Menú «Más» de una fila IPTV** (fila de «En tu IPTV» o id IPTV de la biblioteca): «Ver canal», «Añadir a favoritos» /
«Quitar de favoritos», «Copiar nombre», y en la biblioteca «Renombrar» y «Eliminar». **Sin** «Abrir en la app de
AceStream», «Copiar URL del stream (VLC)», «Copiar enlace acestream://» ni «Copiar hash» (`channelMenuItems` gana
`iptv: true`). La ficha de escritorio (`ChannelDetail`) de un id IPTV no enseña el hash.

**Sesión de un canal tocado que es un id IPTV:**

| Momento | Texto (línea de espera) |
|---|---|
| Primera llamada | «Buscando el canal en tu IPTV…» (el de hoy) |
| Sin nada en la primera, con la búsqueda inversa en marcha | «Buscando este canal en AceStream…» |
| Nada en ninguna, IPTV activa | «Este canal ya no está en tu IPTV y no lo encuentro en AceStream.» |
| Nada en ninguna, IPTV en pausa | «Tu IPTV está en pausa y este canal no está en AceStream.» |
| Nada en ninguna, IPTV eliminada | «Has eliminado tu IPTV y este canal no está en AceStream.» |

### 14.6 Favoritos y Recientes con ids IPTV

**Guardar.** La estrella de una fila IPTV abre la hoja de favorito de siempre y hace `favorite-upsert` con
`{ id: <id IPTV>, title: <nombre limpio>, category: 'IPTV', alias: <nombre limpio>, ih: false }`.
- `alias` guarda el nombre del canal en la IPTV aunque Isma lo renombre después: es el que usa el re-emparejado.
- El **identificador estable** es el id de §4.1 de la mejor variante: no cambia entre sincronizaciones mientras el
  proveedor sea el mismo (§4.1).
- La 0.8.0 lo ve como un favorito más y lo reproduce por `channelStream`, que ya sabe abrir un id IPTV (§4.1).

**Recientes.** Lo que entra es el canal **tocado**, una vez por sesión de canal, cuando arranca la primera fuente de
esa sesión (sea la IPTV o una AceStream): `history-upsert { id: tapped.hash, title: tapped.title, ih }`, solo si
`tapped.record`. Los cambios de fuente, el puente y «Volver a la IPTV» no apuntan nada. Así, además, un canal de
AceStream tocado vuelve a entrar en Recientes cuando suena su IPTV (hoy no entraba).

**`iptvIds`.** Al montar `LibraryView`, el servidor pasa cada id de favoritos y recientes por `isIptvId` (es un HMAC
por id: nada que guardar) y, a los que lo son, por `classify`: `owned` → `ok`, y los otros tres con su código.

**Re-emparejado** (`modules/iptv/relink.ts`, puro, más un gancho en `service.ts`; D28):
- **Cuándo:** tras aplicar una sincronización correcta con la IPTV activa (también la primera tras cambiar de
  proveedor). Nunca en pausa, sin proveedor ni tras una sincronización fallida.
- **A quién:** favoritos y recientes con `isIptvId(id)` que no están en el catálogo vigente, o que están pero ya no son
  la mejor variante de su grupo.
- **Cómo:** con `matchIptvChannels(catalog, [alias || title])` (≥ 92, ES o sin país, la regla del « 1»):
  - si casa: se cambia el `id` por el de la mejor variante del grupo **en su sitio** (mismo título, categoría, alias,
    fecha y posición); si ese id ya estaba en la colección, se quita el viejo;
  - si no casa, en **Recientes** se quita;
  - si no casa, en **Favoritos** se apunta en memoria desde cuándo falta y se quita en la primera sincronización
    correcta pasadas **24 h**. Si el servidor se reinicia, la cuenta vuelve a empezar: el favorito dura más, nunca
    menos. Mientras tanto sale con «Ya no está en tu IPTV» y, al tocarlo, se busca por nombre (§14.4).
- **Todo en un `state.enqueue`**, con el aviso de cambio de biblioteca de siempre. No hay ningún aviso visible.
- Los vínculos guardados (`channelBindings`) no se tocan: una IPTV no se vincula a mano.

### 14.7 Límites

| Qué | Límite |
|---|---|
| Letras para buscar | 2 (`SEARCH_QUERY_MIN`), 80 como mucho; menos → `empty_query` y la web no pregunta |
| Canales listados sin buscar | **ninguno**: no hay ruta para recorrer el catálogo |
| Filas por respuesta | 50 (`IPTV_SEARCH.limit`); `total` hasta 200 con `capped` |
| Filas IPTV a la vista | 5 en Buscar y 3 en Canales, con «Ver más» / «Ver todo en Buscar» |
| Ids de biblioteca por canal | 20; se miran 200 elementos de la biblioteca como mucho |
| Resultados del motor anotados con `iptv` | todos (100 como mucho), 50 grupos preseleccionados por resultado |
| Tiempo de `iptvChannels` en el servidor | objetivo < 50 ms con 100 000 canales; la web espera 4 s |
| Búsqueda inversa | 2 consultas al motor, umbral 92, 20 s de plazo en la web; solo con menos de 3 AceStream o sin nada |
| País | todos, con su país en una etiqueta (D25, §16) |
| Grupos para adultos | salen (D25, §16) |
| Re-emparejado | tras cada sincronización correcta; favoritos que no casan fuera a las 24 h, recientes al momento |

### 14.8 Ficheros

| Dónde | Cambio |
|---|---|
| `packages/shared/src/api/v1/iptv.ts`, `routes.ts`, `api/common.ts`, `api/v1/football.ts`, `api/v1/library.ts`, `constants/iptv.ts` | §14.2 |
| `packages/shared/scripts/fixtures.ts`, `fixtures/web/v1/`, `fixtures/variantes/`, `test/contracts.test.ts` | ejemplos de §14.2 |
| `apps/server/src/modules/iptv/{search, relink}.ts` (nuevos), `match.ts` (`sameChannel`), `catalog.ts` (búsqueda por prefijo en el índice), `service.ts`, `routes.ts`, `types.ts` | búsqueda, re-emparejado, `iptvIds` |
| `apps/server/src/modules/search/{routes, types}.ts`, `services.ts` | `SearchResult.iptv`; `search` recibe `iptv` y `iptv` recibe el `scorer` |
| `apps/server/src/modules/football/{service, resolution}.ts` | `iptv` y `engine=1` en `scope=channel` |
| módulo de la biblioteca en el servidor (donde se monta `LibraryView`) | `iptvIds` |
| `apps/server/test/fake-iptv/provider.ts` | canal nuevo «ES: Telecinco HD» (id 110, categoría 2), que no está en el motor falso ni en la biblioteca E2E, y un grupo «XXX» con un canal |
| `apps/web/src/features/search/{SearchView.tsx, iptv.ts (nuevo), model.ts, demo.ts, search.css}` | sección «En tu IPTV», mezcla, textos |
| `apps/web/src/features/library/{LibraryView, ChannelRow, ChannelDetail, actions, useChannelActions, play, model}.ts(x)` | sección en el filtro, distintivo, subtítulos de `iptvIds`, menú sin hash, `PlayRequest.iptv` |
| `apps/web/src/features/sources/session.ts` | `iptv` en la primera llamada, búsqueda inversa y mezcla, textos de §14.4 y §14.5, Recientes del canal tocado |
| `apps/web/src/api/{client.ts, query.ts, demo/**}` | `TIMEOUTS.iptvChannels`, invalidaciones, demo |
| `apps/web/e2e/iptv.spec.ts` | casos de §14.9 |

**Demo (`?demo=1`):** `iptvChannels` responde con los canales de la «IPTV de ejemplo» de demo-5 (por ejemplo «DAZN
LaLiga», «M+ LaLiga TV», «Telecinco» y «laSexta») y la demo del motor anota `iptv` en sus resultados de «DAZN LaLiga».
demo-4 no cambia.

### 14.9 Pruebas

**Unitarias, `packages/shared`** (`contracts.test.ts`):
- `IptvChannelsResponse` válida; `IptvChannel` no tiene ningún campo `url`, `ref`, `streamId`, `tvgId` ni `group`;
- `SearchResult` con y sin `iptv`; `v1/search.json` sin `iptv`; `ResolveQuery` con `iptv` y `engine`;
  `LibraryView` con y sin `iptvIds`; `v1/libraryGet.json` sin `iptvIds`;
- reparto: `web/v1/` con 6 rutas (todas `access: 'web'`) y las 3 variantes nuevas validando con su esquema.

**Unitarias, servidor:**

| Fichero | Qué cubre |
|---|---|
| `iptv/search.test.ts` | prefijos en cualquier orden («liga m+» encuentra «M+ LaLiga TV»); «la liga» = «laliga»; sin tildes; orden (igual → empieza → en orden → resto; más corta); una fila por grupo con la mejor variante; solo ES o sin país («UK: DAZN 1» no sale); grupo «XXX» y «Adultos» fuera; `total` y `capped` con 250 coincidencias; `library` con favorito, reciente y canal de la lista, y sin «LaLiga TV» para «LaLiga TV Hypermotion»; 100 000 canales en < 50 ms (`@lento`, con margen en CI) |
| `iptv/match.test.ts` | `sameChannel`: «DAZN LA LIGA 1080» = «DAZN LaLiga»; Hypermotion ≤ 58; «DAZN 1» ≠ «DAZN 2» y ≠ «DAZN F1»; « 1» final solo si el pedido no lleva número |
| `iptv/relink.test.ts` | cambio de proveedor: favorito y reciente re-emparejados en su sitio (título renombrado, `alias` manda); id nuevo repetido → se quita el viejo; reciente sin pareja fuera; favorito sin pareja fuera solo pasadas 24 h; variante que deja de ser la mejor → la mejor; en pausa o con sincronización fallida no toca nada |
| `iptv/service.test.ts` | `iptvIds` con los cuatro estados; `iptvChannels` sin IPTV activa → 200 vacío |
| `search/routes.test.ts` | con IPTV activa, `iptv` en los resultados que casan y no en «LaLiga TV» frente a «LaLiga TV Hypermotion»; sin IPTV, sin la clave; la ruta antigua nunca la lleva |
| `football/resolution.test.ts` e `iptv.test.ts` | `scope=channel&iptv=<id>` → esa IPTV primera (su mejor variante) aunque el título no case; `iptv` de otro proveedor → emparejado por nombre; `iptv` con un hash de AceStream → ignorado; `engine=1` → AceStream del motor ≥ 92 detrás, «LaLiga TV» fuera para «LaLiga TV Hypermotion»; `engine=1` sin IPTV → `found` con AceStream; `engine=1` con el motor caído → IPTV y biblioteca, `engineAvailable: false`; `engine=0` sigue sin llamar al motor |

**Unitarias, web:**
- `search/iptv.test.ts` (`mergeSearch`): biblioteca con «IPTV» y sin fila IPTV repetida; fila IPTV cuando no está en la
  biblioteca; resultados del motor escondidos y contados («también en AceStream»); canal IPTV fuera de los 50 → el
  primero del motor con «IPTV» y los demás escondidos; 5 a la vista y «Ver {N} más de tu IPTV».
- `SearchView.test.tsx`: con y sin `features.iptv` (sin él, ni una llamada a `iptvChannels` y los textos de hoy);
  textos de §14.5; fallo de la IPTV sin toast; vacío de los dos; región viva.
- `LibraryView.test.tsx`: sección «En tu IPTV» en el filtro, 3 como mucho, sin las filas de la pestaña; «Ver todo en
  Buscar»; botón del motor con el texto nuevo.
- `play.test.ts`: un id IPTV nunca llama a `play()`, ni con la IPTV en pausa; `iptv` llega a la sesión.
- `session.test.ts`: `iptv` en la primera llamada (y el hash tocado si no se sabe); `engine=1` solo con menos de 3
  AceStream o tras un vacío con id IPTV; la mezcla no reordena y cambia de trabajo; respuesta atrasada descartada;
  filas nuevas del puente con sus textos; los textos de espera de §14.5; Recientes una vez por sesión, con el canal
  tocado, también cuando suena la IPTV.
- `actions.test.ts` (o el de `ChannelRow`): menú IPTV sin «Copiar hash», «Abrir en la app de AceStream», «Copiar URL del
  stream (VLC)» ni «Copiar enlace acestream://»; subtítulos de `iptvIds`.

**Integración** (`apps/server/test/integration/iptv.test.ts`, casos nuevos):
11. `iptvChannels?q=tele` → «Telecinco» con `library: []`; `?q=antena` → «Antena 3» con el id de la biblioteca E2E en
    `library`; desde `/native` → 403 `origin_forbidden`; sin IPTV → 200 vacío; ninguna petición al proveedor.
12. `search?q=la 1` con IPTV activa → los «La 1 HD --> …» del motor llevan el id IPTV de «La 1».
13. `footballResolve?channel=Telecinco&scope=channel&iptv=<id>` → la IPTV sola; con `engine=1` y el motor sin
    Telecinco → la IPTV sola, sin error. Con «La 1» y `engine=1` → la IPTV y las dos AceStream.
14. Cambiar de Xtream a la M3U del mismo proveedor falso (otro `provider.id`) → tras sincronizar, el favorito y el
    reciente de «Telecinco» tienen el id nuevo y se reproducen; un favorito de un canal que se quita de la lista falsa
    sigue 24 h (reloj falso) y luego se va.
15. Fugas: el caso 8 suma `iptvChannels` y `search` con `iptv`.

**E2E** (`apps/web/e2e/iptv.spec.ts`, casos nuevos, con la pila y el proveedor falso):
8. **Solo en la IPTV:** Buscar «tele» → sección «En tu IPTV» con «Telecinco» y el distintivo «IPTV»; tocarlo → suena
   por hls.js; Recientes tiene «Telecinco»; la estrella lo guarda y Favoritos lo enseña con «Tu IPTV».
9. **En los dos:** Buscar «la 1» → una sola fila «La 1» con «también en AceStream» y ningún «La 1 HD --> …» a la vista
   en el motor; tocarla → suena la IPTV y, tras la búsqueda inversa, el panel de fuentes tiene 2 AceStream;
   `/__iptv/modo(107,'down')` → «Tu IPTV no responde: seguimos por AceStream (fuente N)» y «Volver a la IPTV».
10. **Ya en tu biblioteca:** Buscar «antena» → la fila «Antena 3 HD» de la biblioteca con «IPTV» y ninguna fila
    «Antena 3» en «En tu IPTV».
11. **Solo en la IPTV y se cae:** Telecinco con `modo(110,'down')` → «Tu IPTV no responde y este canal no está en
    AceStream. Prueba otra vez en unos minutos.».
12. **Canales:** filtro «tele» en Favoritos vacío → «Nada en esta pestaña con «tele».» y debajo «En tu IPTV» con
    «Telecinco».
13. **Pausa:** «Usar la IPTV» apagado → Buscar sin sección IPTV y con los textos de hoy; el favorito «Telecinco» dice
    «Tu IPTV está en pausa» y, al tocarlo, «Tu IPTV está en pausa y este canal no está en AceStream.», sin error de
    reproductor.

### 14.10 Impacto en la app nativa (actualiza §10)

**La app calcará el buscador de la web** cuando haga su pestaña Buscar (fase 3), con las mismas secciones, reglas y
textos. Hasta entonces nadie de `rediseno/iptv` toca `apps/ios`.

**Sin cambiar nada, incluida la 0.8.0 publicada:**
- `SearchResult.iptv` y `LibraryView.iptvIds` son claves que no conoce: las ignora.
- Un favorito o reciente IPTV guardado desde la web sale en su lista y se reproduce por `channelStream` (el servidor
  abre la IPTV). Lo que falla: sin distintivo, con «Copiar hash» y «Abrir en la app de AceStream», y si el id ya no
  vale, la fuente se agota con «Ese canal ya no está en tu IPTV.» (`iptv_gone`), sin romper nada. El re-emparejado
  (§14.6) hace que casi nunca pase.
- `iptvChannels` responde 403 desde `/native` mientras sea `access: 'web'`: la app no la llama.

**Cambios cuando exista la pantalla** (los ficheros con * no existen aún en `rediseno/nativa`; el nombre lo pone su
dueño):

| Módulo | Fichero o carpeta | Cambio |
|---|---|---|
| M1 | `Sources/Core/Models/Buscar.swift`* (o donde viva `SearchResult`) | `iptv: String?` en `SearchResult`; tipos `CanalIptv` (`id`, `title`, `quality`, `provider`, `library`) y `RespuestaCanalesIptv` (`query`, `total`, `capped`, `channels`) |
| M1 | modelo de la biblioteca | `iptvIds: [String: EstadoIdIptv]?` (tolerante a valores nuevos) |
| M1 | `Sources/Core/Models/Futbol.swift` | `iptv` y `engine` en la consulta de `footballResolve` |
| M1 | `Sources/Core/Networking/` | regenerar `RutaID` (ruta `iptvChannels`) y `PlazosWeb` (`iptvChannels: 4_000`) con los generadores de §10.1 |
| M3 | `Sources/Core/Reglas/Buscar/MezclaBuscador.swift`* | `mergeSearch` de §14.3 tal cual, con vectores generados desde `scripts/vectores/buscador.ts` (nuevo, a partir de `features/search/iptv.ts`) |
| M3 | `Sources/Player/Fuentes/SesionFuentes.swift` | `iptv` en la primera llamada, búsqueda inversa `engine=1` y su mezcla, filas nuevas del puente, textos de espera de §14.5 y Recientes del canal tocado |
| M3 | `Sources/Core/Reglas/Fuentes/OpcionesFuente.swift`* | menú de fila IPTV sin acciones de hash |
| M6 | `Sources/Pantallas/Buscar/`* y `Sources/Pantallas/Canales/`* | sección «En tu IPTV» (5 y «Ver más»; 3 en Canales), distintivo «IPTV» (`Capsula` neutra, icono `tv`), subtítulos de `iptvIds`; textos regenerados en `textos-web.json` |
| M2 | `Sources/Debug/ServidorDemo.swift` | `iptvChannels` y `search` con `iptv` si la demo de la app copia la de la web |

**Orden** (se suma a §10.1):
5. Cuando la app vaya a calcar el buscador, un commit pequeño del «contrato» pasa `iptvChannels` a `access: 'any'`,
   mueve su ejemplo de `fixtures/web/v1/` a `fixtures/v1/` y lo quita de `WEB_FIXTURE_ROUTE_IDS`. El mismo día, el
   dueño de `rediseno/nativa` (M1) añade `RespuestaCanalesIptv` para `FixturesTests` y regenera `RutaID`. Antes de ese
   paso, `ios.yml` solo puede salir rojo en los `--check` de §10.1, como ya se espera.

### 14.11 Riesgos

1. **Resultados que parecen el mismo canal y no lo son.** Lo evita `sameChannel` con el umbral 92, Hypermotion y la
   regla de los números. Si pasa, la fila del motor escondida sigue disponible como fuente en el panel al tocar la
   IPTV, y «Reportar → Canal incorrecto» aprende.
2. **Resultados que son el mismo canal y no se juntan** (grafías raras del motor). Sale una fila más con «IPTV» (regla
   3 de §14.3): feo, pero nunca se pierde nada. El corpus de §4.2 suma nombres del motor.
3. **Carga del motor.** La búsqueda inversa son 2 consultas como mucho, solo con menos de 3 AceStream, y van al motor
   principal, libre mientras suena la IPTV.
4. **Favoritos que se van.** Solo tras 24 h sin pareja y con sincronizaciones correctas; en pausa o sin proveedor nunca.
5. **Memoria y CPU.** La búsqueda usa el índice que ya existe; el test de 100 000 canales la vigila.

### 14.12 Revisión del buscador (26-sep): menores arreglados

- **Región viva de Buscar:** cuenta también «En tu biblioteca» (`searchLiveText`). Con solo «Mi tele» de tu
  biblioteca ya no dice «Sin resultados para «tele».».
- **Consulta que es solo calidad** («hd», «fhd», «4k»): la clave limpia queda vacía y no se busca en el catálogo, pero
  `iptvChannels` devuelve los canales IPTV de lo que tu biblioteca enseña con ese texto, con su `library`. Así «Antena
  3 HD» de tu biblioteca lleva «IPTV» y el motor no la repite.
- **Categoría «IPTV»:** es una marca, no una categoría tuya. En el filtro local (`filterItems`) y en
  `libraryCandidates` solo casa con «ipt» o «iptv»; «tv» ya no saca todos tus favoritos IPTV.
- **Nombre en la IPTV (`alias`):** un id IPTV renombrado se busca por su `alias` («Telecinco»), no por el nombre que le
  pusiste («Mi T5»), en la primera llamada y en la búsqueda inversa (`TappedChannel.alias`). Sirve con la IPTV en
  pausa o con un id que ya no vale.
- **Recientes IPTV:** la estrella de un reciente que es un id IPTV lo guarda con `category: 'IPTV'` y su `alias`
  (usa `iptvIds`, no solo las filas de «En tu IPTV»). Renombrar un reciente IPTV también guarda el nombre de antes
  como `alias`: la ruta `libraryMutate` le pasa a la biblioteca `isIptvId`.
- **Un id IPTV que no está en ningún sitio:** la frase final va como espera terminada (`setWaitingMessage(texto, {
  final: true })`): el panel del vídeo dice «Sin señal» y la línea de estado no dice «Comprobando».
- **Pestaña «Canal» de un id IPTV:** sin «Content ID», «Copiar hash» ni «Abrir en…» (conserva «Favorito»), y
  «Reproducir» pasa por la sesión del canal, nunca por el motor. Abierto con el enlace antes de que llegue la
  biblioteca (IPTV en pausa), el canal espera a saber si es un id IPTV antes de arrancar.
- **`sameChannel`:** otro idioma al final («Real Madrid TV EN», «(ENG)») es otro canal (≤ 58, como Hypermotion); los
  números pegados se separan antes de puntuar («Esport3» = «Esport 3», «Antena3» = «Antena 3»; «DAZN 1» sigue sin ser
  «DAZN12» ni «DAZN F1»).
- **Adultos:** «+18» suelto sigue fuera, pero el «+» de una marca seguido de un número no («Canal+ 18», «M+ 18…»).
- **Registro:** `iptvChannels` escribe su URL como `/api/v1/iptv/channels?[consulta]`, también en los 400.
- **Re-emparejado en fila:** dos sincronizaciones seguidas no re-emparejan a la vez (la segunda leía la biblioteca
  antes de guardarse la primera y daba otras 24 h a un favorito recién quitado). El caso 14 de integración cubre ya
  las 24 h con reloj falso.
- **Botón del filtro de Canales:** «Buscar «{q}» en tu IPTV y el motor» (sin el segundo «en») y reparto equilibrado
  si parte en dos renglones.
- **Sin cambiar:** la línea del partido en directo de una fila IPTV sustituye al subtítulo, igual que en cualquier otra
  fila; falta probarlo con la IPTV real de Isma.

---

## 15. Cómo probar tu propia lista en local

Para meter una lista de verdad (con credenciales) **solo en el PC**, sin tocar el Umbrel. El backend es el real de la
rama, con la red de verdad (agenda de hoy, listas de AceStream y tu IPTV); el motor AceStream es el falso, que hace
sonar cualquier hash: sirve para ver el respaldo. Las credenciales se escriben **solo** en Ajustes → IPTV de la web
local; se guardan cifradas en `ace-player-neo\.data\pila-local` (ignorada por git) y no salen en la consola, en los
registros ni en las respuestas.

**1. Backend** (PowerShell, en una copia con la rama `rediseno/iptv`):

```powershell
cd "C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo"
corepack pnpm@10.18.2 install
$env:Path = "C:\Program Files\Lian-Li\L-Connect 3\x64;" + $env:Path   # ffmpeg, solo en esta terminal
corepack pnpm@10.18.2 exec tsx apps/server/scripts/pila-local.ts
```

Escucha en `http://[::1]:3100` y escribe en la consola la orden exacta de la web (con la `127.0.0.N` del motor falso
que le haya tocado, normalmente la `.60`). Los registros van a `.data\pila-local\registro.jsonl`.

**2. Web** (otra terminal, copiando las dos variables que dice el backend):

```powershell
cd "C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo\apps\web"
$env:VITE_BACKEND = "http://[::1]:3100"; $env:VITE_ENGINE = "http://127.0.0.60:6878"
corepack pnpm@10.18.2 exec vite --host 127.0.0.1 --port 5174
```

Abre **http://127.0.0.1:5174/?vista=ajustes/iptv**, elige «Lista M3U» o «Xtream Codes» y guarda. (Los puertos 3000,
5173 y 6878 se dejan libres para la instancia de siempre.)

**3. Mirar los resultados sin ver las credenciales:**
- La tarjeta de Ajustes → IPTV: host, número de canales y la línea «Guía: N canales con programación».
- Buscar y Canales: los canales de tu IPTV salen con el distintivo «IPTV».
- El ensayo, con la agenda de hoy y de mañana (qué IPTV saldría en cada partido, sin URLs y sin abrir ningún stream):

  ```powershell
  cd "C:\Users\Isma\Desktop\Actualización aceplayer\umbrel-app-store\ace-player-neo"
  $env:DATA_DIR = "$PWD\.data\pila-local"
  corepack pnpm@10.18.2 exec tsx apps/server/scripts/iptv-ensayo.ts --api "http://[::1]:3100"
  ```

- Los registros de la IPTV (solo host, id de canal y códigos): `Select-String -Path .data\pila-local\registro.jsonl -Pattern '"module":"iptv"'`.
  Para comprobar que tu usuario no aparece en ningún sitio sin sacarlo por pantalla, cuenta las veces (tiene que dar 0):
  `(Get-ChildItem .data\pila-local -Recurse -File | Select-String -SimpleMatch 'TU_USUARIO').Count`.
- El respaldo: con un canal IPTV sonando, corta la red y mira cómo pasa a AceStream con el aviso; al devolverla,
  «Volver a la IPTV» (la `127.0.0.N` es la que dijo el backend):

  ```powershell
  Invoke-RestMethod -Method Post "http://127.0.0.60:3002/__red/cortar"      # toda la red saliente
  Invoke-RestMethod -Method Post "http://127.0.0.60:3002/__red/restaurar"
  ```

  Con `?host=<host>` corta solo ese host (y sus subdominios): si el canal tiene otra variante en otro host, el relé
  sigue por ella sin dejar la IPTV.

**4. Eliminarla al acabar:** Ajustes → IPTV → la papelera → «¿Borrar?». Borra la configuración, el catálogo, la guía y
el `.bak`. Compruébalo con:

```powershell
Get-Content .data\pila-local\v2\iptv.json            # "provider": null
Get-ChildItem .data\pila-local\v2\iptv               # sin catalogo.enc ni guia.enc
Test-Path .data\pila-local\v2\iptv.json.bak          # False
```

Luego Ctrl+C en las dos terminales. Si quieres borrar también la clave local y los registros, borra la carpeta
`.data\pila-local` entera.

**Prueba con una lista pública de canales en abierto (26-sep, solo en local y eliminada al acabar).** Lo que salió y se
arregló, cada cosa con su prueba sobre datos inventados con la misma forma:
- **Dos líneas `#EXTM3U`** (la primera de firma y la guía en la segunda): se leía solo la primera y se perdía la guía.
  Ahora se suman (`m3u.ts`). Con la guía `.gz` de unos 600 KB: 1,5 s entre descarga y lectura, 925 programas útiles.
- **Audio de las televisiones públicas en la maestra HLS:** un grupo `#EXT-X-MEDIA TYPE=AUDIO` con el audio principal
  sin `URI` (muxeado) y el original y la audiodescripción aparte se tomaba como «todo aparte» → `iptv_unsupported`.
  Ahora un grupo con alguna rendición sin `URI` es audio muxeado (`hls.ts`).
- **ffmpeg y el relé se esperaban el uno al otro** con segmentos de 2 MB: ffmpeg pide el segmento siguiente antes de
  leer entero el actual y el relé los sirve de uno en uno, así que todo canal HLS con segmentos grandes acababa en
  `iptv_timeout` a los 20 s. `-http_multiple 0` en la entrada HLS del remux (`remux/args.ts`): primera imagen en 4 s.
- **«Canal GEO»** (solo desde España) salía como otro canal: «GEO» al final es una marca; con zona («GEO CAT») cuenta
  como reserva (`names.ts`).
- **URLs con macros sin sustituir** (`[IP]`, `[UA]`, `[CACHEBUSTER]`… de los servidores de anuncios): se usan tal
  cual, porque esos servidores responden igual (las 12 de la lista daban 200), pero van **detrás** de una variante sin
  macros del mismo canal (`catalog.ts`, `match.ts`). Un canal con solo esa URL sigue funcionando.
- **Agenda:** «La 1 TVE» no casaba con «La 1» de la IPTV, ni por nombre ni para la guía; «RTVE Play» casaba al 100 con
  un canal eventual «En Play (RTVE)»; y «TV Canaria» no casaba con «TV Canaria (RTVC)». Ahora la IPTV busca los canales
  de la agenda sin la cadena del final (TVE/RTVE), no empareja por nombre las plataformas de internet (Play, App,
  YouTube, PPV…) y no tiene en cuenta la nota entre paréntesis del final salvo que nombre una competición, un número o
  un deporte («LaLiga TV (Hypermotion)» sigue sin ser «LaLiga TV») (`names.ts`, `match.ts`, `layer.ts`).
- **El ensayo pedía la agenda a `/api/v1/football/schedule`** (404): la ruta es `/api/v1/football`, y `--api` acepta
  ya el backend a secas (`ensayo.ts`).
- **Buscar:** si tu biblioteca o tu IPTV tenían el canal y el motor no, salía debajo el vacío grande «Sin resultados
  para…». Ahora es una línea: «El motor AceStream no tiene nada más para «…».».
- La guía real no emparejó nada por error: resúmenes, fútbol sala, baloncesto, balonmano femenino, Liga F con un
  partido masculino y repeticiones sin marca quedan fuera; el partido de la Nations League en «La 1» y el Mundial
  Sub-20 femenino en Teledeporte sí salen (`guide-match.test.ts`, `match.test.ts`).

---

## 16. Anexo: todo desbloqueado y variantes de resolución (26-sep)

Lo pidió Isma el 26-sep: «mejor déjalo todo desbloqueado y también ten en cuenta que en las IPTV hay muchos canales que
se llaman igual pero tienen una resolución diferente o cosas así». **Implementado el mismo día en `rediseno/iptv`**
(contrato, servidor y web, con unitarias, integración y E2E). Este anexo **manda** sobre lo que digan §0.3, §3.4,
§4.2 a §4.4, §6.1, §8.1, §14.2, §14.3, §14.5, §14.7 y D9, D23 y D25.

### 16.1 En pocas palabras

1. **Todo desbloqueado.** El buscador (y el filtro de Canales) enseña **todos** los canales de tu IPTV: de cualquier
   país (con su país en una etiqueta, «DE») y también los grupos para adultos. No hay ningún filtro de país que
   esconda nada.
2. **El país es una preferencia, no un filtro** (D9). En el emparejado automático (partido o canal de AceStream → la
   IPTV que sale primero) entran todos los países; España y sin país son un canal y cada otro país es otro del mismo
   nombre; con la misma puntuación, el de España o sin país va antes. «DAZN 1» de España va antes que «DE: DAZN 1»;
   si solo existe el extranjero y casa por nombre, sale. El umbral 92 y la protección Hypermotion no cambian. La guía
   sigue exigiendo España (§4.5, regla 5).
3. **Variantes de un canal = un canal.** «DAZN 1 FHD», «DAZN 1 HD», «DAZN 1 SD», «DAZN 1 4K», «DAZN 1 (backup)», «ES:
   DAZN 1 1080p», «DAZN 1 HEVC», «DAZN 1 50fps», «|ES| DAZN 1», «DAZN 1 [ES]», «VIP | ES: DAZN 1 FHD»… dan la misma
   clave (§16.2). Nunca se juntan canales distintos: «DAZN 1» ≠ «DAZN 2» ≠ «DAZN F1», «LaLiga TV» ≠ «LaLiga TV
   Hypermotion», «M+ LaLiga» ≠ «M+ LaLiga 2».
4. **Buscador: una fila por canal**, con sus calidades en etiquetas pequeñas, de mayor a menor resolución («4K»
   «1080p» «720p» «SD»). Nunca una fila por variante.
5. **Panel de fuentes: un cartel IPTV por variante de resolución**, cada uno con su etiqueta de calidad: primero 1080p,
   luego 4K, 720p y SD, y las reservas y las URLs con macros al final. **4 carteles IPTV como mucho**; los demás,
   dentro del servidor como respaldo.
6. **Al abrir, arranca sola la mejor** (la primera). **Si una variante falla, pasa a la siguiente variante IPTV antes
   de saltar a AceStream.** Tocar un cartel de otra resolución cambia a esa variante con un toque.
7. **La calidad sale del nombre y, cuando se conoce por el stream** (la `RESOLUTION` de la maestra HLS que abre el
   relé, o la altura que da ffprobe en la sonda de fondo), **del stream real, que manda**.
8. **Una sola conexión con el proveedor**: cambiar de variante cierra la anterior antes de abrir la nueva (§6.5, sin
   cambios).

### 16.2 Grupos de variantes (`names.ts`, `catalog.ts`)

**Lo que se quita del nombre** (y cómo se lee), además de §4.2:

| Marca | Ejemplos | Qué da |
|---|---|---|
| País delante | `ES:` `ES \|` `\|ES\|` `[ES]` `(ES)` `ES -` `ES •` `ESPAÑA \|` | `country` (ES y sin país, el mismo canal) |
| España al final | `DAZN 1 [ES]` `DAZN 1 \|ES\|` `DAZN 1 (ESP)` | `country: 'ES'` |
| Lo que va delante del país sin serlo | `VIP \| ES: …` `FHD \| ES: …` | marca fuera; la calidad cuenta |
| Calidad | `FHD` `Full HD` `FullHD` `1080p` `1080i` `1080p50` · `UHD` `4K` `2160p` · `HD` `HD+` `720p` `720p60` · `SD` `480p` `576p` · superíndices `ᶠᴴᴰ` | `quality` |
| Códec y técnica | `HEVC` `H265` `H.265` (→ `hevc`) · `H264` `AVC` `HDR` `50FPS` `50 fps` `VIP` | fuera |
| Reserva | `backup` `(backup)` `[BK]` `bk2` `alt` `alternativo` `reserva` `respaldo` `multi` | `backup` |
| Copia del final | `(1)` `(2)` `[3]` | fuera; de la 2 en adelante, `backup` |
| Zona | `GEO` (fuera) · `GEO CAT` (`backup`) | como §4.2 |

- Un grupo del catálogo tiene su **clave** (`normalizeChannelKey(base)`) y, dentro, **un canal por país**
  (`Catalog.buckets(key)`): el de España o sin país (`bucket` `''`) primero y luego cada otro país. «DE: DAZN 1» no es
  una variante de «DAZN 1»: es otro canal del mismo nombre, con su fila en el buscador y sus carteles.
- **La copia del final solo es copia si hay con quién.** Un «Canal Sur (2)» sin ningún «Canal Sur» al lado es «Canal
  Sur 2»: el catálogo lo vuelve a indexar con el número al acabar la sincronización (`rekeyLoneMirrors`). Con
  «Canal Sur» al lado, es su reserva.
- Los números sueltos no se tocan nunca: «DAZN 1» y «DAZN 12», «M+ LaLiga» y «M+ LaLiga 2» son otros canales.
- El grupo «XXX \| ADULTOS», «VIP \| DEPORTES» o «PPV \| …» no declara país.

### 16.3 Carteles y respaldo (`match.ts`: `planVariants`, `relayVariants`)

**Orden de las variantes de un canal:** HEVC al final (la web no lo reproduce, D6); luego las reservas y las URLs con
macros; entre las demás, **1080p > 4K > 720p > SD > sin marca**; entre iguales, la fiabilidad aprendida y el orden del
catálogo. La calidad es la que manda (§16.5).

**Carteles:** se recorre ese orden y cada **resolución** nueva (o «sin marca») tiene su cartel, hasta 4:
- una reserva o una URL con macros solo tiene cartel si su resolución no lo tiene ya (así «DAZN LaLiga (Backup)», sin
  marca, sale al final como «reserva»; una «1080p (2)» con una 1080p al lado, no);
- una HEVC solo tiene cartel si el canal no tiene nada más;
- lo que no tiene cartel es **respaldo del relé**.

**Reparto entre canales (`layer.ts`, `allotPosters`):** 4 carteles IPTV en total por resolución. Los 2 primeros
canales «de verdad» (el de la guía y el del nombre, como antes) tienen uno asegurado; el gemelo de otro país de un
canal que ya está («DE: DAZN 1» con «DAZN 1») no cuenta y solo entra si sobra sitio; el resto se llena en orden, así el
primer canal enseña todas sus resoluciones. Lo que no cabe pasa a respaldo.

**Respaldo del relé:** al abrir un cartel, el relé lleva detrás las variantes sin cartel que le tocan: las copias de
su misma resolución (la no reserva primero) y, las que no tienen cartel de su resolución, detrás del último cartel; 2
como mucho. Las variantes **con** cartel no se prueban ahí: si la 1080p cae, la web pasa a la 4K (§16.6) y se ve.

**En la resolución** (`football/resolution.ts`): el tope `IPTV_MAX_CANDIDATES` pasa de 2 a **4**; entre dos IPTV
manda el orden de la capa IPTV (`sources/ranking.ts` ya no las reordena por fiabilidad: la fiabilidad desempata dentro
de la capa); el canal IPTV tocado (§14.4) trae **todos** sus carteles delante y en su orden
(`tappedCandidates`).

### 16.4 Contrato (`packages/shared`)

Todo opcional o de tope; ningún formato cambia y la 0.8.0 lo decodifica:
- `IPTV_MAX_CANDIDATES = 4` (antes 2) y `IPTV_MAX_MATCHED_CHANNELS = 2` (canales con sitio asegurado).
- `CandidateIptvInfo.country?: string | null`: país del canal si no es España («DE»).
- `IptvChannel.qualities?: IptvQuality[]` (todas las del canal, de mayor a menor resolución, 4 como mucho) y
  `IptvChannel.country?: string | null`.
- `IptvChannel.quality` y `CandidateIptvInfo.quality` son la calidad **que manda** (la del stream real si se conoce).
- Ejemplos: `fixtures/web/v1/iptvChannels.json` con `qualities` y `country`; `fixtures/variantes/footballResolve.iptv.json`
  con dos carteles de «DAZN LaLiga» (1080p y 720p). `v1/` y `events/` no cambian.

### 16.5 La calidad real manda

- **Maestra HLS:** al aplanarla, el relé avisa al servicio (`onMedia`) de la `RESOLUTION` de la variante que elige
  (§6.1); el servicio la apunta como la calidad de esa variante del catálogo (`noteQuality`, en memoria, 5000 como
  mucho; los ids ya llevan el proveedor dentro).
- **ffprobe:** la sonda de fondo (§7.3) pide también `height` (`FFPROBE_ARGS`) y el servicio la apunta igual. No va al
  veredicto.
- Altura → calidad: 1800 o más → 4K; 1000 o más (1080, 1440) → 1080p; 700 o más → 720p; menos → SD.
- Cambia el orden y los carteles: una «SD» que en realidad es 720 pasa a ser una copia de la 720p (sin cartel si la
  720p ya lo tiene), y las etiquetas del buscador lo dicen.

### 16.6 Web

- **Buscador** (`features/search/iptv.ts`, `ChannelRow`): la fila IPTV lleva «{Casa}» (+ « · también en AceStream»)
  y detrás las etiquetas `iptvTags` (el país si no es España y las calidades, de mayor a menor resolución), como las
  del cartel: pequeñas y siempre enteras; lo que se recorta es el subtítulo. Igual en el filtro de Canales.
- **Carteles** (`qualityTags`): el país delante si no es España, la calidad y «reserva». Una IPTV que el comprobador
  deja «en cola» (su carril no sondea el stream, §7.3) se lee «Sin comprobar · se prueba al reproducirla», como dice
  §8.3: con varios carteles IPTV, «Pendiente · en cola» parecía un atasco.
- **Si cae una variante IPTV** (`handleSourceFailed` → `pickNextIptvVariant`), antes del puente: la siguiente IPTV en
  el orden del servidor que no se haya probado, no esté «Sin señal» ni reportada y no haya caído en 60 s. No cuenta en
  el tope de saltos del puente (cada una se prueba una vez) y no saca el toast «Volver a la IPTV» (seguimos en tu
  IPTV). Con un fallo de cuenta (`iptv_busy`, `iptv_auth_failed`, `iptv_account_expired`) o la IPTV en pausa, no: vale
  para todas. Vale en automático, en manual y en canales sueltos con IPTV, como el puente.
- Cuando ya no queda variante, el puente de §7.2 como siempre; **«Volver a la IPTV» vuelve al primer cartel IPTV** (la
  mejor variante), no al último que cayó.
- **Tocar otro cartel** es `selectSource`: el servidor cierra la variante anterior antes de abrir la nueva (§6.5).

**Textos** (literales):

| Momento | Línea de estado |
|---|---|
| Cae una variante y hay otra con calidad distinta | «Tu IPTV no responde en {1080p}: probamos en {4K} (fuente {N})» |
| … sin calidades que decir | «Tu IPTV no responde: probamos otra señal de tu IPTV (fuente {N})» |
| … por conexión ocupada | no se prueban variantes (fallo de cuenta): el puente de §7.2 |

### 16.7 Proveedor falso (`apps/server/test/fake-iptv/provider.ts`)

- «DAZN 1» con 5 variantes, cada una con su stream: «ES: DAZN 1 FHD» (112), «ES: DAZN 1 HD» (113), «ES: DAZN 1 SD»
  (114), «ES: DAZN 1 4K» (115) y «ES: DAZN 1 (backup)» (116). Por HLS (la M3U), una maestra con su `RESOLUTION` de
  verdad (1920×1080, 1280×720, 720×576, 3840×2160 y 1920×1080); por TS, un caudal acorde (4000, 2500, 1500 y 800
  kbit/s).
- Otros países: «UK: DAZN 1» (109), «DE: DAZN 1 HD» (117, grupo «DE | SPORT») y «FR: Canal+ Sport» (118, «FR | SPORT»).
- El grupo «XXX» (111, «ES: Tele Noche HD») sigue ahí: ahora sale en el buscador.

### 16.8 Pruebas

- **Unitarias del servidor:** `names.test.ts` (35 nombres reales de variantes: calidad, reserva, país, HEVC; el orden
  1080p > 4K > 720p > SD; altura → calidad; grupos que no son país); `match.test.ts` (corpus de variantes que dan la
  misma clave y pares que nunca se juntan: «DAZN 1»/«DAZN 2»/«DAZN F1»/«DAZN 12», «LaLiga TV»/«LaLiga TV
  Hypermotion», «M+ LaLiga»/«M+ LaLiga 2», «La 1»/«La 2», «Antena 3»/«Antena 3 Internacional»…; países como
  preferencia; `planVariants` y `relayVariants`; la calidad real manda; «Canal Sur (2)» solo); `search.test.ts` (todo
  desbloqueado, una fila por canal, otro país otra fila); `service.test.ts` (filas con `qualities` y `country`, 4
  carteles 1080p, 4K, 720p y SD, la maestra HLS y ffprobe mandan); `football/iptv.test.ts` (tope 4 en el orden de la
  capa; el canal tocado trae todos sus carteles).
- **Integración** (`test/integration/iptv.test.ts`): caso 1 con los 4 carteles (guía + 1080p, 720p, reserva); **caso
  16**: «dazn 1» da una fila con «4K · 1080p · 720p · SD» y las de UK y DE; `footballResolve` del canal tocado y el
  emparejado por nombre dan los 4 carteles en orden; con la 1080p caída, abrirla da un `iptv_*` y el relé no pide
  ninguna otra variante; la 4K abre; tocar la 720p cierra la 4K (una conexión, una sesión); caso 11 con el grupo XXX.
- **Web:** `session.iptv.test.ts` (cae la 1080p → la 4K → la 720p → AceStream, con sus textos; «Volver a la IPTV» a
  la primera; tocar otro cartel; un fallo de cuenta no prueba variantes; el tope del puente sin contar las variantes);
  `SearchView.test.tsx` (una fila con 4 etiquetas; otro país con «DE»); `iptv.test.ts` (`iptvTags`).
- **E2E** (`e2e/iptv-buscador.spec.ts`, **caso 14**): «dazn 1» da una fila con «4K» «1080p» «720p» «SD» (y la de
  Alemania con «DE»); tocarla arranca la 1080p con 4 carteles IPTV en orden; `modo(112,'down')` → «Tu IPTV no responde
  en 1080p: probamos en 4K (fuente 2)», suena la 4K y el motor AceStream no abre nada; tocar la 720p cambia y queda una
  conexión. El caso 8 enseña también el canal del grupo XXX; `iptv.spec.ts` espera 4 carteles IPTV en el partido.
  Capturas del buscador y del panel con `IPTV_CAPTURAS=<carpeta>` (no en la CI).

### 16.9 Impacto en la app nativa (actualiza §10 y §14.10)

La app **calcará** esto cuando haga su panel de fuentes y su buscador (fase 3). Nadie de `rediseno/iptv` toca
`apps/ios`.

**Sin cambiar nada, incluida la 0.8.0 publicada:**
- Recibe hasta 4 candidatas IPTV (antes 2) en cabeza de `candidates`, todas con `source: 'iptv'`: las decodifica y las
  enseña como fuentes («Fuente» sin distintivo, §10). `iptv.country` es una clave que no conoce: la ignora.
- Si cae una variante, su regla de siempre salta a la siguiente fuente, que suele ser la siguiente variante IPTV (van
  seguidas en el orden del servidor).
- `iptvChannels` sigue siendo `access: 'web'` (D27): no le llega.

**Cambios cuando exista la pantalla** (los ficheros con * no existen aún en `rediseno/nativa`):

| Módulo | Fichero o carpeta | Cambio |
|---|---|---|
| M1 | `Sources/Core/Models/Futbol.swift` | `country: String?` en `CandidateIptvInfo` |
| M1 | `Sources/Core/Models/Buscar.swift`* | `qualities: [CalidadIptv]?` y `country: String?` en `CanalIptv` (tolerantes) |
| M3 | `Sources/Core/Reglas/Fuentes/ReglasFuentes.swift` | `pickNextIptvVariant` (siguiente cartel IPTV antes del puente, sin contar en el tope; no con fallo de cuenta ni en pausa); «Volver a la IPTV» al primer cartel IPTV; etiquetas del cartel con el país; vectores regenerados desde `scripts/vectores/fuentes.ts` |
| M3 | `Sources/Core/Reglas/Avisos/LineaEstado.swift` | los dos textos de §16.6 (regenerados en `textos-web.json`) |
| M6 | `Sources/Pantallas/Partido/` | un cartel por variante con su etiqueta de calidad (y país), 4 IPTV como mucho, en el orden del servidor; tocar uno cambia de variante |
| M6 | `Sources/Pantallas/Buscar/`* y `Sources/Pantallas/Canales/`* | una fila por canal con las etiquetas `iptvTags` (país y calidades de mayor a menor resolución) y «{Casa}» de subtítulo; sin filtro de país ni de adultos |
| M2 | `Sources/Debug/ServidorDemo.swift` | `qualities` en `iptvChannels` si la demo de la app copia la de la web |

### 16.10 Riesgos

1. **Más carteles IPTV:** hasta 4 en vez de 2. Todos del mismo proveedor y con una sola conexión: cambiar de uno a
   otro cierra antes el anterior; un panel que tarde en soltar la plaza se cubre con los reintentos 2-4-8 s de §6.5.
2. **Nombres que parecen variantes y no lo son:** «(2)» se toma como copia si hay otra variante al lado; un canal que
   se llame de verdad «X (2)» junto a un «X» se leería como su reserva (sale al final, como «reserva»). Los números
   sueltos nunca se tocan.
3. **Canales extranjeros en el emparejado:** con la misma puntuación va antes el de España, pero un canal que solo
   exista fuera y case por nombre (≥ 92) sale, con su país en el cartel. Si no es el que se quiere, «Reportar → Canal
   incorrecto» lo aparta para ese canal.
4. **Todo desbloqueado en el buscador:** con catálogos de decenas de miles de canales repetidos por país, una búsqueda
   corta da muchas filas; siguen los topes de §14.7 (50 por respuesta, 5 a la vista) y el orden pone primero lo de
   España o sin país.

## 18. Anexo: buscador y emparejado con la lista real de Isma (26-sep)

Isma metió su lista de verdad (Xtream, 27 687 canales) en su pila local y vio que «movistar laliga», «m+ laliga» y
«movistar liga de campeones» daban 0, que «laliga» no ponía arriba los M. LALIGA, que «tdt» daba 0 y que «futbol» solo
traía «M. FUTBOL». En el Umbrel, además, «La 1» salía dos veces y el cartel de «La 1 TVE 720p» enseñaba «720» de
dorsal. Este anexo lo arregla con una sola normalización para el buscador y el emparejado, medida con un banco de 149
consultas y el ensayo contra la agenda real. **Implementado** en `iptv-busqueda` (sobre `rediseno/iptv`).

### 18.1 En pocas palabras

1. **Una grafía única** (`channelSpelling`, `@ace/shared`): «M.», «M .», «M.» pegado, «M+», «MOVISTAR+», «MOVISTAR
   PLUS+», «MOVIESTAR» → Movistar; «LA LIGA» = «LALIGA»; «LALIGA+» es otra marca; «LA SEXTA» = «LASEXTA», «TELE CINCO»
   = «TELECINCO» y demás compuestos; «SUPER CUPA» → Supercopa; «R. MADRID» → Real Madrid. La usan el buscador y el
   emparejado; la web y la app la portan tal cual.
2. **El buscador encuentra aunque la lista use abreviaturas, prefijos o puntos**, busca también por **categoría** (con
   sinónimos) y **ordena por parecido**: igual, misma familia, empieza por, mismo orden, cualquier orden, sin Movistar y
   por categoría.
3. **El emparejado automático sigue estricto** (umbral 92, Hypermotion ≤ 58, los números): solo gana las grafías
   seguras de arriba, la lista limpia (cabeceras fuera, país bien leído, Tivify visible) y protecciones nuevas
   (plataformas, «DAZN» a secas, marca de cadena en la regla del « 1»). Las erratas y los alias «humanos» (Champions,
   Barça…) **no** entran aquí.
4. **El nombre de una lista de AceStream se limpia antes de buscarlo en la IPTV**: «La 1 TVE 720p \*» y «LA 1 4K -->
   NEW ERA» son «La 1». Así la biblioteca se enlaza con su IPTV (una fila, no dos) y al tocarla va la IPTV primero.
5. **Carteles:** la etiqueta de tipo de las listas dice «AceStream» (no «M3U»); el dorsal se salta la resolución y el
   códec («La 1 TVE 720p» → «1»); el nombre de debajo no repite la calidad que ya va en su etiqueta.
6. **Remux:** la lista `index.m3u8` que aún no está (arranca o se reinicia) responde 503 con `Retry-After: 1` y hls.js
   la reintenta; ya no hay 500 por un ENOENT.

### 18.2 Limpieza de nombres (`names.ts`, `channel-names.ts`)

| Qué | Antes | Ahora |
|---|---|---|
| Cabeceras «##### … #####», «==== … ====», «XX - NO MATCH», «NO EVENT» | canales (salían en el buscador y casaban: «##### FANSEAT #####», «###### DE - APPLE TV ######») | fuera del catálogo (`filler`) |
| Filas de evento «ESPN PLUS 12 : … 3:00 PM ET / 8:00 PM UK» | un canal más | `event`: al final del orden |
| «ES TI - TELEMADRID HD» | país «ES», nombre «TI - TELEMADRID» | país ES; «TI» es la plataforma |
| «ES-M.LALIGA 4 HD» | clave `m laliga 4` | `movistar laliga 4` |
| Categoría «EU \| ES \| TDT ESPAÑA VIP» (con NBSP a veces) | país EU | país ES (el primer tramo es el continente); «VIP \| …» sin país; «AR \| …» es árabe |
| «BEIN SPORTS Ñ FHD» | clave `bein sports n` | «BEIN SPORTS», país ES |
| «LASEXTA ᴿᴬᵂ», «MOVISTAR DEPORTES ᵛᶦᵖ» | ᴿᴬᵂ y ᵛᶦᵖ en la clave | ᴿᴬᵂ = reserva del mismo canal; los demás superíndices, adorno; «⁴ᴷ» = 4K |
| «LA 1 4K/UHD» | «LA 1 /» | «LA 1» (4K) |
| «[ PREMIERELEAGUE ]», «(SOLO EVENTOS)», «(not 24/7)», «[ LIVE EVENT ]» | parte del nombre | nota: fuera |
| «M. LALIGA HD (BK-1)», «BK-2» | «M. LALIGA ( -1)», clave `m laliga 1`: **se juntaba con M. LALIGA 1** | reserva de «M. LALIGA» |
| «#VAMOS», «M. ELLAS #V» | «#» en el nombre | sin «#» |
| Plataformas (VIX, Pluto TV, Rakuten TV, GOLD TV 24/7…, por el nombre o la categoría) | canales normales | `platform`: no se emparejan por nombre y van detrás en el buscador |

La grafía única (`channelSpelling`) es segura para el emparejado: dos nombres que dan lo mismo son el mismo canal.
«M6», «M95», «MTV» y «M LALIGA» (sin punto) no se tocan en la lista. En el **buscador**, además, «m laliga» y «mov
laliga» son Movistar (`iptvSearchSpelling`), y la consulta **no** pasa por los alias curados del emparejado
(`IPTV_CHANNEL_ALIASES`), que añadían «tv» y daban 0.

### 18.3 Buscador (`search.ts`)

**Qué casa:**
1. **Por el nombre:** cada palabra de la consulta es el principio de una palabra de la clave, en cualquier orden. «tv»,
   «canal», «canales», «channel» y «channels» no hace falta encontrarlas. Un número casa **entero** («la 1» ya no trae
   «LALIGA+ PPV 10»). Por dentro de una palabra, solo en compuestos conocidos («liga» en «laliga», «sexta» en
   «lasexta»…) o con 5 letras o más («nba» ya no casa con «dazn baloncesto»). La consulta pegada vale desde el principio
   de una palabra («antena3», «la1»).
2. **Sin Movistar:** «movistar vamos» y «m+ vamos» encuentran «#VAMOS» (las listas no siempre escriben la marca).
3. **Por la categoría:** las palabras del tema (sin continente ni país) con sinónimos en su forma única
   (`IPTV_CATEGORY_SYNONYMS`: futbol = football = soccer; deportes = sports; infantil = niños = kids; cine =
   películas = movies; documental; tenis = tennis; noticias = news; ciclismo; baloncesto = basket; música; series;
   entretenimiento = general). «tdt» trae los canales de «EU | ES | TDT ESPAÑA VIP»; «futbol», los de «TV FOOTBALL
   PPV» detrás de «M. FUTBOL».

**Orden por parecido:** nivel (0 igual; 1 misma familia: sin el número del final o sin la marca de delante, «laliga» →
«DAZN LaLiga» y «M. LALIGA 3»; 2 empieza por la consulta; 3 las palabras en orden; 4 en cualquier orden o por dentro; 5
sin Movistar; 6 por la categoría). Dentro de cada nivel: España o sin país → América en español → el resto; el canal
principal antes que bar, PPV, replay, resúmenes, reservas ᴿᴬᵂ, plataformas y eventos; la familia junta y en orden
numérico («M. LALIGA 1, 2, 3…»); la clave más corta (en la categoría, el orden del catálogo); el orden del catálogo.

**Contrato:** no cambia (`iptvChannels` devuelve lo mismo). La píldora «Categoría: TDT España (75)» y el «Quizás
quisiste decir…» son del buscador «como Google» (otro trabajo).

### 18.4 Emparejado automático (`match.ts`, `names.ts`, `sources/ranking.ts`)

- **Gana** (seguro): la grafía única; «TVG» = «TV Galicia» (alias curado; «TVG 2» sigue siendo otro); la limpieza de
  §18.2 (Tivify visible: IB3, La 7, TVG; «BEIN SPORTS Ñ»; «LASEXTA ᴿᴬᵂ» dentro de «LA SEXTA»); las mismas letras juntas
  o separadas son el mismo canal («laSexta» = «LA SEXTA»).
- **Protecciones nuevas:**
  - una **plataforma** de la lista (VIX, Pluto TV, Rakuten TV…) no casa por nombre: «M+ LaLiga TV» ya no es «LA LIGA 1»
    de Rakuten;
  - la regla del « 1» final exige la **misma marca de cadena** (Movistar o DAZN) si el canal pedido la lleva;
  - **«DAZN» a secas** (la marca paraguas) no casa con nada, ni con un canal que la lista llame «DAZN»;
  - **plataformas de la agenda** que nunca casan por nombre: Disney+, Prime Video, Apple TV, Netflix, HBO Max,
    SkyShowtime, Filmin, Atresplayer, Mitele, FANSEAT, FANPLAY, Peacock, ViX, Pluto TV, Rakuten y «…Play» pegado
    (Movistar Plus+ **sí** es un canal).
- **Canal suelto de AceStream (`scope=channel`, biblioteca, `sameChannel`):** el título se limpia con
  `aceChannelTitle` (sin « --> LISTA», asteriscos, calidad, códec ni fotogramas en cualquier sitio, y sin
  «TVE»/«RTVE» detrás de La 1, La 2, Clan, 24h o Teledeporte). En la resolución, una IPTV **nunca es «lo genérico»**:
  «La 1» de la IPTV ya no va detrás de «La 1 TVE 720p \*» de la lista.
- **Sin cambiar:** umbral 92, Hypermotion ≤ 58, «DAZN 1» ≠ «DAZN 2» ≠ «DAZN F1», Liga de Campeones ≠ LaLiga, LALIGA+ PPV
  y REPLAY nunca son LaLiga TV. **Pendiente de Isma:** «LaLiga TV M2…M5» (Primera Federación) ↔ «M. LALIGA 2…5» no se
  empareja hasta que lo confirme.

### 18.5 Carteles de fuente (web)

- **Etiqueta de tipo:** las fuentes de las listas dicen «AceStream» (antes «M3U», que confundía: la IPTV también sale
  de una lista M3U); las de la IPTV, «IPTV». «Guardada», «Favorito» y «Reciente» no cambian.
- **Dorsal** (`channelDorsal`, `ChannelMark.tsx`): se salta 240/360/480/540/576/720/1080/1440/2160/4320 (con «p», «i»
  o los fps pegados), 4K, 8K, «50 fps», H264/H265/x265/HEVC/AVC/HDR: «La 1 TVE 720p» → «1», «DAZN 2 1080p50 H265» → «2»,
  «Eurosport 4K» → «E». Funciones de `@ace/shared`: `stripQualityMarks` e `isQualityNumber`.
- **Nombre de debajo** (`posterNameOf`): sin los asteriscos de copia y, si la calidad ya sale en su etiqueta, sin la
  marca de calidad: «La 1 TVE 720p» → «La 1 TVE». Sin etiqueta de calidad (AceStream sin medir), se queda.

### 18.6 La lista del remux que aún no está

El registro de la pila de Isma tenía `ENOENT … open '/data/remux/<hash>/index.m3u8'` respondido como 500 «error
interno»: `sendFile` medía el fichero con `stat` y lo abría después; si entre medias el remux se reiniciaba (borra y
rehace la carpeta), el stream fallaba al abrir. Ahora:
- `sendFile` abre primero y lee de ese descriptor (sin carrera);
- la **lista** de una sesión viva que aún no está responde **503 con `Retry-After: 1`** y `no-store` (web y
  `/remux/`); un segmento que falta sigue siendo 404; la app nativa (con `?t=`) recibe su 404 de siempre, ahora con
  `Retry-After`;
- el relé IPTV, sin lista todavía, también responde 503 con `Retry-After`;
- hls.js reintenta la lista maestra y la de nivel 4 veces (0,5 s, hasta 2 s: `HLS_PLAYLIST_RETRY`) sin avisar.

### 18.7 Medidas con la lista real

Servidor de la rama arrancado en otro puerto, sin red, contra una **copia** de los datos de la pila (misma semilla);
«antes» = `origin/rediseno/iptv` (9e8a99e, ya con «todo desbloqueado»), «después» = esta rama. Solo nombres; ni
URLs, ni credenciales, ni ids de stream; ningún canal reproducido.

**Banco (149 consultas, 124 con lo esperado en el top 10):**

| | Antes | Después |
|---|---|---|
| Aciertos en el top 10 | 80 | **102** |
| Empeoran | — | **0** |
| Consultas con 0 resultados | 38 | 31 |
| Mediana / máximo por HTTP | 5,3 / 199 ms | 6,4 / 53 ms |

Mejoran 22: movistar laliga, m+ laliga, mov laliga, movistar plus laliga, movistar la liga, m+ laliga tv, laliga, la
liga, movistar liga de campeones, m+ liga de campeones, m+ liga de campeone, movistar deportes, m+ deportes, movistar
futbol, m+ vamos, movistar vamos, movistar golf, m+ supercopa, tdt, canales tdt, barca tv e infantil. Siguen mal las
erratas y los alias (dasn, telecinko, champions, ucl, tele 5, t5, la 6, tdp, rmtv, segunda division, 1 rfef…) y los
partidos: son del buscador «como Google».

**Ensayo (agenda real de hoy y mañana, 273 partidos):** antes 45 con IPTV, pero 21 eran cabeceras («##### FANSEAT
#####» ×7, «###### DE - APPLE TV ######» ×14) → **24 de verdad**; después **27**, todos de verdad: los 24 de antes y
Lugo – Racing Ferrol (TVG → TV GALICIA), Poblense – Valencia-Mestalla (IB3) y Mansillés – Mirandés B (La 7). Del 28-sep
al 5-oct, el falso positivo «Disney+» → «DISNEY CHANNEL» desaparece.

**«La 1» (8.3 del banco):** `resolve?channel=La 1 TVE 720p *&scope=channel` daba `not_found`; ahora `found` con la IPTV
«La 1» (y primera). `iptvChannels?q=la 1` enlaza la biblioteca con la fila «LA 1» (`library` 0 → 1): una fila, no dos.

### 18.8 Impacto en la app nativa (actualiza §10, §14.10 y §16.9)

Nadie de `rediseno/iptv` toca `apps/ios`. **Sin cambiar nada** (incluida la 0.8.0): el servidor ya empareja mejor y la
lista del remux responde 503 en web; la ruta nativa (`?t=`) sigue con su 404, ahora con `Retry-After`.

**Cuando exista la pantalla**, la app porta:

| Módulo | Fichero o carpeta | Cambio |
|---|---|---|
| M3 | `Sources/Core/Reglas/Nombres/GrafiaCanal.swift`* | `channelSpelling`, `stripQualityMarks` e `isQualityNumber` de `packages/shared/src/domain/channel-names.ts`, con vectores generados desde sus pruebas (`lista-real.test.ts`, «channelSpelling») |
| M3 | `Sources/Core/Reglas/Fuentes/ReglasFuentes.swift` | etiqueta de tipo «AceStream» para las fuentes de listas (antes «M3U»); nombre del cartel sin la calidad si ya va en la etiqueta |
| M6 | `Sources/UI/Dorsal.swift`* (o donde viva el dorsal) | el dorsal se salta la resolución y el códec («La 1 TVE 720p» → «1») |
| M6 | `Sources/Pantallas/Buscar/`* y `Canales/`* | el filtro local con `channelSpelling` («m+ laliga» encuentra «M. LALIGA» en la biblioteca) |

### 18.9 Pruebas

- **Servidor:** `lista-real.test.ts` (nuevo, 90+ casos con una lista **sintética** de la misma forma que la real:
  limpieza, país, cabeceras, eventos, plataformas, lado AceStream, buscador —familia M. LALIGA en orden con 9 formas de
  escribirlo, categoría, números enteros, compuestos, pegados, orden por país y penalizaciones— y emparejado —lo que
  casa y lo que no: Rakuten, Liga de Campeones frente a LaLiga, Hypermotion, DAZN 1/2/F1, PPV y replay, «DAZN» a secas,
  Disney+, Apple TV, FANSEAT); `search.test.ts` (orden por país dentro de la familia); `remux/routes.test.ts` (503 con
  Retry-After en la lista, 404 en el segmento, 404 con Retry-After en la nativa); `sources/ranking.test.ts` (la IPTV no
  es «lo genérico»).
- **Web:** `ChannelMark.test.tsx` (13 casos de dorsal), `SourcePoster.test.ts` (nombre sin calidad), etiqueta
  «AceStream» en `model.test.ts`, `SourcesPanel.test.tsx` y `e2e/fuentes-demo.spec.ts`; `engines.test.ts`
  (reintentos de la lista).

### 18.10 Riesgos

1. **Cabeceras fuera del catálogo:** el recuento de canales baja (27 685 → 26 051 en la lista de Isma). Una fila que
   empiece y acabe con 3 o más «#», «=», «-», «\*», «~», «_» o «★» se toma como cabecera.
2. **Categorías amplias:** «cine» o «series» traen categorías enteras detrás de lo que casa por nombre; siguen los topes
   de §14.7.
3. **Plataformas:** un canal de VIX o Pluto TV ya no se empareja por nombre con la agenda; sí se busca y se reproduce.
4. **«LaLiga 1» pedido por la agenda** sigue casando con «M. LALIGA 1» (Movistar es relleno en `channelMatchScore`,
   matriz 0.6.59 congelada); al revés ya no («M+ LaLiga TV» no es «LA LIGA 1» de Rakuten).
