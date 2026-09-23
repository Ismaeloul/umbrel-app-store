/* Almacenamiento del navegador SIEMPRE con try/catch (inventario-front §25).

   localStorage y sessionStorage pueden no existir o lanzar: ventana privada de
   Safari, datos del sitio bloqueados, cuota llena o el iframe de una captura.
   Si fallan, la app sigue con un respaldo en memoria que dura lo que la
   pestaña; nunca se rompe por no poder guardar una comodidad.

   Solo se guardan comodidades por visor (tema, transparencia, modo de
   reproducción, id del dispositivo...). Lo que se comparte entre dispositivos
   vive en el backend. */

type Area = 'local' | 'session';

const memory: Record<Area, Map<string, string>> = {
  local: new Map(),
  session: new Map(),
};

function area(kind: Area): Storage | null {
  try {
    const store = kind === 'local' ? globalThis.localStorage : globalThis.sessionStorage;
    return store ?? null;
  } catch {
    return null;
  }
}

export function readItem(key: string, kind: Area = 'local'): string | null {
  try {
    const value = area(kind)?.getItem(key);
    if (value !== null && value !== undefined) return value;
  } catch {}
  return memory[kind].get(key) ?? null;
}

export function writeItem(key: string, value: string, kind: Area = 'local'): boolean {
  memory[kind].set(key, value);
  try {
    area(kind)?.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

export function removeItem(key: string, kind: Area = 'local'): void {
  memory[kind].delete(key);
  try {
    area(kind)?.removeItem(key);
  } catch {}
}

/** JSON con validación: si lo guardado no pasa `check`, se ignora. */
export function readJson<T>(
  key: string,
  check: (value: unknown) => value is T,
  kind: Area = 'local',
): T | null {
  const raw = readItem(key, kind);
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return check(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeJson(key: string, value: unknown, kind: Area = 'local'): boolean {
  try {
    return writeItem(key, JSON.stringify(value), kind);
  } catch {
    return false;
  }
}

/** Solo para los tests: olvida el respaldo en memoria. */
export function resetMemoryStorage(): void {
  memory.local.clear();
  memory.session.clear();
}

/** Claves que usa la web (todas con el prefijo de la 0.6.59). */
export const STORAGE_KEYS = {
  /** Tema elegido en Ajustes: `sistema`, `claro` u `oscuro`. */
  theme: 'aceneo-tema',
  /** «Reducir transparencia» propio: `reducida` o `normal`. */
  transparency: 'aceneo-transparencia',
  /** Id persistente de este navegador (arquitectura §5.6). */
  device: 'aceneo-device',
  /** Modo de reproducción de la 0.6.59 (`low`, `balanced`, `stable`). */
  playbackMode: 'aceneo-pb',
  /** Estado del modo demo (solo en demo). */
  demo: 'aceneo-demo-v2',
  /** Interruptores de desarrollo (`sistema`...), separados por comas. */
  flags: 'aceneo-flags',
  /** Panel lateral plegado en escritorio. */
  aside: 'aceneo-panel',
} as const;
