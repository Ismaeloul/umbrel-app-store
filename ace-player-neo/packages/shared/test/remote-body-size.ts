/* Tope del JSON que acepta un esquema zod (el peor caso: cada carácter escapado a \uXXXX).
   Infinity si el esquema no tiene tope (un array o una cadena sin .max(), un record…). Solo lo
   usan los tests del dominio de fuera (el `request_body` de 64 KB de Caddy). */

import type { z } from 'zod';

interface Def {
  readonly type: string;
  readonly checks?: readonly { readonly _zod: { readonly def: Record<string, unknown> } }[];
  readonly shape?: Record<string, z.ZodType>;
  readonly element?: z.ZodType;
  readonly options?: readonly z.ZodType[];
  readonly innerType?: z.ZodType;
  readonly in?: z.ZodType;
  readonly entries?: Record<string, string | number>;
  readonly values?: readonly unknown[];
  readonly items?: readonly z.ZodType[];
}

const defOf = (schema: z.ZodType): Def => (schema as unknown as { _zod: { def: Def } })._zod.def;

/**
 * Tope de lo que casa una expresión sin cuantificadores abiertos (`*`, `+`, `{n,}`) ni grupos
 * repetidos: cada átomo cuenta su `{m,n}` o 1. Grueso pero siempre por encima.
 */
function regexLimit(source: string): number | undefined {
  if (/(?<!\\)[*+]|\{\d+,\}|\)\{/.test(source)) return undefined;
  let total = source.length;
  for (const match of source.matchAll(/\{(?:\d+,)?(\d+)\}/g)) total += Number(match[1]);
  return total;
}

function lengthLimit(def: Def, kind: 'max_length' | 'length_equals'): number | undefined {
  for (const check of def.checks ?? []) {
    const inner = check._zod.def;
    if (inner.check === kind) {
      return Number(kind === 'max_length' ? inner.maximum : inner.length);
    }
  }
  return undefined;
}

export function maxJsonBytes(schema: z.ZodType): number {
  const def = defOf(schema);
  switch (def.type) {
    case 'string': {
      const regexes = (def.checks ?? [])
        .map((check) => check._zod.def)
        .filter((inner) => inner.format === 'regex' && inner.pattern instanceof RegExp)
        .map((inner) => regexLimit((inner.pattern as RegExp).source));
      const limits = [
        lengthLimit(def, 'max_length'),
        lengthLimit(def, 'length_equals'),
        ...regexes,
      ].filter((value): value is number => value !== undefined);
      return limits.length === 0 ? Infinity : Math.min(...limits) * 6 + 2;
    }
    case 'number':
    case 'int':
    case 'bigint':
      return 24;
    case 'boolean':
      return 5;
    case 'null':
    case 'undefined':
      return 4;
    case 'literal':
      return Math.max(...(def.values ?? []).map((value) => JSON.stringify(value).length));
    case 'enum':
      return Math.max(
        ...Object.values(def.entries ?? {}).map((value) => JSON.stringify(value).length),
      );
    case 'object': {
      let total = 2;
      for (const [key, value] of Object.entries(def.shape ?? {})) {
        total += key.length + 4 + maxJsonBytes(value);
      }
      return total;
    }
    case 'array': {
      const max = lengthLimit(def, 'max_length');
      if (max === undefined || !def.element) return Infinity;
      return 2 + max * (maxJsonBytes(def.element) + 1);
    }
    case 'tuple':
      return 2 + (def.items ?? []).reduce((sum, item) => sum + maxJsonBytes(item) + 1, 0);
    case 'union':
      return Math.max(...(def.options ?? []).map(maxJsonBytes));
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'catch':
    case 'readonly':
    case 'nonoptional':
      return def.innerType ? Math.max(4, maxJsonBytes(def.innerType)) : Infinity;
    case 'pipe':
      return def.in ? maxJsonBytes(def.in) : Infinity;
    default:
      return Infinity;
  }
}
