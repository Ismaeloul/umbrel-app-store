/* Implementación del módulo `auth` (arquitectura §5.12 y §7.3; D4).

   Módulo nuevo en la 0.7.0: server.js no autenticaba nada (la web la
   protege el login de Umbrel). Aquí vive lo de la app iOS:

   - Emparejamiento: un código de 6 dígitos (`crypto.randomInt`) vivo como
     mucho, 5 minutos, un solo uso. Del código solo se guarda en memoria su
     HMAC con la clave `ace-pair-v1`, y el canje lo compara en tiempo
     constante. 5 fallos por código (al quinto muere) y 10 intentos por
     minuto en total, sin mirar la IP (el backend solo ve la de nginx).
   - Desde la 0.8.1 también crea códigos un iPhone emparejado: el QR lleva
     sus dos direcciones (una `u=` por dirección) y, solo en memoria, quién lo
     creó; si ese iPhone se revoca, su código muere (no se puede dejar
     sembrado un emparejamiento).
   - Token `<deviceId>.<secreto de 256 bits en base64url>`: en
     v2/devices.json solo va `sha256(secreto)`; el token en claro solo sale en
     la respuesta del canje. Nunca se escribe en el log.
   - Bearer: se busca el dispositivo por id, se compara el sha256 con
     `timingSafeEqual` y se mira que no esté revocado. `lastSeenAt` se guarda
     como mucho una vez por minuto y sin hacer esperar a la petición.
   - URLs de vídeo: `t = base64url(payload) "." base64url(HMAC-SHA256(clave
     ace-video-v1, base64url(payload)))`, payload `{ sid, dev, exp }` con
     `exp` a 60 s. Pasado `exp` sigue valiendo mientras playback diga que el
     visor de ese dispositivo sigue vivo en esa sesión, con tope de 6 h desde
     que se firmó (`exp - 60 s`). Revocar el dispositivo la anula al momento. */

import { randomBytes as nodeRandomBytes, randomInt as nodeRandomInt } from 'node:crypto';
import QRCode from 'qrcode';
import { z } from 'zod';
import {
  AUTH_TIMINGS,
  DEVICE_SECRET_BYTES,
  DeviceIdSchema,
  PAIRING_ATTEMPTS_PER_CODE,
  PAIRING_ATTEMPTS_PER_MINUTE,
  PAIRING_BASE_URL_RE,
  PAIRING_CODE_DIGITS,
  PAIRING_CREATES_PER_DEVICE_PER_MINUTE,
  SessionIdSchema,
  TIMEOUTS,
  type Device,
  type DeviceRecord,
  type DevicesFile,
  type DevicesListResponse,
  type DeviceRevokeResponse,
  type PairingClaimBody,
  type PairingClaimResponse,
  type PairingCreateBody,
  type PairingCreateResponse,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import type { AuthenticatedDevice } from '../../core/module.js';
import type { JsonDocumentStore } from '../state/types.js';
import { BASE64URL_RE, equalDigests, equalStrings, hmac, sha256, sha256Hex } from './crypto.js';
import type { AuthDeps, AuthService, VideoTokenInput } from './types.js';

/** `lastSeenAt` se guarda como mucho una vez por este intervalo (arquitectura §5.12). */
export const LAST_SEEN_THROTTLE_MS = AUTH_TIMINGS.lastSeenThrottleMs;
/** Ventana del límite global de canjes (10 por minuto). */
export const PAIRING_WINDOW_MS = AUTH_TIMINGS.pairingWindowMs;
/** Bytes aleatorios del id de un dispositivo (`dev_` + 16 caracteres base64url). */
const DEVICE_ID_BYTES = 12;
/** Longitud del secreto en base64url (32 bytes → 43 caracteres). */
const SECRET_LENGTH = Math.ceil((DEVICE_SECRET_BYTES * 8) / 6);
/** Tope de longitud de un token de vídeo (el de VideoQuerySchema). */
const MAX_VIDEO_TOKEN_LENGTH = 2048;
/**
 * Origen http(s) sin ruta ni credenciales, como pide PairingCreateBodySchema
 * (también para la reserva de las cabeceras, que no pasa por el zod).
 */
const BASE_URL_RE = PAIRING_BASE_URL_RE;

/** Lo que va firmado en la URL de vídeo. */
const VideoTokenPayloadSchema = z.strictObject({
  sid: SessionIdSchema,
  dev: DeviceIdSchema,
  exp: z.number().int().positive(),
});
export type VideoTokenPayload = z.infer<typeof VideoTokenPayloadSchema>;

/** Azar inyectable (tests deterministas); por defecto, el de node:crypto. */
export interface AuthRandom {
  /** Entero en [0, max). */
  randomInt(max: number): number;
  randomBytes(size: number): Buffer;
}

export interface AuthOptions {
  readonly random?: AuthRandom;
}

/** Lo que los tests pueden mirar además de la interfaz pública. */
export interface AuthServiceInternal extends AuthService {
  /** Espera a las escrituras de `lastSeenAt` que van por detrás. */
  flush(): Promise<void>;
  /** Estado del código vivo (sin el código): para tests y salud. */
  pairingStatus(): {
    readonly active: boolean;
    readonly failures: number;
    readonly expiresAt: number | null;
  };
}

interface PendingPairing {
  /** HMAC del código con la clave ace-pair-v1: el código en claro no se guarda. */
  readonly codeMac: Buffer;
  readonly expiresAt: number;
  /** Dispositivo que lo pidió por /native; null si lo pidió la web. Solo en memoria. */
  readonly createdBy: string | null;
  failures: number;
}

const defaultRandom: AuthRandom = {
  randomInt: (max) => nodeRandomInt(max),
  randomBytes: (size) => nodeRandomBytes(size),
};

/** Vista pública de un dispositivo: nunca lleva el hash del secreto. */
export function publicDevice(record: DeviceRecord): Device {
  return {
    id: record.id,
    name: record.name,
    platform: record.platform,
    createdAt: record.createdAt,
    lastSeenAt: record.lastSeenAt,
    revokedAt: record.revokedAt,
  };
}

/** Un hash de relleno para comparar aunque el dispositivo no exista (mismo trabajo, mismo tiempo). */
const MISSING_DEVICE_DIGEST = sha256('dispositivo-inexistente');

export function createAuth(deps: AuthDeps, options: AuthOptions = {}): AuthServiceInternal {
  const { clock, logger, bus, config } = deps;
  const random = options.random ?? defaultRandom;
  const videoKey = config.security.keys.video;
  const pairingKey = config.security.keys.pairing;

  let pending: PendingPairing | null = null;
  /** Instantes de los últimos canjes (límite global por minuto). */
  let attempts: number[] = [];
  /** Instantes de los últimos códigos creados por cada iPhone (límite por minuto). */
  const createdByDevice = new Map<string, number[]>();
  /** Última escritura de `lastSeenAt` por dispositivo (en memoria, para no escribir en cada petición). */
  const lastSeenWritten = new Map<string, number>();
  const pendingWrites = new Set<Promise<void>>();

  const store = (): JsonDocumentStore<DevicesFile> => deps.state.devices();
  const iso = (ms: number): string => new Date(ms).toISOString();
  const findDevice = (id: string): DeviceRecord | undefined =>
    store()
      .read()
      .devices.find((device) => device.id === id);

  function track(write: Promise<void>): void {
    pendingWrites.add(write);
    void write.finally(() => pendingWrites.delete(write));
  }

  function touchLastSeen(record: DeviceRecord): void {
    const now = clock.now();
    const previous =
      lastSeenWritten.get(record.id) ??
      (record.lastSeenAt === null ? null : Date.parse(record.lastSeenAt));
    if (previous !== null && now - previous < LAST_SEEN_THROTTLE_MS) return;
    lastSeenWritten.set(record.id, now);
    const at = iso(now);
    track(
      store()
        .update((draft) => {
          const device = draft.devices.find((item) => item.id === record.id);
          if (device && device.revokedAt === null) device.lastSeenAt = at;
        })
        .catch((error: unknown) => {
          logger.warn({ err: error, deviceId: record.id }, 'no se pudo guardar lastSeenAt');
        }),
    );
  }

  function codeMac(code: string): Buffer {
    return hmac(pairingKey, code);
  }

  function checkRateLimit(now: number): void {
    attempts = attempts.filter((at) => now - at < PAIRING_WINDOW_MS);
    if (attempts.length >= PAIRING_ATTEMPTS_PER_MINUTE) {
      logger.warn({ errorCode: 'pairing_rate_limited' }, 'emparejamiento: demasiados intentos');
      throw new AppError('pairing_rate_limited');
    }
    attempts.push(now);
  }

  /** Un iPhone no puede crear más de 5 códigos por minuto (la web no tiene tope). */
  function checkCreateRateLimit(deviceId: string, now: number): void {
    const recent = (createdByDevice.get(deviceId) ?? []).filter(
      (at) => now - at < PAIRING_WINDOW_MS,
    );
    if (recent.length >= PAIRING_CREATES_PER_DEVICE_PER_MINUTE) {
      createdByDevice.set(deviceId, recent);
      logger.warn(
        { errorCode: 'pairing_rate_limited', deviceId },
        'emparejamiento: demasiados códigos pedidos por un dispositivo',
      );
      throw new AppError('pairing_rate_limited');
    }
    recent.push(now);
    createdByDevice.set(deviceId, recent);
  }

  function videoSignature(encodedPayload: string): string {
    return hmac(videoKey, encodedPayload).toString('base64url');
  }

  function parseVideoToken(token: string): VideoTokenPayload | null {
    if (typeof token !== 'string' || token.length > MAX_VIDEO_TOKEN_LENGTH) return null;
    const dot = token.indexOf('.');
    if (dot <= 0 || token.indexOf('.', dot + 1) !== -1) return null;
    const encoded = token.slice(0, dot);
    const signature = token.slice(dot + 1);
    if (!BASE64URL_RE.test(encoded) || !BASE64URL_RE.test(signature)) return null;
    if (!equalStrings(signature, videoSignature(encoded))) return null;
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    const parsed = VideoTokenPayloadSchema.safeParse(payload);
    return parsed.success ? parsed.data : null;
  }

  return {
    async start() {},

    async stop() {
      await Promise.allSettled([...pendingWrites]);
    },

    async flush() {
      await Promise.allSettled([...pendingWrites]);
    },

    pairingStatus() {
      return {
        active: pending !== null && clock.now() < pending.expiresAt,
        failures: pending?.failures ?? 0,
        expiresAt: pending?.expiresAt ?? null,
      };
    },

    async createPairing(
      body: PairingCreateBody,
      fallbackBaseUrl: string,
      createdBy: string | null = null,
    ) {
      const clean = (url: string) => url.replace(/\/+$/, '');
      const baseUrl = clean(body.baseUrl ?? fallbackBaseUrl);
      if (!BASE_URL_RE.test(baseUrl)) {
        throw new AppError('bad_request', { detail: 'URL base del emparejamiento no válida' });
      }
      /* Una `u=` por dirección: la de `baseUrl` la primera (la app de la 0.8.0
         lee solo esa) y luego las alternativas, en orden y sin repetidas. */
      const urls = [baseUrl];
      for (const raw of body.alternateBaseUrls ?? []) {
        const url = clean(raw);
        if (!BASE_URL_RE.test(url)) {
          throw new AppError('bad_request', {
            detail: 'URL alternativa del emparejamiento no válida',
          });
        }
        if (!urls.some((known) => known.toLowerCase() === url.toLowerCase())) urls.push(url);
      }
      const now = clock.now();
      if (createdBy !== null) checkCreateRateLimit(createdBy, now);
      const code = String(random.randomInt(10 ** PAIRING_CODE_DIGITS)).padStart(
        PAIRING_CODE_DIGITS,
        '0',
      );
      const expiresAt = now + TIMEOUTS.pairingCodeTtlMs;
      const query = urls.map((url) => `u=${encodeURIComponent(url)}`).join('&');
      const pairUri = `aceneo://pair?${query}&c=${code}`;
      /* El QR se dibuja ANTES de tocar el código vivo: si falla, el que ya
         tenía alguien a la vista sigue valiendo. Con BASE_URL_RE las tres
         direcciones caben de sobra; el catch es por si acaso (400, no 500). */
      let qrSvg: string;
      try {
        qrSvg = await QRCode.toString(pairUri, {
          type: 'svg',
          errorCorrectionLevel: 'M',
          margin: 2,
        });
      } catch {
        throw new AppError('bad_request', {
          detail: 'direcciones demasiado largas para el QR',
        });
      }
      /* Uno nuevo anula el anterior: solo hay un código vivo. */
      pending = { codeMac: codeMac(code), expiresAt, createdBy, failures: 0 };
      logger.info(
        { expiresAt: iso(expiresAt), createdBy, addresses: urls.length },
        'código de emparejamiento creado',
      );
      const response: PairingCreateResponse = {
        code,
        expiresAt: iso(expiresAt),
        ttlMs: TIMEOUTS.pairingCodeTtlMs,
        pairUri,
        qrSvg,
      };
      return response;
    },

    async claimPairing(body: PairingClaimBody) {
      const now = clock.now();
      checkRateLimit(now);
      const current = pending;
      if (!current || now >= current.expiresAt) {
        pending = null;
        throw new AppError('pairing_expired');
      }
      /* Tiempo constante: se comparan los HMAC (32 bytes siempre). */
      const matches = equalDigests(codeMac(String(body.code)), current.codeMac);
      if (!matches) {
        current.failures += 1;
        if (current.failures >= PAIRING_ATTEMPTS_PER_CODE) {
          pending = null;
          logger.warn({ failures: current.failures }, 'emparejamiento: código anulado por fallos');
        } else {
          logger.info({ failures: current.failures }, 'emparejamiento: código incorrecto');
        }
        throw new AppError('pairing_invalid');
      }
      /* Un solo uso: se consume ANTES de cualquier await (dos canjes a la vez no valen los dos). */
      const pairedBy = current.createdBy;
      pending = null;

      const deviceId = `dev_${random.randomBytes(DEVICE_ID_BYTES).toString('base64url')}`;
      const secret = random.randomBytes(DEVICE_SECRET_BYTES).toString('base64url');
      const at = iso(now);
      const name = String(body.name).trim().slice(0, 60) || 'Dispositivo';
      const record: DeviceRecord = {
        id: deviceId,
        name,
        platform: body.platform,
        secretSha256: sha256Hex(secret),
        createdAt: at,
        lastSeenAt: at,
        revokedAt: null,
      };
      await store().update((draft) => {
        draft.devices.push(record);
      });
      lastSeenWritten.set(deviceId, now);
      bus.emit('devices.changed', { reason: 'paired', deviceId });
      logger.info({ deviceId, platform: record.platform, pairedBy }, 'dispositivo emparejado');
      const response: PairingClaimResponse = {
        deviceId,
        token: `${deviceId}.${secret}`,
        device: publicDevice(record),
      };
      return response;
    },

    async authenticateBearer(token: string): Promise<AuthenticatedDevice> {
      const value = typeof token === 'string' ? token : '';
      const dot = value.indexOf('.');
      const deviceId = dot > 0 ? value.slice(0, dot) : '';
      const secret = dot > 0 ? value.slice(dot + 1) : '';
      if (
        !DeviceIdSchema.safeParse(deviceId).success ||
        secret.length !== SECRET_LENGTH ||
        !BASE64URL_RE.test(secret)
      ) {
        throw new AppError('unauthorized', { detail: 'token con forma no válida' });
      }
      const record = findDevice(deviceId);
      const expected = record ? Buffer.from(record.secretSha256, 'hex') : MISSING_DEVICE_DIGEST;
      const matches = equalDigests(sha256(secret), expected);
      if (!record || !matches) throw new AppError('unauthorized');
      /* Revocado: solo se dice a quien tiene el secreto bueno. */
      if (record.revokedAt !== null) throw new AppError('device_revoked');
      touchLastSeen(record);
      return { deviceId: record.id, device: record, via: 'bearer' };
    },

    signVideoToken(input: VideoTokenInput) {
      const payload: VideoTokenPayload = {
        sid: input.sessionId,
        dev: input.deviceId,
        exp: clock.now() + TIMEOUTS.videoUrlStartMs,
      };
      const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      return `${encoded}.${videoSignature(encoded)}`;
    },

    async verifyVideoToken(token, sessionId, isViewerAlive) {
      const payload = parseVideoToken(token);
      if (!payload || payload.sid !== sessionId) throw new AppError('video_token_invalid');
      const record = findDevice(payload.dev);
      if (!record) throw new AppError('video_token_invalid', { detail: 'dispositivo inexistente' });
      if (record.revokedAt !== null) throw new AppError('device_revoked');
      const now = clock.now();
      const signedAt = payload.exp - TIMEOUTS.videoUrlStartMs;
      if (now > signedAt + TIMEOUTS.videoUrlMaxMs) {
        throw new AppError('video_token_invalid', { detail: 'tope de 6 h superado' });
      }
      if (now > payload.exp && !isViewerAlive(payload.sid, payload.dev)) {
        throw new AppError('video_token_invalid', { detail: 'caducado y sin visor vivo' });
      }
      touchLastSeen(record);
      return { deviceId: record.id, device: record, via: 'video-token' };
    },

    listDevices(): DevicesListResponse {
      return { devices: store().read().devices.map(publicDevice) };
    },

    async revokeDevice(deviceId: string): Promise<DeviceRevokeResponse> {
      if (!findDevice(deviceId)) throw new AppError('device_not_found');
      const at = iso(clock.now());
      const result = await store().update((draft) => {
        const device = draft.devices.find((item) => item.id === deviceId);
        if (!device) return null;
        const changed = device.revokedAt === null;
        if (changed) device.revokedAt = at;
        return { device: { ...device }, changed };
      });
      if (!result) throw new AppError('device_not_found');
      lastSeenWritten.delete(deviceId);
      createdByDevice.delete(deviceId);
      /* Un código que creó este dispositivo no sobrevive a su revocación. */
      if (pending?.createdBy === deviceId) {
        pending = null;
        logger.info(
          { deviceId },
          'código de emparejamiento anulado: lo creó un dispositivo revocado',
        );
      }
      if (result.changed) {
        bus.emit('devices.changed', { reason: 'revoked', deviceId });
        logger.info({ deviceId }, 'dispositivo revocado');
      }
      return { device: publicDevice(result.device) };
    },
  };
}
