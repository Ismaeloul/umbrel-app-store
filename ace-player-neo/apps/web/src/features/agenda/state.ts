/* Estado de interfaz de la agenda que comparten la vista y la columna
   compacta del centro de partido (src/features/agenda/column.tsx): el día
   elegido, el filtro y el partido del escenario. Es de esta pestaña (no del
   backend, arquitectura §9) y sobrevive a cambiar de vista, como en la 0.6.59
   («se conservan el scroll, los acordeones y el día elegido», regla 4). */

import { createStore, useStore } from '../../lib/store.ts';
import type { AgendaMode } from './domain.ts';

export interface AgendaUiState {
  /** Día elegido (YYYY-MM-DD) o null: el de por defecto (hoy). */
  day: string | null;
  /** null: el usuario no ha tocado el conmutador (`footballModeTouched`). */
  mode: AgendaMode | null;
  /** Partido del escenario de escritorio; null: el destacado. */
  selected: string | null;
}

export const agendaUi = createStore<AgendaUiState>({ day: null, mode: null, selected: null });

export function useAgendaUi(): AgendaUiState {
  return useStore(agendaUi);
}

export function setAgendaDay(day: string | null): void {
  agendaUi.set((state) => (state.day === day ? state : { ...state, day, selected: null }));
}

export function setAgendaMode(mode: AgendaMode): void {
  agendaUi.set((state) => (state.mode === mode ? state : { ...state, mode }));
}

export function setAgendaSelected(selected: string | null): void {
  agendaUi.set((state) => (state.selected === selected ? state : { ...state, selected }));
}

/** Al guardar los gustos se reevalúa el modo y cuenta como tocado (index.html:2895-2896). */
export function modeAfterSaving(hasPreferences: boolean): void {
  setAgendaMode(hasPreferences ? 'forYou' : 'all');
}

/** Solo para los tests. */
export function resetAgendaUi(): void {
  agendaUi.set({ day: null, mode: null, selected: null });
}
