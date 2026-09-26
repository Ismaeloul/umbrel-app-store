/* Módulo `state`: el almacén de state.json y de los ficheros v2
   (arquitectura §5.4; backend-modulos §2 y §3.3).

   Sustituye a `readState`/`writeState` de la 0.6.59, que releían y
   normalizaban el fichero entero en cada petición y tenían un instante sin
   state.json entre dos `rename` (backend-modulos §8.1). Ahora:
   - se carga y normaliza UNA vez al arrancar (con recuperación y migración);
   - las peticiones leen de memoria;
   - todas las mutaciones pasan por una cola única y se persisten ANTES de
     responder (sustituye al "cuerpo antes que el estado" de T-108/B-201);
   - la forma de las 12 claves v1 no cambia (la 0.6.59 tiene que poder leer
     el fichero tras una vuelta atrás: B-200, B-206).

   Tests a portar: T-025, T-031, T-034, T-036, T-108, T-109, T-110, T-115
   (vía playback), además de los de migración y vuelta atrás de plan E1.2. */

import type {
  LegacyDirectoryResponse,
  LegacyPublicState,
  LegacyPutStateBodySchema,
  LibraryMutationBody,
  LibraryView,
  Preferences,
  PreferencesInput,
  SameChannelPolicy,
  Settings,
  SettingsResponse,
  StateScope,
  StateV1,
  DevicesFile,
  IptvFile,
  SessionsFile,
} from '@ace/shared';
import type { z } from 'zod';
import type { CoreDeps, Lifecycle } from '../../core/module.js';

export type StateDeps = CoreDeps;

/** Resultado del arranque del almacén (arquitectura §5.4, "Recuperación al arrancar"). */
export interface StateLoadReport {
  /** `fresh` = no existía ningún fichero (instalación nueva). */
  readonly status: 'ready' | 'recovered' | 'degraded' | 'fresh';
  /** Fichero del que salió el estado si no fue state.json (`.tmp`, `.bak`, `.1`…). */
  readonly recoveredFrom: string | null;
  /** Ficheros ilegibles apartados como `state.json.corrupt-<ISO>`. */
  readonly quarantined: readonly string[];
  /** Versión de esquema que tenía el fichero (ausente = 1) y la que queda. */
  readonly schemaVersionBefore: number;
  readonly schemaVersionAfter: number;
  /** Se creó `state.pre-0.7.0.json` en este arranque. */
  readonly preMigrationCopy: boolean;
}

export interface EnqueueOptions {
  /** Ámbitos que cambia la mutación: se publican en `state.changed` tras persistir. */
  readonly scopes: readonly StateScope[];
}

/** Documento JSON de v2/ con su propia cola de escritura atómica (devices, sessions). */
export interface JsonDocumentStore<T> {
  /** Copia en memoria (no mutar). */
  read(): T;
  /** Aplica el cambio en orden, lo valida con su esquema y lo persiste antes de resolver. */
  update<R>(mutator: (draft: T) => R | Promise<R>): Promise<R>;
}

/** Documento de v2/ que además se puede purgar (`.bak`, restos y copias apartadas). */
export interface PurgeableDocumentStore<T> extends JsonDocumentStore<T> {
  /** Borra `.bak`, `.tmp` y las copias `.corrupt-*` (el documento vigente no se toca). */
  purge(): Promise<void>;
  /** Espera a que no quede nada en su cola. */
  flush(): Promise<void>;
}

export interface StateService extends Lifecycle {
  /**
   * Carga, recupera y migra state.json (1 → 2, idempotente) y prepara v2/.
   * Nunca deja el disco sin state.json; lo ilegible se aparta, no se borra
   * (T-109, B-202). Se llama una vez al arrancar (arquitectura §5.16, paso 2).
   */
  load(): Promise<StateLoadReport>;
  /** Último informe de `load()` (para la salud). */
  loadReport(): StateLoadReport;

  /** Estado v1 normalizado, en memoria. Solo lectura: para cambiarlo, `enqueue`. */
  get(): Readonly<StateV1>;

  /**
   * Cola única de mutaciones: aplica `mutator` sobre una copia, normaliza con
   * las tolerancias de la 0.6.59, persiste (tmp → fsync → .bak → rename →
   * fsync del directorio) y SOLO ENTONCES resuelve. Emite `state.changed`.
   * Lo que devuelve el mutador es lo que resuelve la promesa.
   */
  enqueue<R>(mutator: (draft: StateV1) => R | Promise<R>, options: EnqueueOptions): Promise<R>;

  // --- Proyecciones (api.md §3.3 y §3.11) ---
  /** `publicState` (server.js:954-961): GET /api/state. */
  publicState(): LegacyPublicState;
  /** `directoryResponse` (server.js:963-972), con `web` y `streams` duplicados. */
  directoryResponse(): LegacyDirectoryResponse;
  libraryView(): LibraryView;
  /** Informes y correcciones que cuentan como aprendizaje (`learningCount`). */
  learningCount(): number;

  // --- Biblioteca y preferencias ---
  /**
   * `mutateLibrary` (server.js:1123-1175): alta, renombrado o borrado por
   * acción, sin pisar colecciones de otros dispositivos (T-031, T-036,
   * T-110; B-185, B-186). En el directorio, borrar es ocultar. Acepta el
   * cuerpo antiguo sin validar (`unknown`) y lanza `bad_action`,
   * `bad_collection`, `bad_title`, `bad_request` o `source_not_found`.
   */
  mutateLibrary(
    body: LibraryMutationBody | Record<string, unknown>,
  ): Promise<LibraryMutationResult>;
  /** PUT /api/state de los clientes 0.6.8: solo altas y el mando (T-034, B-205). */
  mergeLegacyState(body: z.infer<typeof LegacyPutStateBodySchema>): Promise<LegacyPublicState>;
  /** Preferencias de fútbol: SUSTITUYE, no fusiona (T-025, B-142; api.md §6.7). */
  updatePreferences(input: PreferencesInput | Record<string, unknown>): Promise<Preferences>;

  // --- Ajustes v2 (v2/settings.json) ---
  settings(): SettingsResponse;
  updateSettings(patch: Partial<Settings>): Promise<SettingsResponse>;
  /** Política efectiva de mismo canal: la guardada o la de `ACE_SAME_CHANNEL_POLICY` (D5). */
  sameChannelPolicy(): SameChannelPolicy;

  // --- Documentos v2 que usan otros módulos ---
  /** v2/devices.json (auth). */
  devices(): JsonDocumentStore<DevicesFile>;
  /** v2/sessions.json (playback: sesiones que hay que parar si el proceso muere). */
  sessions(): JsonDocumentStore<SessionsFile>;
  /** v2/iptv.json (iptv, docs/iptv.md §2): configuración con los secretos cifrados, 0600. */
  iptv(): PurgeableDocumentStore<IptvFile>;

  /** Espera a que la cola quede vacía (apagado y tests). */
  flush(): Promise<void>;
}

/** Lo que devuelve una mutación de biblioteca: la colección tocada, como la 0.6.59. */
export type LibraryMutationResult =
  | { readonly collection: 'favorites'; readonly state: Readonly<StateV1> }
  | { readonly collection: 'history'; readonly state: Readonly<StateV1> }
  | { readonly collection: 'web'; readonly state: Readonly<StateV1> };
