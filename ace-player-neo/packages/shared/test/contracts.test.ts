/* Contratos de /api/v1: la tabla de rutas es coherente, cada respuesta JSON
   tiene su ejemplo en fixtures/ y valida, y docs/openapi-v2.yaml está al día
   con la tabla (lo que se commitea es exactamente lo que genera el script). */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  ApiErrorSchema,
  COMMON_V1_ERRORS,
  ERROR_CATALOG,
  NATIVE_PUBLIC_ROUTE_IDS,
  SSE_EVENT_TYPES,
  SseEventSchema,
  V1_ROUTES,
  V1_ROUTE_IDS,
  describeError,
  errorMessage,
  isErrorCode,
  listV1Routes,
  nativePath,
  toOpenApiPath,
} from '../src/index.js';
import {
  FIXTURES_DIR,
  NON_JSON_ROUTE_IDS,
  fixtureFiles,
  type JsonRouteId,
} from '../scripts/fixtures.js';
import { OPENAPI_FILE, renderOpenApi } from '../scripts/openapi.js';

const readJson = (rel: string): unknown =>
  JSON.parse(readFileSync(path.join(FIXTURES_DIR, rel), 'utf8'));

describe('tabla de rutas v1', () => {
  const routes = listV1Routes();

  it('no hay dos rutas con el mismo método y ruta', () => {
    const keys = routes.map((route) => `${route.method} ${route.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('todas cuelgan de /api/v1 y tienen su gemela en /native', () => {
    for (const route of routes) {
      expect(route.path.startsWith('/api/v1/')).toBe(true);
      expect(nativePath(route.path)).toBe(`/native${route.path}`);
    }
  });

  it('solo ping y el canje del código van sin credencial desde /native (arquitectura §5.12)', () => {
    expect([...NATIVE_PUBLIC_ROUTE_IDS].sort()).toEqual(['pairingClaim', 'ping']);
    expect(V1_ROUTES.ping.method).toBe('GET');
    expect(V1_ROUTES.pairingClaim.method).toBe('POST');
  });

  it('las mutaciones y los GET con efectos pasan por la regla anti-CSRF', () => {
    for (const route of routes) {
      if (route.method !== 'GET') expect(route.sideEffects, route.id).toBe(true);
    }
    expect(V1_ROUTES.channelStream.sideEffects).toBe(true);
    expect(V1_ROUTES.footballResolve.sideEffects).toBe(true);
  });

  it('los parámetros de la ruta coinciden con su esquema de params', () => {
    for (const route of routes) {
      const names = [...route.path.matchAll(/:([A-Za-z0-9_]+)/g)].map((match) => match[1]);
      const shape = route.params
        ? Object.keys((route.params as unknown as { shape: object }).shape)
        : [];
      expect(shape.sort(), route.id).toEqual(names.sort());
    }
  });

  it('solo SSE y vídeo responden sin JSON', () => {
    const sinJson = routes.filter((route) => route.response === null).map((route) => route.id);
    expect(sinJson.sort()).toEqual([...NON_JSON_ROUTE_IDS].sort());
  });

  it('todos los errores citados existen en el catálogo', () => {
    for (const route of routes)
      for (const code of route.errors) expect(isErrorCode(code)).toBe(true);
    for (const code of COMMON_V1_ERRORS) expect(isErrorCode(code)).toBe(true);
  });

  it('toOpenApiPath convierte :param en {param}', () => {
    expect(toOpenApiPath('/api/v1/video/:sid/:file')).toBe('/api/v1/video/{sid}/{file}');
  });
});

describe('catálogo de errores', () => {
  it('cada código tiene HTTP de error y mensaje en español', () => {
    for (const [code, definition] of Object.entries(ERROR_CATALOG)) {
      expect(definition.status, code).toBeGreaterThanOrEqual(400);
      expect(definition.message.length, code).toBeGreaterThan(0);
      if (definition.legacyStatus !== null)
        expect(definition.legacyStatus, code).toBeGreaterThanOrEqual(400);
    }
  });

  it('http_NNN: 400 en las rutas antiguas y 502 en v1 (api.md §2.6)', () => {
    expect(describeError('http_429')).toMatchObject({ status: 502, legacyStatus: 400 });
    expect(describeError('http_abc')).toBeNull();
    expect(errorMessage('no_existe')).toBe(ERROR_CATALOG.internal_error.message);
  });
});

describe('ejemplos de fixtures/', () => {
  const files = fixtureFiles();

  it('hay un ejemplo por cada ruta JSON y por cada evento, y ninguno sobra', () => {
    const jsonRoutes = V1_ROUTE_IDS.filter((id) => !NON_JSON_ROUTE_IDS.includes(id));
    const v1 = readdirSync(path.join(FIXTURES_DIR, 'v1')).map((file) =>
      file.replace(/\.json$/, ''),
    );
    expect(v1.sort()).toEqual([...jsonRoutes].sort());
    const events = readdirSync(path.join(FIXTURES_DIR, 'events')).map((file) =>
      file.replace(/\.json$/, ''),
    );
    expect(events.sort()).toEqual([...SSE_EVENT_TYPES].sort());
  });

  it('lo que hay en disco es lo que genera scripts/fixtures.ts', () => {
    for (const [rel, value] of files) {
      expect(existsSync(path.join(FIXTURES_DIR, rel)), rel).toBe(true);
      expect(readJson(rel), rel).toEqual(JSON.parse(JSON.stringify(value)));
    }
  });

  it('cada respuesta de ejemplo valida con el esquema de su ruta', () => {
    for (const id of V1_ROUTE_IDS) {
      if (NON_JSON_ROUTE_IDS.includes(id)) continue;
      const schema = V1_ROUTES[id as JsonRouteId].response;
      const result = schema.safeParse(readJson(`v1/${id}.json`));
      expect(result.success ? 'ok' : result.error.message, id).toBe('ok');
    }
  });

  it('cada evento de ejemplo valida con el esquema SSE', () => {
    for (const type of SSE_EVENT_TYPES) {
      const result = SseEventSchema.safeParse(readJson(`events/${type}.json`));
      expect(result.success ? 'ok' : result.error.message, type).toBe('ok');
    }
  });

  it('el error de ejemplo valida', () => {
    expect(ApiErrorSchema.safeParse(readJson('errors/api-error.json')).success).toBe(true);
  });
});

describe('docs/openapi-v2.yaml', () => {
  const onDisk = readFileSync(OPENAPI_FILE, 'utf8').replace(/\r\n/g, '\n');

  it('coincide con lo que genera scripts/openapi.ts (si falla: pnpm --filter @ace/shared openapi)', () => {
    expect(onDisk).toBe(renderOpenApi());
  });

  it('lleva todas las operaciones de la tabla', () => {
    for (const route of listV1Routes()) {
      expect(onDisk).toContain(`operationId: ${route.id}\n`);
    }
  });
});
