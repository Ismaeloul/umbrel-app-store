/* Progreso de Películas y series (docs/vod.md §10, D-VOD17 y D-VOD18).

   Dos partes:
   - Reglas PURAS (las mismas que comprobará la app de iOS con los vectores
     de §10.3): «visto», reanudar, «Seguir viendo», siguiente episodio y el
     botón principal de una serie; y la aplicación de un evento de
     `vodProgress` sobre la lista, con su validación (§10.2).
   - `VodDocStore`: `v2/vod.json` por `createDocumentStore` (0600, escritura
     atómica, `.bak` y cuarentena), que se crea en la PRIMERA escritura (no
     cambia el pin de documentos de una carga limpia). `tick` se queda en
     memoria y se vuelca como mucho una vez por minuto; lo demás, al momento;
     y todo al apagar.

   Por casa, no por aparato: lo empezado en la web sigue en el iPhone. Nunca
   en `state.json` (T4). Solo ids sellados y títulos: nada del proveedor. */

import { existsSync, mkdirSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import path from 'node:path';
import {
  VOD_PROGRESS,
  VodDocSchema,
  type VodCatalogSummary,
  type VodDoc,
  type VodPref,
  type VodProgressBody,
  type VodProgressEntry,
} from '@ace/shared';
import { AppError } from '../../../core/errors.js';
import type { Clock, TimerHandle } from '../../../core/clock.js';
import type { Logger } from '../../../core/logger.js';
import { createDocumentStore, type ManagedDocumentStore } from '../../state/documents.js';

export type VodProgressKind = 'movie' | 'episode';

// --- Reglas (§10.3), puras ---

/** ¿Visto? Película: quedan ≤ max(180 s, 5 %); episodio: ≤ max(60 s, 4 %). */
export function isWatched(kind: VodProgressKind, posS: number, durS: number): boolean {
  if (!(durS > 0)) return false;
  const rule = kind === 'movie' ? VOD_PROGRESS.watchedMovie : VOD_PROGRESS.watchedEpisode;
  return durS - posS <= Math.max(rule.tailS, durS * rule.ratio);
}

/** Dónde reanudar: `posS − 5 s` si se vio ≥ 30 s y no está visto; si no, desde el principio. */
export function resumeAt(entry: Pick<VodProgressEntry, 'posS' | 'watched'> | null): number {
  if (!entry || entry.watched || entry.posS < VOD_PROGRESS.resumeMinS) return 0;
  return Math.max(0, entry.posS - VOD_PROGRESS.resumeBackS);
}

/** Un episodio en orden de reproducción (temporada 0, «Especiales», al final). */
export interface EpisodeRef {
  readonly id: string;
  readonly season: number;
  readonly number: number;
  readonly title: string;
}

/** «T2 · E5 · El regreso» (≤ 120). */
export function episodeSubtitle(episode: Pick<EpisodeRef, 'season' | 'number' | 'title'>): string {
  return `T${episode.season} · E${episode.number} · ${episode.title}`.slice(0, 120);
}

/** «T2:E5». */
export function episodeCode(episode: Pick<EpisodeRef, 'season' | 'number'>): string {
  return `T${episode.season}:E${episode.number}`;
}

/**
 * Siguiente episodio (§10.3): el siguiente de la temporada; si no hay, el
 * primero de la siguiente temporada. La temporada 0 («Especiales») solo si
 * ya se está en ella. `episodes` va en orden de reproducción.
 */
export function nextEpisode(episodes: readonly EpisodeRef[], currentId: string): EpisodeRef | null {
  const index = episodes.findIndex((episode) => episode.id === currentId);
  if (index < 0) return null;
  const current = episodes[index] as EpisodeRef;
  for (let next = index + 1; next < episodes.length; next += 1) {
    const candidate = episodes[next] as EpisodeRef;
    if (candidate.season === 0 && current.season !== 0) return null;
    return candidate;
  }
  return null;
}

/** Botón principal de una serie (`VodSeries.main`, §10.3). */
export interface SeriesMain {
  readonly episodeId: string;
  readonly action: 'start' | 'resume' | 'next' | 'rewatch';
  readonly label: string;
  readonly posS: number;
}

/**
 * - sin progreso: `start` «Ver T1:E1»;
 * - el más reciente empezado: `resume` «Reanudar T2:E3»;
 * - el último visto con siguiente: `next` «Siguiente: T2:E4»;
 * - todo visto: `rewatch` «Volver a ver T1:E1».
 */
export function seriesMain(
  episodes: readonly EpisodeRef[],
  progress: ReadonlyMap<string, Pick<VodProgressEntry, 'posS' | 'watched' | 'updatedAt'>>,
): SeriesMain | null {
  const regular = episodes.filter((episode) => episode.season !== 0);
  const first = regular[0] ?? episodes[0];
  if (!first) return null;
  let latest: {
    episode: EpisodeRef;
    entry: Pick<VodProgressEntry, 'posS' | 'watched' | 'updatedAt'>;
  } | null = null;
  for (const episode of episodes) {
    const entry = progress.get(episode.id);
    if (entry && (!latest || entry.updatedAt > latest.entry.updatedAt)) latest = { episode, entry };
  }
  if (!latest) {
    return { episodeId: first.id, action: 'start', label: `Ver ${episodeCode(first)}`, posS: 0 };
  }
  if (!latest.entry.watched) {
    return {
      episodeId: latest.episode.id,
      action: 'resume',
      label: `Reanudar ${episodeCode(latest.episode)}`,
      posS: resumeAt(latest.entry),
    };
  }
  const next = nextEpisode(episodes, latest.episode.id);
  if (next && !progress.get(next.id)?.watched) {
    return {
      episodeId: next.id,
      action: 'next',
      label: `Siguiente: ${episodeCode(next)}`,
      posS: 0,
    };
  }
  const unseen = regular.find((episode) => !progress.get(episode.id)?.watched);
  if (unseen) {
    return {
      episodeId: unseen.id,
      action: 'next',
      label: `Siguiente: ${episodeCode(unseen)}`,
      posS: 0,
    };
  }
  return {
    episodeId: first.id,
    action: 'rewatch',
    label: `Volver a ver ${episodeCode(first)}`,
    posS: 0,
  };
}

/** Una entrada de «Seguir viendo» antes de pintarla. */
export interface ContinueItem {
  readonly entry: VodProgressEntry;
  /** Siguiente episodio propuesto (empieza en 0): `entry.next` del último visto. */
  readonly isNext: boolean;
}

/**
 * «Seguir viendo» (§10.3): películas y episodios empezados, sin ver y sin
 * ocultar, de más nuevo a más viejo; una sola entrada por serie (la más
 * reciente) y, si su último episodio está visto y tiene `next`, ese
 * siguiente con `isNext`. 20 como mucho.
 */
export function continueWatching(
  entries: readonly VodProgressEntry[],
  max: number = VOD_PROGRESS.continueMax,
): ContinueItem[] {
  const sorted = [...entries].sort((a, b) => b.updatedAt - a.updatedAt);
  const seenSeries = new Set<string>();
  const out: ContinueItem[] = [];
  for (const entry of sorted) {
    if (out.length >= max) break;
    if (entry.kind === 'episode' && entry.seriesId) {
      if (seenSeries.has(entry.seriesId)) continue;
      seenSeries.add(entry.seriesId);
      if (entry.hidden) continue;
      if (entry.watched) {
        if (entry.next) out.push({ entry, isNext: true });
        continue;
      }
      if (entry.posS >= VOD_PROGRESS.resumeMinS) out.push({ entry, isNext: false });
      continue;
    }
    if (entry.hidden || entry.watched || entry.posS < VOD_PROGRESS.resumeMinS) continue;
    out.push({ entry, isNext: false });
  }
  return out;
}

// --- Eventos (§10.2) ---

/** A qué se refiere un evento: la película o el episodio, con sus textos ya resueltos. */
export interface ProgressTarget {
  readonly id: string;
  readonly kind: VodProgressKind;
  readonly seriesId: string | null;
  readonly title: string;
  readonly subtitle: string | null;
  readonly season: number | null;
  readonly episode: number | null;
}

export interface ProgressContext {
  readonly now: number;
  /** Duración que conoce el servidor (la sesión de ese id), o null: entonces hasta 12 h. */
  readonly knownDurationS: number | null;
  /** Siguiente episodio (solo con `ended` de un episodio). */
  readonly next?: { readonly id: string; readonly label: string } | null;
  /** Con `mark-through`: este y todos los anteriores de la serie (≤ 500). */
  readonly through?: readonly ProgressTarget[];
}

const PLAYBACK_EVENTS = new Set(['tick', 'pause', 'seek', 'ended', 'stop']);

/** Valida posición y duración de un evento de reproducción (§10.2). Lanza `validation_error`. */
export function validatePosition(
  body: Pick<VodProgressBody, 'posS' | 'durS'>,
  knownDurationS: number | null,
): void {
  const { posS, durS } = body;
  if (!(durS > 0)) throw new AppError('validation_error', { detail: 'durS' });
  if (posS > durS + VOD_PROGRESS.positionSlackS)
    throw new AppError('validation_error', { detail: 'posS' });
  if (knownDurationS !== null && knownDurationS > 0) {
    const tolerance = knownDurationS * VOD_PROGRESS.durationTolerance;
    if (Math.abs(durS - knownDurationS) > tolerance) {
      throw new AppError('validation_error', { detail: 'durS' });
    }
  } else if (durS > VOD_PROGRESS.durationMaxS) {
    throw new AppError('validation_error', { detail: 'durS' });
  }
}

function blankEntry(target: ProgressTarget, now: number): VodProgressEntry {
  return {
    id: target.id,
    kind: target.kind,
    seriesId: target.seriesId,
    title: target.title.slice(0, 200) || 'Sin título',
    subtitle: target.subtitle ? target.subtitle.slice(0, 120) : null,
    season: target.season,
    episode: target.episode,
    posS: 0,
    durS: 0,
    watched: false,
    hidden: false,
    next: null,
    updatedAt: now,
  };
}

const clampS = (value: number): number => Math.max(0, Math.min(86_400, value));

/**
 * Aplica un evento a la lista (pura): devuelve la lista nueva, ya con la
 * expulsión LRU a 2 000. `tick`, `pause`, `seek`, `stop` y `ended` validan
 * posición y duración; las marcas ignoran `posS`/`durS`.
 */
export function applyProgressEvent(
  entries: readonly VodProgressEntry[],
  target: ProgressTarget,
  body: Pick<VodProgressBody, 'posS' | 'durS' | 'event'>,
  context: ProgressContext,
): VodProgressEntry[] {
  const { now } = context;
  const byId = new Map(entries.map((entry) => [entry.id, entry] as const));
  const upsert = (goal: ProgressTarget, change: (entry: VodProgressEntry) => VodProgressEntry) => {
    const current = byId.get(goal.id);
    const base = current
      ? {
          ...current,
          title: goal.title.slice(0, 200) || current.title,
          subtitle: goal.subtitle?.slice(0, 120) ?? current.subtitle,
          season: goal.season ?? current.season,
          episode: goal.episode ?? current.episode,
          seriesId: goal.seriesId ?? current.seriesId,
        }
      : blankEntry(goal, now);
    byId.set(goal.id, { ...change(base), updatedAt: now });
  };
  if (PLAYBACK_EVENTS.has(body.event)) validatePosition(body, context.knownDurationS);
  const posS = clampS(body.posS);
  const durS = clampS(body.durS);
  switch (body.event) {
    case 'tick':
    case 'pause':
    case 'seek':
    case 'stop':
      upsert(target, (entry) => ({
        ...entry,
        posS: Math.min(posS, durS),
        durS,
        watched: isWatched(target.kind, posS, durS),
        hidden: false,
      }));
      break;
    case 'ended':
      upsert(target, (entry) => ({
        ...entry,
        posS: durS,
        durS,
        watched: true,
        hidden: false,
        next: target.kind === 'episode' ? (context.next ?? null) : null,
      }));
      break;
    case 'mark':
      upsert(target, (entry) => ({ ...entry, watched: true, hidden: false }));
      break;
    case 'unmark':
      upsert(target, (entry) => ({ ...entry, watched: false, posS: 0, next: null }));
      break;
    case 'mark-through': {
      const list = (context.through ?? [target]).slice(0, VOD_PROGRESS.markThroughMax);
      /* El más reciente, el del evento: así el botón principal sigue desde ahí. */
      for (const [index, goal] of list.entries()) {
        const at = now - (list.length - 1 - index);
        const current = byId.get(goal.id);
        const base = current ?? blankEntry(goal, at);
        byId.set(goal.id, { ...base, watched: true, hidden: false, updatedAt: at });
      }
      break;
    }
    case 'hide': {
      const current = byId.get(target.id);
      if (current) byId.set(target.id, { ...current, hidden: true });
      break;
    }
    case 'forget':
      byId.delete(target.id);
      break;
  }
  return [...byId.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, VOD_PROGRESS.itemsMax);
}

/** Oculta o borra todas las entradas de una serie (hide/forget sobre el id de la serie). */
export function applySeriesEvent(
  entries: readonly VodProgressEntry[],
  seriesId: string,
  event: 'hide' | 'forget',
): VodProgressEntry[] {
  if (event === 'forget') return entries.filter((entry) => entry.seriesId !== seriesId);
  return entries.map((entry) => (entry.seriesId === seriesId ? { ...entry, hidden: true } : entry));
}

/** Guarda la preferencia de audio o subtítulos de una serie o película (§10.4; LRU de 500). */
export function applyPref(
  prefs: readonly VodPref[],
  id: string,
  change: {
    readonly audio?: string | null | undefined;
    readonly subtitle?: string | null | undefined;
  },
  now: number,
): VodPref[] {
  if (change.audio === undefined && change.subtitle === undefined) return [...prefs];
  const current = prefs.find((pref) => pref.id === id);
  const next: VodPref = {
    id,
    audio: change.audio === undefined ? (current?.audio ?? null) : change.audio,
    subtitle: change.subtitle === undefined ? (current?.subtitle ?? null) : change.subtitle,
    updatedAt: now,
  };
  return [next, ...prefs.filter((pref) => pref.id !== id)].slice(0, VOD_PROGRESS.prefsMax);
}

// --- v2/vod.json ---

export function emptyVodDoc(providerFp: string | null = null): VodDoc {
  return { v: 1, providerFp, catalog: null, progress: [], prefs: [] };
}

export interface VodDocStoreOptions {
  readonly file: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

/**
 * `v2/vod.json`. Lo que se lee es la copia en memoria (con los `tick` sin
 * volcar); `write` guarda al momento y `tick` marca pendiente y vuelca como
 * mucho una vez por minuto. El fichero no existe hasta la primera escritura.
 */
export class VodDocStore {
  private store: ManagedDocumentStore<VodDoc> | null = null;
  private memory: VodDoc;
  private dirty = false;
  private timer: TimerHandle | null = null;
  private lastFlushAt = Number.NEGATIVE_INFINITY;

  constructor(private readonly options: VodDocStoreOptions) {
    this.memory = existsSync(options.file) ? structuredClone(this.open().read()) : emptyVodDoc();
  }

  private open(): ManagedDocumentStore<VodDoc> {
    if (!this.store) mkdirSync(path.dirname(this.options.file), { recursive: true });
    this.store ??= createDocumentStore<VodDoc>({
      name: 'vod',
      file: this.options.file,
      schema: VodDocSchema,
      defaults: () => emptyVodDoc(),
      clock: this.options.clock,
      logger: this.options.logger,
      fileMode: 0o600,
    });
    return this.store;
  }

  read(): VodDoc {
    return this.memory;
  }

  /** ¿Existe ya el fichero? */
  exists(): boolean {
    return this.store !== null || existsSync(this.options.file);
  }

  /** Cambia la copia en memoria y la guarda al momento. */
  async write(mutate: (doc: VodDoc) => VodDoc): Promise<void> {
    this.memory = mutate(this.memory);
    await this.persist();
  }

  /** Cambia la copia en memoria y la vuelca como mucho una vez por minuto (`tick`). */
  soft(mutate: (doc: VodDoc) => VodDoc): void {
    this.memory = mutate(this.memory);
    this.dirty = true;
    const { clock } = this.options;
    const wait = this.lastFlushAt + VOD_PROGRESS.flushMs - clock.now();
    if (wait <= 0) {
      void this.persist().catch(() => undefined);
      return;
    }
    if (this.timer) return;
    this.timer = clock.setTimeout(
      () => {
        this.timer = null;
        if (this.dirty) void this.persist().catch(() => undefined);
      },
      wait,
      { unref: true },
    );
  }

  /** Guarda la copia en memoria (también lo pendiente de los `tick`). */
  async persist(): Promise<void> {
    this.dirty = false;
    this.lastFlushAt = this.options.clock.now();
    if (this.timer) {
      this.options.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    const snapshot = structuredClone(this.memory);
    try {
      await this.open().update((draft) => {
        draft.providerFp = snapshot.providerFp;
        draft.catalog = snapshot.catalog;
        draft.progress = snapshot.progress;
        draft.prefs = snapshot.prefs;
      });
    } catch (error) {
      this.options.logger.warn({ err: error }, 'v2/vod.json no se pudo guardar');
      throw error;
    }
  }

  /** Vuelca lo pendiente (al apagar). */
  async flush(): Promise<void> {
    if (this.dirty) await this.persist().catch(() => undefined);
    await this.store?.flush();
  }

  /**
   * Otro proveedor (§10.5): el documento se vacía con la huella nueva. Con
   * `null` (IPTV eliminada) se borra el fichero con su `.bak` y sus restos.
   */
  async reset(providerFp: string | null): Promise<void> {
    const had = this.exists();
    this.memory = emptyVodDoc(providerFp);
    this.dirty = false;
    if (this.timer) {
      this.options.clock.clearTimeout(this.timer);
      this.timer = null;
    }
    if (!had) return;
    if (providerFp !== null) {
      await this.persist().catch(() => undefined);
      await this.store?.purge().catch(() => undefined);
      return;
    }
    const store = this.open();
    await store.flush().catch(() => undefined);
    await store.purge().catch(() => undefined);
    this.store = null;
    for (const file of [this.options.file, `${this.options.file}.tmp`]) {
      await rm(file, { force: true }).catch(() => undefined);
    }
  }

  /** Apunta la huella del proveedor en un documento sin dueño (sin vaciar nada). */
  adopt(providerFp: string): void {
    if (this.memory.providerFp === providerFp) return;
    this.memory = { ...this.memory, providerFp };
    if (this.exists()) void this.persist().catch(() => undefined);
  }

  /** Cambia solo el resumen del catálogo (§4.6). */
  async setCatalog(summary: VodCatalogSummary | null): Promise<void> {
    await this.write((doc) => ({ ...doc, catalog: summary }));
  }
}
