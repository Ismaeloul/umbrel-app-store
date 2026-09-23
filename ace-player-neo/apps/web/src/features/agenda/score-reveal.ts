/* El marcador del partido que estás VIENDO sale tapado (regla 29 y
   corrección 2 de eleccion.md): AceStream va por detrás de la emisión y un
   marcador al instante te cantaría el gol antes de verlo. Se destapa con un
   toque y sigue destapado hasta cambiar de partido o detener
   (index.html:3176-3179, 3287-3295, 4891-4894, 4993-4999).

   Es un almacén de la pestaña (no del backend) y vive aquí, en la agenda,
   porque la agenda es la primera que lo pinta. Lo pueden usar el centro de
   partido, la biblioteca y el mini-reproductor importando
   `../agenda/score-reveal.ts`, así los cuatro sitios comparten el mismo
   «destapado». Qué partido se ve lo dice el armazón (playerPresence). */

import { playerPresence, type PlayerPresence } from '../../app/player-presence.ts';
import { createStore, useStore } from '../../lib/store.ts';

interface RevealState {
  /** Partido que suena ahora (id de la agenda), o null. */
  watched: string | null;
  /** Partidos destapados mientras dura esa reproducción. */
  revealed: ReadonlySet<string>;
}

/** Id del partido que se está viendo, o null (un canal suelto no es un partido). */
export function watchedMatchOf(presence: PlayerPresence): string | null {
  const route = presence.route;
  if (!presence.active || !route || route.vista !== 'partido') return null;
  return route.id ?? null;
}

const store = createStore<RevealState>({
  watched: watchedMatchOf(playerPresence.get()),
  revealed: new Set(),
});

/* Cambiar de partido o detener vuelve a tapar: el destapado era para ESA
   reproducción. Suscripción de módulo (vive lo que la pestaña). */
playerPresence.subscribe(() => {
  const watched = watchedMatchOf(playerPresence.get());
  if (watched !== store.get().watched) store.set({ watched, revealed: new Set() });
});

export function revealScore(matchId: string): void {
  store.set((state) => {
    if (state.revealed.has(matchId)) return state;
    const revealed = new Set(state.revealed);
    revealed.add(matchId);
    return { ...state, revealed };
  });
}

/** Vuelve a tapar (el reproductor lo puede llamar al cambiar de fuente o de canal). */
export function resetScoreReveal(): void {
  store.set((state) => (state.revealed.size ? { ...state, revealed: new Set() } : state));
}

/** Id del partido que se está viendo (o null). */
export function useWatchedMatch(): string | null {
  return useStore(playerPresence, watchedMatchOf);
}

/**
 * ¿Hay que tapar el marcador de este partido? `alsoWatched` cuenta como
 * «viéndolo» aunque el reproductor aún no haya arrancado (la columna de la
 * agenda junto al partido que tienes abierto).
 */
export function useScoreHidden(matchId: string, alsoWatched = false): boolean {
  const watched = useWatchedMatch();
  const revealed = useStore(store, (state) => state.revealed.has(matchId));
  return (alsoWatched || watched === matchId) && !revealed;
}

/** Solo para los tests. */
export function resetScoreRevealForTests(): void {
  store.set({ watched: watchedMatchOf(playerPresence.get()), revealed: new Set() });
}
