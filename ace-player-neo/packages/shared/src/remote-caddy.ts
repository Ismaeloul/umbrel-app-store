/* Lista blanca del dominio de fuera (tv.ismaeloul.es) para Caddy, sacada de la tabla de rutas
   (`remote` de cada ruta, routes.ts). La escribe en deploy/umbrel/caddy/tv-on.caddy el script
   `pnpm --filter @ace/shared caddy-tv`, y deploy/test/caddy-native.test.ts comprueba que lo que
   hay en el fichero es esto (y que deja pasar justo lo que la tabla permite).

   Cada `:param` acepta lo mismo que su esquema zod: la expresión del `.regex()` (sin `^` ni `$`),
   las opciones de un `z.enum` o, en una cadena libre con `.min()`/`.max()`, `[^/]{min,max}`
   (Caddy compara la ruta ya decodificada; las `%2f` las tira antes `@raro`). Así una ruta nueva
   con un parámetro raro falla aquí en vez de dar 404 en el iPhone.

   Las expresiones son RE2 (Go): nada de `(?!…)` ni referencias hacia atrás. Lo comprueba
   `assertRe2Safe`. */

import type { z } from 'zod';
import {
  NATIVE_PREFIX,
  V1_PREFIX,
  V1_ROUTES,
  V1_ROUTE_IDS,
  type V1Method,
  type V1RouteDefinition,
  type V1RouteId,
} from './routes.js';

/** Forma del `Authorization` que Caddy deja pasar: `Bearer <deviceId>.<secreto de 43>`. */
export const REMOTE_BEARER_RE = '^Bearer [A-Za-z0-9_-]{4,64}\\.[A-Za-z0-9_-]{43}$';

/** Las rutas con su propio matcher en Caddy (`@video`: sin Bearer, con `?t=`). */
export const REMOTE_VIDEO_ROUTE_IDS: readonly V1RouteId[] = ['video'];

/** Métodos con matcher propio en tv-on.caddy (en este orden). */
export const REMOTE_CADDY_METHODS = ['GET', 'POST', 'PUT', 'DELETE'] as const;
export type RemoteCaddyMethod = (typeof REMOTE_CADDY_METHODS)[number];

/** Lo que comparten todas las rutas del dominio: `/native/api/v1/`. */
export const REMOTE_CADDY_PREFIX = `${NATIVE_PREFIX}${V1_PREFIX}/`;

interface ZodCheckDef {
  readonly check?: string;
  readonly format?: string;
  readonly pattern?: RegExp;
  readonly minimum?: number;
  readonly maximum?: number;
}

interface ZodInternals {
  readonly _zod: {
    readonly def: {
      readonly type: string;
      readonly checks?: readonly { readonly _zod: { readonly def: ZodCheckDef } }[];
      readonly entries?: Readonly<Record<string, string | number>>;
    };
  };
}

/** Lo que RE2 no sabe hacer y JS sí. */
export function assertRe2Safe(source: string): void {
  if (/\(\?[=!<]/.test(source)) throw new Error(`RE2 no admite lookaround: ${source}`);
  if (/\\[1-9]/.test(source)) throw new Error(`RE2 no admite referencias: ${source}`);
}

function escapeLiteral(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, (char) => `\\${char}`);
}

/** La expresión (sin anclas) que acepta lo mismo que el esquema de un `:param`. */
export function paramPattern(schema: z.ZodType, label = 'param'): string {
  const def = (schema as unknown as ZodInternals)._zod.def;
  if (def.type === 'enum') {
    const values = Object.values(def.entries ?? {}).map(String);
    if (values.length === 0) throw new Error(`${label}: enum vacío`);
    return `(?:${values.map(escapeLiteral).join('|')})`;
  }
  if (def.type !== 'string') throw new Error(`${label}: tipo ${def.type} sin traducción a Caddy`);
  const checks = (def.checks ?? []).map((check) => check._zod.def);
  const regexes = checks.filter((check) => check.format === 'regex' && check.pattern);
  if (regexes.length > 1) throw new Error(`${label}: más de una expresión`);
  const regex = regexes[0]?.pattern;
  if (regex) {
    if (regex.flags !== '') throw new Error(`${label}: expresión con banderas (${regex.flags})`);
    const source = regex.source;
    if (!source.startsWith('^') || !source.endsWith('$')) {
      throw new Error(`${label}: la expresión no va anclada (${source})`);
    }
    const inner = source.slice(1, -1);
    assertRe2Safe(inner);
    return `(?:${inner})`;
  }
  const min = checks.find((check) => check.check === 'min_length')?.minimum ?? 1;
  const max = checks.find((check) => check.check === 'max_length')?.maximum;
  if (max === undefined) throw new Error(`${label}: cadena sin .max(): Caddy necesita un tope`);
  return `[^/]{${Math.max(1, min)},${max}}`;
}

/** `/api/v1/channels/:id/stream` → `/native/api/v1/channels/(?:[a-f0-9]{40})/stream` (sin anclas). */
export function routePattern(route: V1RouteDefinition): string {
  const shape = (route.params as unknown as { shape?: Record<string, z.ZodType> } | undefined)
    ?.shape;
  return `${NATIVE_PREFIX}${route.path}`
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return escapeLiteral(segment);
      const name = segment.slice(1);
      const schema = shape?.[name];
      if (!schema) throw new Error(`${route.path}: :${name} sin esquema de params`);
      return paramPattern(schema, `${route.path} :${name}`);
    })
    .join('/');
}

function relative(pattern: string): string {
  if (!pattern.startsWith(REMOTE_CADDY_PREFIX)) {
    throw new Error(`${pattern} fuera de ${REMOTE_CADDY_PREFIX}`);
  }
  return pattern.slice(REMOTE_CADDY_PREFIX.length);
}

/** Rutas que Caddy deja pasar con Bearer (todas las `allow`/`allow-self` menos el vídeo). */
export function remoteBearerRouteIds(): V1RouteId[] {
  return V1_ROUTE_IDS.filter((id) => {
    const route: V1RouteDefinition = V1_ROUTES[id];
    return route.remote !== 'deny' && !REMOTE_VIDEO_ROUTE_IDS.includes(id);
  });
}

/**
 * Una expresión por método: `^/native/api/v1/(?:ruta1|ruta2|…)$`. null si ese método no tiene
 * ninguna ruta permitida. PATCH no tiene ninguna (las de la IPTV son solo web): no lleva matcher,
 * y si alguna vez una ruta PATCH pasara a `allow`, esto falla.
 */
export function remoteCaddyPatterns(): Record<RemoteCaddyMethod, string | null> {
  const ids = remoteBearerRouteIds();
  for (const id of ids) {
    const method: V1Method = V1_ROUTES[id].method;
    if (!(REMOTE_CADDY_METHODS as readonly string[]).includes(method)) {
      throw new Error(`${id}: método ${method} permitido por el dominio sin matcher en Caddy`);
    }
  }
  const out = {} as Record<RemoteCaddyMethod, string | null>;
  for (const method of REMOTE_CADDY_METHODS) {
    const parts = ids
      .filter((id) => V1_ROUTES[id].method === method)
      .map((id) => relative(routePattern(V1_ROUTES[id])));
    out[method] = parts.length === 0 ? null : `^${REMOTE_CADDY_PREFIX}(?:${parts.join('|')})$`;
  }
  return out;
}

/** La del vídeo firmado (`@video`): `GET` y `?t=`, sin Bearer. */
export function remoteVideoPattern(): string {
  const parts = REMOTE_VIDEO_ROUTE_IDS.map((id) => relative(routePattern(V1_ROUTES[id])));
  return `^${REMOTE_CADDY_PREFIX}(?:${parts.join('|')})$`;
}

/** Marcas del trozo generado de tv-on.caddy. */
export const REMOTE_CADDY_BEGIN =
  '# --- GENERADO por `pnpm --filter @ace/shared caddy-tv` desde la tabla de rutas: no tocar a mano ---';
export const REMOTE_CADDY_END = '# --- FIN GENERADO ---';

/** Nombre del matcher de cada método en tv-on.caddy. */
export function remoteCaddyMatcherName(method: RemoteCaddyMethod): string {
  return method.toLowerCase();
}

/**
 * Los matchers de tv-on.caddy, con tabuladores como el resto del fichero. Cada expresión va
 * entre comillas invertidas (Caddy no toca nada dentro); por eso ninguna puede llevar una.
 */
export function renderRemoteCaddyMatchers(): string {
  const quote = (re: string): string => {
    if (re.includes('`')) throw new Error(`expresión con comilla invertida: ${re}`);
    return `\`${re}\``;
  };
  const lines: string[] = [`\t${REMOTE_CADDY_BEGIN}`];
  const patterns = remoteCaddyPatterns();
  for (const method of REMOTE_CADDY_METHODS) {
    const pattern = patterns[method];
    if (pattern === null) continue;
    lines.push(
      `\t@${remoteCaddyMatcherName(method)} {`,
      `\t\tmethod ${method}`,
      `\t\tpath_regexp ${quote(pattern)}`,
      `\t\theader_regexp Authorization ${quote(REMOTE_BEARER_RE)}`,
      '\t}',
    );
  }
  lines.push(
    '\t# El video firmado: AVPlayer no pone cabeceras; la credencial va en ?t= (y el backend mira',
    '\t# en cada segmento que ese aparato siga teniendo permiso de fuera).',
    '\t@video {',
    '\t\tmethod GET',
    `\t\tpath_regexp ${quote(remoteVideoPattern())}`,
    '\t\tquery t=*',
    '\t}',
    `\t${REMOTE_CADDY_END}`,
  );
  return lines.join('\n');
}

/** Sustituye el trozo generado de un tv-on.caddy (lanza si faltan las marcas). */
export function replaceRemoteCaddyMatchers(text: string): string {
  const begin = text.indexOf(`\t${REMOTE_CADDY_BEGIN}`);
  const endMark = text.indexOf(`\t${REMOTE_CADDY_END}`);
  if (begin < 0 || endMark < begin)
    throw new Error('tv-on.caddy sin las marcas del trozo generado');
  const end = endMark + `\t${REMOTE_CADDY_END}`.length;
  return `${text.slice(0, begin)}${renderRemoteCaddyMatchers()}${text.slice(end)}`;
}
