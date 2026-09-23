/* Interruptores de desarrollo. Hoy solo `sistema`: la página de muestra de
   componentes (?vista=sistema) sale siempre en desarrollo y, en producción,
   solo si se activa a mano:
   - una vez: ?vista=sistema&flag=sistema
   - para siempre en ese navegador: localStorage['aceneo-flags'] = 'sistema' */

import { readItem, STORAGE_KEYS } from './storage.ts';

export type Flag = 'sistema';

export function hasFlag(flag: Flag, search: string = globalThis.location?.search ?? ''): boolean {
  try {
    const params = new URLSearchParams(search);
    if (params.getAll('flag').includes(flag)) return true;
  } catch {}
  const stored = readItem(STORAGE_KEYS.flags) ?? '';
  return stored
    .split(',')
    .map((part) => part.trim())
    .includes(flag);
}

export function isSystemPageEnabled(search?: string): boolean {
  return import.meta.env.DEV || hasFlag('sistema', search);
}
