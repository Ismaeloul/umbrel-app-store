/* Lo que hace el backend con cada petición que entra por el dominio de fuera
   (`https://tv.ismaeloul.es`, docs/acceso-remoto.md «Por el dominio»). La llama el hook
   `onRequest` de app.ts cuando la petición llegó por el puerto del dominio (core/edge.ts), ANTES
   de leer el cuerpo y en este orden:

   1. El par TCP es el contenedor de Caddy (`ACE_EDGE_PEER`); si no, 403 y un aviso.
   2. La IP de quien llama (`X-Ace-Client-Ip`, validada; core/edge.ts).
   3. Interruptor general apagado («Cerrar el dominio ya»): 403 `remote_disabled`, igual para todos.
   4. Solo /native/api/v1 (lo demás, 404) y cuerpo de 64 KiB como mucho.
   5. La ruta: desconocida, 404; el canje del código, 403 `pairing_local_only` (se empareja desde
      casa: doble cerradura con Caddy); `deny` o de sala, 403 `remote_forbidden_route`.
   6. La credencial: SIEMPRE token de dispositivo (también en `ping`), o la URL firmada en `video`
      (HMAC, aparato dentro, 60 s para empezar y tope de 6 h, como siempre). Se comprueba aquí,
      pero el error no sale todavía.
   7. IP bloqueada: el bloqueo es para quien no tiene llave. Quien trae una credencial buena (de un
      aparato emparejado, tenga o no permiso de fuera) no lo nota: la IP de un móvil se comparte
      por CGNAT. Sin credencial buena, 429 `remote_blocked`.
   8. Límites por IP (API, vídeo y sesiones nuevas), solo para quien no tiene permiso de fuera: un
      vecino de CGNAT no puede gastarle los cubos al iPhone de Isma. 429 `rate_limited`.
   9. Ahora sí, el error de la credencial (401) y el permiso de fuera del aparato (403
      `remote_forbidden`, y el suceso «tu iPhone X intentó entrar desde fuera»).
   10. Límites por aparato, `allow-self` (`deviceRevoke` solo sobre sí mismo) y SSE por IP (sin
       contar las del mismo aparato que el hub va a cerrar al abrir esta).

   Sin huella: mientras no hay una credencial buena (pasos 1 a 9), cualquier error sale como un 404
   sin cuerpo y sin cabeceras propias, igual que el 404 de Caddy (`concealRemoteError`, lo usa el
   manejador de errores de app.ts). El código de verdad queda en el registro y en los contadores.
   El error v1 en JSON (403 `remote_forbidden`, 429, 404 de un recurso…) solo lo ve un aparato
   emparejado.

   Lo que cuenta como fallo para el bloqueo (8 en 10 min) lo apunta `noteRemoteResponse` al
   terminar: toda respuesta 401, 403 o 404 por el dominio SIN una credencial buena, salvo
   `remote_disabled` (es igual para todos y no es un ataque). Los 429 no cuentan, ni lo que le pase
   a un aparato emparejado (un permiso caducado no debe acabar bloqueando su IP). Solo con una IP
   de internet: si Caddy no ve la IP real (Docker con userland-proxy, NAT de retorno), no se
   bloquea por ella y solo valen los límites por aparato.

   Lo que el dominio sirve a un aparato con permiso queda apuntado (`remote.trackResponse`) para
   cortarlo al momento si se le quita el permiso, caduca o se cierra el dominio. */

import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  REMOTE_LIMITS,
  SessionIdSchema,
  type V1RouteDefinition,
  type V1RouteId,
} from '@ace/shared';
import type { RemoteBucket, RemoteClient } from '../modules/remote/types.js';
import type { Services } from '../services.js';
import { CLIENT_IP_HEADER, normalizePeer, parseClientIp } from './edge.js';
import { AppError } from './errors.js';
import type { AuthenticatedDevice } from './module.js';
import { extractBearer, isNativePath, isV1Path } from './origin.js';
import { normalizeQuery } from './validation.js';

/** Lo que el dominio sabe de la petición (va en `request.aceRemote`). */
export interface RemoteRequestState extends RemoteClient {
  deviceId: string | null;
  /** La credencial era buena (un aparato emparejado), tenga o no permiso de fuera. */
  authenticated: boolean;
  /** El error de verdad, si salió como 404 sin huella (para el registro y el bloqueo). */
  concealed: { readonly status: number; readonly code: string | null } | null;
}

/** Rutas que cuentan como vídeo para los límites (cada segmento o tramo). */
const VIDEO_ROUTES: ReadonlySet<V1RouteId> = new Set<V1RouteId>(['video', 'vodDownload']);
/** Rutas que abren una sesión nueva (20 por IP y minuto). */
const SESSION_ROUTES: ReadonlySet<V1RouteId> = new Set<V1RouteId>(['channelStream', 'vodStream']);

/** Errores que NO suben el contador de fallos de la IP. */
const NOT_A_FAILURE = new Set(['remote_disabled']);

function retryAfter(reply: FastifyReply, seconds: number): void {
  reply.header('retry-after', String(Math.max(1, Math.ceil(seconds))));
}

async function credentialOf(
  request: FastifyRequest,
  routeId: V1RouteId,
  route: V1RouteDefinition,
  services: Services,
): Promise<AuthenticatedDevice> {
  if (route.credential === 'video-token') {
    const query = normalizeQuery(request.query);
    const token = typeof query.t === 'string' ? query.t : '';
    const sid = (request.params as { sid?: unknown } | undefined)?.sid;
    if (!token || !SessionIdSchema.safeParse(sid).success) {
      throw new AppError('video_token_invalid');
    }
    return services.auth.verifyVideoToken(token, sid as string, (sessionId, deviceId) =>
      services.playback.isViewerAlive(sessionId, deviceId),
    );
  }
  /* Todo lo demás (también `ping`, que desde casa no lo pide): token de dispositivo. */
  const token = extractBearer(request.headers.authorization);
  if (!token) throw new AppError('unauthorized', { detail: `dominio sin token (${routeId})` });
  return services.auth.authenticateBearer(token);
}

export async function remoteGate(
  request: FastifyRequest,
  reply: FastifyReply,
  routeId: V1RouteId | undefined,
  route: V1RouteDefinition | undefined,
  services: Services,
): Promise<void> {
  const { remote } = services;
  const peer = request.raw.socket.remoteAddress;
  if (!(await remote.peer.check(peer))) {
    remote.recordPeerMismatch(normalizePeer(peer));
    request.aceRemote = {
      ip: null,
      key: null,
      trusted: false,
      deviceId: null,
      authenticated: false,
      concealed: null,
    };
    throw new AppError('origin_forbidden', { detail: 'puerto del dominio: no viene de Caddy' });
  }

  const client = parseClientIp(request.headers[CLIENT_IP_HEADER]);
  const state: RemoteRequestState = {
    ...client,
    deviceId: null,
    authenticated: false,
    concealed: null,
  };
  request.aceRemote = state;
  if (!client.trusted) remote.count('ipUntrusted');

  if (!remote.enabled()) throw new AppError('remote_disabled');

  const url = request.url;
  if (!isNativePath(url) || !isV1Path(url)) throw new AppError('not_found');
  const length = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(length) && length > REMOTE_LIMITS.maxBodyBytes) {
    throw new AppError('body_too_large');
  }
  if (!route || !routeId) throw new AppError('not_found');
  if (routeId === 'pairingClaim') throw new AppError('pairing_local_only');
  if (route.remote === 'deny' || route.credential === 'party') {
    throw new AppError('remote_forbidden_route', { detail: routeId });
  }

  let device: AuthenticatedDevice | null = null;
  let credentialError: unknown = null;
  try {
    device = await credentialOf(request, routeId, route, services);
  } catch (error) {
    credentialError = error;
  }
  const allowed = device !== null && remote.isAllowed(device.deviceId);
  state.authenticated = device !== null;

  const key = client.trusted ? client.key : null;
  if (key !== null && device === null) {
    const blockedMs = remote.blockedForMs(key);
    if (blockedMs > 0) {
      remote.count('blocked');
      retryAfter(reply, blockedMs / 1000);
      throw new AppError('remote_blocked');
    }
  }

  const bucket: RemoteBucket = VIDEO_ROUTES.has(routeId) ? 'video' : 'api';
  if (key !== null && !allowed) {
    const wait =
      remote.takeIp(bucket, key) ??
      (SESSION_ROUTES.has(routeId) ? remote.takeIp('session', key) : null);
    if (wait !== null) {
      retryAfter(reply, wait);
      throw new AppError('rate_limited');
    }
  }

  if (credentialError !== null || device === null) throw credentialError;
  state.deviceId = device.deviceId;
  if (!allowed) {
    remote.recordDenied(device.deviceId, client, routeId);
    throw new AppError('remote_forbidden');
  }

  const deviceWait = remote.takeDevice(bucket, device.deviceId);
  if (deviceWait !== null) {
    retryAfter(reply, deviceWait);
    throw new AppError('rate_limited');
  }

  if (route.remote === 'allow-self') {
    const target = (request.params as { id?: unknown } | undefined)?.id;
    if (target !== device.deviceId) {
      throw new AppError('remote_forbidden_route', { detail: `${routeId} sobre otro aparato` });
    }
  }

  if (route.content === 'sse' && key !== null) {
    if (services.events.remoteConnections(key, device.deviceId) >= REMOTE_LIMITS.sse.perIp) {
      retryAfter(reply, 30);
      throw new AppError('rate_limited');
    }
  }

  request.aceDevice = device;
  remote.recordAccess(device.deviceId, client, routeId);
  /* Lo que puede durar (vídeo, descargas): se corta destruyendo la respuesta. El SSE lo cierra el
     hub (closeRemote) y lo JSON es corto (y cortarlo rompería, p. ej., el «Olvidar este iPhone»
     del propio aparato, que se revoca a sí mismo). */
  if (route.content === 'binary') remote.trackResponse(device.deviceId, reply.raw);
}

/** Cabeceras que pone el backend y que un 404 sin huella no debe llevar. */
const CONCEALED_HEADERS = ['x-request-id', 'retry-after', 'www-authenticate', 'cache-control'];

/**
 * ¿Hay que esconder este error del dominio? Mientras no hay una credencial buena, sí: se contesta
 * 404 sin cuerpo (como Caddy) y el código de verdad queda en `state.concealed`. Devuelve true si
 * ya ha preparado la respuesta (el que llama solo tiene que mandar `reply.code(404).send()`).
 */
export function concealRemoteError(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  code: string | null,
): boolean {
  const state = request.aceRemote;
  if (!state || state.authenticated) return false;
  state.concealed = { status, code };
  for (const name of CONCEALED_HEADERS) reply.removeHeader(name);
  return true;
}

/** Al terminar una petición del dominio: contadores de 24 h y, si es un fallo, a la cuenta de la IP. */
export function noteRemoteResponse(
  request: FastifyRequest,
  sentStatus: number,
  sentCode: string | null,
  services: Services,
): void {
  const state = request.aceRemote;
  if (!state) return;
  const { remote } = services;
  /* Lo que de verdad pasó, aunque saliera como un 404 sin huella. */
  const status = state.concealed?.status ?? sentStatus;
  const errorCode = state.concealed ? state.concealed.code : sentCode;
  if (status < 400) {
    remote.count('ok');
    return;
  }
  if (status === 429) return;
  if (status === 401 || status === 403) remote.count('denied');
  if (status !== 401 && status !== 403 && status !== 404) return;
  if (errorCode !== null && NOT_A_FAILURE.has(errorCode)) return;
  /* El bloqueo es para quien no tiene llave: lo de un aparato emparejado no cuenta. */
  if (state.authenticated) return;
  if (state.trusted && state.key !== null) remote.recordFailure(state.key, state.ip);
}
