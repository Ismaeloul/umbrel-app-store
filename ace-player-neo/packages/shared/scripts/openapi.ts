/* Genera docs/openapi-v2.yaml recorriendo la tabla de rutas v1 (src/routes.ts)
   y convirtiendo sus esquemas con `z.toJSONSchema()` de zod 4 (arquitectura
   §4). Es la referencia para la app iOS y para cualquiera que quiera hablar
   con el backend sin leer TypeScript. docs/openapi.yaml sigue siendo la
   referencia escrita a mano de la 0.6.59.

   Uso: corepack pnpm@10.18.2 --filter @ace/shared openapi
   El test openapi.test.ts falla si el fichero commiteado no coincide con lo
   que sale de aquí: cambiar un esquema obliga a regenerarlo. */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringify } from 'yaml';
import { z } from 'zod';
import {
  ApiErrorSchema,
  COMMON_V1_ERRORS,
  NATIVE_PREFIX,
  SERVER_MODULES,
  SseEventSchema,
  describeError,
  listV1Routes,
  nativePath,
  toOpenApiPath,
  type V1RouteEntry,
} from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const OPENAPI_FILE = path.resolve(here, '../../../docs/openapi-v2.yaml');
const ROOT_PACKAGE = path.resolve(here, '../../../package.json');

type JsonObject = Record<string, unknown>;

function jsonSchema(schema: z.ZodType, io: 'input' | 'output'): JsonObject {
  /* `unrepresentable: 'any'`: un refine o un transform no tiene equivalente en
     JSON Schema; se deja abierto en vez de romper la generación. */
  const out = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as JsonObject;
  delete out.$schema;
  return out;
}

/** Parámetros de ruta o de query a partir del esquema de objeto. */
function parameters(schema: z.ZodType | undefined, where: 'path' | 'query'): JsonObject[] {
  if (!schema) return [];
  const object = jsonSchema(schema, 'input');
  const properties = (object.properties ?? {}) as Record<string, JsonObject>;
  const required = new Set((object.required ?? []) as string[]);
  return Object.entries(properties).map(([name, property]) => {
    const { description, ...rest } = property;
    return {
      name,
      in: where,
      required: where === 'path' || required.has(name),
      ...(typeof description === 'string' ? { description } : {}),
      schema: rest,
    };
  });
}

function errorList(route: V1RouteEntry): JsonObject[] {
  const codes = [...new Set([...route.errors, ...COMMON_V1_ERRORS])];
  return codes.map((code) => {
    const definition = describeError(code);
    return { code, status: definition?.status ?? 500, message: definition?.message ?? '' };
  });
}

function successResponse(route: V1RouteEntry): JsonObject {
  if (route.content === 'sse') {
    return {
      description: 'Flujo SSE: `id`, `event` y `data` JSON (ver components/schemas/SseEvent).',
      content: { 'text/event-stream': { schema: { type: 'string' } } },
    };
  }
  if (route.content === 'binary') {
    return {
      description: 'Lista m3u8 reescrita con `?t=` o segmento fMP4. Admite Range (206/416).',
      content: {
        'application/vnd.apple.mpegurl': { schema: { type: 'string' } },
        'video/mp4': { schema: { type: 'string', format: 'binary' } },
        'video/iso.segment': { schema: { type: 'string', format: 'binary' } },
      },
    };
  }
  if (!route.response) throw new Error(`la ruta ${route.id} es JSON pero no tiene esquema`);
  return {
    description: 'Correcto',
    content: { 'application/json': { schema: jsonSchema(route.response, 'output') } },
  };
}

function security(route: V1RouteEntry): JsonObject[] {
  if (route.credential === 'none') return [];
  if (route.credential === 'video-token') return [{ videoToken: [] }];
  /* Dos alternativas: desde la web basta la sesión de Umbrel (el backend no
     ve ninguna credencial) y desde /native hace falta el token del dispositivo. */
  return route.access === 'web'
    ? [{ umbrelGateway: [] }]
    : [{ umbrelGateway: [] }, { deviceBearer: [] }];
}

function operation(route: V1RouteEntry): JsonObject {
  return {
    operationId: route.id,
    tags: [route.module],
    summary: route.summary,
    ...(route.description ? { description: route.description } : {}),
    parameters: [...parameters(route.params, 'path'), ...parameters(route.query, 'query')],
    ...(route.body
      ? {
          requestBody: {
            required: true,
            content: { 'application/json': { schema: jsonSchema(route.body, 'input') } },
          },
        }
      : {}),
    responses: {
      [String(route.status)]: successResponse(route),
      default: {
        description: 'Error con el formato de /api/v1 (arquitectura §6.4).',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
      },
    },
    security: security(route),
    'x-access': route.access,
    'x-native-path': toOpenApiPath(nativePath(route.path)),
    'x-side-effects': route.sideEffects,
    'x-legacy-twin': route.legacyTwin,
    'x-errors': errorList(route),
  };
}

export function buildOpenApiDocument(): JsonObject {
  const version = String(
    (JSON.parse(readFileSync(ROOT_PACKAGE, 'utf8')) as { version?: string }).version,
  );
  const paths: Record<string, JsonObject> = {};
  for (const route of listV1Routes()) {
    const key = toOpenApiPath(route.path);
    paths[key] = { ...(paths[key] ?? {}), [route.method.toLowerCase()]: operation(route) };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Ace Player Neo · API v1',
      version,
      description:
        'Generado desde packages/shared/src/routes.ts con scripts/openapi.ts: no editar a mano. ' +
        `Cada ruta existe también bajo ${NATIVE_PREFIX} (la entrada de la app iOS, D4), con origen native. ` +
        'Las rutas antiguas /api/* están en docs/openapi.yaml.',
    },
    servers: [
      { url: '/', description: 'Web (tras el login de Umbrel)' },
      { url: NATIVE_PREFIX, description: 'App iOS (sin login de Umbrel; credencial propia)' },
    ],
    tags: SERVER_MODULES.map((name) => ({ name })),
    paths,
    components: {
      schemas: {
        ApiError: jsonSchema(ApiErrorSchema, 'output'),
        SseEvent: jsonSchema(SseEventSchema, 'output'),
      },
      securitySchemes: {
        umbrelGateway: {
          type: 'apiKey',
          in: 'cookie',
          name: 'umbrel',
          description:
            'Origen web: la sesión la comprueba la pasarela de Umbrel antes de llegar al backend; el backend no ve ninguna credencial.',
        },
        deviceBearer: {
          type: 'http',
          scheme: 'bearer',
          description:
            'Token `<deviceId>.<secreto>` que da POST /api/v1/pairing/claim (solo origen native).',
        },
        videoToken: {
          type: 'apiKey',
          in: 'query',
          name: 't',
          description: 'URL de vídeo firmada: HMAC de { sid, dev, exp } (arquitectura §5.12).',
        },
      },
    },
  };
}

export function renderOpenApi(): string {
  const header =
    '# GENERADO por packages/shared/scripts/openapi.ts desde src/routes.ts. No editar a mano.\n';
  return header + stringify(buildOpenApiDocument(), { lineWidth: 0, aliasDuplicateObjects: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeFileSync(OPENAPI_FILE, renderOpenApi());
  console.log(`OpenAPI escrito en ${OPENAPI_FILE}`);
}
