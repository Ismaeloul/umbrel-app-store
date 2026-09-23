/* Módulo `auth`: emparejamiento de la app iOS, tokens de dispositivo, URLs de
   vídeo firmadas y límites (arquitectura §5.12 y §7.3; D4).

   - Código de 6 dígitos (`crypto.randomInt`), QR
     `aceneo://pair?u=<URL base>&c=<código>`, 5 minutos, un solo uso y uno
     vivo como mucho. 5 intentos por código y 10 por minuto en total (no por
     IP: el backend solo ve la de nginx). Comparación en tiempo constante.
   - Token `<deviceId>.<secreto de 256 bits base64url>`; en v2/devices.json
     solo `sha256(secreto)`. `lastSeenAt` como mucho una vez por minuto.
   - Revocar cierra su SSE, suelta sus visores y anula al instante sus URLs
     de vídeo (se entera todo el mundo por `devices.changed`).
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
  /** POST /api/v1/pairing (solo web). `baseUrl` para el QR; si falta, se deduce de las cabeceras. */
  createPairing(body: PairingCreateBody, fallbackBaseUrl: string): Promise<PairingCreateResponse>;
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
  /** DELETE /api/v1/devices/:id: lanza `device_not_found`. Emite `devices.changed` (`revoked`). */
  revokeDevice(deviceId: string): Promise<DeviceRevokeResponse>;
}
