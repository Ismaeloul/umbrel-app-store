# Cobertura del módulo `auth` (Fase 1.1)

Emparejamiento de la app iOS, tokens de dispositivo y URLs de vídeo firmadas
(arquitectura §5.12 y §7.3; D4). Módulo nuevo en la 0.7.0: server.js no
autenticaba nada, así que no hay funciones que portar ni exportaciones
antiguas (`legacy-exports.ts` sigue vacío). Código en
`apps/server/src/modules/auth/`:

| Fichero | Qué hace |
|---|---|
| `service.ts` / `index.ts` | `createAuth(deps, { random })` (la fábrica `createAuthService(deps)` lo llama con el azar de node:crypto): código de emparejamiento, canje, Bearer, `lastSeenAt`, firma y comprobación de URLs de vídeo, lista y revocación |
| `crypto.ts` | sha256, HMAC y comparaciones con `timingSafeEqual` sobre resúmenes de 32 bytes |
| `routes.ts` | v1 `pairingCreate`, `pairingClaim`, `devicesList`, `deviceRevoke`; `baseUrlFromHeaders` para el QR |
| `types.ts` | + `VideoUrlSigner` (solo añadido) |
| `test-support.ts` | devices.json en memoria (misma semántica que el de state), `fakeState`, azar determinista |

Cómo queda cada pieza:

- **Código**: `crypto.randomInt(10^6)` con ceros a la izquierda; en memoria
  solo su HMAC con la clave `ace-pair-v1` (config/keys.ts). 5 min, un solo uso
  (se consume antes de cualquier `await`), uno vivo como mucho. QR con la
  librería `qrcode` (SVG) de `aceneo://pair?u=<encodeURIComponent(URL base)>&c=<código>`.
  URL base: la de la web (`baseUrl`) o, si no llega, `X-Forwarded-Proto`/
  `X-Forwarded-Host`/`Host` con forma válida (si nada vale, `http://localhost`).
- **Canje**: 10 intentos por minuto en total (ventana deslizante con el
  reloj inyectado; el intento rechazado por el límite no cuenta) y 5 fallos
  por código (el quinto responde `pairing_invalid` y lo anula; después,
  `pairing_expired`). Sin código vivo, caducado o ya usado: `pairing_expired`.
- **Token** `dev_<16 base64url>.<32 bytes base64url>`; en v2/devices.json
  (vía `state.devices()`, interfaz `JsonDocumentStore`) solo
  `sha256(secreto en base64url)` en hex. `lastSeenAt` = `createdAt` al
  emparejar y luego como mucho una vez por minuto, sin hacer esperar a la
  petición (`stop()` espera a lo pendiente).
- **Bearer**: forma estricta (id válido + 43 caracteres base64url), sha256
  comparado con `timingSafeEqual` (también contra un hash de relleno si el
  dispositivo no existe). Revocado → `device_revoked`, pero solo si el
  secreto es bueno; si no, `unauthorized` (no se revela nada).
- **URL de vídeo**: `t = base64url(JSON {sid,dev,exp}) "." base64url(HMAC-SHA256(ace-video-v1, base64url(payload)))`,
  `exp` = ahora + 60 s. Vale hasta `exp`; después, solo con
  `isViewerAlive(sid, dev)` (lo da playback vía app.ts) y como mucho 6 h
  desde la firma (`exp - 60 s + 6 h`). Dispositivo revocado → `device_revoked`
  al momento; inexistente, otra sesión, firma o payload manipulados, otra
  clave → `video_token_invalid`.

## Números

- 43 tests en `auth.test.ts` (29), `routes.test.ts` (9) y `timing.test.ts` (5), 0 saltados.
- Cobertura (`--coverage.include='src/modules/auth/**'`): líneas 98,6 %,
  sentencias 97,5 %, ramas 89,7 %, funciones 98,4 % (`service.ts`: 100 % de líneas).
- Sin red ni reloj real: FakeClock, `app.inject`, devices.json en memoria y,
  en un test, el `state` real sobre un DATA_DIR temporal (comprueba el
  fichero en disco).

## T-xxx

Ninguno: módulo nuevo (contratos.md §9, "nuevos, plan E1.7/E1.8"). Tests nuevos:

| Qué | Test(s) |
|---|---|
| Código de 6 dígitos, 5 min, QR `aceneo://` en SVG | `auth.test.ts` › "6 dígitos con randomInt(10^6)…", "sin baseUrl usa la deducida…", "el azar real da códigos…"; `routes.test.ts` › "flujo completo…", "URL base del QR…" |
| Un solo uso, uno vivo, caducidad | "un solo uso…", "dos canjes a la vez…", "solo hay un código vivo…", "caduca a los 5 minutos", "sin ningún código creado…" |
| Fuerza bruta (5 por código, 10 por minuto) | "fuerza bruta: al quinto fallo…", "fuerza bruta: 10 intentos por minuto…"; `routes.test.ts` › "errores del canje con su HTTP…" (401/410/429/400) |
| Comparación en tiempo constante | `timing.test.ts` (espía `timingSafeEqual`: siempre 32 contra 32 bytes, acierte o no, exista o no el dispositivo) |
| Solo el hash en disco | "da { deviceId, token, device }; guarda SOLO sha256…"; `routes.test.ts` › "flujo completo con el estado real…" (lee v2/devices.json) |
| Rutas nativas sin token, token manipulado, revocado | `routes.test.ts` › "native: sin token 401, token bueno 200, manipulado 401 y revocado 401 device_revoked", "el canje va sin token, pero crear códigos y administrar dispositivos es solo web"; `auth.test.ts` › "token manipulado, de otro dispositivo o con otra forma…", "revocado: device_revoked con el secreto bueno…" |
| Token caducado/manipulado (vídeo) | "t = base64url({ sid, dev, exp })…", "pasado exp solo vale con el visor vivo…", "tope absoluto de 6 h…", "manipulada, de otra sesión o con otra clave…", "revocar el dispositivo anula al momento…"; `routes.test.ts` › "URL de vídeo: …" |
| `lastSeenAt` 1/min | "lastSeenAt se guarda como mucho una vez por minuto", "un dispositivo sin lastSeenAt…", "si falla la escritura de lastSeenAt…" |
| Token/código/secreto fuera del log | "ni el código, ni el token, ni el secreto salen en el log"; `routes.test.ts` › "el token, el secreto, el código y el t= no salen en el log de peticiones" |
| Lista y revocación | "lista sin el hash del secreto…", "revocar marca revokedAt…", "uno que no existe…"; `routes.test.ts` › "web: lista y revoca…" |

## B-xxx

| B | Test(s) | Nota |
|---|---|---|
| B-227 | no aplica | anti-SSRF: es de `net` (T-004, T-005) |
| B-228 | no aplica | aislamiento de `engine_control`: empaquetado (A7) |
| B-229 | no aplica | token de engine-control: T-118 (engine-control) |
| B-230 | `routes.test.ts` › "crear un código desde otra web (anti-CSRF) da 403 cross_origin" | la regla es de app.ts (T-033, A0); aquí se comprueba que la ruta nueva con efectos la respeta |
| B-231 | no aplica | canales de la agenda al resolver: `football` |
| B-232 | no aplica | puerto del comprobador sin publicar: Compose (A7) |
| B-233 | no aplica | `proxy_redirect` de nginx (A7, T-126) |
| B-234 | no aplica | login de Umbrel y cabeceras de nginx (A7); el `no-store` de la API lo pone app.ts |

## Cambios de comportamiento (para docs/compat.md)

Nada cambia en las rutas antiguas. Lo nuevo (la 0.6.59 no tenía nada de esto):

1. `POST /api/v1/pairing/claim` sin código vivo (nunca creado, caducado, usado
   o anulado por fallos) responde 410 `pairing_expired`; el quinto fallo
   responde 401 `pairing_invalid` y anula el código.
2. Un token de un dispositivo revocado da 401 `device_revoked` solo si el
   secreto es el bueno; con otro secreto, 401 `unauthorized`.
3. `GET /api/v1/devices` incluye los revocados (con `revokedAt`), en el orden
   en que se emparejaron. Revocar dos veces devuelve lo mismo y solo avisa la
   primera (`devices.changed`).
4. En `pairUri`, `u=` va con `encodeURIComponent` (la app iOS lo decodifica).
5. `lastSeenAt` se rellena ya al emparejar (igual que `createdAt`), como en
   la fixture de `pairingClaim`.

## Cambios de contrato pedidos

- `@ace/shared/constants`: mover aquí `LAST_SEEN_THROTTLE_MS` (60 s) y la
  ventana de 60 s del límite de canjes (hoy constantes locales en `service.ts`).
- Añadido en `auth/types.ts` (sin romper nada): `VideoUrlSigner`.
- Para quien firma las URLs de iOS (playback/remux): `services.ts` crea `auth`
  DESPUÉS de `playback`, así que playback no puede recibir auth por sus deps.
  Solución sin tocar el grafo: la ruta `channelStream` (que recibe `services`)
  llama a `services.auth.signVideoToken({ sessionId, deviceId })` y añade
  `?t=` a la URL; el manejador de `video` (remux) reutiliza el `t` recibido al
  reescribir cada m3u8. La comprobación ya la hace app.ts.
- `test/app.test.ts` (A0) › "ping y el canje del código no piden token"
  espera 501 del canje: con el módulo hecho, el canje ya no es 501 (con el
  `fakeAuth` de ese test, que no tiene `claimPairing`, da 500). Debería
  comprobar solo que no es 401.
