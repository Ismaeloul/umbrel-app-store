/* Lo que comparten las piezas del reproductor montadas dentro del PlayerDock
   (la superficie grande, el mini-reproductor y el panel técnico): el
   orquestador, las acciones ya preparadas y lo que se puede hacer en este
   navegador. Fuera del PlayerDock el contexto es null y esas piezas no se
   pintan (el reproductor es UNO y lo monta el armazón). */

import { createContext, use } from 'react';
import type { PlayerPresentation } from '../app/contracts.ts';
import type { MenuItem } from '../ui/Menu.tsx';
import type { PlayerRuntime } from './runtime.ts';

export interface PlayerActions {
  toggle(): void;
  tapToPlay(): void;
  stop(): void;
  retry(): void;
  goLive(): void;
  back(): void;
  toggleMute(): void;
  setVolume(volume: number): void;
  toggleFullscreen(): void;
  /** Modo teatro: el vídeo llena la ventana sin pantalla completa (escritorio sin ella). */
  toggleTheater(): void;
  togglePip(): void;
  toggleNerd(): void;
  toggleFavorite(): void;
  zap(direction: 1 | -1): void;
  /** Cambiar de canal rápido entre favoritos (↑ ↓, deslizar a los lados; favorite-zap.ts). */
  zapFavorite(direction: 1 | -1): void;
  minimize(): void;
  expand(): void;
  // ---- Películas y series (docs/vod.md §12.7 y §12.9) ----
  /** ±10 s (las pulsaciones seguidas se juntan). */
  seekBy(delta: number): void;
  /** A un punto (la barra, al soltar). */
  seekTo(seconds: number): void;
  /** «Siguiente episodio» / «Ver ahora». */
  nextEpisode(): void;
  /** «Ver créditos»: la tarjeta sin cuenta atrás. */
  watchCredits(): void;
  /** «¿Sigues viendo?» → «Seguir viendo». */
  keepWatching(): void;
  /** «¿Sigues viendo?» → «Salir» (detiene y vuelve a la ficha). */
  leaveVod(): void;
  /** «Ver de nuevo». */
  replay(): void;
  /** Otra pista de audio (se reabre en la posición). */
  setAudio(index: number): void;
  /** «Volver a la ficha» (la película o la serie). */
  openTitle(): void;
}

export interface PlayerContextValue {
  runtime: PlayerRuntime | null;
  presentation: PlayerPresentation;
  actions: PlayerActions;
  /** Menú «Más opciones» y menú contextual: los mismos elementos. */
  menuItems: MenuItem[];
  fullscreen: boolean;
  /** Modo teatro puesto (plan Palco W5: el mismo `data-immersive` que la pantalla completa). */
  theater: boolean;
  pip: boolean;
  canFullscreen: boolean;
  canPip: boolean;
  canZap: boolean;
  /** Hay algún favorito al que saltar (distinto del que suena). */
  canZapFavorites: boolean;
  isFavorite: boolean;
  /** Ratón de verdad: clic para pausar, doble clic para pantalla completa, menú contextual. */
  finePointer: boolean;
  /** Móvil (< 768): flecha de minimizar, sin volumen (lo da el sistema). */
  compact: boolean;
  /** Vídeo a toda la pantalla (móvil en horizontal, pantalla completa o modo teatro). */
  immersive: boolean;
  /** Una vista ya enseña «Datos técnicos» (useHostNerdPanel): el reproductor no saca el suyo. */
  nerdHosted: boolean;
}

export const PlayerContext = createContext<PlayerContextValue | null>(null);

export function usePlayerContext(): PlayerContextValue | null {
  return use(PlayerContext);
}
