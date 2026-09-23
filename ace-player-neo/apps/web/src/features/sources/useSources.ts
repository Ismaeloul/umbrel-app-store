/* Lo que pintan el selector y el inspector: cada fuente con su número, su
   estado efectivo, su medidor, su frase y si se ve o va plegada (regla 22).
   Se recalcula con la sesión, con lo que hace el reproductor y con un reloj
   de 20 s (para que caduquen los 3 min del veredicto del reproductor y las
   cuarentenas sin esperar a otro evento). */

import { useMemo } from 'react';
import { useApiQuery } from '../../api/index.ts';
import { shallowEqual } from '../../lib/store.ts';
import { usePlayerSelector } from '../../player/api.ts';
import { useNow } from '../agenda/data.ts';
import {
  describeSource,
  detailOf,
  effectiveOf,
  isShownWhileScanning,
  onScreenOf,
  presentationOf,
  signalOf,
  type Effective,
  type OnScreen,
  type SourceEntry,
  type SourcePresentation,
  type SourceSignal,
} from './model.ts';
import { useSession, type SessionState } from './session.ts';

export interface SourceRow {
  entry: SourceEntry;
  /** Número estable: la posición en la lista completa (no se renumera al plegar). */
  number: number;
  effective: Effective;
  signal: SourceSignal;
  detail: string;
  presentation: SourcePresentation;
  /** La elegida (la que está o estaba en pantalla). */
  active: boolean;
  /** Suena o se conecta ahora mismo. */
  onScreen: boolean;
  description: string;
}

export interface SourcesView {
  state: SessionState;
  rows: SourceRow[];
  /** Las que se ven (con comprobador, la activa, las vivas y las iniciales sin probar). */
  shown: SourceRow[];
  /** Las demás (caídas o en cola), plegadas al final. */
  tucked: SourceRow[];
  hasScan: boolean;
  screen: OnScreen;
  effectiveById: ReadonlyMap<string, Effective>;
}

export function useOnScreen(): OnScreen {
  return usePlayerSelector((state) => onScreenOf(state), shallowEqual);
}

export function useSourcesView(): SourcesView {
  const state = useSession((s) => s);
  const screen = useOnScreen();
  const now = useNow();
  const webSources = useApiQuery('libraryGet').data?.webSources;
  return useMemo(() => {
    const hasScan = state.scan !== null;
    const effectiveById = new Map<string, Effective>();
    const rows = state.entries.map((entry, index) => {
      const effective = effectiveOf(entry, screen, now);
      effectiveById.set(entry.id, effective);
      const presentation = presentationOf(entry, webSources);
      return {
        entry,
        number: index + 1,
        effective,
        signal: signalOf(effective, entry),
        detail: detailOf(effective, entry),
        presentation,
        active: entry.id === state.activeHash,
        onScreen: entry.id === screen.hash,
        description: describeSource(entry, index + 1, effective, presentation, hasScan),
      };
    });
    const shown = hasScan
      ? rows.filter((row) => isShownWhileScanning(row.entry, row.effective, state.activeHash))
      : rows;
    const shownIds = new Set(shown.map((row) => row.entry.id));
    const tucked = rows.filter((row) => !shownIds.has(row.entry.id));
    return { state, rows, shown, tucked, hasScan, screen, effectiveById };
  }, [state, screen, now, webSources]);
}
