/* Aplicación HTTP (arquitectura §5.15): Fastify con las reglas de la 0.6.59
   para las rutas antiguas y las de /api/v1 para las nuevas.

   Orden de cada petición (hook onRequest, ANTES de leer el cuerpo):
   1. `X-Request-Id`: el de nginx si llega con forma válida; si no, uno nuevo.
      Sale en la respuesta y en el log.
   2. Origen (`X-Ace-Origin` o prefijo /native, core/origin.ts).
   3. Origen native: solo /api/v1 (lo demás, 403 `origin_forbidden`) y con
      credencial salvo ping y el canje del código (401 `unauthorized`); la
      comprobación del token la hace services.auth.
   4. Origen web: regla anti-CSRF de la 0.6.59, también para los GET con
      efectos (403 `cross_origin`, antes que el 404, como hoy).
   5. Rutas antiguas: enrutado exacto de la 0.6.59 (404/405 con la URL cruda).
   Luego Fastify lee el cuerpo (2 MiB → 413 `body_too_large`), valida con zod
   (v1) y llama al manejador del módulo. Errores con el formato de la ruta:
   `{ error: "<código>" }` en las antiguas y `{ error: { code, message,
   requestId } }` en v1 (core/errors.ts).

   Fastify NO sirve estáticos (los sirve nginx) ni loguea cada petición por
   su cuenta: el log de acceso lo escribe onResponse con la URL redactada. */

import { randomUUID } from 'node:crypto';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';
import {
  LEGACY_OPERATIONS,
  MAX_BODY_BYTES,
  V1_ROUTES,
  V1_ROUTE_IDS,
  nativePath,
  type Origin,
  type V1RouteDefinition,
  type V1RouteId,
} from '@ace/shared';
import { isAllowedMutation } from './core/csrf.js';
import { AppError, isAppError, toLegacyError, toV1Error } from './core/errors.js';
import {
  fastifyPathForLegacy,
  legacyOperationKey,
  resolveLegacyRoute,
} from './core/legacy-routing.js';
import { redactUrl } from './core/logger.js';
import type { AuthenticatedDevice, RequestContext } from './core/module.js';
import { ORIGIN_HEADER, extractBearer, isV1Path, resolveOrigin } from './core/origin.js';
import { createRouteCollector, type RouteCollector } from './core/router.js';
import { normalizeQuery, parseInput, parseOutput } from './core/validation.js';
import * as authRoutes from './modules/auth/routes.js';
import * as diagnosticsRoutes from './modules/diagnostics/routes.js';
import * as directoriesRoutes from './modules/directories/routes.js';
import * as engineRoutes from './modules/engine/routes.js';
import * as eventsRoutes from './modules/events/routes.js';
import * as footballRoutes from './modules/football/routes.js';
import * as healthRoutes from './modules/health/routes.js';
import * as iptvRoutes from './modules/iptv/routes.js';
import * as netRoutes from './modules/net/routes.js';
import * as playbackRoutes from './modules/playback/routes.js';
import * as remuxRoutes from './modules/remux/routes.js';
import * as scannerRoutes from './modules/scanner/routes.js';
import * as searchRoutes from './modules/search/routes.js';
import * as sourcesRoutes from './modules/sources/routes.js';
import * as stateRoutes from './modules/state/routes.js';
import * as teamsRoutes from './modules/teams/routes.js';
import type { Services } from './services.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** Origen de la petición (core/origin.ts). */
    aceOrigin: Origin;
    /** Dispositivo emparejado ya comprobado (solo origen native). */
    aceDevice: AuthenticatedDevice | null;
  }
  interface FastifyContextConfig {
    /** Id de la tabla de rutas v1 que atiende esta ruta. */
    v1RouteId?: V1RouteId;
    /** `MÉTODO ruta` de la operación antigua. */
    legacyKey?: string;
  }
}

/** Módulos que registran rutas, en el orden de SERVICE_ORDER. */
export const MODULE_ROUTES = [
  stateRoutes,
  netRoutes,
  iptvRoutes,
  engineRoutes,
  scannerRoutes,
  searchRoutes,
  sourcesRoutes,
  directoriesRoutes,
  remuxRoutes,
  playbackRoutes,
  footballRoutes,
  teamsRoutes,
  authRoutes,
  eventsRoutes,
  diagnosticsRoutes,
  healthRoutes,
] as const;

export interface BuildAppOptions {
  readonly services: Services;
  /** `false` para no registrar las rutas de los módulos (tests del núcleo). */
  readonly moduleRoutes?: boolean;
  /** Manejadores de más, después de los módulos (tests). */
  readonly register?: (collector: RouteCollector) => void;
}

/* Un `X-Request-Id` que llega de fuera se acepta solo con forma inocua: va
   al log y a la respuesta, y no puede meter saltos de línea ni basura. */
const REQUEST_ID_RE = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Rutas cuya consulta es lo que Isma escribe en el buscador de su IPTV
 * (docs/iptv.md §14.2) o en la pestaña IPTV de Canales (§16.2): ni en un
 * 400 se escribe en el registro.
 */
const QUIET_QUERY_ROUTES: ReadonlySet<string> = new Set(['iptvChannels', 'iptvBrowse']);

/** La URL para el registro: redactada y, en esas rutas, sin la consulta. */
export function loggedUrl(url: string, routeId: string | undefined): string {
  if (routeId && QUIET_QUERY_ROUTES.has(routeId)) {
    const mark = url.indexOf('?');
    return mark < 0 ? url : `${url.slice(0, mark)}?[consulta]`;
  }
  return redactUrl(url);
}

export function requestIdFrom(header: string | string[] | undefined): string {
  const value = Array.isArray(header) ? header[0] : header;
  return value && REQUEST_ID_RE.test(value) ? value : randomUUID();
}

function requestContext(request: FastifyRequest, reply: FastifyReply): RequestContext {
  const controller = new AbortController();
  /* `close` llega también al terminar bien; solo es un cuelgue si la
     respuesta no se llegó a escribir entera. */
  reply.raw.once('close', () => {
    if (!reply.raw.writableFinished) controller.abort(new Error('client_closed'));
  });
  return {
    requestId: request.id,
    origin: request.aceOrigin,
    device: request.aceDevice,
    signal: controller.signal,
    request,
    reply,
  };
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { services } = options;
  const app = Fastify({
    loggerInstance: services.logger as FastifyBaseLogger,
    /* Sin el log de entrada/salida de Fastify: el de onResponse redacta la URL. */
    logController: new Fastify.LogController({ disableRequestLogging: true }),
    bodyLimit: MAX_BODY_BYTES,
    requestIdHeader: false,
    genReqId: (req) => requestIdFrom(req.headers['x-request-id']),
    /* HEAD solo donde la tabla lo declara (/remux/): en las rutas JSON de la
       0.6.59 un HEAD da 405. */
    exposeHeadRoutes: false,
    return503OnClosing: true,
    /* Una URL con escapes rotos (`/api/%zz`) no llega a los hooks: se contesta
       aquí con el mismo formato que el resto. */
    frameworkErrors: (error, request, genericReply) => {
      /* El tipo genérico de esta respuesta no admite códigos arbitrarios. */
      const reply = genericReply as unknown as FastifyReply;
      const url = request.url;
      reply.header('x-request-id', request.id);
      if (isV1Path(url)) {
        const out = toV1Error(new AppError('not_found', { cause: error }), request.id);
        void reply.code(out.status).send(out.body);
        return;
      }
      const allowed = isAllowedMutation({ method: request.method, url, headers: request.headers });
      const out = toLegacyError(new AppError(allowed ? 'not_found' : 'cross_origin'));
      void reply.code(out.status).send(out.body);
    },
  });

  /* La 0.6.59 no mira Content-Type: cualquier cuerpo se intenta parsear como
     JSON, vacío = `{}` y roto = 400 `bad_json` (api.md §2.4). También lo que
     manda `sendBeacon` (text/plain). */
  app.removeAllContentTypeParsers();
  app.addContentTypeParser('*', { parseAs: 'string' }, (_request, body, done) => {
    const text = typeof body === 'string' ? body : body.toString('utf8');
    if (text === '') {
      done(null, {});
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new AppError('bad_json'), undefined);
    }
  });

  app.decorateRequest('aceOrigin', 'web');
  app.decorateRequest('aceDevice', null);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
    const url = request.url;
    const origin = resolveOrigin(request.headers[ORIGIN_HEADER], url);
    request.aceOrigin = origin;
    request.aceDevice = null;
    const routeId = request.routeOptions.config?.v1RouteId;
    const route: V1RouteDefinition | undefined = routeId ? V1_ROUTES[routeId] : undefined;

    if (origin === 'native') {
      /* La app iOS solo usa v1: las antiguas y cualquier otra cosa, 403. */
      if (!isV1Path(url)) throw new AppError('origin_forbidden');
      /* Una ruta v1 desconocida también pide token: sin él no se revela qué existe. */
      const credential = route?.credential ?? 'bearer';
      if (credential === 'bearer') {
        const token = extractBearer(request.headers.authorization);
        if (!token) throw new AppError('unauthorized');
        request.aceDevice = await services.auth.authenticateBearer(token);
      } else if (credential === 'video-token') {
        /* Aquí solo que llegue; se comprueba en la ruta, que conoce el `:sid`. */
        const query = normalizeQuery(request.query);
        if (typeof query.t !== 'string' || !query.t) throw new AppError('video_token_invalid');
      }
      return;
    }

    const mutation = { method: request.method, url, headers: request.headers };
    if (!isAllowedMutation(mutation, { sideEffectGet: route?.sideEffects === true })) {
      throw new AppError('cross_origin');
    }

    if (!isV1Path(url)) {
      const resolution = resolveLegacyRoute(request.method, url);
      if (resolution.kind === 'not_found') throw new AppError('not_found');
      if (resolution.kind === 'method_not_allowed') {
        /* /remux/ con otro método: 405 sin cuerpo (server.js:4929). */
        if (resolution.emptyBody) return reply.code(405).send();
        throw new AppError('method_not_allowed');
      }
    }
  });

  app.addHook('onSend', async (_request, reply, payload) => {
    /* Las cabeceras de `send()` de la 0.6.59 (api.md §2.5), en todas. */
    if (!reply.hasHeader('cache-control')) reply.header('cache-control', 'no-store');
    reply.header('x-content-type-options', 'nosniff');
    return payload;
  });

  app.addHook('onResponse', async (request, reply) => {
    const entry = {
      reqId: request.id,
      method: request.method,
      url: loggedUrl(request.url, request.routeOptions.config?.v1RouteId),
      status: reply.statusCode,
      ms: Math.round(reply.elapsedTime),
      origin: request.aceOrigin,
    };
    if (reply.statusCode >= 400) request.log.info(entry, 'petición');
    else request.log.debug(entry, 'petición');
  });

  app.setErrorHandler((error, request, reply) => {
    const v1 = isV1Path(request.url);
    const out = v1 ? toV1Error(error, request.id) : toLegacyError(error);
    if (out.internal) {
      request.log.error({ err: error, reqId: request.id }, 'error interno');
    } else if (isAppError(error) && (error.detail || error.data)) {
      request.log.debug(
        { reqId: request.id, errorCode: error.code, detail: error.detail, data: error.data },
        'petición rechazada',
      );
    }
    /* Un 401 de v1 dice cómo autenticarse (RFC 9110 §11.6.1). */
    if (v1 && out.status === 401) reply.header('www-authenticate', 'Bearer');
    return reply.code(out.status).send(out.body);
  });

  app.setNotFoundHandler(() => {
    throw new AppError('not_found');
  });

  const collector = createRouteCollector();
  if (options.moduleRoutes !== false) {
    for (const module of MODULE_ROUTES) {
      module.registerLegacyRoutes(collector.legacy, services);
      module.registerV1Routes(collector.v1, services);
    }
  }
  options.register?.(collector);

  registerV1(app, collector, services);
  registerLegacy(app, collector);
  return app;
}

function registerV1(app: FastifyInstance, collector: RouteCollector, services: Services): void {
  for (const id of V1_ROUTE_IDS) {
    const route: V1RouteDefinition = V1_ROUTES[id];
    const handler = collector.v1Handlers.get(id);
    const handle = async (request: FastifyRequest, reply: FastifyReply): Promise<unknown> => {
      if (route.access === 'web' && request.aceOrigin !== 'web')
        throw new AppError('origin_forbidden');
      if (route.access === 'native' && request.aceOrigin !== 'native') {
        throw new AppError('origin_forbidden');
      }
      const params = route.params ? parseInput(route.params, request.params, 'params') : {};
      const query = route.query
        ? parseInput(route.query, normalizeQuery(request.query), 'query')
        : {};
      const body = route.body ? parseInput(route.body, request.body ?? {}, 'body') : undefined;
      if (route.credential === 'video-token' && request.aceOrigin === 'native') {
        const { t } = query as { t: string };
        const { sid } = params as { sid: string };
        request.aceDevice = await services.auth.verifyVideoToken(t, sid, (sessionId, deviceId) =>
          services.playback.isViewerAlive(sessionId, deviceId),
        );
      }
      if (!handler) throw new AppError('not_implemented', { detail: `ruta v1 ${id}` });
      const result = await handler(
        { params, query, body } as Parameters<typeof handler>[0],
        requestContext(request, reply),
      );
      if (route.response === null) {
        if (!reply.sent) throw new AppError('internal_error', { detail: `${id} no respondió` });
        return reply;
      }
      return reply.code(route.status).send(parseOutput(route.response, result, id));
    };
    for (const url of [route.path, nativePath(route.path)]) {
      app.route({ method: route.method, url, config: { v1RouteId: id }, handler: handle });
    }
  }
}

function registerLegacy(app: FastifyInstance, collector: RouteCollector): void {
  for (const operation of LEGACY_OPERATIONS) {
    const key = legacyOperationKey(operation);
    const handler = collector.legacyHandlers.get(key);
    app.route({
      method: operation.method,
      url: fastifyPathForLegacy(operation),
      config: { legacyKey: key },
      handler: async (request, reply) => {
        if (!handler) throw new AppError('not_implemented', { detail: `ruta antigua ${key}` });
        const url = request.url;
        const mark = url.indexOf('?');
        const result = await handler(
          {
            method: operation.method,
            url,
            query: new URLSearchParams(mark < 0 ? '' : url.slice(mark + 1)),
            body: operation.readsBody ? (request.body ?? {}) : undefined,
          },
          requestContext(request, reply),
        );
        if (reply.sent) return reply;
        if (result === undefined) {
          throw new AppError('internal_error', { detail: `${key} no devolvió nada ni respondió` });
        }
        return reply.code(200).send(result);
      },
    });
  }
}
