/* Servicio `teams` (informe de fase 2, §10): índice en memoria y en disco
   (store.ts), vuelta de resolución de fondo contra TheSportsDB (resolver.ts)
   y endpoint de los PNG con ETag. Estado por instancia; sin `process.env`.

   Ciclo:
   - `start()`: en demo o con ACE_TEAM_CRESTS=false no hace nada. Si no,
     carga el índice (y `<teamsDir>/overrides.json` si existe) y programa la
     primera vuelta a los 30 s y luego cada 5 min (`unref`).
   - Vuelta (`runOnce`): agenda cacheada → equipos y competiciones vistos
     (`lastSeenAt`) → los pendientes o con reintento vencido, por fecha del
     partido, hasta 20 por vuelta con 1,5 s entre uno y otro → poda. Un 429
     para la vuelta y pausa una hora; un fallo de red espera 10 min → 1 h →
     6 h → 24 h; `not_found`/`bad_image` reintentan a la semana; lo resuelto
     se revalida a los 90 días. Un aviso de diagnóstico por vuelta fallida
     (`network`) y uno en total si no se puede escribir (`state`).
   - `stop()`: aborta la vuelta en curso, la espera y deja el índice escrito. */

import path from 'node:path';
import { finished } from 'node:stream';
import type { FastifyReply } from 'fastify';
import {
  cleanTitle,
  motivoDeFallo,
  type CompetitionBadge,
  type FootballMatch,
  type FootballSchedule,
  type TeamBadge,
} from '@ace/shared';
import type { TimerHandle } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import { readJsonObjectSync } from '../state/index.js';
import { chooseColors, parseApiColors } from './colors.js';
import {
  TEAMS_AMBIGUOUS_RETRY_MS,
  TEAMS_CACHE_PLAIN,
  TEAMS_CACHE_VERSIONED,
  TEAMS_DATA_OVERRIDES_FILE,
  TEAMS_FIRST_RUN_MS,
  TEAMS_IMAGE_MAX_DIMENSION,
  TEAMS_MAX_COMPETITIONS,
  TEAMS_MAX_CRESTS,
  TEAMS_MAX_ENTRIES,
  TEAMS_NOT_FOUND_RETRY_MS,
  TEAMS_RATE_LIMIT_PAUSE_MS,
  TEAMS_REQUEST_GAP_MS,
  TEAMS_RETRY_BACKOFF_MS,
  TEAMS_REVALIDATE_MS,
  TEAMS_ROUND_BUDGET,
  TEAMS_ROUND_INTERVAL_MS,
} from './constants.js';
import {
  OverridesSchema,
  badgeShort,
  competitionKey,
  englishCountry,
  keyId,
  mergeOverrides,
  teamKey,
  teamQuery,
  type Overrides,
} from './normalize.js';
import { PngError, decodePng, type PngImage } from './png.js';
import {
  BadgeImageError,
  chooseLeague,
  chooseTeam,
  fetchBadge,
  lookupLeague,
  lookupTeam,
  searchLeagues,
  searchTeams,
  type ApiLeague,
  type ResolverDeps,
} from './resolver.js';
import {
  createTeamsStore,
  type BadgeFile,
  type BadgeKind,
  type CompetitionEntry,
  type EntryStatus,
  type TeamEntry,
  type TeamsIndex,
  type TeamsStore,
} from './store.js';
import type { ServeBadgeOptions, TeamsDeps, TeamsHealth, TeamsService } from './types.js';

interface WantedTeam {
  readonly key: string;
  readonly name: string;
  readonly country: string | null;
  readonly competition: string | null;
}

interface WantedCompetition {
  readonly key: string;
  readonly name: string;
  readonly country: string | null;
}

type Outcome =
  | { readonly kind: 'ok' }
  | { readonly kind: 'failed'; readonly code: string }
  | { readonly kind: 'rate_limited' }
  | { readonly kind: 'aborted' };

export interface TeamsLimits {
  readonly maxEntries: number;
  readonly maxCrests: number;
  readonly maxCompetitions: number;
}

export interface TeamsServiceOptions {
  /** Correcciones manuales (la fábrica pasa las empaquetadas en overrides.json). */
  readonly overrides?: Overrides;
  /** Topes del índice (los tests los bajan). */
  readonly limits?: Partial<TeamsLimits>;
}

/* Espera a que la respuesta haya salido del todo (el hook onSend es
   asíncrono: justo después de `send()` `reply.sent` aún es false). */
function settle(reply: FastifyReply): Promise<void> {
  return new Promise((resolve) => {
    finished(reply.raw, () => {
      /* Si el cliente cortó a mitad, nadie más debe tocar esta respuesta. */
      if (!reply.sent) reply.hijack();
      resolve();
    });
  });
}

/** ¿`If-None-Match` casa con el ETag (también `W/`, comillas y listas)? */
export function etagMatches(header: string | undefined, etag: string): boolean {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header
    .split(',')
    .some((part) => part.trim().replace(/^W\//, '').replace(/^"|"$/g, '') === etag);
}

function backoff(attempts: number): number {
  const index = Math.min(Math.max(attempts, 1), TEAMS_RETRY_BACKOFF_MS.length) - 1;
  return TEAMS_RETRY_BACKOFF_MS[index] as number;
}

/** ¿Toca resolver o reintentar esta entrada? */
export function isDue(
  entry: { readonly status: string; readonly nextRetryAt: string | null },
  now: number,
): boolean {
  if (entry.status === 'skipped') return false;
  if (entry.status === 'pending') return true;
  return entry.nextRetryAt !== null && Date.parse(entry.nextRetryAt) <= now;
}

export class TeamsServiceImpl implements TeamsService {
  private readonly store: TeamsStore;
  private readonly limits: TeamsLimits;
  private overrides: Overrides;
  private started = false;
  private loaded = false;
  private timers: TimerHandle[] = [];
  private controller = new AbortController();
  private running: Promise<void> | null = null;
  /** Hasta cuándo no se pide nada (tras un 429). */
  private pausedUntil = 0;
  private lastRefreshAt: number | null = null;
  /** Qué falló en la última vuelta (para la salud), o null. */
  private lastRoundFailure: string | null = null;
  /** Lo que la agenda pidió y el índice no conocía: entra en la siguiente vuelta. */
  private readonly pendingTeams = new Map<string, WantedTeam>();
  private readonly pendingCompetitions = new Map<string, WantedCompetition>();

  constructor(
    private readonly deps: TeamsDeps,
    options: TeamsServiceOptions = {},
  ) {
    this.overrides = options.overrides ?? { teams: {}, competitions: {} };
    this.limits = {
      maxEntries: TEAMS_MAX_ENTRIES,
      maxCrests: TEAMS_MAX_CRESTS,
      maxCompetitions: TEAMS_MAX_COMPETITIONS,
      ...options.limits,
    };
    this.store = createTeamsStore({
      dir: deps.config.paths.teamsDir,
      clock: deps.clock,
      logger: deps.logger,
      onUnreadable: (moved) =>
        deps.bus.emit('diagnostics.report', {
          cause: 'state',
          code: 'crests_index_unreadable',
          message: moved
            ? `El índice de escudos no se podía leer; se ha apartado como ${path.basename(moved)} y se empieza vacío.`
            : 'El índice de escudos no se podía leer; se empieza vacío.',
        }),
      onWriteError: () =>
        deps.bus.emit('diagnostics.report', {
          cause: 'state',
          code: 'crests_unwritable',
          message:
            'Escudos: no se puede escribir en data/v2/teams; el índice sigue solo en memoria.',
        }),
    });
  }

  /** Apagado en demo o con `ACE_TEAM_CRESTS=false` (config.teams.enabled). */
  get enabled(): boolean {
    return this.deps.config.teams.enabled;
  }

  /** El índice en memoria (para los tests y para depurar; no está en la interfaz). */
  snapshot(): TeamsIndex {
    return this.store.index();
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.enabled) return;
    this.load();
    const { clock, logger } = this.deps;
    const tick = (): void => {
      void this.runOnce().catch((error: unknown) =>
        logger.warn(
          { errorCode: motivoDeFallo(error), err: error },
          'escudos: la vuelta ha fallado',
        ),
      );
    };
    this.timers.push(
      clock.setTimeout(tick, TEAMS_FIRST_RUN_MS, { unref: true }),
      clock.setInterval(tick, TEAMS_ROUND_INTERVAL_MS, { unref: true }),
    );
  }

  async stop(): Promise<void> {
    const { clock } = this.deps;
    for (const timer of this.timers) {
      clock.clearTimeout(timer);
      clock.clearInterval(timer);
    }
    this.timers = [];
    this.controller.abort(new Error('teams_stopped'));
    if (this.running) await this.running.catch(() => undefined);
    await this.store.flush();
    this.controller = new AbortController();
    this.started = false;
  }

  /* Índice, PNG y correcciones del volumen: una vez, al arrancar o en la primera vuelta. */
  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const { config, logger } = this.deps;
    const report = this.store.load();
    logger.info(
      { ...report, teams: Object.keys(this.store.index().teams).length },
      'escudos: índice cargado',
    );
    const file = path.join(config.paths.teamsDir, TEAMS_DATA_OVERRIDES_FILE);
    const outcome = readJsonObjectSync(file);
    if (outcome.kind === 'missing') return;
    const parsed = outcome.kind === 'ok' ? OverridesSchema.safeParse(outcome.value) : null;
    if (parsed?.success) {
      this.overrides = mergeOverrides(this.overrides, parsed.data);
      logger.info(
        {
          file,
          teams: Object.keys(parsed.data.teams).length,
          competitions: Object.keys(parsed.data.competitions).length,
        },
        'escudos: correcciones del volumen cargadas',
      );
      return;
    }
    logger.warn(
      {
        file,
        reason: outcome.kind === 'unreadable' ? outcome.reason : 'schema',
        issues: parsed ? parsed.error.issues.slice(0, 5) : null,
      },
      'escudos: overrides.json del volumen ilegible o fuera de esquema; se ignora',
    );
  }

  // --- Agenda ---

  decorateSchedule(schedule: FootballSchedule): FootballSchedule {
    if (!this.enabled) return schedule;
    const index = this.store.index();
    return {
      ...schedule,
      days: schedule.days.map((day) => ({
        ...day,
        matches: day.matches.map((match) => this.decorateMatch(match, index)),
      })),
    };
  }

  private decorateMatch(match: FootballMatch, index: TeamsIndex): FootballMatch {
    const homeTeam = this.teamBadge(match.home, match, index);
    const awayTeam = this.teamBadge(match.away, match, index);
    const competitionBadge = this.competitionBadge(match, index);
    if (!homeTeam && !awayTeam && !competitionBadge) return match;
    return {
      ...match,
      ...(homeTeam ? { homeTeam } : {}),
      ...(awayTeam ? { awayTeam } : {}),
      ...(competitionBadge ? { competitionBadge } : {}),
    };
  }

  private teamBadge(name: string, match: FootballMatch, index: TeamsIndex): TeamBadge | undefined {
    const key = teamKey(name);
    if (!key) return undefined;
    const entry = index.teams[key];
    if (!entry && !this.pendingTeams.has(key)) {
      this.pendingTeams.set(key, {
        key,
        name: cleanTitle(name, ''),
        country: match.country || null,
        competition: match.competition || null,
      });
    }
    if (entry?.idTeam && (entry.crest || entry.colors)) {
      return {
        id: entry.idTeam,
        name: entry.apiName ?? name,
        short: entry.short,
        crest: entry.crest
          ? `/api/v1/football/teams/${entry.idTeam}/crest?v=${entry.crest.etag}`
          : null,
        colors: entry.colors
          ? { primary: entry.colors.primary, secondary: entry.colors.secondary }
          : null,
      };
    }
    const override = this.overrides.teams[key];
    if (override?.colors) {
      return {
        id: keyId(key),
        name,
        short: null,
        crest: null,
        colors: { primary: override.colors[0], secondary: override.colors[1] },
      };
    }
    return undefined;
  }

  private competitionBadge(match: FootballMatch, index: TeamsIndex): CompetitionBadge | undefined {
    const key = competitionKey(match.competition);
    if (!key) return undefined;
    const entry = index.competitions[key];
    if (!entry) {
      if (!this.pendingCompetitions.has(key)) {
        this.pendingCompetitions.set(key, {
          key,
          name: cleanTitle(match.competition, ''),
          country: match.country || null,
        });
      }
      return undefined;
    }
    if (!entry.idLeague || !entry.logo) return undefined;
    return {
      id: entry.idLeague,
      name: entry.apiName ?? match.competition,
      logo: `/api/v1/football/competitions/${entry.idLeague}/logo?v=${entry.logo.etag}`,
    };
  }

  // --- Endpoint ---

  serveCrest(reply: FastifyReply, teamId: string, options: ServeBadgeOptions = {}): Promise<void> {
    return this.serveBadge('team', teamId, reply, options);
  }

  serveCompetitionLogo(
    reply: FastifyReply,
    competitionId: string,
    options: ServeBadgeOptions = {},
  ): Promise<void> {
    return this.serveBadge('competition', competitionId, reply, options);
  }

  private findBadge(
    kind: BadgeKind,
    id: string,
  ): { readonly key: string; readonly file: BadgeFile } | null {
    const index = this.store.index();
    if (kind === 'team') {
      for (const entry of Object.values(index.teams)) {
        if (entry.idTeam === id && entry.crest) return { key: entry.key, file: entry.crest };
      }
      return null;
    }
    for (const entry of Object.values(index.competitions)) {
      if (entry.idLeague === id && entry.logo) return { key: entry.key, file: entry.logo };
    }
    return null;
  }

  private async serveBadge(
    kind: BadgeKind,
    id: string,
    reply: FastifyReply,
    options: ServeBadgeOptions,
  ): Promise<void> {
    const found = this.enabled ? this.findBadge(kind, id) : null;
    if (!found) throw new AppError('not_found', { detail: `${kind} ${id}: sin imagen` });
    const etag = `"${found.file.etag}"`;
    /* `cache-control` antes de `send`: el hook onSend pone `no-store` si falta. */
    const headers: Record<string, string> = {
      etag,
      'last-modified': new Date(found.file.fetchedAt).toUTCString(),
      'cache-control': options.version ? TEAMS_CACHE_VERSIONED : TEAMS_CACHE_PLAIN,
    };
    if (etagMatches(options.ifNoneMatch, found.file.etag)) {
      void reply.code(304).headers(headers).send();
      await settle(reply);
      return;
    }
    const bytes = await this.store.readBadge(kind, found.file.file);
    if (!bytes) {
      /* El PNG desapareció del disco: la entrada vuelve a la cola. */
      this.store.update((draft) => {
        if (kind === 'team') {
          const entry = draft.teams[found.key];
          if (entry) {
            entry.crest = null;
            entry.status = 'pending';
            entry.nextRetryAt = null;
          }
        } else {
          const entry = draft.competitions[found.key];
          if (entry) {
            entry.logo = null;
            entry.status = 'pending';
            entry.nextRetryAt = null;
          }
        }
      });
      throw new AppError('not_found', { detail: `${kind} ${id}: el PNG ya no está en disco` });
    }
    void reply
      .code(200)
      .headers({
        ...headers,
        'content-type': 'image/png',
        'content-length': String(bytes.length),
      })
      .send(bytes);
    await settle(reply);
  }

  // --- Vuelta de resolución ---

  runOnce(options: { readonly budget?: number } = {}): Promise<void> {
    if (!this.enabled) return Promise.resolve();
    if (this.running) return this.running;
    this.load();
    const run = this.round(options.budget ?? TEAMS_ROUND_BUDGET).finally(() => {
      this.running = null;
    });
    this.running = run;
    return run;
  }

  /* Equipos y competiciones de la agenda (por fecha) más lo que pidió la decoración. */
  private collectWanted(schedule: FootballSchedule | null): {
    readonly teams: Map<string, WantedTeam>;
    readonly competitions: Map<string, WantedCompetition>;
  } {
    const teams = new Map<string, WantedTeam>();
    const competitions = new Map<string, WantedCompetition>();
    for (const day of schedule?.days ?? []) {
      for (const match of day.matches) {
        for (const name of [match.home, match.away]) {
          const key = teamKey(name);
          if (key && !teams.has(key)) {
            teams.set(key, {
              key,
              name: cleanTitle(name, ''),
              country: match.country || null,
              competition: match.competition || null,
            });
          }
        }
        const key = competitionKey(match.competition);
        if (key && !competitions.has(key)) {
          competitions.set(key, {
            key,
            name: cleanTitle(match.competition, ''),
            country: match.country || null,
          });
        }
      }
    }
    for (const [key, wanted] of this.pendingTeams) if (!teams.has(key)) teams.set(key, wanted);
    for (const [key, wanted] of this.pendingCompetitions) {
      if (!competitions.has(key)) competitions.set(key, wanted);
    }
    this.pendingTeams.clear();
    this.pendingCompetitions.clear();
    return { teams, competitions };
  }

  private async round(budget: number): Promise<void> {
    const { clock, football } = this.deps;
    const signal = this.controller.signal;
    const schedule = await football.schedule().catch(() => null);
    if (signal.aborted) return;
    const { teams, competitions } = this.collectWanted(schedule);
    const nowIso = clock.date().toISOString();
    this.store.update((draft) => {
      for (const wanted of teams.values()) {
        const entry = draft.teams[wanted.key];
        if (entry) {
          entry.lastSeenAt = nowIso;
          entry.name = wanted.name;
          /* Si el override de `skip` desapareció (fichero del volumen), vuelve a la cola. */
          if (entry.status === 'skipped' && !this.overrides.teams[wanted.key]?.skip) {
            entry.status = 'pending';
          }
        } else {
          draft.teams[wanted.key] = {
            key: wanted.key,
            name: wanted.name,
            query: '',
            idTeam: null,
            apiName: null,
            short: null,
            crest: null,
            colors: null,
            status: 'pending',
            attempts: 0,
            resolvedAt: null,
            nextRetryAt: null,
            lastSeenAt: nowIso,
          };
        }
      }
      for (const wanted of competitions.values()) {
        const entry = draft.competitions[wanted.key];
        if (entry) {
          entry.lastSeenAt = nowIso;
          entry.name = wanted.name;
          if (entry.status === 'skipped' && !this.overrides.competitions[wanted.key]?.skip) {
            entry.status = 'pending';
          }
        } else {
          draft.competitions[wanted.key] = {
            key: wanted.key,
            name: wanted.name,
            query: '',
            idLeague: null,
            apiName: null,
            logo: null,
            status: 'pending',
            attempts: 0,
            resolvedAt: null,
            nextRetryAt: null,
            lastSeenAt: nowIso,
          };
        }
      }
    });
    /* Tras un 429 esta vuelta no pide nada (solo apunta lo visto). */
    if (clock.now() < this.pausedUntil) return;

    const failures: string[] = [];
    let rateLimited = false;
    let used = 0;
    /* Cola única: una resolución cada vez, con pausa entre dos. */
    const pace = async (): Promise<boolean> => {
      if (used >= budget || signal.aborted) return false;
      if (used > 0) {
        try {
          await clock.sleep(TEAMS_REQUEST_GAP_MS, signal);
        } catch {
          return false;
        }
      }
      used += 1;
      return true;
    };
    const now = clock.now();
    /* Un `skip` no gasta turno ni pausa: se anota y se sigue. */
    const markSkipped = (entry: { status: EntryStatus; nextRetryAt: string | null }): void => {
      entry.status = 'skipped';
      entry.nextRetryAt = null;
    };
    for (const wanted of teams.values()) {
      const entry = this.store.index().teams[wanted.key];
      if (!entry || !isDue(entry, now)) continue;
      if (this.overrides.teams[wanted.key]?.skip) {
        this.patchTeam(wanted.key, markSkipped);
        continue;
      }
      if (!(await pace())) break;
      const outcome = await this.resolveTeam(wanted, signal);
      if (outcome.kind === 'aborted') return;
      if (outcome.kind === 'rate_limited') {
        rateLimited = true;
        break;
      }
      if (outcome.kind === 'failed') failures.push(outcome.code);
    }
    if (!rateLimited) {
      for (const wanted of competitions.values()) {
        const entry = this.store.index().competitions[wanted.key];
        if (!entry || !isDue(entry, now)) continue;
        if (this.overrides.competitions[wanted.key]?.skip) {
          this.patchCompetition(wanted.key, markSkipped);
          continue;
        }
        if (!(await pace())) break;
        const outcome = await this.resolveCompetition(wanted, signal);
        if (outcome.kind === 'aborted') return;
        if (outcome.kind === 'rate_limited') {
          rateLimited = true;
          break;
        }
        if (outcome.kind === 'failed') failures.push(outcome.code);
      }
    }
    if (signal.aborted) return;
    await this.prune();
    this.lastRefreshAt = clock.now();
    this.reportRound(failures, rateLimited);
  }

  private resolver(signal: AbortSignal): ResolverDeps {
    return { net: this.deps.net, apiKey: this.deps.config.football.apiKey, signal };
  }

  private at(ms: number): string {
    return new Date(this.deps.clock.now() + ms).toISOString();
  }

  private patchTeam(key: string, mutate: (entry: TeamEntry) => void): void {
    this.store.update((draft) => {
      const entry = draft.teams[key];
      if (entry) mutate(entry);
    });
  }

  private patchCompetition(key: string, mutate: (entry: CompetitionEntry) => void): void {
    this.store.update((draft) => {
      const entry = draft.competitions[key];
      if (entry) mutate(entry);
    });
  }

  private async resolveTeam(wanted: WantedTeam, signal: AbortSignal): Promise<Outcome> {
    const { clock, logger } = this.deps;
    const override = this.overrides.teams[wanted.key];
    const query = teamQuery(wanted.name, wanted.key, override);
    const resolver = this.resolver(signal);
    try {
      const candidates = override?.idTeam
        ? await lookupTeam(resolver, override.idTeam)
        : await searchTeams(resolver, query);
      const first = candidates[0];
      const choice =
        override?.idTeam !== undefined
          ? first
            ? ({ kind: 'chosen', team: first, score: 1 } as const)
            : ({ kind: 'none' } as const)
          : chooseTeam(candidates, {
              name: wanted.name,
              query,
              country: wanted.country,
              competition: wanted.competition,
              override,
            });
      if (choice.kind !== 'chosen') {
        if (choice.kind === 'ambiguous') {
          logger.info(
            { team: wanted.name, best: choice.best.strTeam, second: choice.second.strTeam },
            'escudos: dos candidatos igual de buenos; sin escudo hasta que un override lo fije',
          );
        }
        this.patchTeam(wanted.key, (entry) => {
          entry.query = query;
          entry.attempts = 0;
          /* Lo que ya tenía (revalidación) se conserva. */
          if (!entry.crest && !entry.colors) {
            entry.status = choice.kind === 'none' ? 'not_found' : 'ambiguous';
          }
          entry.nextRetryAt = this.at(
            choice.kind === 'none' ? TEAMS_NOT_FOUND_RETRY_MS : TEAMS_AMBIGUOUS_RETRY_MS,
          );
        });
        return { kind: 'ok' };
      }
      const team = choice.team;
      let bytes: Buffer | null = null;
      let image: PngImage | null = null;
      let badImage: string | null = null;
      if (team.strBadge) {
        try {
          bytes = await fetchBadge(resolver, team.strBadge);
          image = decodePng(bytes, { maxDimension: TEAMS_IMAGE_MAX_DIMENSION });
        } catch (error) {
          if (error instanceof BadgeImageError || error instanceof PngError) {
            badImage = error.reason;
            bytes = null;
            image = null;
          } else {
            throw error;
          }
        }
      }
      const colors = chooseColors({
        override: override?.colors ?? null,
        api: parseApiColors(team.strColour1, team.strColour2),
        image,
      });
      let crest: BadgeFile | null = null;
      if (bytes) {
        try {
          crest = await this.store.writeBadge('team', team.idTeam, bytes);
        } catch {
          crest = null; // el disco falló (ya avisado por el almacén): esta vez sin escudo nuevo
        }
      }
      const previous = this.store.index().teams[wanted.key];
      if (previous?.crest && crest && previous.crest.file !== crest.file) {
        await this.store.removeBadge('team', previous.crest.file);
      }
      this.patchTeam(wanted.key, (entry) => {
        entry.query = query;
        entry.idTeam = team.idTeam;
        entry.apiName = team.strTeam;
        entry.short = badgeShort(team.strTeamShort);
        if (crest) entry.crest = crest;
        else if (!team.strBadge) entry.crest = null;
        entry.colors = colors;
        entry.status = badImage && !entry.crest ? 'bad_image' : 'resolved';
        entry.resolvedAt = clock.date().toISOString();
        entry.attempts = 0;
        entry.nextRetryAt = this.at(badImage ? TEAMS_NOT_FOUND_RETRY_MS : TEAMS_REVALIDATE_MS);
      });
      if (badImage) {
        logger.info(
          { team: wanted.name, reason: badImage },
          'escudos: la imagen de TheSportsDB no vale; sin escudo',
        );
      }
      return { kind: 'ok' };
    } catch (error) {
      if (signal.aborted) return { kind: 'aborted' };
      const code = motivoDeFallo(error);
      if (code === 'http_429') {
        this.patchTeam(wanted.key, (entry) => {
          entry.query = query;
          entry.nextRetryAt = this.at(TEAMS_RATE_LIMIT_PAUSE_MS);
        });
        return { kind: 'rate_limited' };
      }
      this.patchTeam(wanted.key, (entry) => {
        entry.query = query;
        entry.attempts += 1;
        if (!entry.crest) entry.status = 'failed';
        entry.nextRetryAt = this.at(backoff(entry.attempts));
      });
      logger.debug({ team: wanted.name, errorCode: code }, 'escudos: consulta fallida');
      return { kind: 'failed', code };
    }
  }

  private async resolveCompetition(
    wanted: WantedCompetition,
    signal: AbortSignal,
  ): Promise<Outcome> {
    const { clock, logger } = this.deps;
    const override = this.overrides.competitions[wanted.key];
    const query = override?.query ?? wanted.name;
    const country = override?.country ?? (wanted.country ? englishCountry(wanted.country) : null);
    const resolver = this.resolver(signal);
    try {
      let found: ApiLeague | null = null;
      if (override?.idLeague) found = (await lookupLeague(resolver, override.idLeague))[0] ?? null;
      else if (country) {
        found = chooseLeague(await searchLeagues(resolver, country), { name: wanted.name, query });
      }
      if (!found) {
        this.patchCompetition(wanted.key, (entry) => {
          entry.query = query;
          entry.attempts = 0;
          if (!entry.logo) entry.status = 'not_found';
          entry.nextRetryAt = this.at(TEAMS_NOT_FOUND_RETRY_MS);
        });
        return { kind: 'ok' };
      }
      const league = found;
      const url = league.strBadge ?? league.strLogo;
      let bytes: Buffer | null = null;
      let badImage: string | null = null;
      if (url) {
        try {
          bytes = await fetchBadge(resolver, url);
        } catch (error) {
          if (!(error instanceof BadgeImageError)) throw error;
          badImage = error.reason;
        }
      }
      let logo: BadgeFile | null = null;
      if (bytes) {
        try {
          logo = await this.store.writeBadge('competition', league.idLeague, bytes);
        } catch {
          logo = null;
        }
      }
      const previous = this.store.index().competitions[wanted.key];
      if (previous?.logo && logo && previous.logo.file !== logo.file) {
        await this.store.removeBadge('competition', previous.logo.file);
      }
      this.patchCompetition(wanted.key, (entry) => {
        entry.query = query;
        entry.idLeague = league.idLeague;
        entry.apiName = league.strLeague;
        if (logo) entry.logo = logo;
        else if (!url) entry.logo = null;
        entry.status = badImage && !entry.logo ? 'bad_image' : 'resolved';
        entry.resolvedAt = clock.date().toISOString();
        entry.attempts = 0;
        entry.nextRetryAt = this.at(badImage ? TEAMS_NOT_FOUND_RETRY_MS : TEAMS_REVALIDATE_MS);
      });
      return { kind: 'ok' };
    } catch (error) {
      if (signal.aborted) return { kind: 'aborted' };
      const code = motivoDeFallo(error);
      if (code === 'http_429') {
        this.patchCompetition(wanted.key, (entry) => {
          entry.nextRetryAt = this.at(TEAMS_RATE_LIMIT_PAUSE_MS);
        });
        return { kind: 'rate_limited' };
      }
      this.patchCompetition(wanted.key, (entry) => {
        entry.query = query;
        entry.attempts += 1;
        if (!entry.logo) entry.status = 'failed';
        entry.nextRetryAt = this.at(backoff(entry.attempts));
      });
      logger.debug({ competition: wanted.name, errorCode: code }, 'escudos: consulta fallida');
      return { kind: 'failed', code };
    }
  }

  /* Topes: 600 entradas, 400 escudos y 60 competiciones; sobran los de `lastSeenAt` más viejo. */
  private async prune(): Promise<void> {
    const index = this.store.index();
    const byOldest = <T extends { readonly lastSeenAt: string }>(entries: T[]): T[] =>
      [...entries].sort((a, b) => Date.parse(a.lastSeenAt) - Date.parse(b.lastSeenAt));
    const teams = byOldest(Object.values(index.teams));
    const dropTeams = new Set(
      teams.slice(0, Math.max(0, teams.length - this.limits.maxEntries)).map((e) => e.key),
    );
    const withCrest = teams.filter((e) => e.crest && !dropTeams.has(e.key));
    const dropCrests = new Set(
      withCrest.slice(0, Math.max(0, withCrest.length - this.limits.maxCrests)).map((e) => e.key),
    );
    const competitions = byOldest(Object.values(index.competitions));
    const dropCompetitions = new Set(
      competitions
        .slice(0, Math.max(0, competitions.length - this.limits.maxCompetitions))
        .map((e) => e.key),
    );
    if (!dropTeams.size && !dropCrests.size && !dropCompetitions.size) return;
    const removals: { readonly kind: BadgeKind; readonly file: string }[] = [];
    this.store.update((draft) => {
      for (const key of dropTeams) {
        const entry = draft.teams[key];
        if (entry?.crest) removals.push({ kind: 'team', file: entry.crest.file });
        delete draft.teams[key];
      }
      for (const key of dropCrests) {
        const entry = draft.teams[key];
        if (!entry?.crest) continue;
        removals.push({ kind: 'team', file: entry.crest.file });
        entry.crest = null;
        entry.status = 'pending';
        entry.nextRetryAt = null;
      }
      for (const key of dropCompetitions) {
        const entry = draft.competitions[key];
        if (entry?.logo) removals.push({ kind: 'competition', file: entry.logo.file });
        delete draft.competitions[key];
      }
    });
    await Promise.all(
      removals.map((removal) => this.store.removeBadge(removal.kind, removal.file)),
    );
  }

  /* Un aviso de diagnóstico por vuelta fallida, no por equipo. */
  private reportRound(failures: readonly string[], rateLimited: boolean): void {
    const { bus, clock, logger } = this.deps;
    if (rateLimited) {
      this.pausedUntil = clock.now() + TEAMS_RATE_LIMIT_PAUSE_MS;
      this.lastRoundFailure = 'TheSportsDB limita las peticiones (429); pausa de una hora';
      logger.warn({ errorCode: 'http_429' }, 'escudos: TheSportsDB ha limitado las peticiones');
      bus.emit('diagnostics.report', {
        cause: 'network',
        code: 'crest_rate_limited',
        message: 'Escudos: TheSportsDB ha limitado las peticiones (429); se reintenta en una hora.',
      });
      return;
    }
    if (failures.length) {
      const code = failures[0] as string;
      this.lastRoundFailure = `TheSportsDB no respondió (${code}) en ${failures.length} consultas`;
      logger.warn(
        { errorCode: code, failures: failures.length },
        'escudos: consultas fallidas en esta vuelta',
      );
      bus.emit('diagnostics.report', {
        cause: 'network',
        code: 'crest_lookup_failed',
        message: `Escudos: ${failures.length} consultas a TheSportsDB han fallado (${code}).`,
      });
      return;
    }
    this.lastRoundFailure = null;
  }

  // --- Salud ---

  healthInfo(): TeamsHealth {
    if (!this.enabled) {
      return {
        status: 'disabled',
        teams: 0,
        crests: 0,
        pending: 0,
        lastRefreshAt: null,
        detail: null,
      };
    }
    const now = this.deps.clock.now();
    const teams = Object.values(this.store.index().teams);
    const writeFailed = this.store.writeFailed();
    const degraded = writeFailed || now < this.pausedUntil || this.lastRoundFailure !== null;
    return {
      status: degraded ? 'degraded' : this.lastRefreshAt === null ? 'warming' : 'ready',
      teams: teams.length,
      crests: teams.filter((entry) => entry.crest).length,
      pending: teams.filter((entry) => isDue(entry, now)).length,
      lastRefreshAt:
        this.lastRefreshAt === null ? null : new Date(this.lastRefreshAt).toISOString(),
      detail: writeFailed ? 'no se puede escribir en data/v2/teams' : this.lastRoundFailure,
    };
  }
}
