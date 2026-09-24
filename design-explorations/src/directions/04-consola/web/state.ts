/* Consola · estado de interfaz de la web (fuera del simulador): selección de
   la lista, panel de comandos, hojas abiertas, barra lateral plegada. */

import { useSyncExternalStore } from 'react';

export type Selection = { kind: 'match' | 'channel'; id: string } | null;

export type WebSheet =
  | { type: 'report'; kind: 'match' | 'channel'; id: string; sourceId: string }
  | { type: 'paste'; kind: 'match' | 'channel'; id: string }
  | { type: 'rename'; id: string; title: string }
  | { type: 'addList' }
  | null;

interface WebUi {
  selection: Selection;
  palette: { open: boolean; initial: string };
  help: boolean;
  sheet: WebSheet;
  collapsed: boolean;
  drawer: boolean;
}

let ui: WebUi = {
  selection: null,
  palette: { open: false, initial: '' },
  help: false,
  sheet: null,
  collapsed: readBool('co-sidebar-collapsed', false),
  drawer: false,
};

function readBool(key: string, d: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? d : v === '1';
  } catch {
    return d;
  }
}

const listeners = new Set<() => void>();

function set(p: Partial<WebUi>) {
  ui = { ...ui, ...p };
  for (const l of listeners) l();
}

export function useUi<T>(sel: (u: WebUi) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => sel(ui),
    () => sel(ui),
  );
}

export function getUi(): WebUi {
  return ui;
}

export function select(s: Selection) {
  if (ui.selection?.id === s?.id && ui.selection?.kind === s?.kind) return;
  set({ selection: s });
}

export function openPalette(initial = '') {
  set({ palette: { open: true, initial } });
}

export function closePalette() {
  if (ui.palette.open) set({ palette: { open: false, initial: '' } });
}

export function setHelp(v: boolean) {
  set({ help: v });
}

export function openSheet(s: WebSheet) {
  set({ sheet: s });
}

export function closeSheet() {
  set({ sheet: null });
}

export function setCollapsed(v: boolean) {
  set({ collapsed: v });
  try {
    localStorage.setItem('co-sidebar-collapsed', v ? '1' : '0');
  } catch {
    /* sin almacenamiento */
  }
}

export function setDrawer(v: boolean) {
  set({ drawer: v });
}

/** ¿Hay algo modal abierto? (para que las listas no roben teclas) */
export function isModalOpen(): boolean {
  return ui.palette.open || ui.help || ui.sheet !== null || ui.drawer;
}
