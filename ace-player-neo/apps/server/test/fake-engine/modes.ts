/* Modos de fallo del motor falso.

   Se aplican a un contenido (por id o infohash) o a todos con '*'. `stall` y
   `down` puestos con '*' afectan al motor entero (también a /search y, en
   `down`, a /webui); puestos a un contenido solo tocan ese contenido.

   Prioridad al decidir el modo de un contenido:
   1. `down` o `stall` globales ('*');
   2. el modo del propio contenido;
   3. un contenido del catálogo con `peers: 0` se porta como `noPeers`;
   4. el modo global ('*');
   5. `normal`. */

export type DownHow = 'refuse' | 'reset' | '503';

export type FakeMode =
  | { kind: 'normal' }
  /* La meta tarda `ms`; el primer byte llega `firstByteMs` (por defecto, `ms`)
     después de responder la meta. */
  | { kind: 'slowStart'; ms: number; firstByteMs?: number }
  /* Meta y estadísticas normales; la lista, los segmentos y el progresivo
     aceptan la conexión y no mandan nada (ni cabeceras). */
  | { kind: 'silence' }
  /* Corta la conexión de datos a mitad: tras `afterBytes` bytes o `afterMs`
     ms (medidos con el reloj del motor) de cada conexión. */
  | { kind: 'cut'; afterBytes?: number; afterMs?: number }
  /* Sin pares: estadística a cero ("prebuf") y ningún dato. */
  | { kind: 'noPeers' }
  /* Motor colgado: /webui responde; meta, datos, estadísticas, stop y
     /search se quedan colgados (sin responder) hasta que se quita el modo. */
  | { kind: 'stall' }
  /* Motor caído. Global: `refuse` deja de escuchar (ECONNREFUSED, lo de por
     defecto), `reset` acepta y corta, `503` responde 503. A un contenido:
     `503` (por defecto) o `reset`. */
  | { kind: 'down'; how?: DownHow }
  /* La meta responde "failed to load content" y no se abre sesión. */
  | { kind: 'failedContent' }
  /* Cada petición de datos (lista, segmento, /ace/r, /content) responde
     primero con un 302 a sí misma en http:// absoluto, como las
     redirecciones del motor real. */
  | { kind: 'redirectHttp' };

export type FakeModeKind = FakeMode['kind'];
export type FakeModeInput = FakeMode | FakeModeKind;

export const NORMAL_MODE: FakeMode = { kind: 'normal' };
export const NO_PEERS_MODE: FakeMode = { kind: 'noPeers' };

const KINDS: readonly FakeModeKind[] = [
  'normal',
  'slowStart',
  'silence',
  'cut',
  'noPeers',
  'stall',
  'down',
  'failedContent',
  'redirectHttp',
];

function nonNegative(value: unknown, name: string, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > max) throw new Error(`${name} fuera de rango (0-${max})`);
  return Math.floor(n);
}

/* Valida un modo que llega de un test o de la API HTTP de control. Con el
   nombre suelto usa valores razonables: slowStart de 5 s, corte a 256 KiB. */
export function parseMode(input: unknown): FakeMode {
  const raw: Record<string, unknown> =
    typeof input === 'string'
      ? { kind: input }
      : input && typeof input === 'object'
        ? (input as Record<string, unknown>)
        : {};
  const kind = raw.kind as FakeModeKind;
  if (!KINDS.includes(kind)) throw new Error(`modo desconocido: ${String(raw.kind ?? input)}`);
  switch (kind) {
    case 'slowStart': {
      const ms = raw.ms === undefined ? 5000 : nonNegative(raw.ms, 'ms', 600_000);
      const mode: FakeMode = { kind, ms };
      if (raw.firstByteMs !== undefined)
        mode.firstByteMs = nonNegative(raw.firstByteMs, 'firstByteMs', 600_000);
      return mode;
    }
    case 'cut': {
      const mode: FakeMode = { kind };
      if (raw.afterBytes !== undefined)
        mode.afterBytes = nonNegative(raw.afterBytes, 'afterBytes', 2 ** 40);
      if (raw.afterMs !== undefined) mode.afterMs = nonNegative(raw.afterMs, 'afterMs', 86_400_000);
      if (mode.afterBytes === undefined && mode.afterMs === undefined) mode.afterBytes = 256 * 1024;
      return mode;
    }
    case 'down': {
      if (raw.how === undefined) return { kind };
      if (raw.how !== 'refuse' && raw.how !== 'reset' && raw.how !== '503')
        throw new Error(`down.how no válido: ${String(raw.how)}`);
      return { kind, how: raw.how };
    }
    default:
      return { kind } as FakeMode;
  }
}

/* Modos en los que el motor no entrega datos de ese contenido. */
export function holdsData(mode: FakeMode): boolean {
  return mode.kind === 'silence' || mode.kind === 'noPeers' || mode.kind === 'stall';
}
