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
import { readItem, STORAGE_KEYS, writeItem } from '../../lib/storage.ts';
import { createStore, useStore } from '../../lib/store.ts';

interface RevealState {
  /** Partido que suena ahora (id de la agenda), o null. */
  watched: string | null;
  /** Partidos destapados mientras dura esa reproducción. */
  revealed: ReadonlySet<string>;
  /** Partidos que TAPASTE a mano en la agenda (cápsula «Marcador» o menú):
      la tira «En directo», que enseña el resultado, tampoco lo enseña. */
  covered: ReadonlySet<string>;
  /** «Marcador oculto» de Ajustes (rediseño, sección 7): apagado, todo se ve. */
  hiding: boolean;
}

/** «Marcador oculto» guardado en este navegador; sin nada guardado, encendido. */
function readHiding(): boolean {
  return readItem(STORAGE_KEYS.scoreHiding) !== 'visible';
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
  covered: new Set(),
  hiding: readHiding(),
});

/* Cambiar de partido o detener vuelve a tapar: el destapado era para ESA
   reproducción. Lo tapado a mano se queda (lo pediste tú). Suscripción de
   módulo (vive lo que la pestaña). */
playerPresence.subscribe(() => {
  const watched = watchedMatchOf(playerPresence.get());
  if (watched !== store.get().watched)
    store.set((state) => ({ ...state, watched, revealed: new Set() }));
});

function without(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set;
  const next = new Set(set);
  next.delete(id);
  return next;
}

function including(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (set.has(id)) return set;
  const next = new Set(set);
  next.add(id);
  return next;
}

export function revealScore(matchId: string): void {
  store.set((state) => {
    const revealed = including(state.revealed, matchId);
    const covered = without(state.covered, matchId);
    if (revealed === state.revealed && covered === state.covered) return state;
    return { ...state, revealed, covered };
  });
}

/** Vuelve a tapar UN partido (segundo toque en la cápsula «Marcador» de la agenda o el menú). */
export function hideScore(matchId: string): void {
  store.set((state) => {
    const revealed = without(state.revealed, matchId);
    const covered = including(state.covered, matchId);
    if (revealed === state.revealed && covered === state.covered) return state;
    return { ...state, revealed, covered };
  });
}

/* ---- Agenda: TODO tapado por defecto (corrección 1 y DESIGN.md de Palco:
   «el marcador vive oculto tras un toque en la cápsula "Marcador", nunca en
   la imagen»). En la agenda (héroe, filas, panel, «Luego» y columna) un
   partido enseña cifras solo si está en `revealed`; lo demás (centro de
   partido, biblioteca, mini) sigue con la regla 29 de arriba. El destapado se
   olvida igual que antes al cambiar de partido o detener.

   Excepción, la tira «En directo» de la pantalla ancha (Isma, 0.9.0: «el
   marcador junto al minuto»): enseña el resultado salvo el del partido que
   estás viendo (regla 29, `useScoreHidden`) y salvo los que hayas tapado a
   mano (`useScoreCovered`). */

/* «Marcador oculto» apagado: la agenda recibe este conjunto en vez del de
   destapados y lo da todo por destapado (sin tocar a quien lo usa). */
const EVERYTHING: ReadonlySet<string> = new Set<string>();

/** Puro: ¿este partido está destapado? */
export function isScoreRevealed(revealed: ReadonlySet<string>, matchId: string): boolean {
  return revealed === EVERYTHING || revealed.has(matchId);
}

/** Los partidos destapados (la agenda lo lee una vez para sus menús contextuales). */
export function useRevealedScores(): ReadonlySet<string> {
  return useStore(store, (state) => (state.hiding ? state.revealed : EVERYTHING));
}

/** ¿Este partido está destapado en la agenda? */
export function useScoreRevealed(matchId: string): boolean {
  return useStore(store, (state) => !state.hiding || isScoreRevealed(state.revealed, matchId));
}

/** ¿Está encendido «Marcador oculto»? (Ajustes → Agenda.) */
export function useScoreHiding(): boolean {
  return useStore(store, (state) => state.hiding);
}

/** Enciende o apaga «Marcador oculto» y lo guarda en este navegador. */
export function setScoreHiding(hiding: boolean): void {
  writeItem(STORAGE_KEYS.scoreHiding, hiding ? 'oculto' : 'visible');
  store.set((state) => (state.hiding === hiding ? state : { ...state, hiding }));
}

/** Vuelve a tapar (el reproductor lo puede llamar al cambiar de fuente o de canal). */
export function resetScoreReveal(): void {
  store.set((state) => (state.revealed.size ? { ...state, revealed: new Set() } : state));
}

/** ¿Lo has tapado a mano en la agenda (y no lo has vuelto a destapar)? */
export function useScoreCovered(matchId: string): boolean {
  return useStore(store, (state) => state.hiding && state.covered.has(matchId));
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
  const revealed = useStore(store, (state) => !state.hiding || state.revealed.has(matchId));
  return (alsoWatched || watched === matchId) && !revealed;
}

/** Solo para los tests. */
export function resetScoreRevealForTests(): void {
  store.set({
    watched: watchedMatchOf(playerPresence.get()),
    revealed: new Set(),
    covered: new Set(),
    hiding: readHiding(),
  });
}
