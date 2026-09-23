/* Datos de la agenda: consultas (TanStack Query por la capa de src/api), el
   reloj que hace avanzar las insignias y lo que llega por SSE sobre la señal
   de cada partido. Lo usan la vista, la columna compacta y el escenario.

   Sondeos: la agenda NO se refresca sola (inventario §3.1), las preferencias
   y la biblioteca las invalida el SSE (`state.changed`) y la señal de cada
   partido llega por SSE (`scan.progress` con `matchId`). Lo único que se
   consulta periódicamente son los marcadores, porque no hay evento para
   ellos (regla 29: solo si el día que miras tiene partidos en su ventana). */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useMemo, useSyncExternalStore } from 'react';
import { onSseEvent, useApiQuery, useRealtimeStatus } from '../../api/index.ts';
import { createStore, useStore } from '../../lib/store.ts';
import {
  buildLibraryLookup,
  inPreheatWindow,
  scoresInterval,
  scoresWanted,
  signalFromPreheat,
  signalFromScan,
  type LibraryLookup,
  type MatchSignal,
} from './domain.ts';

// ---- Reloj compartido ----------------------------------------------------------

/* Un solo intervalo para todas las filas. Solo corre mientras alguien lo
   escucha: con la vista oculta (Activity) sus efectos se desmontan y el
   intervalo se para solo. */
const TICK_MS = 20_000;
let nowValue = Date.now();
let timer: ReturnType<typeof setInterval> | null = null;
const tickListeners = new Set<() => void>();

function subscribeNow(listener: () => void): () => void {
  tickListeners.add(listener);
  nowValue = Date.now();
  if (timer === null) {
    timer = setInterval(() => {
      nowValue = Date.now();
      for (const fn of [...tickListeners]) fn();
    }, TICK_MS);
  }
  return () => {
    tickListeners.delete(listener);
    if (tickListeners.size === 0 && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** «Ahora», que avanza cada 20 s: las insignias «En 48 min» se actualizan solas (contradicción 12). */
export function useNow(): number {
  return useSyncExternalStore(
    subscribeNow,
    () => nowValue,
    () => nowValue,
  );
}

// ---- Consultas -------------------------------------------------------------------

/** Agenda. Sin refresco periódico; caduca a los 10 min para que una pestaña olvidada no enseñe la de ayer. */
export function useSchedule() {
  return useApiQuery('footballSchedule', undefined, {
    staleTime: 10 * 60_000,
    refetchOnWindowFocus: true,
  });
}

export function usePreferencesQuery() {
  return useApiQuery('preferencesGet');
}

export function useLibraryQuery() {
  return useApiQuery('libraryGet');
}

/** ¿Está cada canal en tu biblioteca? Solo se recalcula si cambia el CONTENIDO de la biblioteca (regla 5). */
export function useLibraryLookup(): LibraryLookup {
  const library = useLibraryQuery().data;
  return useMemo(() => buildLibraryLookup(library), [library]);
}

const NO_SCORES: Readonly<Record<string, LiveScore>> = Object.freeze({});

/**
 * Marcadores del día que miras. Solo se consulta si ese día tiene algún
 * partido en su ventana (15 min antes a 3,5 h después), cada 8 s si hay algo
 * en juego y cada 45 s si no. Con la vista oculta no se consulta nada.
 */
export function useScores(matches: readonly FootballMatch[], now: number, enabled = true) {
  const wanted = enabled && scoresWanted(matches, now);
  const query = useApiQuery('scores', undefined, {
    enabled: wanted,
    staleTime: 5_000,
    refetchInterval: (q) => (wanted ? scoresInterval(q.state.data?.scores) : false),
    refetchOnWindowFocus: false,
  });
  return {
    scores: query.data?.available ? query.data.scores : NO_SCORES,
    available: query.data?.available ?? false,
  };
}

// ---- Señal por partido -----------------------------------------------------------

interface ScanSnapshot {
  status: string;
  playable: number;
  checked: number;
  total: number;
  retryAt: string | null;
  receivedAt: number;
}

/* Lo último que dijo el comprobador de cada partido (evento `scan.progress`
   con `matchId`). Suscripción de módulo: un evento no espera a que haya una
   fila montada, y cuesta lo que un Map. */
const scanStore = createStore<ReadonlyMap<string, ScanSnapshot>>(new Map());

onSseEvent('scan.progress', (data) => {
  if (!data.matchId) return;
  scanStore.set((current) => {
    const next = new Map(current);
    if (data.status === 'cancelled') next.delete(data.matchId as string);
    else {
      next.set(data.matchId as string, {
        status: data.status,
        playable: data.playable,
        checked: data.checked,
        total: data.total,
        retryAt: data.retryAt,
        receivedAt: Date.now(),
      });
    }
    return next;
  });
});

/** Solo para los tests. */
export function resetScanStore(): void {
  scanStore.set(new Map());
}

/** Lo que el SSE sabe de la señal de este partido (válido 20 min, lo que dura un resultado del precalentado). */
function useScanSignal(matchId: string): MatchSignal | null {
  const snapshot = useStore(scanStore, (map) => map.get(matchId) ?? null);
  if (!snapshot || Date.now() - snapshot.receivedAt > 20 * 60_000) return null;
  return signalFromScan(snapshot);
}

/**
 * Indicador de señal de un partido: el SSE si ha dicho algo; si no, el
 * precalentado del servidor (solo dentro de su ventana, de 45 min antes a
 * 120 después). Fuera de la ventana, «Pendiente» para lo que va a empezar y
 * nada para lo terminado o sin canal. Sin SSE, el precalentado se vuelve a
 * pedir cada 30 s (respaldo).
 */
export function useMatchSignal(
  match: FootballMatch,
  now: number,
  options: { enabled?: boolean; finished?: boolean } = {},
): MatchSignal | null {
  const { enabled = true, finished = false } = options;
  const realtime = useRealtimeStatus();
  const hasChannels = (match.channels?.length ?? 0) > 0;
  const inWindow = inPreheatWindow(match, now);
  const fromScan = useScanSignal(match.id);
  const preheat = useApiQuery(
    'footballPreheat',
    { params: { matchId: match.id } },
    {
      enabled: enabled && hasChannels && inWindow && !finished,
      refetchInterval: realtime === 'open' ? false : 30_000,
    },
  );
  if (!hasChannels || finished) return null;
  if (fromScan) return fromScan;
  if (!inWindow) {
    // «Pendiente» solo para lo que empieza en las próximas 6 h (lo que lleva
    // insignia): marcarlo en todos los partidos de la semana sería ruido.
    return typeof match.start === 'number' &&
      match.start > now &&
      match.start - now <= 6 * 60 * 60_000
      ? signalFromPreheat(null)
      : null;
  }
  if (preheat.isLoading) return { state: 'checking', summary: 'Consultando la señal…' };
  return signalFromPreheat(preheat.data?.preheat ?? null);
}
