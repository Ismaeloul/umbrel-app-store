/* Módulo `teams`: escudos (PNG) y colores de los equipos de la agenda y
   logos de las competiciones, desde TheSportsDB, cacheados en
   `<DATA_DIR>/v2/teams/` y servidos desde nuestra API con ETag (informe de
   fase 2, §10). Módulo nuevo: sin equivalente en la 0.6.59.

   Reglas:
   - La agenda nunca espera ni falla por esto: `decorateSchedule` es síncrona,
     pura y lee de un índice en memoria; lo desconocido se encola y una vuelta
     de fondo (cada 5 min, 20 resoluciones, cola única con pausa entre
     peticiones) lo resuelve.
   - Los clientes nunca enlazan imágenes de terceros: el PNG sale de
     `GET /api/v1/football/teams/:teamId/crest` (mismo origen; la CSP de nginx
     solo admite `img-src 'self'`).
   - En demo (`FOOTBALL_DEMO_ONLY`) o con `ACE_TEAM_CRESTS=false` no toca red
     ni disco y `healthInfo().status === 'disabled'`.
   - Si falla o no encuentra un equipo, la agenda sale igual (campos
     ausentes) y el cliente pinta un escudo generado y un color del nombre. */

import type { FastifyReply } from 'fastify';
import type { FootballSchedule } from '@ace/shared';
import type { CoreDeps, Lifecycle } from '../../core/module.js';
import type { FootballService } from '../football/types.js';
import type { NetClient } from '../net/types.js';

export interface TeamsDeps extends CoreDeps {
  readonly net: NetClient;
  /** Solo `schedule()`: la agenda cacheada (nunca dispara una descarga que no hiciera ya el precalentado). */
  readonly football: Pick<FootballService, 'schedule'>;
}

export type TeamsStatus = 'ready' | 'warming' | 'degraded' | 'disabled';

/** Estado para la salud (nivel 1 de §7: avisos en `warnings[]`, sin componente propio). */
export interface TeamsHealth {
  readonly status: TeamsStatus;
  /** Entradas del índice. */
  readonly teams: number;
  /** Con escudo en disco. */
  readonly crests: number;
  /** Pendientes de resolver o de reintentar. */
  readonly pending: number;
  readonly lastRefreshAt: string | null;
  /** Por qué está `degraded` (texto corto para el aviso de salud), o null. */
  readonly detail: string | null;
}

export interface ServeBadgeOptions {
  /** Cabecera `If-None-Match` de la petición: si casa, 304 sin cuerpo. */
  readonly ifNoneMatch?: string | undefined;
  /** `?v=` de la URL: con él la respuesta es inmutable un año. */
  readonly version?: string | undefined;
}

export interface TeamsService extends Lifecycle {
  /**
   * Síncrona y pura: copia la agenda añadiendo `homeTeam`/`awayTeam`/
   * `competitionBadge` donde el índice sabe algo. No toca la agenda que
   * recibe (la comparten preheat, marcadores y la ruta antigua). Lo que no
   * conoce lo apunta para la siguiente vuelta sin esperar. Nunca lanza.
   */
  decorateSchedule(schedule: FootballSchedule): FootballSchedule;
  /** Escudo por `idTeam`: escribe él mismo la respuesta (PNG, 304 o lanza `not_found`). */
  serveCrest(reply: FastifyReply, teamId: string, options?: ServeBadgeOptions): Promise<void>;
  /** Logo por `idLeague`, mismo circuito. */
  serveCompetitionLogo(
    reply: FastifyReply,
    competitionId: string,
    options?: ServeBadgeOptions,
  ): Promise<void>;
  /** Una vuelta de resolución (la lanza el temporizador; expuesta para los tests). */
  runOnce(options?: { readonly budget?: number }): Promise<void>;
  healthInfo(): TeamsHealth;
}
