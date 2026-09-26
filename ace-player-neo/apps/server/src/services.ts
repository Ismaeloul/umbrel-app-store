/* Composición de los servicios del backend, SIN ciclos (arquitectura §5.2).

   El orden de creación es el del grafo "A usa B": cada fábrica recibe solo
   los servicios que ya existen. Lo que en la 0.6.59 eran llamadas cruzadas
   (el comprobador avisando a fuentes, precalentado y playback; el motor
   avisando a la web) va por el bus de dominio, que se crea antes que nadie.

     state, net
     iptv         → state, net (docs/iptv.md §11.2)
     engine
     scanner      → engine
     search       → engine, scanner
     sources      → state, scanner
     directories  → net, state
     remux        → engine
     playback     → engine, remux, state, scanner
     football     → state, net, engine, scanner, search, sources, directories
     teams        → net, football
     auth         → state
     events       (solo el bus)
     diagnostics  (solo el bus)
     health       → todos los anteriores (hoja: nadie depende de él)

   Los tests montan el árbol con `createServices(core, overrides)` y cambian
   solo lo que les interesa por un fake. */

import type { AppConfig } from './config/index.js';
import type { DomainBus } from './core/bus.js';
import type { Clock } from './core/clock.js';
import type { Logger } from './core/logger.js';
import type { CoreDeps } from './core/module.js';
import { createAuthService, type AuthService } from './modules/auth/index.js';
import { createDiagnosticsService, type DiagnosticsService } from './modules/diagnostics/index.js';
import { createDirectoriesService, type DirectoriesService } from './modules/directories/index.js';
import { createEngineService, type EngineService } from './modules/engine/index.js';
import { createEventsHub, type EventsHub } from './modules/events/index.js';
import { createFootballService, type FootballService } from './modules/football/index.js';
import { createHealthService, type HealthService } from './modules/health/index.js';
import { createIptvService, type IptvService } from './modules/iptv/index.js';
import { createNetClient, type NetClient } from './modules/net/index.js';
import { createPlaybackService, type PlaybackService } from './modules/playback/index.js';
import { createRemuxService, type RemuxService } from './modules/remux/index.js';
import { createScannerService, type ScannerService } from './modules/scanner/index.js';
import { createSearchService, type SearchService } from './modules/search/index.js';
import { createSourcesService, type SourcesService } from './modules/sources/index.js';
import { createStateService, type StateService } from './modules/state/index.js';
import { createTeamsService, type TeamsService } from './modules/teams/index.js';

export interface Services {
  readonly config: AppConfig;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly bus: DomainBus;
  readonly state: StateService;
  readonly net: NetClient;
  readonly iptv: IptvService;
  readonly engine: EngineService;
  readonly scanner: ScannerService;
  readonly search: SearchService;
  readonly sources: SourcesService;
  readonly directories: DirectoriesService;
  readonly remux: RemuxService;
  readonly playback: PlaybackService;
  readonly football: FootballService;
  readonly teams: TeamsService;
  readonly auth: AuthService;
  readonly events: EventsHub;
  readonly diagnostics: DiagnosticsService;
  readonly health: HealthService;
}

export type ServiceName = Exclude<keyof Services, keyof CoreDeps>;

/** Orden de creación (el del grafo). El arranque sigue este orden y el apagado, el contrario. */
export const SERVICE_ORDER: readonly ServiceName[] = [
  'state',
  'net',
  'iptv',
  'engine',
  'scanner',
  'search',
  'sources',
  'directories',
  'remux',
  'playback',
  'football',
  'teams',
  'auth',
  'events',
  'diagnostics',
  'health',
];

/**
 * Crea todos los servicios. `overrides` sustituye servicios concretos (tests):
 * los que dependen de uno sustituido reciben el sustituto.
 */
export function createServices(
  core: CoreDeps,
  overrides: Partial<Omit<Services, keyof CoreDeps>> = {},
): Services {
  const state = overrides.state ?? createStateService(core);
  const net = overrides.net ?? createNetClient(core);
  const iptv = overrides.iptv ?? createIptvService({ ...core, state, net });
  const engine = overrides.engine ?? createEngineService(core);
  const scanner = overrides.scanner ?? createScannerService({ ...core, engine });
  const search = overrides.search ?? createSearchService({ ...core, engine, scanner });
  const sources = overrides.sources ?? createSourcesService({ ...core, state, scanner });
  const directories = overrides.directories ?? createDirectoriesService({ ...core, net, state });
  const remux = overrides.remux ?? createRemuxService({ ...core, engine });
  const playback =
    overrides.playback ?? createPlaybackService({ ...core, engine, remux, state, scanner });
  const football =
    overrides.football ??
    createFootballService({ ...core, state, net, engine, scanner, search, sources, directories });
  const teams = overrides.teams ?? createTeamsService({ ...core, net, football });
  const auth = overrides.auth ?? createAuthService({ ...core, state });
  const events = overrides.events ?? createEventsHub(core);
  const diagnostics = overrides.diagnostics ?? createDiagnosticsService(core);
  const health =
    overrides.health ??
    createHealthService({
      ...core,
      state,
      engine,
      scanner,
      sources,
      directories,
      playback,
      remux,
      football,
      teams,
      diagnostics,
      events,
    });

  return {
    ...core,
    state,
    net,
    iptv,
    engine,
    scanner,
    search,
    sources,
    directories,
    remux,
    playback,
    football,
    teams,
    auth,
    events,
    diagnostics,
    health,
  };
}
