/* Módulo `auth`: emparejamiento de la app iOS, tokens de dispositivo, URLs de
   vídeo firmadas y límites (arquitectura §5.12 y §7.3; D4).

   - Código de 6 dígitos (`crypto.randomInt`), QR
     `aceneo://pair?u=<URL base>[&u=<otra>…]&c=<código>`, 5 minutos, un solo uso y uno
     vivo como mucho. 5 intentos por código y 10 por minuto en total (no por
     IP: el backend solo ve la de nginx). Comparación en tiempo constante.
   - Token `<deviceId>.<secreto de 256 bits base64url>`; en v2/devices.json
     solo `sha256(secreto)`. `lastSeenAt` como mucho una vez por minuto.
   - Revocar cierra su SSE, suelta sus visores y anula al instante sus URLs
     de vídeo (se entera todo el mundo por `devices.changed`).
   - Desde la 0.8.1 crear códigos, listar y revocar también lo puede hacer un
     iPhone emparejado; un código creado por un iPhone muere si ese iPhone se
     revoca.
   - URL de vídeo: `t = base64url(payload) + "." + HMAC-SHA256(clave
     ace-video-v1, payload)` con `{ sid, dev, exp }`, `exp` a 60 s; mientras
     el visor siga vivo en esa sesión vale aunque pase `exp`, con tope de 6 h.

   La capa HTTP (app.ts) decide QUÉ credencial hace falta según el origen y
   la tabla de rutas; este módulo solo dice si una credencial es buena.

   Tests previstos: plan E1.8 (emparejamiento, límites, revocación y firma),
   más los de acceso de test/app.test.ts. */

import type {
  DevicesListResponse,
  DeviceRevokeResponse,
  PairingClaimBody,
  PairingClaimResponse,
  PairingCreateBody,
  PairingCreateResponse,
} from '@ace/shared';
import type { AuthenticatedDevice, CoreDeps, Lifecycle } from '../../core/module.js';
import type { StateService } from '../state/types.js';

export interface AuthDeps extends CoreDeps {
  readonly state: StateService;
}

export interface VideoTokenInput {
  readonly sessionId: string;
  readonly deviceId: string;
}

export interface AuthService extends Lifecycle {
  /**
   * POST /api/v1/pairing (web o iPhone). `baseUrl` y `alternateBaseUrls` para
   * el QR; si falta `baseUrl`, se deduce de las cabeceras. `createdBy`: el
   * dispositivo que lo pide desde /native (null desde la web). Lanza
   * `bad_request` si alguna URL no vale.
   */
  createPairing(
    body: PairingCreateBody,
    fallbackBaseUrl: string,
    createdBy?: string | null,
  ): Promise<PairingCreateResponse>;
  /**
   * POST /api/v1/pairing/claim (sin token). Lanza `pairing_invalid`,
   * `pairing_expired` o `pairing_rate_limited`. Emite `devices.changed`.
   */
  claimPairing(body: PairingClaimBody): Promise<PairingClaimResponse>;
  /**
   * Comprueba `Authorization: Bearer <token>` de una petición native. Lanza
   * `unauthorized` o `device_revoked`. Nunca escribe el token en el log.
   */
  authenticateBearer(token: string): Promise<AuthenticatedDevice>;
  /** Firma una URL de vídeo para un visor (60 s para empezar a usarla). */
  signVideoToken(input: VideoTokenInput): string;
  /**
   * Comprueba el `?t=` de /api/v1/video/:sid/:file. Lanza
   * `video_token_invalid` o `device_revoked`. `isViewerAlive` lo da playback
   * (vía app.ts) para aceptar tokens pasados de `exp` con el visor vivo.
   */
  verifyVideoToken(
    token: string,
    sessionId: string,
    isViewerAlive: (sessionId: string, deviceId: string) => boolean,
  ): Promise<AuthenticatedDevice>;
  listDevices(): DevicesListResponse;
  /**
   * DELETE /api/v1/devices/:id (web o iPhone, también el propio): lanza
   * `device_not_found`. Emite `devices.changed` (`revoked`). Si ese
   * dispositivo tenía un código de emparejamiento vivo, lo anula.
   */
  revokeDevice(deviceId: string): Promise<DeviceRevokeResponse>;
}

/**
 * Lo único de auth que necesitan las URLs de vídeo de iOS (añadido en la
 * Fase 1.1): firmar el `?t=` al dar la URL (la ruta `channelStream`, con
 * `services.auth`) y comprobarlo en /api/v1/video (lo hace app.ts antes del
 * manejador, con `playback.isViewerAlive`). Al reescribir cada m3u8, remux
 * reutiliza el `t` que le ha llegado: no hace falta volver a firmar.
 */
export type VideoUrlSigner = Pick<AuthService, 'signVideoToken' | 'verifyVideoToken'>;
