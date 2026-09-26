/* Implementación del almacén de estado (arquitectura §5.4). Ver types.ts
   para el contrato y el porqué de cada decisión.

   Resumen:
   - `load()` (o el primer uso): recupera state.json siguiendo la cadena
     state.json → .tmp (válido y más nuevo) → .bak → .1 → .2 → .3, aparta lo
     ilegible como `.corrupt-*` (los 5 últimos), copia el original a
     `state.pre-0.7.0.json` si viene de la 0.6.x y lo migra (1 → 2).
   - Las lecturas salen de una copia en memoria congelada.
   - Todas las mutaciones pasan por UNA cola: copia → cambio → normalización
     de la 0.6.59 → escritura atómica → memoria → `state.changed`. */

import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  DevicesFileSchema,
  IptvFileSchema,
  SCHEMA_VERSION,
  SameChannelPolicySchema,
  SessionsFileSchema,
  SettingsFileSchema,
  type DevicesFile,
  type IptvFile,
  type LegacyPublicState,
  type Preferences,
  type SameChannelPolicy,
  type SessionsFile,
  type Settings,
  type SettingsFile,
  type SettingsResponse,
  type StateScope,
  type StateV1,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';
import { createDocumentStore, deepFreeze, QUARANTINE_KEEP } from './documents.js';
import { applyLegacyPut, applyLibraryMutation, applyPreferences } from './library.js';
import { migrateStateObject, serializeStateFile, type MigratedState } from './migrations.js';
import { normalizeStateV1, type NormalizeContext } from './normalize.js';
import * as projections from './projections.js';
import {
  copyOnceSync,
  corruptStamp,
  quarantineSync,
  readJsonObjectSync,
  removeIfExistsSync,
  rotateSnapshots,
  rotatedPaths,
  writeAtomic,
  writeAtomicSync,
} from './storage.js';
import type {
  EnqueueOptions,
  LibraryMutationResult,
  StateDeps,
  StateLoadReport,
  StateService,
} from './types.js';

/** Instantáneas rotadas `.1`-`.3`, como mucho una por hora. */
export const ROTATED_SNAPSHOTS = 3;
export const ROTATION_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Acceso síncrono para la fachada de la 0.6.59 (`readState`/`writeState` de
 * server.js eran síncronas). No es parte del contrato: solo la usa
 * legacy-exports.ts.
 */
export const LEGACY_SYNC = Symbol.for('ace.state.legacySync');

export interface LegacySyncAccess {
  readonly ctx: NormalizeContext;
  /** `writeState` de la 0.6.59: normaliza, escribe (state.json + .bak) y devuelve el estado. */
  writeStateSync(next: unknown): StateV1;
}

type Scopes<R> = readonly StateScope[] | ((result: R) => readonly StateScope[]);

interface Candidate {
  readonly label: string;
  readonly file: string;
  /** Sufijo del apartado (`state.json.corrupt-<fecha>-<sufijo>`). */
  readonly suffix: string;
}

interface Chosen {
  readonly candidate: Candidate;
  readonly migrated: MigratedState;
  readonly text: string;
}

export function createStateService(deps: StateDeps): StateService & {
  readonly [LEGACY_SYNC]: LegacySyncAccess;
} {
  const { config, clock, logger, bus } = deps;
  const paths = config.paths;

  const ctx: NormalizeContext = {
    nowIso: () => clock.date().toISOString(),
    defaultWebSyncUrl: config.sync.defaultWebSyncUrl,
    footballCountry: config.football.country,
    randomHex: (bytes) => randomBytes(bytes).toString('hex'),
  };

  let current: StateV1 | null = null;
  let extras: Readonly<Record<string, unknown>> = {};
  let report: StateLoadReport | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  let pending = 0;
  let lastRotationAt: number | null = null;

  /* "Estado ilegible" va también al registro de fallos (arquitectura §5.4;
     causa `state` añadida en el paso 1.3). */
  const reportUnreadable = (file: string, moved: string | null): void => {
    bus.emit('diagnostics.report', {
      cause: 'state',
      code: 'state_unreadable',
      message: moved
        ? `${file} no se podía leer; se ha apartado como ${path.basename(moved)}.`
        : `${file} no se podía leer.`,
    });
  };

  const devicesStore = createDocumentStore<DevicesFile>({
    name: 'devices',
    file: paths.devicesFile,
    schema: DevicesFileSchema,
    defaults: () => ({ schemaVersion: SCHEMA_VERSION, devices: [] }),
    clock,
    logger,
    onUnreadable: reportUnreadable,
  });
  const sessionsStore = createDocumentStore<SessionsFile>({
    name: 'sessions',
    file: paths.sessionsFile,
    schema: SessionsFileSchema,
    defaults: () => ({ schemaVersion: SCHEMA_VERSION, sessions: [] }),
    clock,
    logger,
    onUnreadable: reportUnreadable,
  });
  /* IPTV (docs/iptv.md §2.1): secretos cifrados, pero aun así 0600. */
  const iptvStore = createDocumentStore<IptvFile>({
    name: 'iptv',
    file: paths.iptvFile,
    schema: IptvFileSchema,
    defaults: () => ({ version: 1, provider: null }),
    clock,
    logger,
    onUnreadable: reportUnreadable,
    fileMode: 0o600,
  });
  const settingsStore = createDocumentStore<SettingsFile>({
    name: 'settings',
    file: paths.settingsFile,
    schema: SettingsFileSchema,
    defaults: () => ({
      schemaVersion: SCHEMA_VERSION,
      settings: { sameChannelPolicy: config.playback.sameChannelPolicy },
      updatedAt: null,
    }),
    clock,
    logger,
    onUnreadable: reportUnreadable,
  });

  // --- Carga y recuperación ---

  function candidates(): Candidate[] {
    return [
      { label: 'state.json', file: paths.stateFile, suffix: '' },
      { label: 'state.json.tmp', file: paths.stateTmpFile, suffix: 'tmp' },
      { label: 'state.json.bak', file: paths.stateBackupFile, suffix: 'bak' },
      ...rotatedPaths(paths.stateFile, ROTATED_SNAPSHOTS).map((file, index) => ({
        label: path.basename(file),
        file,
        suffix: String(index + 1),
      })),
    ];
  }

  function loadSync(): StateLoadReport {
    if (report) return report;
    mkdirSync(config.dataDir, { recursive: true });
    const stamp = corruptStamp(clock.date());
    const quarantined: string[] = [];
    let anyExisted = false;

    /* Lee un candidato; si existe pero no vale, lo aparta. */
    const tryCandidate = (candidate: Candidate): (Chosen & { mtimeMs: number }) | null => {
      const outcome = readJsonObjectSync(candidate.file);
      if (outcome.kind === 'missing') return null;
      anyExisted = true;
      if (outcome.kind === 'ok') {
        try {
          return {
            candidate,
            migrated: migrateStateObject(outcome.value, ctx),
            text: outcome.text,
            mtimeMs: outcome.mtimeMs,
          };
        } catch (error) {
          logger.error({ err: error, file: candidate.label }, 'no se pudo normalizar el estado');
        }
      }
      const moved = quarantineSync(
        candidate.file,
        paths.stateFile,
        stamp,
        candidate.suffix,
        QUARANTINE_KEEP,
      );
      if (moved) quarantined.push(moved);
      logger.error(
        { file: candidate.label, apartado: moved, errorCode: 'state_unreadable' },
        'estado ilegible: apartado para mirarlo a mano',
      );
      reportUnreadable(candidate.label, moved);
      return null;
    };

    const [mainCandidate, tmpCandidate, ...copies] = candidates() as [
      Candidate,
      Candidate,
      ...Candidate[],
    ];
    const main = tryCandidate(mainCandidate);
    const tmp = tryCandidate(tmpCandidate);
    /* Un .tmp completo y más nuevo es la última escritura, cortada antes del
       rename (arquitectura §5.4). Si es más viejo, es un resto sin valor. */
    let chosen: Chosen | null = tmp && (!main || tmp.mtimeMs > main.mtimeMs) ? tmp : main;
    for (const candidate of copies) {
      if (chosen) break;
      chosen = tryCandidate(candidate);
    }

    let status: StateLoadReport['status'];
    let state: StateV1;
    let before = 1;
    let preMigrationCopy = false;
    if (chosen) {
      const { candidate, migrated } = chosen;
      status = candidate.label === 'state.json' ? 'ready' : 'recovered';
      state = migrated.state;
      extras = migrated.extras;
      before = migrated.schemaVersionBefore;
      /* Primer arranque de la 0.7.0 sobre un estado de la 0.6.x: copia
         intocable del original ANTES de escribir nada (arquitectura §5.4). */
      if (before < SCHEMA_VERSION) {
        preMigrationCopy = copyOnceSync(candidate.file, paths.statePreMigrationFile);
      }
    } else {
      status = anyExisted ? 'degraded' : 'fresh';
      state = normalizeStateV1({}, ctx);
      extras = {};
      if (anyExisted) {
        logger.error(
          { errorCode: 'state_unreadable', quarantined },
          'ninguna copia del estado se puede leer: se arranca vacío y los ficheros quedan apartados',
        );
      }
    }

    const text = serializeStateFile(state, extras);
    const upToDate = chosen?.candidate.label === 'state.json' && chosen.text === text;
    let written = upToDate;
    if (!upToDate) {
      /* Si state.json existe (aún válido, por ejemplo al tirar de un .tmp más
         nuevo) pasa a ser el .bak; si se apartó, el .bak bueno no se toca.
         Si el disco no deja escribir, se sigue con el estado en memoria (se
         puede ver la tele) y la siguiente mutación lo volverá a intentar. */
      try {
        writeAtomicSync(paths.stateFile, text, { backup: paths.stateBackupFile });
        written = true;
      } catch (error) {
        logger.error(
          { err: error, errorCode: 'internal_error' },
          'no se pudo guardar el estado al arrancar: se sigue en memoria',
        );
      }
    }
    if (written) {
      removeIfExistsSync(paths.stateTmpFile);
      removeIfExistsSync(`${paths.stateBackupFile}.tmp`);
    }

    const firstSnapshot = rotatedPaths(paths.stateFile, 1)[0] as string;
    const snapshot = readJsonObjectSync(firstSnapshot);
    lastRotationAt = snapshot.kind === 'ok' ? Math.min(snapshot.mtimeMs, clock.now()) : null;

    current = deepFreeze(state);
    report = {
      status,
      recoveredFrom: status === 'recovered' && chosen ? chosen.candidate.label : null,
      quarantined,
      schemaVersionBefore: chosen ? before : SCHEMA_VERSION,
      schemaVersionAfter: SCHEMA_VERSION,
      preMigrationCopy,
    };
    if (status === 'recovered') {
      logger.warn({ state: report }, 'estado recuperado de una copia');
    }

    try {
      mkdirSync(paths.v2Dir, { recursive: true });
    } catch (error) {
      logger.error({ err: error }, 'no se pudo crear data/v2: sus documentos quedan en memoria');
    }
    devicesStore.loadSync();
    sessionsStore.loadSync();
    settingsStore.loadSync();
    iptvStore.loadSync();
    syncSettingsWithEnvironment();
    return report;
  }

  /* Si Isma no ha guardado nunca la política, manda ACE_SAME_CHANNEL_POLICY
     (D5) y settings.json la refleja. */
  function syncSettingsWithEnvironment(): void {
    const file = settingsStore.read();
    if (
      file.updatedAt === null &&
      file.settings.sameChannelPolicy !== config.playback.sameChannelPolicy
    ) {
      settingsStore.replaceSync({
        ...file,
        settings: { ...file.settings, sameChannelPolicy: config.playback.sameChannelPolicy },
      });
    }
  }

  function ensureLoaded(): StateV1 {
    if (!current) loadSync();
    return current as StateV1;
  }

  // --- Cola de mutaciones ---

  async function persist(next: StateV1): Promise<void> {
    await writeAtomic(paths.stateFile, serializeStateFile(next, extras), {
      backup: paths.stateBackupFile,
    });
    const now = clock.now();
    if (lastRotationAt === null || now - lastRotationAt >= ROTATION_INTERVAL_MS) {
      try {
        await rotateSnapshots(paths.stateFile, ROTATED_SNAPSHOTS);
        lastRotationAt = now;
      } catch (error) {
        logger.warn({ err: error }, 'no se pudo rotar la instantánea horaria del estado');
      }
    }
  }

  function emitChanged(scopes: readonly StateScope[]): void {
    if (!scopes.length) return;
    bus.emit('state.changed', { scopes: [...new Set(scopes)], at: clock.date().toISOString() });
  }

  function run<R>(
    mutator: (draft: StateV1) => R | Promise<R>,
    scopes: Scopes<R>,
  ): Promise<{ readonly result: R; readonly state: StateV1 }> {
    const job = async (): Promise<{ result: R; state: StateV1 }> => {
      const draft = structuredClone(ensureLoaded());
      const result = await mutator(draft);
      const next = deepFreeze(normalizeStateV1(draft, ctx));
      await persist(next);
      current = next;
      emitChanged(typeof scopes === 'function' ? scopes(result) : scopes);
      return { result, state: next };
    };
    pending += 1;
    const promise = chain.then(job).finally(() => {
      pending -= 1;
    });
    chain = promise.catch(() => undefined);
    return promise;
  }

  // --- Ajustes v2 ---

  function settingsResponse(): SettingsResponse {
    ensureLoaded();
    const file = settingsStore.read();
    const saved = file.updatedAt !== null;
    return {
      settings: {
        sameChannelPolicy: saved
          ? file.settings.sameChannelPolicy
          : config.playback.sameChannelPolicy,
      },
      source: saved ? 'saved' : 'environment',
    };
  }

  const service: StateService & { readonly [LEGACY_SYNC]: LegacySyncAccess } = {
    async start() {
      ensureLoaded();
    },
    async stop() {
      await service.flush();
    },
    async load() {
      return loadSync();
    },
    loadReport() {
      return loadSync();
    },
    get() {
      return ensureLoaded();
    },
    async enqueue<R>(mutator: (draft: StateV1) => R | Promise<R>, options: EnqueueOptions) {
      const { result } = await run(mutator, options.scopes);
      return result;
    },

    publicState(): LegacyPublicState {
      return projections.publicState(ensureLoaded());
    },
    directoryResponse() {
      return projections.directoryResponse(ensureLoaded());
    },
    libraryView() {
      return projections.libraryView(ensureLoaded());
    },
    learningCount() {
      return ensureLoaded().channelFeedback.length;
    },

    async mutateLibrary(body, options = {}): Promise<LibraryMutationResult> {
      const { result, state } = await run(
        (draft) => applyLibraryMutation(draft, body, ctx, options),
        (collection) => (collection === 'web' ? ['library', 'directories'] : ['library']),
      );
      return { collection: result, state };
    },
    async mergeLegacyState(body) {
      const { state } = await run(
        (draft) => applyLegacyPut(draft, body, clock.now(), ctx),
        (touched) => (touched.nowPlaying ? ['library', 'nowPlaying'] : ['library']),
      );
      return projections.publicState(state);
    },
    async updatePreferences(input): Promise<Preferences> {
      const { state } = await run((draft) => applyPreferences(draft, input, ctx), ['preferences']);
      return state.preferences;
    },

    settings: settingsResponse,
    async updateSettings(patch: Partial<Settings>) {
      ensureLoaded();
      const policy = (patch as { sameChannelPolicy?: unknown } | null)?.sameChannelPolicy;
      if (policy === undefined) return settingsResponse();
      const parsed = SameChannelPolicySchema.safeParse(policy);
      if (!parsed.success) throw new AppError('validation_error', { detail: 'sameChannelPolicy' });
      await settingsStore.update((draft) => {
        draft.settings.sameChannelPolicy = parsed.data;
        draft.updatedAt = clock.date().toISOString();
      });
      emitChanged(['settings']);
      return settingsResponse();
    },
    sameChannelPolicy(): SameChannelPolicy {
      return settingsResponse().settings.sameChannelPolicy;
    },

    devices() {
      ensureLoaded();
      return devicesStore;
    },
    sessions() {
      ensureLoaded();
      return sessionsStore;
    },
    iptv() {
      ensureLoaded();
      return iptvStore;
    },

    async flush() {
      await chain;
      await Promise.all([
        devicesStore.flush(),
        sessionsStore.flush(),
        settingsStore.flush(),
        iptvStore.flush(),
      ]);
    },

    [LEGACY_SYNC]: {
      ctx,
      writeStateSync(next: unknown): StateV1 {
        ensureLoaded();
        if (pending > 0) {
          throw new Error('writeState síncrono con escrituras en cola: usa enqueue()');
        }
        const state = deepFreeze(normalizeStateV1(next, ctx));
        writeAtomicSync(paths.stateFile, serializeStateFile(state, extras), {
          backup: paths.stateBackupFile,
        });
        current = state;
        return state;
      },
    },
  };

  return service;
}
