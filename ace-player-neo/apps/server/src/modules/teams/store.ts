/* Caché en disco del módulo `teams` (informe de fase 2, §10.4):
   `<teamsDir>/index.json` (índice validado con zod, escritura atómica con
   `.bak`, ilegible → apartado como `.corrupt-<fecha>` y se empieza vacío),
   `<teamsDir>/<idTeam>.png` y `<teamsDir>/competitions/<idLeague>.png`
   (escritura atómica propia para binarios: tmp + fsync + rename).

   La memoria manda: si el disco no deja escribir, el índice sigue en memoria
   y se avisa UNA vez (`onWriteError`, que el servicio manda a diagnóstico).
   Al arrancar se concilian los PNG con el índice: un PNG que falta vuelve a
   la cola y uno sin entrada se borra. Los últimos 64 búferes servidos se
   quedan en memoria (LRU) para no tocar disco en cada fila de la agenda. */

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { open, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { HexColorSchema, IsoDateTimeSchema } from '@ace/shared';
import type { Clock } from '../../core/clock.js';
import type { Logger } from '../../core/logger.js';
import {
  corruptStamp,
  fileExists,
  isMissing,
  quarantineSync,
  readJsonObjectSync,
  removeIfExists,
  writeAtomic,
} from '../state/index.js';
import { TEAMS_BUFFER_CACHE, TEAMS_COMPETITIONS_DIR, TEAMS_INDEX_FILE } from './constants.js';

/** Apartados que se guardan (como los documentos v2). */
export const QUARANTINE_KEEP = 5;

// --- Esquema del índice ---

export const BadgeFileSchema = z.strictObject({
  /** Nombre del PNG dentro de su carpeta (`<id>.png`). */
  file: z.string().regex(/^[A-Za-z0-9_-]{1,64}\.png$/),
  /** 16 hex del sha256 de los bytes: la versión que lleva la URL (`?v=`). */
  etag: z.string().regex(/^[a-f0-9]{16}$/),
  bytes: z.number().int().nonnegative(),
  fetchedAt: IsoDateTimeSchema,
});
export type BadgeFile = z.infer<typeof BadgeFileSchema>;

export const EntryStatusSchema = z.enum([
  'pending',
  'resolved',
  'not_found',
  'ambiguous',
  'bad_image',
  'failed',
  'skipped',
]);
export type EntryStatus = z.infer<typeof EntryStatusSchema>;

export const StoredColorsSchema = z.strictObject({
  primary: HexColorSchema,
  secondary: HexColorSchema.nullable(),
  source: z.enum(['override', 'thesportsdb', 'image']),
});

const ENTRY_COMMON = {
  key: z.string().min(1),
  /** Nombre tal y como sale en la agenda (el último visto). */
  name: z.string(),
  /** Término con el que se buscó (vacío hasta la primera búsqueda). */
  query: z.string(),
  status: EntryStatusSchema,
  /** Fallos de red seguidos (la espera exponencial). */
  attempts: z.number().int().nonnegative(),
  resolvedAt: IsoDateTimeSchema.nullable(),
  /** Cuándo toca volver a mirar (revalidación, reintento); null = nunca. */
  nextRetryAt: IsoDateTimeSchema.nullable(),
  /** Última vez que salió en la agenda (la poda quita los más viejos). */
  lastSeenAt: IsoDateTimeSchema,
};

export const TeamEntrySchema = z.strictObject({
  ...ENTRY_COMMON,
  idTeam: z.string().nullable(),
  /** `strTeam` de TheSportsDB. */
  apiName: z.string().nullable(),
  short: z.string().max(4).nullable(),
  crest: BadgeFileSchema.nullable(),
  colors: StoredColorsSchema.nullable(),
});
export type TeamEntry = z.infer<typeof TeamEntrySchema>;

export const CompetitionEntrySchema = z.strictObject({
  ...ENTRY_COMMON,
  idLeague: z.string().nullable(),
  apiName: z.string().nullable(),
  logo: BadgeFileSchema.nullable(),
});
export type CompetitionEntry = z.infer<typeof CompetitionEntrySchema>;

export const TeamsIndexSchema = z.strictObject({
  version: z.literal(1),
  teams: z.record(z.string(), TeamEntrySchema),
  competitions: z.record(z.string(), CompetitionEntrySchema),
});
export type TeamsIndex = z.infer<typeof TeamsIndexSchema>;

export function emptyIndex(): TeamsIndex {
  return { version: 1, teams: {}, competitions: {} };
}

/** Versión de un PNG: 16 hex del sha256 de sus bytes. */
export function etagOf(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 16);
}

// --- Escritura atómica de binarios ---

/* En Windows (solo desarrollo y tests) un antivirus puede tener el fichero
   abierto un instante: se reintenta el rename cediendo el turno (como storage.ts). */
const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);
const RETRIES = process.platform === 'win32' ? 20 : 0;

async function renameRetrying(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = String((error as { code?: unknown } | null)?.code ?? '');
      if (attempt >= RETRIES || !RETRYABLE.has(code)) throw error;
      await new Promise((resolve) => setImmediate(resolve));
    }
  }
}

/** `<destino>.tmp` + fsync → rename: nunca hay un PNG a medias con el nombre bueno. */
export async function writeBufferAtomic(target: string, bytes: Buffer): Promise<void> {
  const tmp = `${target}.tmp`;
  const handle = await open(tmp, 'w');
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await renameRetrying(tmp, target);
}

// --- El almacén ---

export type BadgeKind = 'team' | 'competition';
export type TeamsLoadStatus = 'fresh' | 'ready' | 'recovered' | 'degraded' | 'memory';

export interface TeamsLoadReport {
  readonly status: TeamsLoadStatus;
  /** PNG sin entrada en el índice, borrados. */
  readonly orphansRemoved: number;
  /** Entradas cuyo PNG no estaba: vuelven a la cola. */
  readonly crestsMissing: number;
}

export interface TeamsStoreOptions {
  readonly dir: string;
  readonly clock: Clock;
  readonly logger: Logger;
  /** Índice ilegible y apartado (el servicio lo manda a diagnóstico). */
  readonly onUnreadable?: (moved: string | null) => void;
  /** Primera escritura fallida (índice o PNG): una sola vez. */
  readonly onWriteError?: (error: unknown) => void;
  readonly bufferCache?: number;
}

export interface TeamsStore {
  /** Crea la carpeta, lee el índice (aparta el ilegible) y concilia los PNG. Idempotente. */
  load(): TeamsLoadReport;
  /** Copia en memoria (no mutar fuera de `update`). Antes de `load()`, vacío. */
  index(): TeamsIndex;
  /** Aplica el cambio sobre una copia, lo valida, lo deja en memoria y encola la escritura. */
  update(mutator: (draft: TeamsIndex) => void): void;
  /** Espera a que no quede ninguna escritura del índice pendiente. */
  flush(): Promise<void>;
  badgePath(kind: BadgeKind, file: string): string;
  /** Escribe `<id>.png` de forma atómica y devuelve su ficha (etag, bytes, fecha). Lanza si el disco falla. */
  writeBadge(kind: BadgeKind, id: string, bytes: Buffer): Promise<BadgeFile>;
  /** Bytes del PNG (LRU en memoria), o null si ya no está. */
  readBadge(kind: BadgeKind, file: string): Promise<Buffer | null>;
  removeBadge(kind: BadgeKind, file: string): Promise<void>;
  /** ¿Ha fallado alguna escritura (índice o PNG)? */
  writeFailed(): boolean;
}

export function createTeamsStore(options: TeamsStoreOptions): TeamsStore {
  const { dir, clock, logger } = options;
  const indexFile = path.join(dir, TEAMS_INDEX_FILE);
  const backupFile = `${indexFile}.bak`;
  const cacheMax = options.bufferCache ?? TEAMS_BUFFER_CACHE;
  let current: TeamsIndex = emptyIndex();
  let loaded: TeamsLoadReport | null = null;
  let dirty = false;
  let writing: Promise<void> | null = null;
  let failed = false;
  let reported = false;
  const cache = new Map<string, Buffer>();

  const kindDir = (kind: BadgeKind): string =>
    kind === 'competition' ? path.join(dir, TEAMS_COMPETITIONS_DIR) : dir;
  const badgePath = (kind: BadgeKind, file: string): string => path.join(kindDir(kind), file);
  const cacheKey = (kind: BadgeKind, file: string): string => `${kind}:${file}`;

  function noteWriteError(error: unknown): void {
    failed = true;
    if (reported) return;
    reported = true;
    logger.warn(
      { err: error, dir },
      'escudos: no se puede escribir en data/v2/teams; se sigue en memoria',
    );
    options.onWriteError?.(error);
  }

  function cacheSet(key: string, bytes: Buffer): void {
    cache.delete(key);
    cache.set(key, bytes);
    while (cache.size > cacheMax) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  function persist(): void {
    if (loaded?.status === 'memory') return;
    dirty = true;
    if (writing) return;
    writing = (async () => {
      while (dirty) {
        dirty = false;
        const text = JSON.stringify(current, null, 2);
        try {
          await writeAtomic(indexFile, text, { backup: backupFile });
        } catch (error) {
          noteWriteError(error);
        }
      }
    })().finally(() => {
      writing = null;
    });
  }

  /* Un PNG del índice que no está en disco deja la entrada pendiente; un PNG
     (o un `.tmp` a medias) sin entrada se borra. */
  function reconcile(): { changed: boolean; crestsMissing: number; orphansRemoved: number } {
    let changed = false;
    let crestsMissing = 0;
    let orphansRemoved = 0;
    const referenced: Record<BadgeKind, Set<string>> = { team: new Set(), competition: new Set() };
    for (const entry of Object.values(current.teams)) {
      if (!entry.crest) continue;
      if (fileExists(badgePath('team', entry.crest.file))) referenced.team.add(entry.crest.file);
      else {
        entry.crest = null;
        entry.status = 'pending';
        entry.nextRetryAt = null;
        crestsMissing += 1;
        changed = true;
      }
    }
    for (const entry of Object.values(current.competitions)) {
      if (!entry.logo) continue;
      if (fileExists(badgePath('competition', entry.logo.file))) {
        referenced.competition.add(entry.logo.file);
      } else {
        entry.logo = null;
        entry.status = 'pending';
        entry.nextRetryAt = null;
        crestsMissing += 1;
        changed = true;
      }
    }
    for (const kind of ['team', 'competition'] as const) {
      let names: string[];
      try {
        names = readdirSync(kindDir(kind));
      } catch {
        continue;
      }
      for (const name of names) {
        const isPng = name.endsWith('.png');
        const isLeftover = name.endsWith('.png.tmp');
        if ((!isPng && !isLeftover) || referenced[kind].has(name)) continue;
        try {
          rmSync(path.join(kindDir(kind), name), { force: true });
          orphansRemoved += 1;
        } catch {}
      }
    }
    return { changed, crestsMissing, orphansRemoved };
  }

  function load(): TeamsLoadReport {
    if (loaded) return loaded;
    try {
      mkdirSync(kindDir('competition'), { recursive: true });
    } catch (error) {
      noteWriteError(error);
      current = emptyIndex();
      loaded = { status: 'memory', orphansRemoved: 0, crestsMissing: 0 };
      return loaded;
    }
    let status: TeamsLoadStatus = 'fresh';
    const stamp = corruptStamp(clock.date());
    let existed = false;
    for (const [candidate, suffix] of [
      [indexFile, ''],
      [backupFile, 'bak'],
    ] as const) {
      const outcome = readJsonObjectSync(candidate);
      if (outcome.kind === 'missing') continue;
      existed = true;
      const parsed = outcome.kind === 'ok' ? TeamsIndexSchema.safeParse(outcome.value) : null;
      if (parsed?.success) {
        current = parsed.data;
        status = candidate === indexFile ? 'ready' : 'recovered';
        break;
      }
      const moved = quarantineSync(candidate, indexFile, stamp, suffix, QUARANTINE_KEEP);
      logger.error(
        { apartado: moved, errorCode: 'state_unreadable' },
        'escudos: índice ilegible o fuera de esquema: apartado, se empieza vacío',
      );
      options.onUnreadable?.(moved);
    }
    if (status === 'fresh') {
      current = emptyIndex();
      if (existed) status = 'degraded';
    }
    const reconciled = reconcile();
    loaded = {
      status,
      crestsMissing: reconciled.crestsMissing,
      orphansRemoved: reconciled.orphansRemoved,
    };
    if (reconciled.changed || status === 'recovered') persist();
    return loaded;
  }

  return {
    load,
    index: () => current,
    update(mutator) {
      const draft = structuredClone(current);
      mutator(draft);
      const parsed = TeamsIndexSchema.safeParse(draft);
      if (!parsed.success) {
        logger.error(
          { issues: parsed.error.issues.slice(0, 5) },
          'escudos: el índice no cumple su esquema tras el cambio; se descarta',
        );
        return;
      }
      current = parsed.data;
      persist();
    },
    async flush() {
      while (writing) await writing;
    },
    badgePath,
    async writeBadge(kind, id, bytes) {
      const file = `${id}.png`;
      try {
        await writeBufferAtomic(badgePath(kind, file), bytes);
      } catch (error) {
        noteWriteError(error);
        throw error;
      }
      cacheSet(cacheKey(kind, file), bytes);
      return {
        file,
        etag: etagOf(bytes),
        bytes: bytes.length,
        fetchedAt: clock.date().toISOString(),
      };
    },
    async readBadge(kind, file) {
      const key = cacheKey(kind, file);
      const cached = cache.get(key);
      if (cached) {
        cacheSet(key, cached);
        return cached;
      }
      try {
        const bytes = await readFile(badgePath(kind, file));
        cacheSet(key, bytes);
        return bytes;
      } catch (error) {
        if (isMissing(error)) return null;
        throw error;
      }
    },
    async removeBadge(kind, file) {
      cache.delete(cacheKey(kind, file));
      await removeIfExists(badgePath(kind, file));
    },
    writeFailed: () => failed,
  };
}
