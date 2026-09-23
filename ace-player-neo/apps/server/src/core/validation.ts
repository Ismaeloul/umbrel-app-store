/* Adaptador propio entre zod 4 y Fastify (arquitectura §5.15: "unas 100
   líneas o fastify-type-provider-zod si admite zod 4.6"). Se hace propio:
   son pocas líneas, no añade dependencias al NAS y deja claro dónde está cada
   regla. Las rutas v1 validan aquí la entrada (params, query y cuerpo) y la
   salida; las antiguas no pasan por aquí porque la 0.6.59 acepta cualquier
   JSON y normaliza lo que entiende (api.md §2.4). */

import type { z } from 'zod';
import { AppError } from './errors.js';

export type InputPart = 'params' | 'query' | 'body';

/** Resumen de un fallo de validación apto para el log (sin valores, que pueden ser secretos). */
export interface ValidationIssueSummary {
  readonly part: InputPart | 'response';
  readonly path: string;
  readonly message: string;
}

function summarize(
  part: ValidationIssueSummary['part'],
  error: z.ZodError,
): ValidationIssueSummary[] {
  return error.issues.slice(0, 10).map((issue) => ({
    part,
    path: issue.path.map(String).join('.') || '(raíz)',
    message: issue.message,
  }));
}

/**
 * Valida una parte de la petición. Si no vale, 400 `validation_error` (el
 * detalle va al log, no al cliente: un mensaje genérico en español basta y no
 * filtra la forma interna).
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  part: InputPart,
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError('validation_error', {
    detail: `entrada no válida en ${part}`,
    data: summarize(part, result.error),
  });
}

/**
 * Valida lo que devuelve un manejador antes de mandarlo. Si no cumple su
 * propio contrato es un fallo del servidor (500 `internal_error` con el
 * detalle en el log), nunca del cliente: mejor un error claro que una
 * respuesta que rompa la app de iOS al decodificar.
 */
export function parseOutput<S extends z.ZodType>(
  schema: S,
  value: unknown,
  routeId: string,
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) return result.data;
  throw new AppError('internal_error', {
    detail: `la respuesta de ${routeId} no cumple su esquema`,
    data: summarize('response', result.error),
  });
}

/**
 * La query de Fastify llega como objeto con `string | string[]`. Se copia a un
 * objeto plano sin prototipo raro para que zod la lea tal cual (un `?a=1&a=2`
 * sigue siendo un array, que es lo que espera `channel` en la resolución).
 */
export function normalizeQuery(query: unknown): Record<string, unknown> {
  if (!query || typeof query !== 'object') return {};
  return { ...(query as Record<string, unknown>) };
}
