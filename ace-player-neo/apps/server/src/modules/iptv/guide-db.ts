/* Guía TV completa en disco (docs/iptv.md §20.2): un fichero SQLite
   (`v2/iptv/guia.db`) con `node:sqlite`, que viene con Node 24 (sin
   dependencias ni compilar nada).

   Tablas:
   - `meta (k, v)`: esquema, proveedor, fecha de la descarga, ventana,
     duración máxima, recuentos y de dónde salió (`xmltv` o `short`).
   - `ch (g, tvg, icon, n, first, last)`: un canal de la guía por `tvg-id`
     (en minúsculas) que está en el catálogo, de CUALQUIER país; `g` es el
     número que usa la API (cambia con cada descarga, como `version`).
   - `p (g, s, e, t, f, d)` WITHOUT ROWID con clave (g, s): la parrilla,
     densa y contigua por canal en disco (pocas páginas por petición, que
     importa en el disco del N100). `s` y `e` en minutos desde 1970 (UTC),
     `t` el título, `f` las marcas (`GUIDE_FLAGS`) y `d` la ficha.
   - `det`: lo gordo (subtítulo, sinopsis, categorías, episodio, año, edad,
     nota, reparto, imagen), aparte y sin repetir (por un hash de 64 bits):
     solo se lee con «Más info».

   Memoria: nada de la guía vive en el montón de JS. Al construir, la caché
   de páginas está topada (16 MiB) y lo que no cabe va al fichero; al leer,
   8 MiB. El mapa `tvg → g` (unos pocos miles) sí se queda en memoria.

   Construcción (`GuideWriter`): en `guia.db.next`, en una sola transacción
   (diario en memoria, sin `fsync`), y al final arreglo de horarios canal a
   canal (§20.4) cediendo el hilo cada 12 ms: la IPTV que alguien está
   viendo no espera. Luego `GuideStore.install` cierra la de ahora, cambia el
   fichero de golpe (`rename`) y abre la nueva de solo lectura. Como todo es
   síncrono, ninguna consulta ve un fichero a medias.

   Varias guías (una M3U con dos `url-tvg`): cada una es una «fuente»
   (`beginSource` … `endSource`, un SAVEPOINT). Un canal se queda con los
   programas de la primera fuente que trae alguno (no se mezclan dos
   parrillas de un canal), y una fuente que se corta a medias se deshace
   entera (`rollbackSource`): lo de las anteriores vale.

   Sin cifrar (D-propuesta G1): no lleva credenciales (las URL de imagen que
   las llevarían se descartan antes, guide-full.ts) y SQLite no cifra. 0600
   en la carpeta 0700, como lo demás de la IPTV. Un fichero ilegible o de
   otro proveedor se borra y se vuelve a descargar. */

import { createHash } from 'node:crypto';
import { chmodSync, existsSync, renameSync, rmSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { GUIDE_FLAGS, IPTV_GUIDE_NORMALIZE, IPTV_GUIDE_STORE } from '@ace/shared';
import type { Logger } from '../../core/logger.js';
import { FILE_MODE, ensureIptvDir } from './crypto.js';

const SCHEMA_VERSION = '1';
const MINUTE = 60_000;
const PAGE_SIZE = 4096;

export type GuideSource = 'xmltv' | 'short';

export interface GuideMeta {
  readonly providerId: string;
  /** Epoch ms de la descarga. */
  readonly builtAt: number;
  /** Sello de la API (`builtAt` en base 36). */
  readonly version: string;
  /** Ventana guardada (epoch ms). */
  readonly from: number;
  readonly to: number;
  /** El bloque más largo, en minutos (acota las consultas por tiempo). */
  readonly maxDurationMin: number;
  readonly programmes: number;
  readonly channels: number;
  readonly source: GuideSource;
  /** Se llegó al tope de programas o de tamaño y se dejó de guardar. */
  readonly truncated: boolean;
}

/** Hasta dónde llega de verdad la programación guardada (epoch ms, dentro de la ventana). */
export interface GuideCoverage {
  /** Inicio del primer programa. */
  readonly from: number;
  /** Fin del último programa. */
  readonly to: number;
}

export interface GuideChannelInfo {
  readonly g: number;
  readonly tvg: string;
  readonly hasIcon: boolean;
  readonly count: number;
  /** Primer inicio y último fin (epoch ms). */
  readonly first: number;
  readonly last: number;
}

/** Un programa de la parrilla (minutos UTC). */
export interface GuideGridRow {
  readonly s: number;
  readonly e: number;
  readonly t: string;
  readonly f: number;
}

export interface GuideDetailRow extends GuideGridRow {
  readonly g: number;
  readonly subTitle: string | null;
  readonly description: string | null;
  readonly categories: readonly string[];
  readonly season: number | null;
  readonly episode: number | null;
  readonly episodeText: string | null;
  readonly year: number | null;
  readonly rating: string | null;
  readonly stars: string | null;
  readonly directors: readonly string[];
  readonly actors: readonly string[];
}

/** Ficha de un programa ya limpia (la prepara guide-full.ts). */
export interface GuideDetailInput {
  readonly subTitle: string;
  readonly description: string;
  readonly categories: readonly string[];
  readonly season: number | null;
  readonly episode: number | null;
  readonly episodeText: string | null;
  readonly year: number | null;
  readonly rating: string | null;
  readonly stars: string | null;
  readonly directors: readonly string[];
  readonly actors: readonly string[];
  /** URL de la imagen, ya comprobada (sin credenciales). */
  readonly icon: string | null;
}

export interface GuideProgrammeInput {
  /** `tvg-id` en minúsculas y sin espacios alrededor. */
  readonly tvg: string;
  /** Epoch ms (con la zona y el `tvg-shift` ya aplicados). */
  readonly start: number;
  /** null: la guía no dice cuándo acaba (`noStop`). */
  readonly stop: number | null;
  readonly title: string;
  /** Marcas de la guía (`live`, `new`, `repeat`, `filler`); las demás las pone el guardado. */
  readonly flags: number;
  /** `clumpidx` > 0: comparte franja con el anterior y se junta su título («Noticias / El tiempo»). */
  readonly clumpFollower: boolean;
  readonly detail: GuideDetailInput | null;
}

const SCHEMA_SQL = `
CREATE TABLE meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE ch (
  g INTEGER PRIMARY KEY,
  tvg TEXT NOT NULL UNIQUE,
  icon TEXT,
  n INTEGER NOT NULL DEFAULT 0,
  first INTEGER,
  last INTEGER
);
CREATE TABLE p (
  g INTEGER NOT NULL,
  s INTEGER NOT NULL,
  e INTEGER NOT NULL,
  t TEXT NOT NULL,
  f INTEGER NOT NULL,
  d INTEGER,
  PRIMARY KEY (g, s)
) WITHOUT ROWID;
CREATE TABLE det (
  id INTEGER PRIMARY KEY,
  h INTEGER NOT NULL UNIQUE,
  sub TEXT,
  descr TEXT,
  cats TEXT,
  season INTEGER,
  episode INTEGER,
  eptext TEXT,
  year INTEGER,
  rating TEXT,
  stars TEXT,
  directors TEXT,
  actors TEXT,
  icon TEXT
);
`;

/** ¿Es el SQLITE_FULL de SQLite (disco o tope de páginas lleno)? */
function isFull(error: unknown): boolean {
  return (error as { errcode?: number } | null)?.errcode === 13;
}

function lines(value: unknown): string[] {
  return typeof value === 'string' && value ? value.split('\n') : [];
}

function textOrNull(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Hash de 64 bits (con signo, como lo guarda SQLite) de la ficha, para no repetirla. */
function detailHash(detail: GuideDetailInput): bigint {
  const digest = createHash('sha1')
    .update(
      JSON.stringify([
        detail.subTitle,
        detail.description,
        detail.categories,
        detail.season,
        detail.episode,
        detail.episodeText,
        detail.year,
        detail.rating,
        detail.stars,
        detail.directors,
        detail.actors,
        detail.icon,
      ]),
    )
    .digest();
  return digest.readBigInt64BE(0);
}

export interface GuideWriterOptions {
  readonly providerId: string;
  readonly builtAt: number;
  readonly source: GuideSource;
  readonly logger: Logger;
  readonly maxProgrammes?: number;
  readonly maxBytes?: number;
  /** Cede el hilo tras tantos ms de trabajo seguido (por defecto, `IPTV_GUIDE_STORE.sliceMs`). */
  readonly sliceMs?: number;
}

/**
 * Construye una guía en un fichero nuevo. `add` y `channel` son síncronos y
 * baratos (una inserción); `finish` arregla los horarios a trozos y cierra.
 * `abort` lo deshace todo (borra el fichero).
 */
export class GuideWriter {
  private readonly db: DatabaseSync;
  private readonly insertChannel: StatementSync;
  private readonly setChannelIcon: StatementSync;
  private readonly insertProgramme: StatementSync;
  private readonly replaceShorter: StatementSync;
  private readonly joinClump: StatementSync;
  private readonly findDetail: StatementSync;
  private readonly insertDetail: StatementSync;
  private readonly pageCount: StatementSync;
  private byTvg = new Map<string, number>();
  /** `tvg-id` con algún programa guardado. */
  private withProgrammes = new Set<string>();
  /** Canales que ya trajo una fuente anterior: los de la fuente en curso no entran (una fuente por canal). */
  private locked: ReadonlySet<string> = new Set();
  /** Cómo estaba todo al empezar la fuente en curso (para deshacerla). */
  private source: {
    readonly byTvg: Map<string, number>;
    readonly withProgrammes: Set<string>;
    readonly stored: number;
    readonly truncated: boolean;
  } | null = null;
  private readonly fromMin: number;
  private readonly toMin: number;
  private readonly maxProgrammes: number;
  private readonly maxPages: number;
  private stored = 0;
  private closed = false;
  /** Se dejó de guardar por un tope (programas o tamaño). */
  private truncated = false;
  private sinceCheck = 0;

  constructor(
    readonly file: string,
    private readonly options: GuideWriterOptions,
  ) {
    rmSync(file, { force: true });
    this.db = new DatabaseSync(file);
    this.maxProgrammes = options.maxProgrammes ?? IPTV_GUIDE_STORE.maxProgrammes;
    this.maxPages = Math.max(
      64,
      Math.floor((options.maxBytes ?? IPTV_GUIDE_STORE.maxBytes) / PAGE_SIZE),
    );
    try {
      this.db.exec(
        [
          `PRAGMA page_size = ${PAGE_SIZE}`,
          'PRAGMA journal_mode = MEMORY',
          'PRAGMA synchronous = OFF',
          'PRAGMA temp_store = MEMORY',
          `PRAGMA cache_size = -${Math.round(IPTV_GUIDE_STORE.buildCacheBytes / 1024)}`,
          /* Tope duro un 10 % por encima del que se vigila (el que se vigila corta antes). */
          `PRAGMA max_page_count = ${Math.ceil(this.maxPages * 1.1) + 64}`,
        ].join(';\n'),
      );
      this.db.exec(SCHEMA_SQL);
      this.db.exec('BEGIN');
      this.insertChannel = this.db.prepare('INSERT INTO ch (tvg) VALUES (?)');
      this.setChannelIcon = this.db.prepare('UPDATE ch SET icon = ? WHERE g = ? AND icon IS NULL');
      this.insertProgramme = this.db.prepare(
        'INSERT OR IGNORE INTO p (g, s, e, t, f, d) VALUES (?, ?, ?, ?, ?, ?)',
      );
      /* Dos programas en el mismo minuto de un canal (la clave es el minuto): se queda el más
         largo, para que un corte de 30 s a las 12:00:00 no tape la película de las 12:00:30.
         Sin fin cuenta como 30 min; dos sin fin, el último (el primero duró menos de 1 min). */
      const noStop = GUIDE_FLAGS.noStop;
      const noStopMin = Math.round(IPTV_GUIDE_NORMALIZE.noStopDefaultMs / MINUTE);
      this.replaceShorter = this.db.prepare(
        `UPDATE p SET e = ?, t = ?, f = ?, d = ?
         WHERE g = ? AND s = ? AND (
           (CASE WHEN (f & ${noStop}) != 0 THEN ${noStopMin} ELSE e - s END) < ?
           OR ((f & ${noStop}) != 0 AND ? = 1)
         )`,
      );
      this.joinClump = this.db.prepare(
        `UPDATE p SET t = substr(t || ' / ' || ?, 1, ${IPTV_GUIDE_STORE.titleChars + 1})
         WHERE g = ? AND s = ? AND e = ? AND instr(t, ?) = 0`,
      );
      this.findDetail = this.db.prepare('SELECT id FROM det WHERE h = ?');
      this.pageCount = this.db.prepare('PRAGMA page_count');
      this.insertDetail = this.db.prepare(
        `INSERT INTO det (h, sub, descr, cats, season, episode, eptext, year, rating, stars, directors, actors, icon)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
    } catch (error) {
      this.closeQuietly();
      rmSync(file, { force: true });
      throw error;
    }
    this.fromMin = Math.floor((options.builtAt - IPTV_GUIDE_STORE.pastMs) / MINUTE);
    this.toMin = Math.ceil((options.builtAt + IPTV_GUIDE_STORE.futureMs) / MINUTE);
  }

  /** Programas aceptados hasta ahora. */
  get programmes(): number {
    return this.stored;
  }

  get channels(): number {
    return this.byTvg.size;
  }

  private channelOf(tvg: string): number {
    const known = this.byTvg.get(tvg);
    if (known !== undefined) return known;
    const result = this.insertChannel.run(tvg);
    const g = Number(result.lastInsertRowid);
    this.byTvg.set(tvg, g);
    return g;
  }

  /** El logo de un canal (de `<channel><icon>`), si aún no tenía. */
  channel(tvg: string, icon: string | null): void {
    if (this.closed || this.truncated || !icon) return;
    try {
      this.setChannelIcon.run(icon, this.channelOf(tvg));
    } catch (error) {
      this.onWriteError(error);
    }
  }

  /** Guarda un programa si cae en la ventana (síncrono). */
  add(input: GuideProgrammeInput): void {
    if (this.closed || this.truncated) return;
    if (!Number.isFinite(input.start)) return;
    /* Ese canal ya lo trajo una guía anterior: no se mezclan dos parrillas. */
    if (this.locked.has(input.tvg)) return;
    const s = Math.floor(input.start / MINUTE);
    let e: number;
    let flags = input.flags & ~(GUIDE_FLAGS.detail | GUIDE_FLAGS.noStop | GUIDE_FLAGS.image);
    if (input.stop === null) {
      /* Sin fin: se calcula al arreglar los horarios (§20.4). */
      if (s >= this.toMin || s < this.fromMin - IPTV_GUIDE_NORMALIZE.noStopMaxGapMs / MINUTE)
        return;
      e = s;
      flags |= GUIDE_FLAGS.noStop;
    } else {
      if (!Number.isFinite(input.stop) || input.stop <= input.start) return;
      e = Math.max(s + 1, Math.floor(input.stop / MINUTE));
      if (e <= this.fromMin || s >= this.toMin) return;
    }
    try {
      const g = this.channelOf(input.tvg);
      let detailId: number | null = null;
      if (input.detail) {
        detailId = this.detailId(input.detail);
        flags |= GUIDE_FLAGS.detail;
        if (input.detail.icon) flags |= GUIDE_FLAGS.image;
      }
      const result = this.insertProgramme.run(g, s, e, input.title, flags, detailId);
      if (result.changes === 0) {
        /* Mismo canal y mismo minuto: la continuación de una franja compartida junta el título;
           si no, se queda el más largo. */
        if (input.clumpFollower) {
          if (input.title) this.joinClump.run(input.title, g, s, e, input.title);
        } else {
          const noStop = (flags & GUIDE_FLAGS.noStop) !== 0;
          const length = noStop ? Math.round(IPTV_GUIDE_NORMALIZE.noStopDefaultMs / MINUTE) : e - s;
          this.replaceShorter.run(e, input.title, flags, detailId, g, s, length, noStop ? 1 : 0);
        }
        return;
      }
      this.stored += 1;
      this.withProgrammes.add(input.tvg);
      this.sinceCheck += 1;
      if (this.stored >= this.maxProgrammes) this.stop('programas');
      else if (this.sinceCheck >= 256) {
        this.sinceCheck = 0;
        const pages = Number((this.pageCount.get() as { page_count: number }).page_count);
        if (pages >= this.maxPages) this.stop('tamaño');
      }
    } catch (error) {
      this.onWriteError(error);
    }
  }

  private detailId(detail: GuideDetailInput): number {
    const hash = detailHash(detail);
    const known = this.findDetail.get(hash) as { id: number } | undefined;
    if (known) return Number(known.id);
    const result = this.insertDetail.run(
      hash,
      detail.subTitle || null,
      detail.description || null,
      detail.categories.length ? detail.categories.join('\n') : null,
      detail.season,
      detail.episode,
      detail.episodeText,
      detail.year,
      detail.rating,
      detail.stars,
      detail.directors.length ? detail.directors.join('\n') : null,
      detail.actors.length ? detail.actors.join('\n') : null,
      detail.icon,
    );
    return Number(result.lastInsertRowid);
  }

  /**
   * Empieza otra fuente (otra URL de guía). Los canales que ya tienen
   * programas de una fuente anterior se quedan como están (una fuente por
   * canal). Lanza si SQLite no deja (quien llama deshace la guía).
   */
  beginSource(): void {
    if (this.closed) return;
    this.endSource();
    this.locked = new Set(this.withProgrammes);
    this.db.exec('SAVEPOINT fuente');
    this.source = {
      byTvg: new Map(this.byTvg),
      withProgrammes: new Set(this.withProgrammes),
      stored: this.stored,
      truncated: this.truncated,
    };
  }

  /** La fuente en curso se leyó entera: lo suyo se queda. */
  endSource(): void {
    if (this.closed || !this.source) return;
    this.source = null;
    this.db.exec('RELEASE fuente');
  }

  /**
   * La fuente en curso se cortó a medias: se deshace entera (lo de las
   * anteriores vale). false si no se pudo (el escritor queda deshecho: quien
   * llama lo trata como un fallo del disco).
   */
  rollbackSource(): boolean {
    if (this.closed) return false;
    const snapshot = this.source;
    if (!snapshot) return true;
    this.source = null;
    try {
      this.db.exec('ROLLBACK TO fuente');
      this.db.exec('RELEASE fuente');
    } catch {
      this.abort();
      return false;
    }
    this.byTvg = snapshot.byTvg;
    this.withProgrammes = snapshot.withProgrammes;
    this.stored = snapshot.stored;
    this.truncated = snapshot.truncated;
    return true;
  }

  private stop(reason: string): void {
    if (this.truncated) return;
    this.truncated = true;
    this.options.logger.warn(
      { programmes: this.stored, channels: this.byTvg.size, reason },
      'Guía TV: tope alcanzado, el resto de la guía no se guarda',
    );
  }

  private onWriteError(error: unknown): void {
    /* El tope de páginas (o el disco) lleno: se deja de guardar, lo que hay vale. */
    if (isFull(error)) {
      this.stop('disco');
      return;
    }
    throw error;
  }

  /**
   * Arregla los horarios canal a canal (§20.4), escribe `meta` y cierra.
   * Cede el hilo cada `sliceMs`. Con `signal` abortada, lanza y deshace.
   */
  async finish(signal?: AbortSignal): Promise<GuideMeta> {
    if (this.closed) throw new Error('GuideWriter cerrado');
    const sliceMs = this.options.sliceMs ?? IPTV_GUIDE_STORE.sliceMs;
    try {
      this.endSource();
      const rowsOf = this.db.prepare('SELECT s, e, f, t FROM p WHERE g = ? ORDER BY s');
      const update = this.db.prepare('UPDATE p SET e = ?, f = ? WHERE g = ? AND s = ?');
      const remove = this.db.prepare('DELETE FROM p WHERE g = ? AND s = ?');
      const setChannel = this.db.prepare('UPDATE ch SET n = ?, first = ?, last = ? WHERE g = ?');
      const dropChannel = this.db.prepare('DELETE FROM ch WHERE g = ?');
      const noStopGap = IPTV_GUIDE_NORMALIZE.noStopMaxGapMs / MINUTE;
      const noStopDefault = IPTV_GUIDE_NORMALIZE.noStopDefaultMs / MINUTE;
      const gapMerge = IPTV_GUIDE_NORMALIZE.gapMergeMs / MINUTE;
      const fillerMin = IPTV_GUIDE_NORMALIZE.fillerMs / MINUTE;
      const maxDuration = IPTV_GUIDE_NORMALIZE.maxDurationMs / MINUTE;
      let maxDurationMin = 1;
      let programmes = 0;
      let channels = 0;
      let sliceStart = performance.now();
      for (const [, g] of this.byTvg) {
        if (signal?.aborted) throw signal.reason ?? new Error('aborted');
        const all = rowsOf.all(g) as unknown as GuideGridRow[];
        /* El mismo programa listado dos veces con un minuto de diferencia: se queda el segundo. */
        const rows: GuideGridRow[] = [];
        for (let index = 0; index < all.length; index += 1) {
          const row = all[index] as GuideGridRow;
          const next = all[index + 1];
          if (next && next.t === row.t && next.s - row.s < gapMerge) remove.run(g, row.s);
          else rows.push(row);
        }
        let kept = 0;
        let first = 0;
        let last = 0;
        for (let index = 0; index < rows.length; index += 1) {
          const row = rows[index] as GuideGridRow;
          const next = rows[index + 1];
          let e = row.e;
          let f = row.f;
          if (f & GUIDE_FLAGS.noStop) {
            e = next && next.s - row.s <= noStopGap ? next.s : row.s + noStopDefault;
          }
          if (next) {
            /* Se solapa con el siguiente: se recorta. Un hueco de menos de 2 min: se pega. */
            if (e > next.s) e = next.s;
            else if (next.s - e > 0 && next.s - e < gapMerge) e = next.s;
          }
          if (e - row.s > maxDuration) e = row.s + maxDuration;
          if (e - row.s > fillerMin) f |= GUIDE_FLAGS.filler;
          if (e <= row.s || e <= this.fromMin || row.s >= this.toMin) {
            remove.run(g, row.s);
            continue;
          }
          if (e !== row.e || f !== row.f) update.run(e, f, g, row.s);
          if (!kept) first = row.s;
          last = e;
          kept += 1;
          if (e - row.s > maxDurationMin) maxDurationMin = e - row.s;
        }
        if (kept) {
          setChannel.run(kept, first * MINUTE, last * MINUTE, g);
          programmes += kept;
          channels += 1;
        } else dropChannel.run(g);
        if (performance.now() - sliceStart >= sliceMs) {
          await nextTurn();
          sliceStart = performance.now();
        }
      }
      if (signal?.aborted) throw signal.reason ?? new Error('aborted');
      const meta: GuideMeta = {
        providerId: this.options.providerId,
        builtAt: this.options.builtAt,
        version: this.options.builtAt.toString(36),
        from: this.fromMin * MINUTE,
        to: this.toMin * MINUTE,
        maxDurationMin,
        programmes,
        channels,
        source: this.options.source,
        truncated: this.truncated,
      };
      const setMeta = this.db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)');
      setMeta.run('schema', SCHEMA_VERSION);
      setMeta.run('meta', JSON.stringify(meta));
      this.db.exec('COMMIT');
      this.closeQuietly();
      try {
        chmodSync(this.file, FILE_MODE);
      } catch {
        /* Windows: chmod no aplica. */
      }
      return meta;
    } catch (error) {
      this.abort();
      throw error;
    }
  }

  /** Lo deshace todo: cierra y borra el fichero a medias. Idempotente. */
  abort(): void {
    this.closeQuietly();
    rmSync(this.file, { force: true });
  }

  private closeQuietly(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch {
      /* Ya cerrada o a medias: da igual, se borra. */
    }
  }
}

/** Lectura de una guía guardada (solo lectura; todas las consultas son síncronas y cortas). */
export class GuideReader {
  private readonly db: DatabaseSync;
  readonly meta: GuideMeta;
  private readonly sliceStmt: StatementSync;
  private readonly programmeStmt: StatementSync;
  private readonly aroundStmt: StatementSync;
  private readonly iconStmt: StatementSync;
  private channelMap: Map<string, GuideChannelInfo> | null = null;
  private byG: Map<number, GuideChannelInfo> | null = null;
  private allCoverage: GuideCoverage | null | undefined = undefined;
  private closed = false;

  private constructor(db: DatabaseSync, meta: GuideMeta) {
    this.db = db;
    this.meta = meta;
    this.sliceStmt = db.prepare(
      'SELECT s, e, t, f FROM p WHERE g = ? AND s >= ? AND s < ? AND e > ? ORDER BY s LIMIT ?',
    );
    this.programmeStmt = db.prepare(
      `SELECT p.s AS s, p.e AS e, p.t AS t, p.f AS f, det.sub AS sub, det.descr AS descr,
              det.cats AS cats, det.season AS season, det.episode AS episode, det.eptext AS eptext,
              det.year AS year, det.rating AS rating, det.stars AS stars,
              det.directors AS directors, det.actors AS actors
       FROM p LEFT JOIN det ON det.id = p.d WHERE p.g = ? AND p.s = ?`,
    );
    this.aroundStmt = db.prepare(
      'SELECT s, e, t, f FROM p WHERE g = ? AND s >= ? AND e > ? ORDER BY s LIMIT 2',
    );
    this.iconStmt = db.prepare(
      'SELECT det.icon AS icon FROM p JOIN det ON det.id = p.d WHERE p.g = ? AND p.s = ?',
    );
  }

  /** Abre una guía guardada si es de ese proveedor y de este esquema; si no, null. */
  static open(file: string, providerId: string): GuideReader | null {
    if (!existsSync(file)) return null;
    let db: DatabaseSync | null = null;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      db.exec(`PRAGMA cache_size = -${Math.round(IPTV_GUIDE_STORE.readCacheBytes / 1024)}`);
      const rows = db.prepare('SELECT k, v FROM meta').all() as unknown as {
        k: string;
        v: string;
      }[];
      const values = new Map(rows.map((row) => [row.k, row.v]));
      if (values.get('schema') !== SCHEMA_VERSION) throw new Error('esquema');
      const meta = JSON.parse(values.get('meta') ?? 'null') as GuideMeta | null;
      if (!meta || meta.providerId !== providerId || typeof meta.builtAt !== 'number') {
        throw new Error('proveedor');
      }
      return new GuideReader(db, meta);
    } catch {
      try {
        db?.close();
      } catch {
        /* nada */
      }
      return null;
    }
  }

  get version(): string {
    return this.meta.version;
  }

  /** Canales con programas, por `tvg-id`. Se lee una vez (unos pocos miles de filas). */
  channels(): ReadonlyMap<string, GuideChannelInfo> {
    if (this.channelMap) return this.channelMap;
    const map = new Map<string, GuideChannelInfo>();
    const byG = new Map<number, GuideChannelInfo>();
    const rows = this.db
      .prepare('SELECT g, tvg, icon, n, first, last FROM ch WHERE n > 0')
      .all() as unknown as {
      g: number;
      tvg: string;
      icon: string | null;
      n: number;
      first: number;
      last: number;
    }[];
    for (const row of rows) {
      const info: GuideChannelInfo = {
        g: Number(row.g),
        tvg: row.tvg,
        hasIcon: Boolean(row.icon),
        count: Number(row.n),
        first: Number(row.first),
        last: Number(row.last),
      };
      map.set(info.tvg, info);
      byG.set(info.g, info);
    }
    this.channelMap = map;
    this.byG = byG;
    return map;
  }

  channel(g: number): GuideChannelInfo | null {
    if (!this.byG) this.channels();
    return this.byG?.get(g) ?? null;
  }

  /**
   * Hasta dónde llega de verdad la programación de esos canales (de todos sin
   * `gs`), recortado a la ventana guardada; null si ninguno tiene. Una guía
   * que solo cubre hoy (la del panel de Isma, Paso 0 del 3-oct) acaba hoy
   * aunque la ventana llegue a +80 h.
   */
  coverage(gs?: Iterable<number>): GuideCoverage | null {
    if (!gs && this.allCoverage !== undefined) return this.allCoverage;
    let from = Number.POSITIVE_INFINITY;
    let to = Number.NEGATIVE_INFINITY;
    const list = gs ? [...gs].map((g) => this.channel(g)) : [...this.channels().values()];
    for (const info of list) {
      if (!info || info.count === 0) continue;
      if (info.first < from) from = info.first;
      if (info.last > to) to = info.last;
    }
    const out =
      from < to ? { from: Math.max(from, this.meta.from), to: Math.min(to, this.meta.to) } : null;
    if (!gs) this.allCoverage = out;
    return out;
  }

  /** Programas de un canal que se solapan con [fromMs, toMs), en orden. */
  slice(g: number, fromMs: number, toMs: number, limit: number): GuideGridRow[] {
    const fromMin = Math.floor(fromMs / MINUTE);
    const toMin = Math.ceil(toMs / MINUTE);
    return this.sliceStmt.all(
      g,
      fromMin - this.meta.maxDurationMin,
      toMin,
      fromMin,
      limit,
    ) as unknown as GuideGridRow[];
  }

  /** Lo que se emite en `atMs` y lo siguiente. */
  nowNext(g: number, atMs: number): { now: GuideGridRow | null; next: GuideGridRow | null } {
    const at = Math.floor(atMs / MINUTE);
    const rows = this.aroundStmt.all(
      g,
      at - this.meta.maxDurationMin,
      at,
    ) as unknown as GuideGridRow[];
    const [first, second] = rows;
    if (!first) return { now: null, next: null };
    if (first.s <= at) return { now: first, next: second ?? null };
    return { now: null, next: first };
  }

  /** La ficha de un programa (null si no existe). */
  programme(g: number, s: number): GuideDetailRow | null {
    const row = this.programmeStmt.get(g, s) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      g,
      s: Number(row.s),
      e: Number(row.e),
      t: String(row.t ?? ''),
      f: Number(row.f),
      subTitle: textOrNull(row.sub),
      description: textOrNull(row.descr),
      categories: lines(row.cats),
      season: numberOrNull(row.season),
      episode: numberOrNull(row.episode),
      episodeText: textOrNull(row.eptext),
      year: numberOrNull(row.year),
      rating: textOrNull(row.rating),
      stars: textOrNull(row.stars),
      directors: lines(row.directors),
      actors: lines(row.actors),
    };
  }

  /** URL del logo de un canal (`programmeStart` null) o de la imagen de un programa. Nunca sale del módulo. */
  iconUrl(g: number, programmeStart: number | null): string | null {
    if (programmeStart === null) {
      const row = this.db.prepare('SELECT icon FROM ch WHERE g = ?').get(g) as
        { icon: string | null } | undefined;
      return textOrNull(row?.icon);
    }
    const row = this.iconStmt.get(g, programmeStart) as { icon: string | null } | undefined;
    return textOrNull(row?.icon);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.db.close();
    } catch {
      /* nada */
    }
  }
}

/**
 * Dueño del fichero de la guía: abre la guardada, prepara una construcción
 * nueva y la instala de golpe. Un solo lector abierto a la vez.
 */
export class GuideStore {
  private reader: GuideReader | null = null;

  constructor(
    private readonly file: string,
    private readonly dir: string,
    private readonly logger: Logger,
  ) {}

  get nextFile(): string {
    return `${this.file}.next`;
  }

  /** La guía guardada de ese proveedor (la abre si hace falta). Una de otro proveedor o ilegible se borra. */
  open(providerId: string): GuideReader | null {
    if (this.reader && this.reader.meta.providerId === providerId) return this.reader;
    this.closeReader();
    const reader = GuideReader.open(this.file, providerId);
    if (!reader && existsSync(this.file)) {
      this.logger.info('Guía TV: la guardada es de otro proveedor o no se puede leer; se descarta');
      this.removeFiles();
    }
    this.reader = reader;
    return reader;
  }

  current(): GuideReader | null {
    return this.reader;
  }

  /** Empieza una construcción nueva en `guia.db.next` (borra la de una vez anterior que se quedara a medias). */
  begin(options: GuideWriterOptions): GuideWriter {
    ensureIptvDir(this.dir);
    return new GuideWriter(this.nextFile, options);
  }

  /** Cambia la guía por la recién construida (ya cerrada por `finish`) y la abre. */
  install(providerId: string): GuideReader | null {
    this.closeReader();
    try {
      renameSync(this.nextFile, this.file);
    } catch (error) {
      this.logger.warn({ err: error }, 'Guía TV: no se pudo instalar la guía nueva');
      rmSync(this.nextFile, { force: true });
    }
    this.reader = GuideReader.open(this.file, providerId);
    return this.reader;
  }

  /** Borra la guía (otro proveedor, eliminar la IPTV). */
  clear(): void {
    this.closeReader();
    this.removeFiles();
  }

  close(): void {
    this.closeReader();
  }

  private closeReader(): void {
    this.reader?.close();
    this.reader = null;
  }

  private removeFiles(): void {
    for (const file of [this.file, this.nextFile, `${this.file}-journal`, `${this.file}-wal`]) {
      try {
        rmSync(file, { force: true });
      } catch {
        /* Windows con el fichero abierto en otro sitio: se borrará la próxima vez. */
      }
    }
  }
}
