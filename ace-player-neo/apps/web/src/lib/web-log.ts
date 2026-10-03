/* Anillo de errores de la web («Descargar fallos» de Ajustes → Salud, 0.9.0).

   Los últimos WEB_LOG_MAX_ENTRIES (200) en MEMORIA, nunca en disco ni en el
   almacenamiento del navegador: solo salen de aquí cuando Isma pulsa
   «Descargar fallos», y entonces van al servidor, que los redacta junto con
   lo suyo (apps/server/src/modules/diagnostics/export.ts). Qué se apunta:

   - `error`: una excepción sin capturar (`window` «error»);
   - `rejection`: una promesa rechazada sin capturar (salvo las cancelaciones);
   - `console`: `console.error` y `console.warn` (React apunta ahí lo que
     recoge una ErrorBoundary, con la pila de componentes);
   - `api`: las peticiones que fallan por la red, el plazo, una respuesta rara
     o un 5xx (src/api/client.ts; los 4xx son respuestas normales);
   - `player`: lo que cuenta el reproductor (src/player/runtime.ts): sus
     fallos con código, como `warn`, y sus notas (huecos del búfer, primera
     imagen, cada reconexión…), como `info`. También van aquí, como notas,
     los avisos que mpegts.js escribe en la consola («[MP4Remuxer] > …»):
     son de la librería, no errores de la web, y su fallo de verdad ya llega
     por el reproductor.

   El mismo aviso seguido no llena el anillo: se cuenta (`repeated`). Las
   notas (`info`) ocupan como mucho la mitad y, al llenarse, salen antes que
   los errores: una sesión larga con una señal que da tirones no echa del
   anillo el error de la web de hace un rato.

   «Descargar logs» (0.9.0): `subscribeWebLog` avisa de cada línea NUEVA; la
   usa src/lib/web-log-upload.ts para mandar los avisos y errores al
   registro en disco del servidor. */

import {
  WEB_LOG_MAX_ENTRIES,
  type FaultLevel,
  type WebLogEntry,
  type WebLogKind,
} from '@ace/shared';

const MESSAGE_MAX = 1000;
const DETAIL_MAX = 4000;
/** Hueco de las notas (`info`) en el anillo. */
export const WEB_LOG_MAX_NOTES = Math.floor(WEB_LOG_MAX_ENTRIES / 2);
/* El formato del registro de mpegts.js (src/utils/logger.js): «[Etiqueta] > texto». */
const LIBRARY_LINE_RE = /^\[[A-Za-z][\w.-]*\] > /;

const entries: WebLogEntry[] = [];
const startedAt = Date.now();
const listeners = new Set<(entry: WebLogEntry) => void>();

/** Avisa de cada línea nueva (no de las que solo se cuentan). Devuelve cómo dejar de escuchar. */
export function subscribeWebLog(listener: (entry: WebLogEntry) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const cut = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** La vista abierta, tal y como va en la URL (`partido/demo-4`, `ajustes/salud`). */
function currentView(): string | undefined {
  try {
    const vista = new URLSearchParams(globalThis.location?.search ?? '').get('vista');
    return vista ? cut(vista, 160) : 'agenda';
  } catch {
    return undefined;
  }
}

export interface WebLogInput {
  kind: WebLogKind;
  level: FaultLevel;
  message: string;
  detail?: string | null;
  code?: string | null;
}

/** Apunta una línea (si es igual que la última, solo la cuenta). */
export function recordWebLog(input: WebLogInput): void {
  const message = cut(String(input.message ?? '').trim() || '(sin mensaje)', MESSAGE_MAX);
  const code = input.code ? cut(String(input.code), 60) : undefined;
  const last = entries.at(-1);
  // El reproductor apunta cada fallo y luego lo repite en su nota «código: frase».
  if (
    last &&
    input.kind === 'player' &&
    last.kind === 'player' &&
    !code &&
    last.code &&
    message === cut(`${last.code}: ${last.message}`, MESSAGE_MAX)
  )
    return;
  if (
    last &&
    last.kind === input.kind &&
    last.level === input.level &&
    last.message === message &&
    last.code === code
  ) {
    last.repeated = (last.repeated ?? 1) + 1;
    return;
  }
  const view = currentView();
  const entry: WebLogEntry = {
    at: new Date().toISOString(),
    kind: input.kind,
    level: input.level,
    message,
    ...(input.detail ? { detail: cut(String(input.detail), DETAIL_MAX) } : {}),
    ...(code ? { code } : {}),
    ...(view ? { view } : {}),
  };
  entries.push(entry);
  trim();
  for (const listener of listeners) {
    try {
      listener({ ...entry });
    } catch {
      // Quien escucha no puede romper el anillo (ni volver a apuntar aquí).
    }
  }
}

/* Lleno: sale la nota más vieja; sin notas, lo más viejo. Y las notas, como mucho WEB_LOG_MAX_NOTES. */
function trim(): void {
  let notes = entries.reduce((count, entry) => count + (entry.level === 'info' ? 1 : 0), 0);
  while (entries.length > WEB_LOG_MAX_ENTRIES || notes > WEB_LOG_MAX_NOTES) {
    const oldestNote = notes > 0 ? entries.findIndex((entry) => entry.level === 'info') : -1;
    if (oldestNote >= 0) {
      entries.splice(oldestNote, 1);
      notes -= 1;
    } else entries.shift();
  }
}

/** Copia de lo apuntado, de lo más viejo a lo más nuevo. */
export function webLogSnapshot(): WebLogEntry[] {
  return entries.map((entry) => ({ ...entry }));
}

/** Segundos desde que se cargó la página. */
export function webLogUptimeSeconds(): number {
  return Math.max(0, Math.round((Date.now() - startedAt) / 1000));
}

/** Solo para los tests. */
export function clearWebLog(): void {
  entries.length = 0;
}

/** Texto de un error cualquiera: «TypeError: x is undefined» y su pila aparte. */
export function describeThrown(value: unknown): { message: string; detail: string | null } {
  if (value instanceof Error) {
    const name = value.name && value.name !== 'Error' ? `${value.name}: ` : '';
    return { message: `${name}${value.message}`, detail: value.stack ?? null };
  }
  if (typeof value === 'string') return { message: value, detail: null };
  // DOMException y compañía: no siempre heredan de Error, pero tienen nombre y mensaje.
  const like = value as { name?: unknown; message?: unknown; stack?: unknown } | null;
  if (like && typeof like === 'object' && typeof like.message === 'string') {
    const name = typeof like.name === 'string' && like.name !== 'Error' ? `${like.name}: ` : '';
    return {
      message: `${name}${like.message}`,
      detail: typeof like.stack === 'string' ? like.stack : null,
    };
  }
  try {
    return { message: JSON.stringify(value) ?? String(value), detail: null };
  } catch {
    return { message: String(value), detail: null };
  }
}

/** Los argumentos de `console.error(…)` en una frase (y la primera pila que haya). */
function describeArgs(args: readonly unknown[]): { message: string; detail: string | null } {
  let detail: string | null = null;
  const parts = args.map((arg) => {
    if (arg instanceof Error) {
      const described = describeThrown(arg);
      detail ??= described.detail;
      return described.message;
    }
    if (typeof arg === 'string') return arg;
    try {
      return JSON.stringify(arg) ?? String(arg);
    } catch {
      return String(arg);
    }
  });
  return { message: parts.join(' '), detail };
}

function isCancellation(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { name?: unknown }).name === 'AbortError'
  );
}

interface ConsoleLike {
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
}

/**
 * Engancha el anillo a la página: errores y promesas sin capturar y
 * `console.error`/`console.warn` (que siguen escribiendo en la consola como
 * siempre). Devuelve cómo soltarlo. Lo llama main.tsx una vez.
 */
export function installWebLog(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window,
  output: ConsoleLike = console,
): () => void {
  const onError = (event: Event) => {
    const error = (event as ErrorEvent).error;
    const described =
      error !== undefined && error !== null
        ? describeThrown(error)
        : {
            message: (event as ErrorEvent).message || 'Error sin mensaje',
            detail: (event as ErrorEvent).filename
              ? `${(event as ErrorEvent).filename}:${(event as ErrorEvent).lineno}:${(event as ErrorEvent).colno}`
              : null,
          };
    recordWebLog({ kind: 'error', level: 'error', ...described });
  };
  const onRejection = (event: Event) => {
    const reason = (event as PromiseRejectionEvent).reason;
    if (isCancellation(reason)) return;
    recordWebLog({ kind: 'rejection', level: 'error', ...describeThrown(reason) });
  };
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);

  const originalError = output.error;
  const originalWarn = output.warn;
  const fromConsole = (level: 'error' | 'warn', args: readonly unknown[]) => {
    const described = describeArgs(args);
    // mpegts.js en el hilo principal: una nota del reproductor, no un error de la web.
    if (LIBRARY_LINE_RE.test(described.message))
      recordWebLog({ kind: 'player', level: 'info', ...described });
    else recordWebLog({ kind: 'console', level, ...described });
  };
  output.error = (...args: unknown[]) => {
    fromConsole('error', args);
    originalError.apply(output, args);
  };
  output.warn = (...args: unknown[]) => {
    fromConsole('warn', args);
    originalWarn.apply(output, args);
  };

  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
    output.error = originalError;
    output.warn = originalWarn;
  };
}
