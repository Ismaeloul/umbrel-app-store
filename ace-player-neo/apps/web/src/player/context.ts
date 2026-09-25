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
  minimize(): void;
  expand(): void;
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
