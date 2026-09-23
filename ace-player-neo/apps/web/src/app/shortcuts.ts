/* Registro central de atajos de teclado (inventario §18).

   Cualquier vista registra los suyos y el panel de ayuda («?») los lista
   todos, agrupados, con su descripción:

     useShortcut({
       id: 'reproductor.pausa',
       keys: [' ', 'k'],
       display: ['Espacio', 'K'],
       label: 'Pausa y reanuda',
       group: 'Reproductor',
       when: () => playing,
       handler: () => togglePause(),
     });

   Reglas (las de la 0.6.59):
   - Mientras se escribe en un campo no salta ninguno, salvo Escape (o los
     que lleven allowInInput).
   - Con una hoja o menú abierto no salta ninguno: la capa manda.
   - Si alguien ya atendió la tecla (preventDefault, por ejemplo las flechas
     de unas pestañas), no salta: así ←/→ no zapean con el foco en la
     navegación (regla 9).
   - Ctrl, Cmd y Alt se dejan al navegador.
   - Si dos atajos usan la misma tecla, gana el último registrado cuyo `when`
     se cumpla (una vista puede sobreescribir uno general). */

import { useEffect, useEffectEvent } from 'react';
import { createStore, useStore } from '../lib/store.ts';
import { hasOverlay } from '../ui/overlay.ts';

export interface ShortcutDef {
  id: string;
  /** Valores de KeyboardEvent.key: ' ', 'k', 'ArrowLeft', '?', '/'. Las letras no distinguen mayúsculas. */
  keys: readonly string[];
  /** Cómo se enseñan en la ayuda: ['Espacio', 'K']. */
  display?: readonly string[];
  label: string;
  group: string;
  /** Solo salta si devuelve true (por ejemplo, «si se está reproduciendo»). */
  when?: () => boolean;
  /** También dentro de un campo de texto. */
  allowInInput?: boolean;
  handler(event: KeyboardEvent): void;
}

interface Entry extends ShortcutDef {
  order: number;
}

export const shortcutStore = createStore<readonly Entry[]>([]);
let order = 0;

export function registerShortcut(def: ShortcutDef): () => void {
  const entry: Entry = { ...def, order: order++ };
  shortcutStore.set((list) => [...list, entry]);
  return () => shortcutStore.set((list) => list.filter((item) => item !== entry));
}

function normalizeKey(key: string): string {
  return key.length === 1 ? key.toLowerCase() : key;
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color', 'file'].includes(
      target.type,
    );
  }
  return false;
}

/** Busca el atajo que atiende esta pulsación (puro salvo por `when`). */
export function matchShortcut(
  event: KeyboardEvent,
  list: readonly Entry[] = shortcutStore.get(),
): Entry | null {
  if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
    return null;
  const key = normalizeKey(event.key);
  const typing = isTypingTarget(event.target);
  const candidates = list
    .filter((entry) => entry.keys.some((k) => normalizeKey(k) === key))
    .sort((a, b) => b.order - a.order);
  for (const entry of candidates) {
    if (typing && !entry.allowInInput && key !== 'Escape') continue;
    if (entry.when && !entry.when()) continue;
    return entry;
  }
  return null;
}

let installed = false;

export function installShortcutListener(target: Window = window): () => void {
  if (installed) return () => {};
  installed = true;
  const onKeyDown = (event: KeyboardEvent) => {
    if (hasOverlay()) return;
    const entry = matchShortcut(event);
    if (!entry) return;
    event.preventDefault();
    entry.handler(event);
  };
  target.addEventListener('keydown', onKeyDown);
  return () => {
    installed = false;
    target.removeEventListener('keydown', onKeyDown);
  };
}

/** Registra un atajo mientras el componente está montado (y visible: Activity lo quita al ocultarse). */
export function useShortcut(def: ShortcutDef, enabled = true): void {
  const handler = useEffectEvent((event: KeyboardEvent) => def.handler(event));
  const when = useEffectEvent(() => (def.when ? def.when() : true));
  const keys = def.keys.join('\u0000');
  const display = def.display?.join('\u0000') ?? '';
  useEffect(() => {
    if (!enabled) return;
    return registerShortcut({
      id: def.id,
      keys: keys.split('\u0000'),
      display: display ? display.split('\u0000') : undefined,
      label: def.label,
      group: def.group,
      allowInInput: def.allowInInput,
      when: () => when(),
      handler: (event) => handler(event),
    });
  }, [enabled, def.id, keys, display, def.label, def.group, def.allowInInput]);
}

export interface ShortcutGroup {
  group: string;
  items: Array<{ id: string; label: string; display: readonly string[] }>;
}

/** Lo que enseña el panel de ayuda: sin repetidos y agrupado. */
export function groupShortcuts(list: readonly ShortcutDef[]): ShortcutGroup[] {
  const groups = new Map<string, ShortcutGroup>();
  const seen = new Set<string>();
  for (const def of list) {
    if (seen.has(def.id)) continue;
    seen.add(def.id);
    const group = groups.get(def.group) ?? { group: def.group, items: [] };
    group.items.push({
      id: def.id,
      label: def.label,
      display: def.display ?? def.keys.map(prettyKey),
    });
    groups.set(def.group, group);
  }
  return [...groups.values()];
}

export function prettyKey(key: string): string {
  switch (key) {
    case ' ':
      return 'Espacio';
    case 'ArrowLeft':
      return '←';
    case 'ArrowRight':
      return '→';
    case 'ArrowUp':
      return '↑';
    case 'ArrowDown':
      return '↓';
    case 'Escape':
      return 'Esc';
    default:
      return key.length === 1 ? key.toUpperCase() : key;
  }
}

export function useShortcutGroups(): ShortcutGroup[] {
  const list = useStore(shortcutStore);
  return groupShortcuts(list);
}
