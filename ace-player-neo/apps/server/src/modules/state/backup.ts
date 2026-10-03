/* Copia de seguridad de tus ajustes (0.8.4, decisiones.md D24).

   Exportar: lo que Isma tendría que volver a montar a mano si reinstala o
   formatea el Umbrel (favoritos, recientes, listas, «Tu fútbol», vínculos,
   correcciones, ajustes y la IPTV) en un JSON versionado
   (`BackupFileSchema` de @ace/shared). Sin dispositivos, tokens, sesiones,
   «quién tiene el mando», informes ni estadísticas. La contraseña de la
   IPTV solo si se pide, cifrada con la clave de Isma (backup-crypto.ts).

   Restaurar:
   1. Se valida TODO antes de tocar nada: formato, versión, esquema y, si se
      dio la clave, que abra la contraseña de la IPTV.
   2. Vista previa (`dryRun`): recuentos de ahora, de la copia y de después.
   3. Aplicar, de uno en uno (un cerrojo propio: dos restauraciones no se
      cruzan):
      - state.json en UNA mutación de la cola del estado (la de siempre:
        copia → cambio → normalización → tmp + fsync → .bak → rename), con
        el plan calculado DENTRO de la cola sobre el estado vigente;
      - la política de mismo canal (settings.json, su propia cola);
      - la IPTV (iptv.json, su propia cola) si la copia trae la contraseña.
      Cada fichero se escribe atómicamente; si falla un paso posterior al
      estado, el error llega a la web y repetir la restauración es seguro
      (da lo mismo dos veces). Lo anterior queda en `state.json.bak` y en las
      instantáneas `.1`-`.3`.
   4. `state.changed` (biblioteca, listas, preferencias, vínculos y
      aprendizaje) y, por su cuenta, `settings` e `iptv.status`.

   Ids IPTV: en otro Umbrel no se reconocen (otra semilla). Los favoritos y
   recientes marcados `iptv` se re-etiquetan con las claves de aquí
   (`adoptForeignId`) para que el re-emparejado por nombre los lleve a su
   canal tras la primera sincronización (docs/iptv.md §14.6). */

import {
  BACKUP_FORMAT,
  BACKUP_SCHEMA_VERSION,
  BackupFileSchema,
  backupFileName,
  type BackupCounts,
  type BackupFile,
  type BackupImportBody,
  type BackupImportResponse,
  type BackupIptvOutcome,
  type BackupItem,
  type ChannelBinding,
  type ChannelFeedback,
  type IptvKind,
  type Item,
  type Preferences,
  type SameChannelPolicy,
  type StateV1,
  type WebSource,
  MAX_HISTORY,
  MAX_WEB_SOURCES,
} from '@ace/shared';
import { z } from 'zod';
import type { Clock } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import type { Logger } from '../../core/logger.js';
import type { IptvPlainSecrets, IptvService } from '../iptv/types.js';
import { backupAad, openWithPassphrase, sealWithPassphrase } from './backup-crypto.js';
import type { StateService } from './types.js';

export interface BackupDeps {
  readonly state: StateService;
  /** null en tests sin IPTV. */
  readonly iptv: Pick<
    IptvService,
    'backupConfig' | 'restore' | 'adoptForeignId' | 'classify'
  > | null;
  readonly appVersion: string;
  readonly clock: Clock;
  readonly logger: Logger;
}

export interface BackupService {
  /** La copia (con la contraseña de la IPTV cifrada si llega `passphrase`). */
  exportFile(options?: { readonly passphrase?: string }): Promise<BackupFile>;
  /** `ace-player-neo-copia-AAAA-MM-DD.json`. */
  fileName(): string;
  importFile(body: BackupImportBody): Promise<BackupImportResponse>;
}

// --- Validación ---

/**
 * Lee la copia que manda la web: primero formato y versión (para decir
 * «es de una versión más nueva» en vez de «está dañada»), luego el esquema
 * entero. El detalle de los fallos va al registro sin valores.
 */
export function parseBackup(value: unknown): BackupFile {
  const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  if (!record || record.format !== BACKUP_FORMAT) {
    throw new AppError('backup_invalid', { detail: 'no es una copia de Ace Player Neo' });
  }
  const version = record.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new AppError('backup_invalid', { detail: 'schemaVersion no válida' });
  }
  if (version > BACKUP_SCHEMA_VERSION) {
    throw new AppError('backup_version_unsupported', {
      detail: `copia v${version}; esta versión lee hasta la v${BACKUP_SCHEMA_VERSION}`,
    });
  }
  const parsed = BackupFileSchema.safeParse(record);
  if (!parsed.success) {
    throw new AppError('backup_invalid', {
      detail: 'la copia no cumple su esquema',
      data: parsed.error.issues.slice(0, 10).map((issue) => ({
        path: issue.path.map(String).join('.') || '(raíz)',
        message: issue.message,
      })),
    });
  }
  return parsed.data;
}

const PlainSecretsSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('m3u'), url: z.string().min(1).max(2048) }),
  z.strictObject({
    kind: z.literal('xtream'),
    server: z.string().min(1).max(2048),
    username: z.string().min(1).max(200),
    password: z.string().min(1).max(200),
  }),
]);

// --- Recuentos ---

export function countsOf(state: {
  readonly favorites: readonly unknown[];
  readonly history: readonly unknown[];
  readonly webSources: readonly { readonly streams: readonly unknown[] }[];
  readonly channelBindings: readonly unknown[];
  readonly channelFeedback: readonly unknown[];
}): BackupCounts {
  return {
    favorites: state.favorites.length,
    history: state.history.length,
    directories: state.webSources.length,
    channels: state.webSources.reduce((sum, source) => sum + source.streams.length, 0),
    channelBindings: state.channelBindings.length,
    channelFeedback: state.channelFeedback.length,
  };
}

function backupCounts(backup: BackupFile): BackupCounts {
  return countsOf({
    favorites: backup.library.favorites,
    history: backup.library.history,
    webSources: backup.directories.sources,
    channelBindings: backup.channelBindings,
    channelFeedback: backup.channelFeedback,
  });
}

// --- Plan (puro) ---

export interface ImportPlan {
  readonly favorites: Item[];
  readonly history: Item[];
  readonly webSources: WebSource[];
  readonly activeWebSourceId: string;
  readonly preferences: Preferences;
  readonly channelBindings: ChannelBinding[];
  readonly channelFeedback: ChannelFeedback[];
  readonly sameChannelPolicy: SameChannelPolicy;
  /** Favoritos y recientes IPTV de otra instalación (re-etiquetados). */
  readonly relinkItems: number;
}

type CurrentState = Pick<
  StateV1,
  | 'favorites'
  | 'history'
  | 'webSources'
  | 'activeWebSourceId'
  | 'preferences'
  | 'channelBindings'
  | 'channelFeedback'
>;

/** Une dos listas sin repetir clave: primero las de `first`, luego las nuevas de `second`. */
function union<T>(first: readonly T[], second: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set(first.map(key));
  const out = [...first];
  for (const value of second) {
    const k = key(value);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(value);
  }
  return out;
}

/**
 * Lo que quedará después de restaurar (sin normalizar: eso lo hace la cola
 * del estado). `adopt` re-etiqueta un id IPTV de otra instalación.
 * - `replace`: lo de la copia sustituye a lo de ahora.
 * - `merge`: añade lo que falte (favoritos, recientes, listas, vínculos y
 *   correcciones) y no cambia lo que ya tienes configurado («Tu fútbol»
 *   solo si aún no lo habías configurado; la política de mismo canal, nunca).
 */
export function planImport(
  current: CurrentState,
  currentPolicy: SameChannelPolicy,
  backup: BackupFile,
  mode: 'replace' | 'merge',
  adopt: (id: string) => string,
): ImportPlan {
  let relinkItems = 0;
  const toItem = (item: BackupItem): Item => {
    const { iptv, ...rest } = item;
    if (!iptv) return { ...rest };
    const id = adopt(rest.id);
    if (id !== rest.id) relinkItems += 1;
    return { ...rest, id };
  };
  const favorites = backup.library.favorites.map(toItem);
  const history = backup.library.history.map(toItem);
  const sources = backup.directories.sources.map((source) => structuredClone(source));

  if (mode === 'replace') {
    return {
      favorites,
      history,
      webSources: sources,
      activeWebSourceId: backup.directories.activeId,
      preferences: structuredClone(backup.preferences),
      channelBindings: structuredClone(backup.channelBindings),
      channelFeedback: structuredClone(backup.channelFeedback),
      sameChannelPolicy: backup.settings.sameChannelPolicy,
      relinkItems,
    };
  }

  const byId = (item: Item) => item.id;
  const urls = new Set(current.webSources.map((source) => source.url.toLowerCase()));
  const ids = new Set(current.webSources.map((source) => source.id));
  const webSources = [...current.webSources];
  for (const source of sources) {
    if (webSources.length >= MAX_WEB_SOURCES) break;
    if (ids.has(source.id) || urls.has(source.url.toLowerCase())) continue;
    ids.add(source.id);
    urls.add(source.url.toLowerCase());
    webSources.push(source);
  }
  return {
    favorites: union(current.favorites, favorites, byId).slice(0, MAX_HISTORY),
    history: union(current.history, history, byId).slice(0, MAX_HISTORY),
    webSources: structuredClone(webSources),
    activeWebSourceId: current.activeWebSourceId,
    preferences: current.preferences.onboardingComplete
      ? structuredClone(current.preferences)
      : structuredClone(backup.preferences),
    channelBindings: union(
      current.channelBindings,
      backup.channelBindings,
      (binding) => binding.channelKey,
    ),
    channelFeedback: union(
      current.channelFeedback,
      backup.channelFeedback,
      (entry) => `${entry.id}:${entry.channelKey}`,
    ),
    sameChannelPolicy: currentPolicy,
    relinkItems,
  };
}

function samePreferences(a: Preferences, b: Preferences): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// --- Servicio ---

export function createBackupService(deps: BackupDeps): BackupService {
  const { state, iptv, clock, logger } = deps;
  let lock: Promise<unknown> = Promise.resolve();

  /** Un solo «restaurar» a la vez (las colas de cada fichero ya ordenan lo demás). */
  function exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = lock.then(task);
    lock = run.catch(() => undefined);
    return run;
  }

  const isIptvId = (id: string): boolean => {
    if (!iptv) return false;
    try {
      return iptv.classify(id) !== 'engine';
    } catch {
      return false;
    }
  };

  const adopt = (id: string): string => (iptv ? iptv.adoptForeignId(id) : id);

  function iptvConfig() {
    if (!iptv) return null;
    try {
      return iptv.backupConfig();
    } catch (error) {
      logger.warn({ err: error }, 'copia: la IPTV no responde, va sin ella');
      return null;
    }
  }

  async function exportFile(options: { readonly passphrase?: string } = {}): Promise<BackupFile> {
    const current = state.get();
    const mark = (item: Item): BackupItem =>
      isIptvId(item.id) ? { ...item, iptv: true } : { ...item };
    const config = iptvConfig();
    let iptvBlock: BackupFile['iptv'] = null;
    if (config) {
      let secret: NonNullable<BackupFile['iptv']>['secret'] = null;
      if (options.passphrase !== undefined) {
        if (!config.secrets) throw new AppError('iptv_secret_unreadable');
        secret = await sealWithPassphrase(
          options.passphrase,
          backupAad(BACKUP_SCHEMA_VERSION, config.kind),
          config.secrets,
        );
      }
      iptvBlock = {
        kind: config.kind,
        name: config.name,
        enabled: config.enabled,
        host: config.host,
        server: config.kind === 'xtream' ? config.server : null,
        username: config.kind === 'xtream' ? config.username : null,
        secret,
      };
    }
    const file: BackupFile = {
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      appVersion: deps.appVersion.slice(0, 40) || 'desconocida',
      createdAt: clock.date().toISOString(),
      library: {
        favorites: current.favorites.map(mark),
        history: current.history.map(mark),
      },
      directories: {
        sources: structuredClone(current.webSources) as WebSource[],
        activeId: current.activeWebSourceId,
      },
      preferences: structuredClone(current.preferences) as Preferences,
      channelBindings: structuredClone(current.channelBindings) as ChannelBinding[],
      channelFeedback: structuredClone(current.channelFeedback) as ChannelFeedback[],
      settings: { sameChannelPolicy: state.sameChannelPolicy() },
      iptv: iptvBlock,
    };
    logger.info(
      {
        counts: countsOf(current),
        iptv: config ? { kind: config.kind, withSecret: iptvBlock?.secret !== null } : null,
      },
      'copia de seguridad descargada',
    );
    return file;
  }

  async function openSecrets(
    backup: BackupFile,
    passphrase: string | undefined,
  ): Promise<IptvPlainSecrets | null> {
    const block = backup.iptv;
    if (!block?.secret || passphrase === undefined) return null;
    const plain = await openWithPassphrase(
      passphrase,
      backupAad(backup.schemaVersion, block.kind),
      block.secret,
    );
    if (plain === null) throw new AppError('backup_passphrase_wrong');
    const parsed = PlainSecretsSchema.safeParse(plain);
    if (!parsed.success || parsed.data.kind !== block.kind) {
      throw new AppError('backup_invalid', {
        detail: 'la contraseña de la IPTV no tiene la forma',
      });
    }
    return parsed.data;
  }

  function iptvOutcome(
    backup: BackupFile,
    mode: 'replace' | 'merge',
    secrets: IptvPlainSecrets | null,
    relinkItems: number,
  ): BackupIptvOutcome {
    const block = backup.iptv;
    const base = {
      protected: Boolean(block?.secret),
      kind: (block?.kind ?? null) as IptvKind | null,
      name: block?.name ?? null,
      host: block?.host ?? null,
      server: block?.server ?? null,
      username: block?.username ?? null,
      relinkItems,
    };
    if (!block) return { action: 'none', ...base };
    const hasCurrent = iptvConfig() !== null;
    if (secrets && iptv && (mode === 'replace' || !hasCurrent)) {
      return { action: 'restore', ...base };
    }
    return { action: hasCurrent ? 'keep' : 'needs_secret', ...base };
  }

  async function importFile(body: BackupImportBody): Promise<BackupImportResponse> {
    const backup = parseBackup(body.backup);
    const secrets = await openSecrets(backup, body.passphrase);
    const mode = body.mode;

    return exclusive(async () => {
      const current = state.get();
      const policy = state.sameChannelPolicy();
      const plan = planImport(current, policy, backup, mode, adopt);
      const outcome = iptvOutcome(backup, mode, secrets, plan.relinkItems);
      const preview: BackupImportResponse = {
        applied: false,
        mode,
        source: {
          appVersion: backup.appVersion,
          createdAt: backup.createdAt,
          schemaVersion: backup.schemaVersion,
        },
        current: countsOf(current),
        incoming: backupCounts(backup),
        result: countsOf(plan),
        preferences: !samePreferences(current.preferences, plan.preferences),
        settings: plan.sameChannelPolicy !== policy,
        iptv: outcome,
        browser: backup.browser ?? null,
      };
      if (body.dryRun) return preview;

      /* 1. state.json: una sola escritura atómica, con el plan rehecho sobre
         el estado vigente DENTRO de la cola. */
      await state.enqueue(
        (draft) => {
          const fresh = planImport(draft, policy, backup, mode, adopt);
          draft.favorites = fresh.favorites;
          draft.history = fresh.history;
          draft.webSources = fresh.webSources;
          draft.activeWebSourceId = fresh.activeWebSourceId;
          draft.preferences = fresh.preferences;
          draft.channelBindings = fresh.channelBindings;
          draft.channelFeedback = fresh.channelFeedback;
        },
        { scopes: ['library', 'directories', 'preferences', 'bindings', 'learning'] },
      );
      /* 2. Ajustes v2 (emite `settings`). */
      if (preview.settings) {
        await state.updateSettings({ sameChannelPolicy: plan.sameChannelPolicy });
      }
      /* 3. La IPTV, si la copia trae la contraseña (emite `iptv.status`). */
      if (outcome.action === 'restore' && secrets && iptv && backup.iptv) {
        await iptv.restore({
          secrets,
          name: backup.iptv.name,
          enabled: backup.iptv.enabled,
        });
      }
      const after = state.get();
      logger.info(
        {
          mode,
          from: backup.appVersion,
          counts: countsOf(after),
          iptv: outcome.action,
          relinkItems: outcome.relinkItems,
        },
        'copia de seguridad restaurada',
      );
      return { ...preview, applied: true, result: countsOf(after) };
    });
  }

  return {
    exportFile,
    importFile,
    fileName: () => backupFileName(clock.date()),
  };
}
