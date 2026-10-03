/* Módulo `instant-start`: «Arranque instantáneo» (D24, 0.8.4).

   Unos minutos antes del saque de un partido de tus EQUIPOS favoritos, el
   Umbrel deja preparada la mejor fuente para que «Ver» arranque en 1-2 s:
   - T-10 min: se resuelve otra vez el partido (IPTV primero, luego
     AceStream) con el precalentado de football.
   - T-3 min: si nada suena en casa (D5) y, con IPTV, la plaza del proveedor
     está libre de verdad (§7), playback abre esa fuente sin visor (IPTV: relé
     + remux con segmentos listos; AceStream: la sesión del motor).
   - Cede al momento ante cualquier otra reproducción, se suelta a los 10 min
     del saque si nadie la usa y al apagar el ajuste.
   - Una sola a la vez: si dos partidos coinciden, el de saque más temprano
     (a igual saque, el del equipo que va antes en tus gustos).

   Depende de state (ajuste y gustos), football (agenda y resolución),
   playback (la sesión) y scanner (veredictos para elegir la fuente). */

import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { FootballService } from '../football/types.js';
import type { PlaybackService } from '../playback/types.js';
import type { ScannerService } from '../scanner/types.js';
import type { StateService } from '../state/types.js';

export interface InstantStartDeps extends CoreDeps {
  readonly state: StateService;
  readonly football: FootballService;
  readonly playback: PlaybackService;
  readonly scanner: ScannerService;
}

/** `components.instantStart` de la salud. */
export interface InstantStartHealth {
  readonly enabled: boolean;
  readonly status: 'off' | 'idle' | 'warming' | 'warm';
  readonly matchId: string | null;
  readonly source: 'engine' | 'iptv' | null;
  readonly last: string | null;
}

export interface InstantStartService extends Lifecycle {
  /** Una vuelta (la lanza el temporizador cada 30 s; los tests, a mano). */
  tick(): Promise<void>;
  healthInfo(): InstantStartHealth;
}
