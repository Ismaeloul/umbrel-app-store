/* Lo que dice el propio fichero (docs/vod.md §4.11): las lenguas del audio de
   una película o un episodio, leídas del índice MKV/MP4 (el mismo lector que
   la reproducción, por el relé VOD con Range: la cabecera y las pistas).

   Por qué: muchos títulos no dicen su idioma ni en la categoría ni en el
   título («Sin indicar»), y la versión «sin indicar» de Mr. Robot sonó en
   inglés sin que la ficha avisara. Ahora la ficha lo comprueba antes.

   - NUNCA quita la conexión a Isma: quien lee (`read`, en `IptvServiceImpl`)
     devuelve null si hay una sesión IPTV (directo o VOD) abierta, otra sonda,
     un cierre de hace nada o la cuenta en su tope; entonces se deja para
     otra vez. Una reproducción que empieza aborta la lectura en curso.
   - De una en una, con plazo corto (`VOD_AUDIO_READ_MS`) y sin reintentos:
     lo que falla no se vuelve a intentar hasta `VOD_AUDIO_RETRY_MS`.
   - La ficha que se cierra cancela: la web vuelve a pedir la ficha mientras
     está «Comprobando el audio…»; lo que nadie ha pedido en
     `VOD_AUDIO_ABANDON_MS` se quita de la cola (y la lectura en curso se
     corta).
   - Caché persistente por título (`vod-audio.json` junto a `vod.enc`), con
     tope (`VOD_AUDIO_MAX`, la más vieja fuera) y del proveedor vigente: otro
     proveedor la vacía. También la rellena la reproducción (el productor ya
     lee el índice). */

import { readFileSync, rmSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { VOD_LANG_BIT, type VodDetectedAudio } from '@ace/shared';
import type { Clock, TimerHandle } from '../../../core/clock.js';
import { errorCodeOf } from '../../../core/errors.js';
import type { Logger } from '../../../core/logger.js';
import { vodLanguageLabel, vodTrackLangKey } from '../../remux/vod/audio.js';
import { writeAtomic } from '../../state/storage.js';

/** Las pistas que importan de un índice (las de `VodIndex`, sin depender del remux). */
export interface VodTracksSeen {
  readonly audio: ReadonlyArray<{ readonly lang: string | null; readonly name: string | null }>;
  readonly subtitles: ReadonlyArray<{
    readonly lang: string | null;
    readonly name: string | null;
    readonly text: boolean;
  }>;
}

/** El fichero que se lee: una película o un episodio. */
export interface VodFileTarget {
  readonly kind: 'movie' | 'episode';
  readonly source: number;
  readonly ext: string;
}

/**
 * Lee las pistas del fichero. null = ahora no se puede (la IPTV está en uso o
 * la cuenta llena): se deja para luego sin contarlo como fallo.
 */
export type VodTracksReader = (
  target: VodFileTarget,
  signal: AbortSignal,
) => Promise<VodTracksSeen | null>;

/** Una entrada de la caché: claves de lengua del audio y de los subtítulos de texto. */
export interface VodAudioEntry {
  readonly audio: readonly string[];
  readonly subtitles: readonly string[];
  readonly at: number;
}

/** Plazo de la lectura entera (cabecera + pistas). */
export const VOD_AUDIO_READ_MS = 10_000;
/** Lo que falló no se vuelve a intentar antes de esto. */
export const VOD_AUDIO_RETRY_MS = 10 * 60_000;
/** Lo que la ficha deja de pedir en este tiempo se quita de la cola (la ficha se ha cerrado). */
export const VOD_AUDIO_ABANDON_MS = 8_000;
/** Cada cuánto se mira si la lectura en curso sigue haciendo falta. */
const WATCH_MS = 2_000;
/** Títulos guardados como mucho (unos 40 bytes cada uno). */
export const VOD_AUDIO_MAX = 5_000;
/** Lo que se espera antes de escribir el fichero (junta varias lecturas). */
const SAVE_DELAY_MS = 2_000;
const MAX_LANGS = 8;

/** El fichero de la caché, junto al catálogo VOD. */
export function vodAudioFileOf(vodCatalogFile: string): string {
  return path.join(path.dirname(vodCatalogFile), 'vod-audio.json');
}

function uniqueKeys(
  tracks: ReadonlyArray<{ readonly lang: string | null; readonly name: string | null }>,
): string[] {
  const out: string[] = [];
  for (const track of tracks) {
    const key = vodTrackLangKey(track);
    if (key && !out.includes(key)) out.push(key);
    if (out.length >= MAX_LANGS) break;
  }
  return out;
}

/** Las claves de lengua de unas pistas (sin repetir, en su orden; los subtítulos, solo los de texto). */
export function entryOfTracks(tracks: VodTracksSeen, at: number): VodAudioEntry {
  return {
    audio: uniqueKeys(tracks.audio),
    subtitles: uniqueKeys(tracks.subtitles.filter((track) => track.text)),
    at,
  };
}

/** Subtítulos: «Español» (la variante importa menos que en el audio). */
function subtitleLabel(key: string): string {
  return key === 'spa' ? 'Español' : vodLanguageLabel(key);
}

/** Lo que va en la ficha: etiquetas en castellano. */
export function detectedOf(entry: VodAudioEntry): VodDetectedAudio {
  return {
    audio: entry.audio.map(vodLanguageLabel),
    subtitles: [...new Set(entry.subtitles.map(subtitleLabel))],
  };
}

const KEY_LANG: Readonly<Record<string, keyof typeof VOD_LANG_BIT>> = {
  spa: 'castellano',
  'es-419': 'latino',
  eng: 'ingles',
  fra: 'frances',
  ita: 'italiano',
  deu: 'aleman',
  por: 'portugues',
  cat: 'catalan',
};

/**
 * Los idiomas (§4.10) que dice el fichero, para el filtro de los títulos que
 * eran «sin indicar»: los del audio; y VOSE si ninguno es español y hay
 * subtítulos en español. 0 si el fichero no dice nada.
 */
export function langBitsOf(entry: VodAudioEntry): number {
  let bits = 0;
  for (const key of entry.audio) bits |= VOD_LANG_BIT[KEY_LANG[key] ?? 'otros'];
  const spanishAudio = entry.audio.includes('spa') || entry.audio.includes('es-419');
  const spanishSubs = entry.subtitles.includes('spa') || entry.subtitles.includes('es-419');
  if (bits && !spanishAudio && spanishSubs) bits |= VOD_LANG_BIT.vose;
  return bits;
}

interface Job {
  readonly key: string;
  readonly target: VodFileTarget;
  /** Otras claves que se guardan con lo leído (el episodio de una serie). */
  readonly aliases: readonly string[];
  wantedAt: number;
  controller: AbortController | null;
}

interface StoredFile {
  readonly version: 1;
  readonly provider: string;
  /** `[clave, audio, subtítulos, cuándo]`, de la más vieja a la más nueva. */
  readonly items: Array<[string, string[], string[], number]>;
}

export interface VodAudioCheckOptions {
  readonly file: string;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly read: VodTracksReader;
  /** ¿Se puede leer ahora? (barato, sin red): si no, ni se pone en cola. */
  readonly free: () => boolean;
  /** Se ha sabido el audio de un título (para el filtro de idiomas). */
  readonly onDetected?: (key: string, entry: VodAudioEntry) => void;
  readonly max?: number;
}

/** Qué pasa con el audio de un título que la ficha quiere saber. */
export type VodAudioWant = 'known' | 'pending' | 'later';

export class VodAudioCheck {
  private entries = new Map<string, VodAudioEntry>();
  private provider: string | null = null;
  private loaded = false;
  private readonly jobs = new Map<string, Job>();
  private running: Job | null = null;
  private readonly failedAt = new Map<string, number>();
  private saveTimer: TimerHandle | null = null;
  private saving: Promise<void> = Promise.resolve();
  private watchTimer: TimerHandle | null = null;
  private stopped = false;
  private idleWaiters: Array<() => void> = [];

  constructor(private readonly options: VodAudioCheckOptions) {}

  private get max(): number {
    return this.options.max ?? VOD_AUDIO_MAX;
  }

  /** Carga el fichero la primera vez (y lo descarta si es de otro proveedor). */
  private ensure(provider: string): void {
    if (!this.loaded) {
      this.loaded = true;
      try {
        const raw = JSON.parse(readFileSync(this.options.file, 'utf8')) as Partial<StoredFile>;
        if (raw.version === 1 && typeof raw.provider === 'string' && Array.isArray(raw.items)) {
          this.provider = raw.provider;
          for (const item of raw.items.slice(-this.max)) {
            if (!Array.isArray(item) || typeof item[0] !== 'string') continue;
            const strings = (value: unknown): string[] =>
              Array.isArray(value)
                ? value.filter((v): v is string => typeof v === 'string').slice(0, MAX_LANGS)
                : [];
            this.entries.set(item[0], {
              audio: strings(item[1]),
              subtitles: strings(item[2]),
              at: typeof item[3] === 'number' ? item[3] : 0,
            });
          }
        }
      } catch {
        /* Sin fichero o ilegible: se empieza de cero (es solo una caché). */
      }
    }
    if (this.provider !== provider) {
      if (this.provider !== null) this.reset();
      this.provider = provider;
    }
  }

  /** Lo guardado de un título, o null. */
  entry(provider: string, key: string): VodAudioEntry | null {
    this.ensure(provider);
    return this.entries.get(key) ?? null;
  }

  /** Todas las entradas (para volver a poner el filtro tras cargar un catálogo). */
  all(provider: string): ReadonlyMap<string, VodAudioEntry> {
    this.ensure(provider);
    return this.entries;
  }

  /** ¿Se está leyendo (o en cola) este título? */
  pending(key: string): boolean {
    return this.jobs.has(key);
  }

  /**
   * La ficha quiere saber el audio de `key`: `known` si ya se sabe (o falló
   * hace poco: no se vuelve a intentar), `pending` si se está leyendo o va en
   * la cola, `later` si ahora no se puede (IPTV en uso).
   */
  want(
    provider: string,
    key: string,
    target: VodFileTarget,
    aliases: readonly string[] = [],
  ): VodAudioWant {
    this.ensure(provider);
    if (this.stopped) return 'later';
    if (this.entries.has(key)) return 'known';
    const now = this.options.clock.now();
    const job = this.jobs.get(key);
    if (job) {
      job.wantedAt = now;
      return 'pending';
    }
    const failed = this.failedAt.get(key);
    if (failed !== undefined && now - failed < VOD_AUDIO_RETRY_MS) return 'known';
    if (!this.options.free()) return 'later';
    this.jobs.set(key, { key, target, aliases, wantedAt: now, controller: null });
    this.pump();
    return 'pending';
  }

  /** Lo que ha leído la reproducción (el productor ya tiene el índice). */
  note(provider: string, key: string, tracks: VodTracksSeen): void {
    this.ensure(provider);
    this.store(key, entryOfTracks(tracks, this.options.clock.now()));
  }

  private store(key: string, entry: VodAudioEntry): void {
    const before = this.entries.get(key);
    this.entries.delete(key);
    this.entries.set(key, entry);
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    this.failedAt.delete(key);
    const same =
      before &&
      before.audio.join() === entry.audio.join() &&
      before.subtitles.join() === entry.subtitles.join();
    if (!same) this.options.onDetected?.(key, entry);
    this.scheduleSave();
  }

  private pump(): void {
    if (this.running || this.stopped) {
      this.settleIdle();
      return;
    }
    const now = this.options.clock.now();
    let next: Job | null = null;
    for (const job of this.jobs.values()) {
      if (now - job.wantedAt > VOD_AUDIO_ABANDON_MS) {
        this.jobs.delete(job.key);
        continue;
      }
      next = job;
      break;
    }
    if (!next) {
      this.settleIdle();
      return;
    }
    void this.run(next);
  }

  private async run(job: Job): Promise<void> {
    const { clock, logger } = this.options;
    this.running = job;
    const controller = new AbortController();
    job.controller = controller;
    const deadline = clock.setTimeout(
      () => controller.abort(new Error('plazo de la lectura del audio')),
      VOD_AUDIO_READ_MS,
    );
    this.watch();
    const startedAt = clock.now();
    try {
      if (!this.options.free()) return;
      const tracks = await this.options.read(job.target, controller.signal);
      if (controller.signal.aborted) throw controller.signal.reason ?? new Error('cancelada');
      if (!tracks) return; // ocupada: para luego, sin contarlo como fallo
      const entry = entryOfTracks(tracks, clock.now());
      for (const alias of job.aliases) this.store(alias, entry);
      this.store(job.key, entry);
      logger.info(
        {
          kind: job.target.kind,
          audio: entry.audio,
          subtitles: entry.subtitles,
          ms: clock.now() - startedAt,
        },
        'VOD: audio del fichero comprobado',
      );
    } catch (error) {
      const abandoned = clock.now() - job.wantedAt > VOD_AUDIO_ABANDON_MS || this.stopped;
      if (!abandoned) this.failedAt.set(job.key, clock.now());
      logger.info(
        {
          kind: job.target.kind,
          errorCode: errorCodeOf(error) ?? (abandoned ? 'cancelada' : 'desconocido'),
          ms: clock.now() - startedAt,
        },
        abandoned
          ? 'VOD: comprobación del audio cancelada'
          : 'VOD: no se ha podido comprobar el audio',
      );
      if (this.failedAt.size > 1_000) {
        const oldest = this.failedAt.keys().next().value as string;
        this.failedAt.delete(oldest);
      }
    } finally {
      clock.clearTimeout(deadline);
      if (this.jobs.get(job.key) === job) this.jobs.delete(job.key);
      this.running = null;
      this.pump();
    }
  }

  /** Mientras se lee: si la ficha ya no la pide, se corta. */
  private watch(): void {
    if (this.watchTimer) return;
    this.watchTimer = this.options.clock.setTimeout(() => {
      this.watchTimer = null;
      const job = this.running;
      if (!job) return;
      if (this.options.clock.now() - job.wantedAt > VOD_AUDIO_ABANDON_MS) {
        job.controller?.abort(new Error('la ficha se ha cerrado'));
        return;
      }
      this.watch();
    }, WATCH_MS);
  }

  /** Una sesión de verdad va a abrirse: se corta lo que se esté leyendo. */
  cancel(): void {
    for (const job of this.jobs.values()) {
      if (job !== this.running) this.jobs.delete(job.key);
    }
    this.running?.controller?.abort(new Error('la IPTV hace falta'));
  }

  private scheduleSave(): void {
    if (this.saveTimer || this.stopped) return;
    this.saveTimer = this.options.clock.setTimeout(() => {
      this.saveTimer = null;
      void this.save();
    }, SAVE_DELAY_MS);
  }

  private save(): Promise<void> {
    const provider = this.provider;
    if (provider === null) return this.saving;
    const body: StoredFile = {
      version: 1,
      provider,
      items: [...this.entries].map(([key, entry]) => [
        key,
        [...entry.audio],
        [...entry.subtitles],
        entry.at,
      ]),
    };
    const text = JSON.stringify(body);
    this.saving = this.saving
      .then(async () => {
        await mkdir(path.dirname(this.options.file), { recursive: true });
        await writeAtomic(this.options.file, text, { backup: null });
      })
      .catch((error: unknown) =>
        this.options.logger.warn({ err: error }, 'VOD: no se pudo guardar vod-audio.json'),
      );
    return this.saving;
  }

  /** Escribe lo pendiente ya (al parar). */
  async flush(): Promise<void> {
    if (this.saveTimer) {
      this.options.clock.clearTimeout(this.saveTimer);
      this.saveTimer = null;
      await this.save();
    }
    await this.saving;
  }

  /** IPTV eliminada u otro proveedor: se olvida todo (y el fichero). */
  reset(): void {
    this.cancel();
    this.jobs.clear();
    this.entries = new Map();
    this.failedAt.clear();
    this.provider = null;
    if (this.saveTimer) {
      this.options.clock.clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    try {
      rmSync(this.options.file, { force: true });
    } catch {
      /* Se reescribe en la próxima lectura. */
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.cancel();
    if (this.watchTimer) {
      this.options.clock.clearTimeout(this.watchTimer);
      this.watchTimer = null;
    }
    await this.flush();
  }

  private settleIdle(): void {
    if (this.running || this.jobs.size) return;
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Espera a que no quede nada en cola (tests). */
  idle(): Promise<void> {
    if (!this.running && !this.jobs.size) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }
}
