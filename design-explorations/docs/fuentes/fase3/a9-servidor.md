# A9 · Servidor 0.8.1: el iPhone emparejado administra como la web

Fase 3 (app de iPhone = web móvil calcada, nativa). Este documento es SOLO el
plan: no se ha tocado ningún fichero del repositorio. Todo lo que sigue sale de
leer el código de la rama `rediseno/palco` (HEAD `455264f`) el 25-sep-2026;
las líneas citadas son las de ese HEAD.

Rutas base usadas abajo:

- `MONO` = `umbrel-app-store/ace-player-neo`
- `APP` = `umbrel-app-store/ismaeloul-ace-player-neo` (carpeta de la tienda)

---

## 0. Resumen de la decisión

| Ruta (id) | Hoy (`access`) | 0.8.1 | Quién la usa en la web | Por qué |
|---|---|---|---|---|
| `health` · `GET /api/v1/health` | `web` | **`any`** (bearer) | Ajustes › Salud (`HealthSection.tsx:151`) | Salud calcada en la app |
| `healthLive` · `GET /api/v1/health/live` | `web` | **se queda `web`** (ver §6.1) | nadie en la web; el healthcheck de Docker | la app usa `ping`; así queda una ruta que ejercita la rama `web` |
| `settingsUpdate` · `PUT /api/v1/settings` | `web` | **`any`** (bearer) | Ajustes › Reproducción › «Un solo dispositivo a la vez» (`SettingsView.tsx:235-289`) | el interruptor calcado |
| `pairingCreate` · `POST /api/v1/pairing` | `web` | **`any`** (bearer) + cuerpo con `alternateBaseUrls` | Ajustes › Dispositivos › «Emparejar un dispositivo» (`usePairing.ts:113`) | emparejar otro iPhone con el QR que enseña este |
| `devicesList` · `GET /api/v1/devices` | `web` | **`any`** (bearer) | Dispositivos (`DevicesSection.tsx:158`) y Salud (nombres del registro, `HealthSection.tsx:160`) | lista calcada |
| `deviceRevoke` · `DELETE /api/v1/devices/:id` | `web` | **`any`** (bearer) | Dispositivos (`DevicesSection.tsx:177`) | revocar calcado, también a sí mismo |
| evento SSE `devices.changed` | solo origen web (`WEB_ONLY_EVENT_TYPES`) | **a todos** | `sse.ts:149` (invalida la lista), `usePairing.ts` (detecta el canje) | la lista y el «¡emparejado!» en vivo en la app |

Lo que NO cambia (y por qué, §4.7-4.8): `app.ts`, `core/origin.ts`,
`core/csrf.ts`, `nginx.conf`, `PROXY_AUTH_WHITELIST` (`"/native/*"` ya cubre
`/native/api/v1/devices`, etc.), el formato de `v2/devices.json` y el de
`v2/settings.json`. Sin cambios de disco ⇒ volver a la 0.8.0 es seguro.

Tamaño: ~5 líneas de datos en `routes.ts`, ~25 de código en `auth`, 1 en
`events.ts`, más tests y documentos.

---

## 1. Cómo funciona hoy (leído, no supuesto)

### 1.1 La tabla de rutas (`MONO/packages/shared/src/routes.ts`)

- Cada ruta v1 es un `defineRoute({...})` (línea 161) con `access` y
  `credential`. Comentario de cabecera, líneas 12-23:
  - `access: 'web'` → desde /native, 403 `origin_forbidden`.
  - `access: 'native'` → solo la app (hoy solo `video`).
  - `access: 'any'` → los dos; desde /native hace falta credencial salvo
    `credential: 'none'`.
  - `credential`: `bearer` | `video-token` | `none` (solo `ping` y
    `pairingClaim`, `NATIVE_PUBLIC_ROUTE_IDS`, línea 896).
- Rutas `web` hoy (grep de `access: 'web'`): `health` (240, `access` en 243),
  `healthLive` (254/257), `settingsUpdate` (422/425), `pairingCreate`
  (439/442), `devicesList` (470/473), `deviceRevoke` (484/487). Todas llevan
  ya `credential: 'bearer'`, así que al pasar a `any` exigen token sin tocar
  nada más.

### 1.2 Dónde se aplica (`MONO/apps/server/src/app.ts`)

- `onRequest` (187-227): resuelve el origen (`resolveOrigin`,
  `core/origin.ts:165-171`: todo lo que empieza por `/native` es SIEMPRE
  `native`). Con origen `native` (196-211): solo `/api/v1` (si no, 403
  `origin_forbidden`); `credential` de la ruta (o `bearer` si la ruta no
  existe, 200) y para `bearer` exige `Authorization: Bearer` (202-203) y llama
  a `services.auth.authenticateBearer(token)` (204), que deja
  `request.aceDevice = { deviceId, device, via: 'bearer' }`. El anti-CSRF
  (213-216) solo se aplica al origen `web`.
- `registerV1` (283-320): en el manejador comprueba `access` (288-292: `web` con
  origen ≠ `web` → 403 `origin_forbidden`) y después valida params/query/cuerpo
  con zod; registra cada ruta dos veces: `route.path` y
  `nativePath(route.path)` (316-318).
- `requestContext` (119-134) pasa `ctx.device` (= `request.aceDevice`) a los
  manejadores: **el manejador ya sabe qué dispositivo llama**.

Conclusión: pasar una ruta de `web` a `any` en la tabla es suficiente para que
el iPhone la use con su Bearer. `app.ts` no cambia.

### 1.3 La pasarela y nginx

- `MONO/deploy/umbrel/docker-compose.yml:12-21`: `PROXY_AUTH_WHITELIST:
  "/native/*"` en `app_proxy`. Cubre cualquier ruta bajo `/native/`, con
  cualquier método (el iPhone de la 0.8.0 ya usa `PUT /native/api/v1/preferences`
  y `DELETE /native/api/v1/directories/:id`: `apps/ios/Sources/Core/Networking/Rutas.swift:97,111`).
  **No cambia.**
- `MONO/deploy/umbrel/nginx.conf:83-99`: `location /native/` → Node quitando
  el prefijo, `X-Ace-Origin native` fijo, `Host $http_host`. No pone
  `X-Forwarded-Host/Proto`. **No cambia.**

### 1.4 Los módulos implicados

- `auth` (`MONO/apps/server/src/modules/auth/`):
  - `routes.ts:57-64` registra `pairingCreate` (con
    `baseUrlFromHeaders(ctx.request.headers)` como URL de reserva, 45-53),
    `pairingClaim`, `devicesList`, `deviceRevoke`.
  - `service.ts:221-249` `createPairing`: `baseUrl = body.baseUrl ??
    fallback`, valida con `BASE_URL_RE` (62), código de 6 dígitos, `pending`
    único (233: uno nuevo anula el anterior), `pairUri =
    aceneo://pair?u=<baseUrl>&c=<código>` (234), QR SVG nivel M (235-239).
  - `service.ts:251-299` `claimPairing`: límite global (171-178), comparación
    en tiempo constante, consume el código antes de cualquier `await` (272),
    guarda el dispositivo y emite `devices.changed {reason:'paired'}` (291).
  - `service.ts:351-353` `listDevices`: todos, también revocados, con
    `publicDevice` (sin `secretSha256`, 108-117).
  - `service.ts:355-372` `revokeDevice`: 404 `device_not_found` si no existe;
    marca `revokedAt`, idempotente, emite `devices.changed {reason:'revoked'}`
    solo la primera vez.
- `events` (`modules/events/hub.ts`): `matches()` (132-138) descarta para
  origen ≠ web los eventos de `WEB_ONLY_EVENT_TYPES`
  (`packages/shared/src/events.ts:255-257`, hoy `['devices.changed']`);
  `forward()` (249-263) publica y DESPUÉS, si es `revoked`, cierra las
  conexiones de ese dispositivo (`closeDevice`, 240-245).
- `playback/service.ts:1202-1204`: `devices.changed` `revoked` → suelta los
  visores de ese dispositivo (y el motor para si nadie más mira).
- `state/service.ts:436-448` `updateSettings`: no mira el origen; guarda y
  emite `state.changed {scopes:['settings']}`.
- `health` (`modules/health/routes.ts:24-28`): `health()` sale de cachés; la
  respuesta (`packages/shared/src/api/v1/system.ts:63-114`) no lleva secretos
  (versión, estados, contadores, nombre del modelo de IA, etiqueta de la copia
  de la que se recuperó el estado, avisos en texto). Nada que un dispositivo de
  casa no deba ver (ya ve `engineStatus`, `diagnosticsList`, `playbackStatus`).

### 1.5 Qué llama cada sección de Ajustes de la web (inventario)

Grep de `useApiQuery|useApiMutation|api(` en `MONO/apps/web/src`:

| Sección | Rutas | Acceso hoy |
|---|---|---|
| Salud | `health`, `diagnosticsList`, `devicesList` (solo si el registro tiene `deviceId`), `engineStatus`, `engineRestart` | `web`, `any`, `web`, `any`, `any` |
| Dispositivos | `devicesList`, `pairingCreate`, `deviceRevoke` + SSE `devices.changed` | `web` ×3, evento solo web |
| Reproducción («Un solo dispositivo a la vez») | `settingsGet`, `settingsUpdate` | `any`, `web` |
| Motor | `engineStatus`, `engineRestart` | `any` |
| Dónde se está reproduciendo | `playbackStatus` + SSE `playback.sessions` | `any` |
| Preferencias, Canales/Listas | `preferences*`, `directories*`, `library*` | `any` |

`healthLive` no lo llama la web (solo aparece su plazo en `api/client.ts:71`);
lo llaman el healthcheck de Docker (`docker-compose.yml:130`, sin nginx ⇒
origen web), `scripts/smoke-bundle.mjs` y `scripts/test-compose-local.mjs:450`
(con cookie). **Resultado: además de las 5 rutas, hay que abrir el evento
`devices.changed`; nada más.**

---

## 2. Cambios exactos por fichero

### 2.1 `MONO/packages/shared/src/routes.ts`

1. Cabecera, líneas 12-17: añadir tras la 17:

   ```
     Desde la 0.8.1 el iPhone emparejado administra como la web (Salud,
     Dispositivos, emparejar otro y ajustes v2): solo `healthLive` sigue
     siendo `web` (es el healthcheck de Docker; la app usa `ping`).
   ```

2. `health` (240-253): línea 243 `access: 'web'` → `access: 'any'`.
3. `healthLive` (254-267): sin cambios (§6.1).
4. `settingsUpdate` (422-436): línea 425 `access: 'web'` → `access: 'any'`.
5. `pairingCreate` (439-453):
   - 442 `access: 'web'` → `access: 'any'`;
   - añadir `description` (tras 445):
     `'Desde la web (su dirección en baseUrl) o desde un iPhone emparejado (baseUrl = la dirección que usa ahora; alternateBaseUrls = la otra, casa o Tailscale). El QR lleva una u= por dirección, en ese orden. Si lo crea un iPhone y luego se revoca, su código muere.'`;
   - 451 `errors: []` → `errors: ['bad_request']` (hoy ya puede salir:
     `service.ts:223-225` lanza `bad_request` si la URL pasa el regex de zod
     pero no `BASE_URL_RE`, p. ej. con un espacio; con varias URL es más fácil
     que pase. Solo cambia `x-errors` del OpenAPI).
6. `devicesList` (470-483): línea 473 `access: 'web'` → `access: 'any'`.
7. `deviceRevoke` (484-498):
   - 487 `access: 'web'` → `access: 'any'`;
   - añadir `description`:
     `'Web o cualquier iPhone emparejado; también el propio (entonces responde 200 y todo lo suyo deja de valer al instante: su SSE recibe devices.changed revoked y se cierra).'`.

### 2.2 `MONO/packages/shared/src/api/v1/auth.ts`

- Líneas 1-2 (comentario): «La web no usa tokens: la protege el login de
  Umbrel. Desde la 0.8.1 un iPhone emparejado también crea códigos, lista y
  revoca (con su Bearer).»
- Líneas 19-31, sustituir por:

  ```ts
  /** Origen http(s) sin ruta (lo que va en cada `u=` del QR). */
  const PairingBaseUrlSchema = z
    .string()
    .max(512)
    .regex(/^https?:\/\/[^/?#]+$/i, 'origen http(s) sin ruta');

  /** POST /api/v1/pairing (web o iPhone emparejado). */
  export const PairingCreateBodySchema = z.strictObject({
    /**
     * Dirección base que irá la primera en el QR: `location.origin` en la web;
     * en el iPhone, la dirección que está usando ahora. Si falta, el servidor
     * la deduce de las cabeceras.
     */
    baseUrl: PairingBaseUrlSchema.optional(),
    /**
     * Otras direcciones del MISMO servidor (0.8.1): el iPhone manda la que no
     * está usando (Tailscale o la de casa). Van detrás en el QR, en el mismo
     * orden y sin repetidas. Como mucho 2.
     */
    alternateBaseUrls: z.array(PairingBaseUrlSchema).max(2).optional(),
  });
  ```

- Línea 38 (doc de `pairUri`): «`aceneo://pair?u=<URL base>[&u=<otra>…]&c=<código>`:
  una `u` por dirección, la primera es `baseUrl`.»
- Línea 67 (doc de `DeviceRevokeResponseSchema`): quitar nada; añadir «Web o
  iPhone emparejado, también el propio.»

### 2.3 `MONO/packages/shared/src/api/v1/settings.ts`

- Líneas 1-2 (comentario): «Se leen y se cambian desde la web y desde la app
  iOS (0.8.1: «Un solo dispositivo a la vez» también en el iPhone).» Sin cambios
  de esquema.

### 2.4 `MONO/packages/shared/src/events.ts`

- Líneas 254-257, sustituir por:

  ```ts
  /**
   * Eventos que solo recibe el origen `web`. Vacío desde la 0.8.1:
   * `devices.changed` llega también a los iPhone (Ajustes › Dispositivos en la
   * app). El filtro se queda para eventos de administración futuros.
   */
  export const WEB_ONLY_EVENT_TYPES: ReadonlySet<SseEventType> = new Set<SseEventType>([]);
  ```

  (Alternativa más limpia pero menos mínima: borrar la constante y el campo
  `webOnly` del hub. No se recomienda ahora: toca `hub.ts` en 4 sitios y
  su test; el filtro vacío no cuesta nada.)

### 2.5 `MONO/apps/server/src/modules/auth/routes.ts`

- Líneas 8-11 (comentario): «pairingCreate: POST /api/v1/pairing (web o iPhone
  emparejado)», «devicesList … (web o iPhone)», «deviceRevoke … (web o iPhone,
  también el propio)».
- Líneas 39-44 (doc de `baseUrlFromHeaders`): cambiar «Solo la usa el origen web
  (la ruta es solo web), y el QR lo ve el mismo que lo pide.» por «Reserva
  cuando no llega `baseUrl`. Desde /native es el `Host` con el que el iPhone
  llegó (nginx lo reenvía tal cual); la app nueva manda siempre `baseUrl`.
  Cualquiera de las dos cabeceras las controla quien llama, pero quien llama ya
  está autenticado y podría mandar `baseUrl` a su gusto: el QR solo lo ve él.»
- Líneas 58-60:

  ```ts
  router.handle('pairingCreate', (input, ctx) =>
    services.auth.createPairing(
      input.body,
      baseUrlFromHeaders(ctx.request.headers),
      ctx.device?.deviceId ?? null,
    ),
  );
  ```

  Las demás (`devicesList`, `deviceRevoke`) no cambian: el servicio no
  necesita saber quién revoca.

### 2.6 `MONO/apps/server/src/modules/auth/types.ts`

- Líneas 1-20 (comentario): añadir «Desde la 0.8.1 crear códigos, listar y
  revocar también lo puede hacer un iPhone emparejado; un código creado por un
  iPhone muere si ese iPhone se revoca.»
- Líneas 43-44:

  ```ts
  /**
   * POST /api/v1/pairing (web o iPhone). `baseUrl` y `alternateBaseUrls` para
   * el QR; si falta `baseUrl`, se deduce de las cabeceras. `createdBy`: el
   * dispositivo que lo pide desde /native (null desde la web).
   */
  createPairing(
    body: PairingCreateBody,
    fallbackBaseUrl: string,
    createdBy?: string | null,
  ): Promise<PairingCreateResponse>;
  ```

- Línea 68: «DELETE /api/v1/devices/:id (web o iPhone, también el propio)…
  Si ese dispositivo tenía un código de emparejamiento vivo, lo anula.»

### 2.7 `MONO/apps/server/src/modules/auth/service.ts`

- Comentario de cabecera (1-21): añadir un guion «- Desde la 0.8.1 también
  crea códigos un iPhone emparejado: el QR lleva sus dos direcciones (una `u=`
  por dirección) y, solo en memoria, quién lo creó; si ese iPhone se revoca, su
  código muere (no se puede dejar sembrado un emparejamiento).»
- `PendingPairing` (95-100):

  ```ts
  interface PendingPairing {
    readonly codeMac: Buffer;
    readonly expiresAt: number;
    /** Dispositivo que lo pidió por /native; null si lo pidió la web. Solo en memoria. */
    readonly createdBy: string | null;
    failures: number;
  }
  ```

- `createPairing` (221-249), sustituir la firma y el principio:

  ```ts
  async createPairing(body: PairingCreateBody, fallbackBaseUrl: string, createdBy: string | null = null) {
    const clean = (url: string) => url.replace(/\/+$/, '');
    const baseUrl = clean(body.baseUrl ?? fallbackBaseUrl);
    if (!BASE_URL_RE.test(baseUrl)) {
      throw new AppError('bad_request', { detail: 'URL base del emparejamiento no válida' });
    }
    const urls = [baseUrl];
    for (const raw of body.alternateBaseUrls ?? []) {
      const url = clean(raw);
      if (!BASE_URL_RE.test(url)) {
        throw new AppError('bad_request', { detail: 'URL alternativa del emparejamiento no válida' });
      }
      if (!urls.some((known) => known.toLowerCase() === url.toLowerCase())) urls.push(url);
    }
    // … código y expiresAt igual (226-231) …
    pending = { codeMac: codeMac(code), expiresAt, createdBy, failures: 0 };   // línea 233
    const query = urls.map((url) => `u=${encodeURIComponent(url)}`).join('&');
    const pairUri = `aceneo://pair?${query}&c=${code}`;                         // línea 234
    // … QR igual (235-239) …
    logger.info(
      { expiresAt: iso(expiresAt), createdBy, addresses: urls.length },
      'código de emparejamiento creado',
    );                                                                          // línea 240
  ```

  Con una sola dirección el `pairUri` sale byte a byte igual que hoy (lo fija
  el test de §5.2 y el fixture no cambia).

- `claimPairing` (251-299): antes de `pending = null` (272) guardar
  `const pairedBy = current.createdBy;` y en el log de 292:
  `logger.info({ deviceId, platform: record.platform, pairedBy }, 'dispositivo emparejado');`
  (el `deviceId` no es secreto; el token sí y no se toca).
- `revokeDevice` (355-372): tras `lastSeenWritten.delete(deviceId)` (366):

  ```ts
  /* Un código que creó este dispositivo no sobrevive a su revocación. */
  if (pending?.createdBy === deviceId) {
    pending = null;
    logger.info({ deviceId }, 'código de emparejamiento anulado: lo creó un dispositivo revocado');
  }
  ```

  (Fuera del `if (result.changed)`: revocar dos veces sigue siendo idempotente
  y el código muere igual.)

### 2.8 `MONO/apps/server/src/modules/events/hub.ts` y `types.ts`

Solo comentarios (el código ya hace lo correcto con la lista vacía):

- `hub.ts:16`: «Filtro: `devices.changed` solo al origen web» → «Filtro por
  origen: `WEB_ONLY_EVENT_TYPES` (vacío desde la 0.8.1: `devices.changed` va a
  todos)…».
- `hub.ts:25`: añadir «Se publica ANTES de cerrar: el propio dispositivo
  revocado recibe su `devices.changed` `revoked` y luego se le cierra el SSE.»
  (ya es así: `forward`, 256-262).
- `events/types.ts:8-9`: igual que `hub.ts:16`.

### 2.9 Sin cambios (comprobado)

- `app.ts`: la regla `access`/`credential` es genérica (288-292, 196-211).
- `core/origin.ts`, `core/csrf.ts`: el anti-CSRF no aplica a native (no hay
  cookies; el Bearer va en cabecera).
- `deploy/umbrel/nginx.conf`: `/native/` ya reenvía todo; `client_max_body_size
  2m` sobra.
- `deploy/umbrel/docker-compose.yml:21` `PROXY_AUTH_WHITELIST: "/native/*"`:
  igual. Solo cambian las rutas `/releases/0.8.0/` (§8).
- `deploy/local/fake-gateway/gateway.mjs`: igual (reenvía `Host` tal cual,
  150-156).
- `v2/devices.json` (`DeviceRecordSchema`, `packages/shared/src/state/v2.ts:62-71`,
  `strictObject`): **no se añade `pairedBy`** a propósito: la 0.8.0 no leería un
  fichero con un campo de más (esquema estricto) y una vuelta atrás dejaría a
  todos los iPhone sin emparejar. Quién creó el código queda solo en el log.

---

## 3. Identidad, revocación y QR

### 3.1 Cómo se sabe quién llama

- Toda petición `native` a estas rutas pasa por `authenticateBearer`
  (`service.ts:301-321`): id + sha256 del secreto en tiempo constante; revocado
  ⇒ 401 `device_revoked`. El manejador recibe `ctx.device.deviceId`.
- La app sabe cuál es ella: `GET /native/api/v1/bootstrap` devuelve `device`
  (el que pregunta, `system.ts:38-39`) y el canje devolvió `deviceId`. No hace
  falta marcar «este» en `devicesList`.
- No hay roles: cualquier dispositivo emparejado es administrador (igual que
  la web tras el login de Umbrel). La web sigue siendo la autoridad última: no
  tiene registro en `devices.json`, así que ningún iPhone puede revocarla
  (`DELETE /native/api/v1/devices/<id del navegador>` → 404 `device_not_found`,
  porque el `device` de la web es un id de pestaña, no un dispositivo).

### 3.2 ¿Puede revocar a otros? Sí

- Mismo efecto que desde la web: `revokedAt`, `devices.changed revoked` a todos,
  cierre del SSE del revocado, `playback.releaseDevice` suelta sus visores, sus
  URLs de vídeo dan 401 `device_revoked` al momento.
- Un código de emparejamiento que hubiera creado el revocado muere (§2.7).

### 3.3 ¿Puede revocarse a sí mismo? Sí («Olvidar este iPhone»)

Secuencia exacta, con el código actual más §2.7:

1. `onRequest` autentica (el dispositivo aún no está revocado) y deja
   `ctx.device`.
2. `revokeDevice(propio)` marca `revokedAt` (la escritura de `lastSeenAt`
   que pudiera ir por detrás no lo pisa: comprueba `revokedAt === null` dentro de
   la misma cola, `service.ts:158-160`).
3. `bus.emit('devices.changed', revoked)`: el hub publica el evento (el
   propio SSE lo recibe) y luego cierra su conexión; playback suelta sus visores.
4. La respuesta 200 `{ device: { …, revokedAt } }` sale (la autenticación ya
   pasó). Cualquier petición siguiente del mismo token: 401 `device_revoked`.

Lo que tiene que hacer la app (para el plan de iOS): pedir confirmación con
texto propio («Este iPhone dejará de poder entrar. Para volver, emparéjalo otra
vez desde la web u otro iPhone»), llamar a `DELETE`, borrar el token del
Llavero y volver a la pantalla de emparejar conservando las direcciones.
Si recibe por SSE `devices.changed {reason:'revoked', deviceId: <el suyo>}` sin
haberlo pedido, lo mismo con el aviso «Este iPhone se ha revocado desde otro
dispositivo».

La interfaz exacta de las dos cosas (dónde está el botón, variante, segundo
toque, textos, orden de lo que se desmonta y qué ve el usuario después) está en
§3.5. Ojo con el paso 3: el evento `revoked` propio llega por SSE ANTES que la
respuesta 200, así que la app tiene que saber que lo ha pedido ella (§3.5.3).

### 3.4 El QR que pide la app: qué `baseUrl` y qué direcciones

Problema: hoy el QR lleva una sola dirección (`u=`) y el servidor no sabe por
dónde llegará el iPhone nuevo (casa o Tailscale). El iPhone que enseña el QR
sí lo sabe: guarda las dos en `ServerConfig { lan, tailscale }`
(`apps/ios/Sources/Core/Auth/Servidores.swift:57-66`).

Decisión (A, recomendada):

- La app manda `baseUrl` = la dirección que está usando ahora (la que
  responde, `ActiveServer.url`, solo origen) y `alternateBaseUrls` = [la otra]
  si la tiene configurada.
- El servidor devuelve `pairUri =
  aceneo://pair?u=<baseUrl>&u=<alternativa>&c=<código>` (una `u` por
  dirección, sin repetidas, `baseUrl` la primera) y su `qrSvg`.
- Compatibilidad: la app de la 0.8.0 lee la primera `u`
  (`PairingLink.init`, `Servidores.swift:132-133`, `items.first(where:)`), que
  es la que funciona ahora mismo al lado del iPhone que enseña el QR. La web no
  cambia (manda solo `baseUrl = location.origin`, `usePairing.ts:112`).
- La app nueva lee TODAS las `u`, clasifica cada una con
  `ServerVia.clasificar` (`*.ts.net` y 100.64.0.0/10 → Tailscale; lo demás →
  casa) y guarda la primera de cada tipo. Dibuja el QR nativo desde `pairUri`
  (CoreImage `CIQRCodeGenerator`, corrección «M» como el servidor) en vez de
  pintar el SVG.
- Si la app no manda `baseUrl` (no debería): reserva `baseUrlFromHeaders` =
  `http://<Host con el que llegó>` (nginx `/native/` pone `Host $http_host`).
  No hay garantía de que la pasarela real de umbreld conserve el `Host` (la
  falsa sí, `gateway.mjs:150-156`): por eso la app debe mandar siempre
  `baseUrl`.
- Tamaño del QR: dos URL de ~40 caracteres dan un QR versión ~6-7; el tope de
  2 alternativas × 512 caracteres evita QR ilegibles.

Alternativa B (cero contrato, no recomendada): la app pide el código sin
`alternateBaseUrls` y compone ella el `pairUri` con sus dos direcciones. Evita
tocar `@ace/shared`, pero el formato del QR pasa a vivir en dos sitios y el
`qrSvg` del servidor mentiría.

### 3.5 Interfaz en la app: «Olvidar este iPhone» y «revocado desde otro dispositivo»

La web no tiene nada de esto (el navegador no está en `devices.json`: nunca sale
en su propia lista y no se puede revocar). Es un añadido de la app, pero hecho
con piezas que la web YA tiene, para que no desentone: la fila de «Emparejados»
(a6 §8.9), la cápsula «Este dispositivo» de «Dónde» (a6 §6), el segundo toque
(a6 §13, `features/settings/second-tap.ts`) y el aviso que aparece debajo al
armar «Reiniciar el motor» en la tarjeta del motor de Salud (a6 §9.3). Regla de
la web que se mantiene: **nunca un diálogo del sistema** (ni `.alert`, ni
`.confirmationDialog`): el primer toque arma y el segundo ejecuta.

Esto sustituye a la propuesta de a7 §2.4 («Este iPhone» suelto con «Olvidar
este servidor» local), que partía de que `devicesList`/`deviceRevoke` eran solo
web. Con servidor 0.8.0 esa propuesta local sigue siendo el plan B (§9.1.3).

#### 3.5.1 Dónde vive: Ajustes › Dispositivos › «Emparejados», la fila propia

No hay entrada nueva en el índice de chips ni pantalla aparte: el botón está en
la fila del propio iPhone dentro de la lista «Emparejados» de la sección
Dispositivos (id `dispositivos`, 6.ª sección, a6 §8). Se llega igual que a
cualquier sección (chip «Dispositivos» del índice o desplazando).

Árbol de la sección con el cambio (solo lo nuevo en **negrita**):

```
.disp (columna, separación 16)
├─ Intro, panel de emparejar, nota de origen      (a6 §8.2-8.8, sin cambios)
└─ Bloque «Emparejados» (separación 12)
    ├─ «EMPAREJADOS · N»                           (N cuenta también este iPhone)
    ├─ Lista (radio 8, fondo --bg, borde 1 pt --line-soft)
    │   ├─ **Fila propia** (siempre la primera)
    │   │   ├─ **icono 40×40 en oro lavado**
    │   │   ├─ texto: **[nombre] [cápsula «Este dispositivo»]** / meta / meta suave
    │   │   ├─ **botón sm «Olvidar»** (a 390: debajo del texto, a la izquierda)
    │   │   └─ **aviso 12 pt, solo con el botón armado**
    │   └─ Filas de los demás (sin cambios: «Revocar», a6 §8.9)
    └─ [👁 Ver los revocados (N)]                  (sin cambios)
```

Cuál es la fila propia: `device.id === bootstrap.device.id` (§9, «Este
iPhone»). Si por lo que sea la lista no la trae (carrera justo tras emparejar),
se pinta igual con los datos de `bootstrap.device` hasta que llegue.

Medidas y estilo de la fila propia (todo lo que no se nombra es la fila de a6
§8.9: alto mín. **68**, relleno **10 / 12 / 10 / 14**, rejilla `[icono | texto |
botón]` separación **12**, a 390 el contenedor mide 326 ≤ 340 y el botón baja a
la columna del texto, alineado a la izquierda):

| Pieza | Valor |
|---|---|
| Orden | Primera de la lista, pase lo que pase con «el último visto primero» (igual que «Dónde» pone primero este dispositivo, a6 §6). |
| Icono | Cuadro **40×40**, radio **10**, fondo `--accent-wash` sobre `--bg` = claro `#f6edc1`, oscuro `#2d280a`; icono `movil` (iPhone/iPad) **20** en `--accent-ink` (claro `#7e6100`, oscuro `#ffd60a`). Es el tratamiento de «este dispositivo» de «Dónde». |
| Línea del nombre | Fila que se parte, separación **4 × 8**, centrada: nombre **15 / 800 / anchura 125 % / −0,01 em** (`--text`) + cápsula **gold `sm`** «**Este dispositivo**» (alto 24, relleno 0 8, 11 pt / 640 / 88 % / +0,02 em, fondo `#ffd60a`, tinta `#1a1400`, en claro y en oscuro). Mismo texto que en «Dónde» (no «Este iPhone»: así la app dice lo mismo en los dos sitios). |
| Meta | Igual que las demás: punto verde **7** (`--ok` `#1f7a46` / `#35c759`) + «iPhone · Conectado ahora mismo» (se calcula igual, `isOnlineNow` < 2 min; en la práctica siempre sale «Conectado» porque la propia app acaba de llamar). Segunda meta `--text-3` «Emparejado el 23 sept 2026». |
| Botón en reposo | `Button size="sm" variant="quiet"`, sin icono: «**Olvidar**». Alto 36 (zona 44), relleno 0 14, cápsula, 13 pt / 650, fondo `--line-soft` sobre `--bg` = claro `#e1e1e2`, oscuro `#1e2022`, tinta `--text`. |
| Botón armado | `variant="danger"`: «**¿Olvidar? Pulsa otra vez**». Fondo `--surface-2` (claro `#ececee`, oscuro `#171b23`), tinta `--fail-ink` (claro `#b01e16`, oscuro `#fe5547`), borde interior 1 pt fail 45 % (claro `#dc9c98`, oscuro `#7f2e2d`). Cambio de variante instantáneo, sin animar el color (a6 §13). |
| Aviso (solo armado) | Debajo del botón, en la columna del texto (columna 2 de la rejilla, a todo su ancho), margen superior **4**: **12 pt / 450 / `--text-2` / interlineado 1,25**: «Este iPhone dejará de poder entrar. Para volver, emparéjalo otra vez desde la web u otro iPhone.» Aparece y desaparece sin animación, como el aviso de la tarjeta del motor (a6 §9.3); la fila crece con él (≈ +32 pt a 390, dos líneas). |
| Plazo | **5 s** (`CONFIRM_REVOKE_MS`, el mismo que «Revocar»). Al pasar, vuelve solo a «Olvidar» y el aviso se va. |
| Un armado a la vez | Comparte el MISMO estado de segundo toque que las filas de los demás (`useSecondTap` de la sección, clave = id): armar «Olvidar» desarma un «Revocar» armado y al revés. Salir de la sección (u ocultar la pestaña) desarma. |
| Ocupado | El segundo toque desarma y ejecuta (igual que `revoke` en `DevicesSection.tsx:174-188`): el botón vuelve al rótulo «Olvidar» con `busy` (deshabilitado, opacidad **.75**, sin ruedita) hasta que acaba. |
| Pulsación larga | 500 ms en la fila (se cancela si el dedo se mueve > 8 pt) → menú «Opciones de {nombre}» con un solo elemento rojo, icono `x`: «**Olvidar este iPhone**» (o «**Olvidar ya**» si el botón ya está armado); elegirlo = un toque en el botón. Vibración `medium` al abrir (mapa de a6 §14). |
| VoiceOver | Botón: «Olvidar este iPhone» / armado «¿Olvidar? Pulsa otra vez para olvidar este iPhone» (mismo patrón que «Revocar {nombre}» / «¿Revocar? Pulsa otra vez para revocar {nombre}»). El aviso va como `accessibilityHint` del botón armado. La cápsula se lee como parte del nombre: «iPhone de Isma, Este dispositivo». |
| Vibración | Ninguna al armar (la web no vibra al armar nada). Al acabar bien, `.warning` una vez (§3.5.4). |
| Horizontal 844 | Contenedor > 340: botón a la derecha en la misma fila; el aviso armado sigue en la columna del texto, debajo del nombre y las metas (columna 2, fila nueva). |

La fila propia NO tiene «Revocar»: en la app, revocarse = «Olvidar». Las
demás filas no cambian (a6 §8.9: «Revocar» → «¿Revocar? Pulsa otra vez», 5 s,
toast ok ««{nombre}» ya no puede entrar. Si lo quieres de vuelta, emparéjalo
otra vez.»).

#### 3.5.2 Qué pasa al segundo toque (orden exacto)

1. `olvidando = true` en el modelo de sesión (ver §3.5.3) y el botón ocupado.
2. `DELETE /native/api/v1/devices/<bootstrap.device.id>` con el Bearer.
3. Resultado:

   | Respuesta | Qué es | Qué hace la app |
   |---|---|---|
   | 200 `{ device: { …, revokedAt } }` | Revocado ahora | Camino de salida (paso 4). |
   | 401 `device_revoked` | Ya estaba revocado (otro se adelantó) | Camino de salida, igual que 200. |
   | 404 `device_not_found` | El servidor ya no lo conoce (datos borrados) | Camino de salida, igual que 200. |
   | 403 `origin_forbidden` | Servidor 0.8.0 | NO sale: marca «servidor viejo» (§9.1) y la fila pasa al plan B (§9.1.3). Toast err «No se pudo olvidar este iPhone. Esta opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel.» |
   | Sin red, plazo, 5xx | No se sabe si se revocó | NO sale (si no, el iPhone seguiría en la lista del servidor como activo sin que nadie lo sepa): `olvidando = false`, botón en reposo, toast err «No se pudo olvidar este iPhone. {motivo}» (`describeFailure`, mismos motivos que el resto). |

4. Camino de salida, en este orden (todo en el hilo principal, sin esperas entre
   pasos):
   1. Parar la reproducción: `AVPlayer.pause()` + quitar el `AVPlayerItem`,
      cerrar PiP si está abierto, vaciar `MPNowPlayingInfoCenter.nowPlayingInfo`
      y desactivar los mandos remotos, desactivar la `AVAudioSession`. (El
      servidor ya ha cortado las URL de vídeo; esto evita un error del
      reproductor a la vista.)
   2. Cancelar la tarea del SSE y los sondeos.
   3. Borrar el token del Llavero.
   4. Vaciar la caché de datos del servidor en memoria (y la de disco si la
      hay: agenda, biblioteca, listas; son del servidor, no del iPhone).
   5. **Conservar**: las dos direcciones (`ServerConfig { lan, tailscale }`),
      el nombre del iPhone y los ajustes que son de este aparato (tema,
      «Reducir transparencia», modo de reproducción).
   6. Cambiar la raíz a la pantalla de emparejar (la de a8 §3.3.4, que la web
      no tiene) con **fundido cruzado de 320 ms** (`cubic-bezier(0.2, 0.7,
      0.3, 1)`, el `--dur-fade`; igual con «Reducir movimiento»), con las
      direcciones ya escritas, el campo del código vacío y el aviso de §3.5.4
      arriba.
   7. Vibración `.warning` una vez (se omite si la app no está activa).
   8. `olvidando = false`.

#### 3.5.3 La carrera del evento propio

`revokeDevice` emite `devices.changed {reason:'revoked', deviceId: <el propio>}`
y el hub lo publica ANTES de cerrar el SSE y antes de que salga la respuesta 200
(§3.3, pasos 3-4; `hub.ts` `forward`, 249-263). Sin cuidado, la app vería su
propio `revoked` y enseñaría «se ha revocado desde otro dispositivo», que es
falso. Regla:

- Con `olvidando == true`: el `revoked` propio por SSE, el cierre del SSE y
  cualquier 401 `device_revoked` de peticiones en vuelo **se ignoran** (no
  llaman a `alPerderAcceso`, a8 §3.4.3 `APIClient`): manda el resultado del
  `DELETE` (§3.5.2).
- Con `olvidando == false`: cualquiera de esas tres señales = revocado desde
  fuera (§3.5.5).

#### 3.5.4 La pantalla de emparejar después de olvidar

La pantalla de emparejar la define a8 (textos en a8 §3.3.4: «Empareja este
iPhone», «Escanear el código QR», «o escribe el código», campos «Red local» y
«Tailscale»…). Lo único que añade este documento es el **aviso de motivo**,
una fila entre el subtítulo y el botón «Escanear el código QR», con el estilo
de la nota de origen de la web (`.disp-origin`, a6 §8.8):

- Fila `HStack(alignment: .top)`, separación **10**, relleno **10 / 14**, radio
  **18**, 13 pt / 450 / interlineado 1,45; icono **18** con margen superior 1;
  ancho completo del contenido (canal de 16 a cada lado).
- Variante neutra (tras «Olvidar»): fondo `--line-soft` sobre `--bg` = claro
  `#e1e1e2`, oscuro `#1e2022`; texto `--text-2` (`#4a4c52` / `#b9baba`); icono
  `check` en `--accent-ink` (`#7e6100` / `#ffd60a`). Texto: «Has olvidado este
  iPhone en tu Umbrel. Para volver, emparéjalo otra vez desde la web u otro
  iPhone.»
- Se queda hasta que se empareja bien (no tiene «cerrar»). `role=note`; al
  aparecer se anuncia a VoiceOver una vez
  (`AccessibilityNotification.Announcement`).

#### 3.5.5 «Revocado desde otro dispositivo» (sin haberlo pedido)

Señales (con `olvidando == false`), la primera que llegue:

1. SSE `devices.changed {reason:'revoked', deviceId: <el propio>}` (solo con
   servidor ≥ 0.8.1; la 0.8.0 no lo manda a native);
2. el SSE se cierra y al reconectar da 401 `device_revoked`;
3. cualquier petición da 401 `device_revoked` (con servidor 0.8.0 es la única
   señal; a8 §3.4.3 ya borra el token y lanza `.necesitaEmparejar`).

Qué hace: el mismo camino de salida de §3.5.2 paso 4 (parar, cortar SSE,
Llavero, cachés, conservar direcciones, pantalla de emparejar con fundido de
320 ms, `.warning` si la app está activa). Diferencias:

- Si pasa con la app en segundo plano sonando (audio en segundo plano o PiP):
  se para ya (la URL de vídeo ya da 401) y la pantalla de emparejar sale al
  volver; sin notificación local.
- Si había una hoja, menú o el reproductor a pantalla completa abiertos, se
  cierran sin animación antes del fundido.
- Aviso de motivo en **variante de aviso** (la de `.disp-origin--warn`): fondo
  weak 14 % sobre `--bg` = claro `#e5ded2`, oscuro `#281f12`; borde interior
  1 pt weak 40 % (sobre ese fondo: claro `#c3aa7e`, oscuro `#7e5a24`); texto
  `--text` (`#0c0c0e` / `#ffffff`); icono `aviso` en `--weak-ink` (`#805100` /
  `#ffb340`). Texto: «**Este iPhone se ha revocado desde otro dispositivo.**
  Para volver a entrar, emparéjalo otra vez desde la web u otro iPhone.» (la
  primera frase en 650 `--text`, como los `strong` de la nota de origen).
- Con 401 `unauthorized` (token que el servidor no conoce: datos del servidor
  borrados o restaurados) el mismo aviso con otro texto: «**Tu Umbrel ya no
  reconoce este iPhone.** Emparéjalo otra vez desde la web u otro iPhone.»
  (texto propuesto: la web no tiene equivalente).

Colores del borde del aviso calculados como la web los pinta: `inset
box-shadow` weak al 40 % compuesto en sRGB encima del fondo ya teñido (weak
`#8f5b00` / `#ffb340`; fondo `#e5ded2` / `#281f12`): `0,4 × weak + 0,6 ×
fondo` por canal. a6 §0.1 da `#cbb692` / `#694c20` («borde ámbar 40 % sobre
`--bg`»), que es el ámbar compuesto sobre `--bg` SIN el tinte de debajo; la
diferencia se nota (hasta 20 niveles en el azul en claro): usar los de aquí y
corregir a6 para la nota de origen `--warn` y el aviso del backend.

---

## 4. Riesgos

| Id | Riesgo | Gravedad | Mitigación en la 0.8.1 | Queda aceptado |
|---|---|---|---|---|
| N-1 | **Un iPhone robado pasa a ser administrador**: puede crear códigos y emparejar dispositivos nuevos (persistencia: revocar el robado no revoca los que sembró). Hoy solo podía «lo que no es de administración» (R-9). | Media | El código que crea un iPhone muere si ese iPhone se revoca (§2.7); el log dice `pairedBy`; la web lista todos con fecha y nombre y puede revocar cualquiera. | Sí: los que ya sembró siguen hasta revocarlos a mano. Propuesta futura (con migración y sin vuelta atrás a la 0.8.0): `pairedBy` en `devices.json` y revocación en cascada. |
| N-2 | Un iPhone puede revocar a todos los demás (molestia). | Baja | La web (login de Umbrel) no se puede revocar y vuelve a emparejar. | Sí |
| N-3 | Auto-revocación por error ⇒ el iPhone queda fuera. | Baja | Segundo toque de 5 s con el aviso debajo del botón (§3.5.2); se vuelve con un código desde la web u otro iPhone, y la pantalla de emparejar sale con las direcciones ya puestas (§3.5.4). | Sí |
| N-4 | Un código creado desde el iPhone anula el que la web tuviera a la vista (solo hay uno vivo, `service.ts:232-233`): la web sigue contando atrás y el canje da 410 `pairing_expired`. | Baja | Ninguna (es la regla de siempre). | Sí; si molesta, un `pairing.changed` futuro. |
| N-5 | `pairingCreate` desde native sin `baseUrl` usa el `Host`/`X-Forwarded-*` que controla quien llama. | Nula | Quien llama está autenticado y el QR solo lo ve él; ya podía mandar `baseUrl`. La URL nunca la pide el servidor (no hay SSRF). | — |
| N-6 | `devices.changed` a todos: cada iPhone ve los `deviceId` de los demás en vivo. | Nula | Ya los ve con `devicesList`. | — |
| N-7 | `health` a native: versión, contadores, nombre del modelo de IA, avisos. | Nula | Sin secretos (§1.4); ya ven `engineStatus`, `diagnosticsList`, `playbackStatus`. | — |
| N-8 | Una app nueva contra un servidor 0.8.0: las 5 rutas dan 403 `origin_forbidden` y no llega `devices.changed`. | — (compatibilidad) | La app trata ese 403 como «tu Umbrel necesita la 0.8.1» (§9) y refresca la lista al aparecer. | — |
| N-9 | Vuelta atrás 0.8.1 → 0.8.0. | — | Sin cambios de disco (§2.9). La app de la 0.8.0 recibe ahora `devices.changed` por SSE: lo decodifica (`Eventos.swift:231,261`) y lo ignora. | — |

Riesgos ya aceptados que cambian de texto: **R-9** (`docs/seguridad.md:283`)
deja de ser verdad tal cual; **R-1** (red de Docker) no cambia.

---

## 5. Tests

Todos en `MONO`. Nombres en español como los de alrededor.

### 5.1 A cambiar (fallarían tal cual)

| Fichero · líneas | Hoy | Cambio |
|---|---|---|
| `apps/server/test/security.test.ts:7` (comentario) | «native con token válido en una ruta solo web → 403» | «…en la única ruta solo web (`healthLive`) → 403; las de administración, abiertas desde la 0.8.1» |
| `security.test.ts:179-195` «con token válido, las rutas solo web dan 403 origin_forbidden» | `arrayContaining(['pairingCreate','devicesList','deviceRevoke','settingsUpdate'])` | `expect(webOnly.map(([id]) => id)).toEqual(['healthLive'])` (fija el conjunto: una apertura accidental se ve) y el bucle sigue igual. Título: «…la única ruta solo web (healthLive) da 403…» |
| `security.test.ts:215-240` «rutas v1 retorcidas…» | Usa `devices` como ruta web: con token, `/native/api/v1/devices?x=1` (y quizá `%64evices`) darían 200 | Cambiar `devices` por `health/live` en la lista: `/native/api/v1/health/live/`, `//health/live`, `%68ealth/live`, `health/live?x=1`, `HEALTH/LIVE`, `../v1/health/live`, `pairing/claim/../../health/live`, `ping/../health/live`. Mantener `/native/api/v1/nope`. |
| `apps/server/test/app.test.ts:262-277` «token incorrecto → 401; ruta solo web con token → 403» | `GET /native/api/v1/devices` con token → 403 | Usar `GET /native/api/v1/health/live`. |
| `apps/server/src/modules/auth/routes.test.ts:125-139` «el canje va sin token, pero crear códigos y administrar dispositivos es solo web» | 403 con token | Reescribir: «sin token 401; con token el iPhone crea códigos (201), lista (200) y revoca (200)». Revocar al final (el propio), comprobando después 401 `device_revoked`. |
| `apps/server/src/modules/events/hub.test.ts:254-270` «la reanudación respeta el mismo filtro que en vivo» | `ios` (dev_a) recibe `[first+2]`; `iosB` 2 | `ios` → `[first, first+2]` (ahora le llega el `devices.changed`); `iosB` → 3; `web` igual. |
| `hub.test.ts:273-280` «devices.changed (administración) solo va al origen web» | `ios` vacío | «devices.changed llega a web y a native (0.8.1)»: los dos con 1 evento. |
| `apps/server/src/modules/events/routes.test.ts:93-101` | `expect(res.body).not.toContain('devices.changed')` | Contiene `event: devices.changed` dos veces (`dev_otro` paired y el suyo revoked) y el último evento del cuerpo es el `revoked` con `DEVICE.id`; `connections()` 0. |

Sin cambios (comprobado): `security.test.ts:142-177` (la matriz 401 sigue:
las 5 rutas ya son `bearer`), `:244-252` (sin token sigue 401),
`auth/routes.test.ts:230-269` (el log: `GET /native/api/v1/devices` con
token ahora da 200, pero el test solo mira la redacción),
`health.test.ts:537-538` (`/native/api/v1/health/live` sin token → 401),
`scripts/test-compose-local.mjs:551-552` (`/native/api/v1/health` sin token →
401), `deploy/test/compose.test.ts` (whitelist igual), fixtures e iOS
`FixturesTests` (el fixture de `pairingCreate` no cambia).

### 5.2 A añadir

`apps/server/src/modules/auth/auth.test.ts` (unidad, `ctx.auth`):

1. «alternateBaseUrls: una u= por dirección, en orden, sin repetidas ni barra
   final»: `createPairing({ baseUrl: 'http://umbrel.local:7792', alternateBaseUrls: ['http://umbrel.tail1234.ts.net:7792/', 'HTTP://UMBREL.LOCAL:7792'] }, BASE)` →
   `pairUri === 'aceneo://pair?u=http%3A%2F%2Fumbrel.local%3A7792&u=http%3A%2F%2Fumbrel.tail1234.ts.net%3A7792&c=' + code`.
2. «con una sola dirección el pairUri es el de siempre» (byte a byte:
   `aceneo://pair?u=<enc>&c=<código>`).
3. «una alternativa con espacio da bad_request» (`'http://a b'` pasa el zod,
   no `BASE_URL_RE`).
4. «el código que creó un dispositivo muere al revocarlo»: emparejar A;
   `createPairing({}, BASE, A)`; `revokeDevice(A)`; canje → `pairing_expired`.
5. «revocar a otro no anula un código ajeno»: código creado por A (o por la
   web, `createdBy` null); revocar B; el canje funciona.
6. «el log del canje lleva pairedBy» (con el logger de captura del fichero).

`apps/server/src/modules/auth/routes.test.ts` (HTTP con `app.inject`):

7. «el iPhone crea un código con sus dos direcciones y otro iPhone lo canjea»:
   A por la web; `POST /native/api/v1/pairing` con Bearer A y cuerpo
   `{ baseUrl, alternateBaseUrls }` → 201, `pairUri` con dos `u`; canje con
   `native()` → 201; `GET /native/api/v1/devices` con A → 2 activos.
8. «sin baseUrl, el QR usa el Host con el que llegó el iPhone»: cabecera
   `host: 'umbrel.local:7792'` → `u=http%3A%2F%2Fumbrel.local%3A7792`.
9. «alternateBaseUrls con 3 entradas o con ruta → 400 validation_error».
10. «revocarse a sí mismo: 200 con revokedAt y después 401 device_revoked»
    (también que su URL de vídeo firmada da 401 `device_revoked`).
11. «un iPhone revoca a otro: el otro 401, el que revoca sigue 200».
12. «el id de la web (pestaña) no es un dispositivo: 404 device_not_found».

`apps/server/test/security.test.ts`:

13. «0.8.1: con token válido, las rutas de administración abiertas al iPhone
    responden»: `GET /native/api/v1/health` 200, `PUT /native/api/v1/settings`
    `{ sameChannelPolicy: 'handoff' }` 200, `POST /native/api/v1/pairing` `{}`
    201, `GET /native/api/v1/devices` 200, `DELETE
    /native/api/v1/devices/<s.revoked.deviceId>` 200 (idempotente); y las
    mismas por cabecera sin prefijo (`nativeForms`).

`apps/server/src/modules/events/hub.test.ts`:

14. «el dispositivo revocado recibe su devices.changed antes de que se le
    cierre»: ampliar el de 350-362: `revoked.sink.events()` =
    `[{ event: 'devices.changed', data: { reason: 'revoked', deviceId: 'dev_a' } }]`
    y `writableEnded` true; `other` también lo recibe.

`apps/server/src/modules/health/health.test.ts:516-539`:

15. `GET /native/api/v1/health` con token → 200 y valida con
    `HealthResponseSchema` (usar el `fakeAuth()` de `test/app.test.ts:33-40`,
    movido a `test/helpers/index.ts` para compartirlo).

`apps/server/src/modules/state/routes.test.ts:529-580` (o en 13):

16. `PUT /native/api/v1/settings` con token → 200, `source: 'saved'`, y
    `state.changed` con `scopes: ['settings']` en el bus.

`apps/server/test/integration/wiring.test.ts` (tras el de 162-240):

17. «iPhone A empareja a B desde la app, lo revoca y se revoca»: A por la web;
    A crea código con dos direcciones; B canjea; B abre un canal (grant
    firmado); A revoca B → las URL de B 401 y el motor para (`sessionsOpen` 0);
    A se revoca → `GET /native/api/v1/bootstrap` con A 401 `device_revoked`;
    `h.bus.of('devices.changed')` → `['paired','paired','revoked','revoked']`.

`packages/shared/test/contracts.test.ts`:

18. `PairingCreateBodySchema`: acepta `{}`, `{ baseUrl }`, `{ baseUrl,
    alternateBaseUrls: [x, y] }`; rechaza 3 alternativas, una con ruta
    (`http://a/b`), una con `?`, y un campo de más.

`MONO/scripts/test-compose-local.mjs` (pila real: pasarela falsa + nginx +
Node), bloque nuevo tras la línea 552:

19. Emparejar por la pasarela con cookie (`POST /api/v1/pairing`), canjear por
    `/native/api/v1/pairing/claim`, y con el Bearer por `/native/…`: `GET
    devices` 200, `PUT settings` 200, `POST pairing` con `alternateBaseUrls`
    201, `GET health` 200, `DELETE devices/<propio>` 200, `GET bootstrap` 401.
    Prueba que nginx y la lista blanca dejan pasar PUT y DELETE nativos hasta
    estas rutas.

---

## 6. Decisiones que quedan abiertas (para Isma)

### 6.1 `healthLive` se queda `web` (recomendado)

- La app no lo necesita: para «¿está vivo y qué versión?» tiene `ping` (sin
  token). La Salud calcada usa `health`.
- Es la única ruta que seguiría ejercitando la rama `access === 'web'` de
  `app.ts:288-289` y la matriz de `security.test.ts:179-195`. Si se abre, no
  queda ninguna ruta `web`: ese test y el de `app.test.ts:262-277` se quedan sin
  ejemplo (habría que borrarlos o probar la rama con una ruta de test, que la
  tabla no permite inyectar) y la lista retorcida de §5.1 tendría que usar
  otra.
- Si aun así se quiere abrir: `routes.ts:257` → `'any'`; en
  `security.test.ts:183` `toEqual([])` y sin bucle; borrar el caso de
  `app.test.ts:262-277` (o dejarlo solo con el 401); la lista retorcida pasa a
  `/native/api/v1/nope*`; `health.test.ts:537-538` sigue 401 sin token.

### 6.2 Otras

- ¿Revocación en cascada (`pairedBy` persistido)? Recomendado: no en la 0.8.1
  (rompe la vuelta atrás); anotarlo como propuesta de N-1.
- ¿Versión de la IPA nueva? `MONO/apps/ios/Config/AceNeo.xcconfig:11`
  (`MARKETING_VERSION = 0.8.0`) lo decide el plan de iOS; si sale a la vez,
  `0.8.1`.

---

## 7. Documentación a tocar

| Fichero · líneas | Cambio |
|---|---|
| `MONO/docs/contratos.md:179-180` | «Solo web: `healthLive` (healthcheck de Docker). Solo native: `video`. Todo lo demás, los dos (0.8.1: `health`, `settingsUpdate`, `pairingCreate`, `devicesList` y `deviceRevoke` pasan a los dos para la app calcada).» |
| `MONO/docs/arquitectura.md:620-623` | «Desde la web o desde un iPhone emparejado: `POST /api/v1/pairing` …»; el QR `aceneo://pair?u=<URL base>[&u=<otra>]&c=<código>`. |
| `arquitectura.md:638` | «(solo web)» → «(web o iPhone emparejado, también el propio)». Añadir: el código que creó un iPhone revocado muere. |
| `arquitectura.md:671-672` y `:688` | Filtro: `devices.changed` a todos desde la 0.8.1; fila de la tabla: «todos». |
| `arquitectura.md:794-799` | Filas: pairing «web, native»; devices «web, native»; settings «web, native»; health «web, native · interno (live solo web)». |
| `arquitectura.md:925-947` (diagrama 7.3) | Nota o `alt`: el código también lo crea un iPhone emparejado; `devices.changed` también a los iPhone. |
| `MONO/docs/seguridad.md:183-187` | Matriz: «con token bueno, la única ruta solo web (`healthLive`) → 403». |
| `seguridad.md:267-268` | «SSE: `devices.changed` a todos (0.8.1); revocar publica el evento y luego cierra las conexiones del dispositivo…». |
| `seguridad.md:283` (R-9) | «Un dispositivo emparejado puede todo lo que puede la web (desde la 0.8.1 también administrar: emparejar, revocar, ajustes)…». |
| `seguridad.md` §4, fila nueva **R-14** tras 287 | N-1 de §4 (qué, por qué se acepta, mitigación del código que muere, propuesta `pairedBy`). |
| `seguridad.md` §7 nueva «Cambio de la 0.8.1» | Qué rutas se abren, tests 13 y 19, y que no cambia nada de nginx ni de la pasarela. |
| `MONO/docs/decisiones.md` (al final, tras D21) | **D22.** «El iPhone emparejado administra como la web (0.8.1)»: decisión, por qué (app calcada), qué se deja fuera (`healthLive`, `pairedBy`). |
| `MONO/docs/cobertura/auth.md:13, 65` | Rutas y el test renombrado de §5.1; añadir los de §5.2. |
| `MONO/docs/cobertura/events.md:32, 65` | Filtro por origen vacío; test renombrado. |
| `MONO/docs/ios.md:86-87, 142` | «empareja (web → Ajustes → Dispositivos, o desde otro iPhone ya emparejado → Ajustes → Dispositivos)»; «…revócalo desde la web o desde el iPhone nuevo». |
| `MONO/docs/pruebas-iphone.md` | Casos nuevos (los escribe el plan de iOS): emparejar desde el iPhone con QR de dos direcciones, revocar otro, «Olvidar este iPhone», interruptor «Un solo dispositivo a la vez», Salud. |
| `MONO/docs/api.md` | **Sin cambios**: describe las rutas antiguas de la 0.6.59 (no menciona `/api/v1` ni `/native`). |
| `MONO/docs/openapi-v2.yaml` | Se regenera (§8), no se edita a mano. |

---

## 8. Subida a 0.8.1

La 0.8.0 está publicada (`main` y `origin/main` con `version: "0.8.0"`,
etiqueta `ace-player-neo-v0.8.0`, `APP/releases/0.8.0/`), así que esto es una
versión nueva. Mismo patrón que la 0.7.1 (commit `344ba3b`) y la 0.8.0.

| Fichero · línea | Cambio |
|---|---|
| `MONO/package.json:4` | `"version": "0.8.1"` |
| `MONO/apps/server/package.json:4` | `"0.8.1"` |
| `MONO/apps/web/package.json:4` | `"0.8.1"` |
| `MONO/packages/shared/package.json:4` | `"0.8.1"` |
| `MONO/deploy/umbrel/docker-compose.yml:69, 120, 155, 156` | `/releases/0.8.0/` → `/releases/0.8.1/` (4 sitios; `deploy/test/compose.test.ts:55-61` exige una sola versión y que sea la del monorepo) |
| `APP/docker-compose.yml` | copia idéntica de la plantilla (lo exige `compose.test.ts:180-186`; en LF) |
| `APP/umbrel-app.yml:6` | `version: "0.8.1"` (`compose.test.ts:185`) |
| `APP/umbrel-app.yml:15-44` | `releaseNotes` nuevas (borrador abajo) |
| `APP/CHANGELOG.md:5` | sección `## 0.8.1 (fecha)` encima de `## 0.8.0` con las mismas notas |
| `MONO/docs/openapi-v2.yaml` | regenerar: `info.version` (línea 5) y, en `health` (669; `security` 1015-1018), `settingsUpdate` (2213; 2265-2268), `pairingCreate` (2305; 2361-2364, más el `requestBody` con `alternateBaseUrls` y `x-errors` con `bad_request`), `devicesList` (2546; 2610-2613), `deviceRevoke` (2650; 2718-2721): `security` pasa a `[umbrelGateway, deviceBearer]` y `x-access: any` (lo hace `packages/shared/scripts/openapi.ts:111-119` solo). `healthLive` (1055; 1079-1082) sigue igual. |
| `MONO/packages/shared/fixtures/` | regenerar para comprobar que no cambia nada (el de `pairingCreate` sigue con una `u`) |
| `APP/releases/0.8.1/` | la monta `scripts/release-docker.mjs` (Linux, desde HEAD) |

No se tocan: `APP/releases/0.8.0/` (se conservan todas las anteriores),
`deploy/local/compose.local.yml` (usa `${ACE_VERSION:-0.7.0}`),
`apps/web/src/features/pwa/install.test.ts:214-215` (su `0.8.0` es un dato del
test, no la versión del paquete), `nginx.conf`, hook `pre-start`.

Borrador de `releaseNotes` (mismo estilo que las anteriores):

```
Lista para la nueva app de iPhone: desde el iPhone emparejado ya puedes ver
la Salud, emparejar otro dispositivo con su QR (lleva la direccion de casa y
la de Tailscale), revocar dispositivos, tambien el propio, y cambiar "Un solo
dispositivo a la vez", igual que en la web. Si revocas un iPhone, el codigo
de emparejamiento que hubiera creado deja de valer. La web no cambia.
```

Orden de trabajo y comandos (PC de Isma, `corepack pnpm@10.18.2`):

1. Commit 1 `feat(server): el iPhone emparejado administra como la web
   (salud, dispositivos, emparejar y ajustes)`: §2, §5, §7.
   - `corepack pnpm@10.18.2 --filter @ace/shared openapi`
   - `corepack pnpm@10.18.2 --filter @ace/shared fixtures` (sin diferencias)
   - `corepack pnpm@10.18.2 -r typecheck` · `corepack pnpm@10.18.2 -r test`
   - `corepack pnpm@10.18.2 exec eslint . --ignore-pattern "deploy/local/.work/**"` y prettier
   - `node scripts/test-compose-local.mjs` (Docker; test 19)
2. Commit 2 `build(ace-player-neo): versión 0.8.1 (el iPhone administra) con sus
   notas`: tabla de arriba menos `releases/`; volver a generar el OpenAPI
   (cambia `info.version`). `test:deploy` y `check:release` quedan en rojo hasta
   el paso 3.
3. Commit 3 `build(ismaeloul-ace-player-neo): release 0.8.1 montada en Linux
   (fuentes <sha del commit 2>)`: `node scripts/release-docker.mjs` y
   `node scripts/release-docker.mjs --check`; `corepack pnpm@10.18.2 exec vitest
   run --config vitest.config.ts` (deploy + scripts) en verde.
4. Publicar (merge a `main`, etiqueta `ace-player-neo-v0.8.1`, push): solo
   cuando Isma lo diga. Commits con `git -c user.name="Isma" -c
   user.email="ismaeloulhaji@gmail.com"` y `Co-Authored-By:`.

---

## 9. Contrato para el plan de iOS (lo que la app nueva puede dar por hecho)

- Con servidor ≥ 0.8.1 y su Bearer: `GET /native/api/v1/health`,
  `PUT /native/api/v1/settings { sameChannelPolicy }`,
  `POST /native/api/v1/pairing { baseUrl, alternateBaseUrls? }` (201:
  `code`, `expiresAt`, `ttlMs`, `pairUri`, `qrSvg`),
  `GET /native/api/v1/devices`, `DELETE /native/api/v1/devices/:id`
  (también el propio).
- SSE `devices.changed { reason: 'paired'|'revoked'|'renamed', deviceId }`
  llega también a la app: invalidar la lista; con un código a la vista, un
  `paired` de un id nuevo = «¡Emparejado!» (igual que `usePairing.ts:92-100`);
  un `revoked` con su propio id = fuera. Sin SSE, sondear `devices` cada 5 s
  solo con código a la vista (`PAIRING_POLL_MS`, `usePairing.ts:25`).
- Detección de servidor viejo: cualquiera de esas 5 rutas → 403
  `origin_forbidden` ⇒ enseñar «Esta opción necesita Ace Player Neo 0.8.1 o
  posterior en tu Umbrel» en esa sección (no comparar versiones de `ping`: el
  403 es la señal exacta).
- QR: parsear todas las `u` (§3.4) y dibujarlo desde `pairUri` con CoreImage.
- «Este iPhone»: `bootstrap.device.id`.
- «Olvidar este iPhone» y «revocado desde otro dispositivo»: §3.5.

### 9.1 Cómo se enseña «necesita la 0.8.1» (servidor 0.8.0)

#### 9.1.1 Cuándo

- Estado de sesión `servidorViejo: Bool` en el modelo de la app (no se guarda
  en disco). Pasa a `true` con la PRIMERA respuesta 403 `origin_forbidden` de
  cualquiera de las 5 rutas (`health`, `settingsUpdate`, `pairingCreate`,
  `devicesList`, `deviceRevoke`). Un 403 con otro código (p. ej.
  `cross_origin`) NO cuenta.
- Vuelve a `false` en cuanto una de esas rutas responde 2xx, o cuando
  `bootstrap.version` cambia (se ha actualizado el Umbrel) o cambia el servidor
  activo. No se compara la versión de `ping` (§9: el 403 es la señal exacta).
- Las secciones siguen pidiendo sus datos cada vez que se abren (como la web:
  `refetchOnMount: 'always'` en `devicesList` y `health`), así que tras
  actualizar el Umbrel el aviso desaparece solo al volver a la sección.
- Con `servidorViejo` ya sabido, la sección pinta el aviso SIN esperar a su
  petición (evita un parpadeo de esqueleto → aviso), pero la petición se hace
  igual por si ya se actualizó.

#### 9.1.2 El componente: `AvisoVersion`

Es la **nota de origen en variante de aviso** de la web (`.disp-origin
.disp-origin--warn`, `features/devices/devices.css:82-110`, a6 §8.8),
reutilizada tal cual. No es un toast (el toast se va a los 2,8 s y esto es un
estado) ni el `EmptyState` de error (no ha fallado nada: falta una versión).

| Pieza | Valor |
|---|---|
| Caja | `HStack(alignment: .top, spacing: 10)`, relleno **10** arriba/abajo y **14** a los lados, radio **18** (`--r-l`, esquinas circulares), ancho completo del contenedor. |
| Fondo | weak 14 % compuesto sobre `--surface` (todas las secciones de Ajustes lo tienen detrás): claro **`#efe8db`**, oscuro **`#31291e`**. |
| Borde | Interior 1 pt, weak 40 % encima del fondo anterior: claro **`#c9b084`**, oscuro **`#83602b`** (`strokeBorder`). |
| Icono | `aviso` **18**, trazo 1,8, en `--weak-ink` (claro `#805100`, oscuro `#ffb340`), margen superior **1**. Decorativo. |
| Texto | **13 pt / 450 / anchura 100 % / interlineado 1,45**, `--text` (`#0c0c0e` / `#ffffff`). La versión «**Ace Player Neo 0.8.1**» en `strong` **650** (como la dirección en la nota de origen). Se parte en las líneas que haga falta (`overflow-wrap: anywhere` en la web). |
| Texto base | «Esta opción necesita **Ace Player Neo 0.8.1** o posterior en tu Umbrel.» + una frase según la sección (tabla de §9.1.3). |
| Aparición | Sin animación cuando la sección ya lo sabe al pintarse; si aparece por un 403 con la sección a la vista, entra con `ace-aparece` (opacidad 0 + `translateY(8)` → normal, muelle estándar `.spring(duration: 0.4, bounce: 0.15)`; con «Reducir movimiento», fundido de 150 ms). |
| Accesibilidad | Un solo elemento (`accessibilityElement(children: .combine)`), sin rasgo de botón; al aparecer por un 403 se anuncia una vez (`AccessibilityNotification.Announcement`), como el `role=note` + región `polite` de la web. |
| Horizontal 844 | Igual; ocupa el ancho de su contenedor. |

#### 9.1.3 Dónde sale y qué cambia en cada sección

| Sección (a6) | Qué da 403 | Cómo queda | Frase añadida al texto base |
|---|---|---|---|
| **Dispositivos** (§8) | `devicesList` al abrir (y `pairingCreate` / `deviceRevoke` si llegaran a llamarse) | Intro igual. Debajo, `AvisoVersion`. **Se quitan** el panel de emparejar y la nota de origen (no se puede crear código). El bloque «Emparejados» pasa a «**ESTE IPHONE**» (kicker, sin cuenta) con UNA fila: la propia (§3.5.1) hecha con `bootstrap.device`, pero su botón es el **plan B local** (abajo). Sin «Ver los revocados». | «Mientras tanto, empareja y revoca desde la web: Ajustes › Dispositivos.» |
| **Salud** (§9) | `health` | El bloque de arriba (`.salud-top`: resumen + «Volver a comprobar») cambia el resumen por `AvisoVersion` (crece con base 280, como el resumen; a 390 el botón `quiet` refresh «**Volver a comprobar**» baja a su línea, a la izquierda). **Se quitan** los avisos del backend y la rejilla de servicios (salen de `health`). **Se quedan** «Fuentes con fallos» y «Registro de fallos» (`diagnosticsList` es `any`). En el registro, el nombre del dispositivo solo sale para este iPhone (de `bootstrap.device`); `devicesList` no se pide. NO sale el vacío de error «No se pudo leer la salud» por un 403. | «Mientras tanto, el estado de todos los servicios se ve en la web: Ajustes › Salud.» |
| **Reproducción › «Un solo dispositivo a la vez»** (§5) | `settingsUpdate` al tocarlo | El valor se sigue leyendo (`settingsGet` es `any`), así que el interruptor enseña el estado real. Con `servidorViejo` sabido: interruptor **deshabilitado** (opacidad **.5**) y `AvisoVersion` debajo, dentro del `.set-stack` (separación 16). Si aún no se sabía: el toque lanza `selection` como siempre, el `PUT` da 403, el interruptor **no se mueve** (la web no es optimista: `checked` sale del servidor), NO sale el toast «No se pudo guardar el ajuste…», se marca `servidorViejo` y entra el aviso con `ace-aparece`. | «Mientras tanto, cámbialo desde la web.» |
| **Motor AceStream** (§10) | nada (`engineStatus`/`engineRestart` son `any`) | Sin cambios; «Ver salud de todos los servicios» lleva a Salud, que enseña lo de arriba. | — |
| Resto (Listas, Tu fútbol, Dónde, Apariencia, Acerca de) | nada | Sin cambios. | — |

Casos que con un servidor coherente no deberían darse pero quedan cubiertos:
`pairingCreate` 403 con la lista a la vista → fase `error` del panel con «No se
pudo crear el código. Esta opción necesita Ace Player Neo 0.8.1 o posterior en
tu Umbrel.» y la sección se repinta como la fila «Dispositivos» de la tabla;
`deviceRevoke` 403 sobre otro → toast err «No se pudo revocar «{nombre}». Esta
opción necesita Ace Player Neo 0.8.1 o posterior en tu Umbrel.» y lo mismo.

**Plan B local de la fila propia (solo con `servidorViejo`)**: el servidor
0.8.0 no deja al iPhone revocarse, así que «Olvidar» solo puede ser local (es
la propuesta de a7 §2.4):

- Mismo botón y mismo segundo toque de 5 s (§3.5.1), mismos rótulos «Olvidar» /
  «¿Olvidar? Pulsa otra vez», pero el aviso armado dice: «Este iPhone olvidará
  tu Umbrel, pero seguirá en su lista hasta que lo revoques desde la web.»
- Segundo toque: NO llama a `DELETE`; hace directamente el camino de salida de
  §3.5.2 paso 4.
- Aviso de motivo en la pantalla de emparejar (variante neutra de §3.5.4):
  «Has olvidado tu Umbrel en este iPhone. Sigue en la lista de la web hasta que
  lo revoques allí: Ajustes › Dispositivos.»

---

## 10. Lo más delicado

1. Abrir `pairingCreate` convierte cualquier iPhone emparejado en
   administrador que puede sembrar dispositivos: se mitiga con el código que
   muere al revocar a su creador y el `pairedBy` en el log; la cascada completa
   queda fuera porque `devices.json` es estricto y rompería la vuelta a la 0.8.0.
2. `devices.changed` es hoy «solo web» en `WEB_ONLY_EVENT_TYPES`; sin abrirlo,
   la lista y el «¡emparejado!» de la app no se enterarían en vivo. Tres tests
   de `events` cambian por eso.
3. La lista de rutas «retorcidas» de `security.test.ts` usa `devices` como
   ruta solo web: con el cambio, `?x=1` daría 200. Hay que moverla a
   `health/live`, la única ruta `web` que queda (motivo principal para NO abrir
   `healthLive`).
4. El QR con varias `u=` es compatible hacia atrás solo porque la app de la
   0.8.0 lee la primera; la app nueva tiene que leerlas todas y el servidor debe
   poner primero la que usa el iPhone que enseña el QR.
5. La reserva `baseUrlFromHeaders` desde `/native` depende de que la pasarela
   real de umbreld conserve el `Host`, cosa no comprobada: la app debe mandar
   siempre `baseUrl`.
6. «Olvidar este iPhone» (§3.5): el `devices.changed revoked` propio llega por
   SSE antes que el 200 del `DELETE`; sin la bandera `olvidando` la app se
   diría a sí misma «revocado desde otro dispositivo». Y si el `DELETE` falla
   por red, NO hay que salir en local: el iPhone quedaría activo en el servidor
   sin que nadie lo vea.
7. «Necesita la 0.8.1» (§9.1) es la nota de origen `--warn` de la web
   reutilizada, no un toast ni un vacío de error; en Salud se conserva el
   registro de fallos (sale de `diagnosticsList`, que ya es `any`) y el
   interruptor no se mueve porque la web no es optimista.
