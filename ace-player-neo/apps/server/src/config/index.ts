/* Configuración del backend (arquitectura §5.3; backend-modulos §1).

   Se lee `process.env` UNA vez al arrancar y el resultado se congela: nadie
   vuelve a mirar el entorno. Mismos nombres, defectos, acotaciones y
   saneados que la 0.6.59 (server.js:10-122 y 5158), para que el Compose de
   siempre siga valiendo. Diferencias a propósito, todas con defecto seguro:

   - `ACESTREAM_SCANNER_HOST` y `ENGINE_CONTROL_HOST` se sanean igual que
     `ACESTREAM_HOST` (backend-modulos §9.10: hoy no se sanean).
   - Variables nuevas: `ACE_SEED`, `ACE_SAME_CHANNEL_POLICY`, `ACE_LOG_LEVEL`
     y `APP_VERSION` (la inyecta el build, T-102).
   - Un valor que no vale se sustituye por el defecto y queda un aviso en
     `warnings` (main.ts los escribe en el log). Solo las de seguridad hacen
     fallar el arranque (`ConfigError`): un `ACE_SEED` demasiado corto. */

import path from 'node:path';
import { DEFAULT_SAME_CHANNEL_POLICY, V2_FILES, type SameChannelPolicy } from '@ace/shared';
import { LOG_LEVELS, type LogLevel } from '../core/logger.js';
import { MIN_SEED_LENGTH, deriveKeys, ephemeralSeed, type DerivedKeys } from './keys.js';

/* Lo pone esbuild al compilar la release (apps/server/build.mjs). En
   desarrollo y en los tests no existe. */
declare const __APP_VERSION__: string | undefined;

export type Env = Readonly<Record<string, string | undefined>>;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

export const DEFAULTS = {
  dataDir: '/data',
  acestreamHost: 'ismaeloul-ace-player-neo_acestream_1',
  engineControlHost: 'ismaeloul-ace-player-neo_engine_control_1',
  defaultWebSyncUrl:
    'https://ipfs.io/ipns/k51qzi5uqu5di462t7j4vu4akwfhvtjhy88qbupktvoacqfqe9uforjvhyi4wr/hashes_acestream.m3u',
  ipfsDelegatedRouting: 'https://delegated-ipfs.dev',
  ipfsTrustlessGateway: 'https://trustless-gateway.link',
  footballApiKey: '123',
  footballCountry: 'Spain',
  ollamaEmbedModel: 'embeddinggemma:300m-qat-q4_0',
  port: 3000,
  devVersion: '0.0.0-dev',
} as const;

/** Puertos fijos en el código de la 0.6.59 (server.js:259, 2818 y 4686). */
export const ENGINE_PORT = 6878;
export const ENGINE_CONTROL_PORT = 3001;

export interface AppConfig {
  readonly appVersion: string;
  readonly host: '0.0.0.0';
  readonly port: number;
  readonly logLevel: LogLevel;
  readonly dataDir: string;
  readonly paths: {
    readonly stateFile: string;
    readonly stateBackupFile: string;
    readonly stateTmpFile: string;
    /** Copia intocable del primer arranque de la 0.7.0 (arquitectura §5.4). */
    readonly statePreMigrationFile: string;
    readonly remuxDir: string;
    readonly v2Dir: string;
    readonly devicesFile: string;
    readonly settingsFile: string;
    readonly sessionsFile: string;
    readonly diagnosticsFile: string;
    /** Índice y PNG de escudos y logos (`<v2Dir>/teams`, módulo `teams`). */
    readonly teamsDir: string;
    /** IPTV (docs/iptv.md §2.1): configuración con los secretos cifrados (0600). */
    readonly iptvFile: string;
    /** Carpeta de la IPTV (0700): catálogo y guía cifrados y, sin semilla, la clave. */
    readonly iptvDir: string;
    readonly iptvCatalogFile: string;
    readonly iptvGuideFile: string;
    readonly iptvKeyFile: string;
  };
  readonly engine: {
    readonly host: string;
    readonly port: number;
    readonly controlHost: string;
    readonly controlPort: number;
    /** Vacío = engine-control no comprueba nada (compatibilidad); en Compose es `${APP_SEED}`. */
    readonly controlToken: string;
  };
  readonly scanner: {
    /** Vacío = comprobador apagado. */
    readonly host: string;
    readonly enabled: boolean;
    readonly port: number;
    readonly probeTimeoutMs: number;
    readonly sampleBytes: number;
    readonly mediaProbeMs: number;
    readonly retryDelayMs: number;
    readonly sustainMs: number;
    /** Retraso de reintento + 15 min (server.js:88). */
    readonly jobTtlMs: number;
    /** Igual al retraso de reintento (server.js:102). */
    readonly badTtlMs: number;
  };
  readonly sync: {
    readonly autoSync: boolean;
    readonly defaultWebSyncUrl: string;
    /** Con `true` desaparece TODO el filtro SSRF (T-004, T-005, T-116). */
    readonly allowPrivateUrls: boolean;
    readonly ipfsDelegatedRouting: string;
    readonly ipfsTrustlessGateway: string;
  };
  readonly football: {
    readonly apiKey: string;
    readonly country: string;
    readonly days: number;
    readonly demoOnly: boolean;
    readonly timezone: 'Europe/Madrid';
  };
  readonly teams: {
    /**
     * Escudos y colores desde TheSportsDB (módulo `teams`). Apagado en demo
     * (`FOOTBALL_DEMO_ONLY`) o con `ACE_TEAM_CRESTS=false`: entonces no toca
     * red ni disco y la agenda sale sin `homeTeam`/`awayTeam`.
     */
    readonly enabled: boolean;
  };
  readonly ai: {
    readonly ollamaBaseUrl: string;
    readonly embedModel: string;
    readonly timeoutMs: number;
    /** `ollamaConfigured()` de server.js:654-662: http(s) y sin credenciales en la URL. */
    readonly enabled: boolean;
  };
  readonly playback: {
    /** Política de mismo canal si no hay ajuste guardado (D5). */
    readonly sameChannelPolicy: SameChannelPolicy;
  };
  readonly security: {
    /** De dónde sale el material de las claves. `ephemeral` = aleatorio de este arranque. */
    readonly seedSource: 'ACE_SEED' | 'ENGINE_CONTROL_TOKEN' | 'ephemeral';
    readonly keys: DerivedKeys;
  };
}

export interface LoadedConfig {
  readonly config: AppConfig;
  /** Valores que no valían y se sustituyeron por su defecto. */
  readonly warnings: readonly string[];
}

// --- Saneados, tal cual la 0.6.59 ---

/** `trim`, quita lo que no sea `[a-zA-Z0-9_.-]`, máx. 253; vacío → defecto (server.js:16-17). */
export function sanitizeHost(value: string | undefined, fallback: string): string {
  return (
    String(value || fallback)
      .trim()
      .replace(/[^a-zA-Z0-9_.-]/g, '')
      .slice(0, 253) || fallback
  );
}

/**
 * `Math.min(max, Math.max(min, parseInt(v, 10) || defecto))`: el patrón de
 * server.js. Ojo, igual que allí, un "0" cuenta como vacío y da el defecto.
 */
export function clampedInt(
  value: string | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  return Math.min(max, Math.max(min, Number.parseInt(value ?? '', 10) || fallback));
}

function ollamaConfigured(baseUrl: string, model: string): boolean {
  if (!baseUrl || !model) return false;
  try {
    const parsed = new URL(baseUrl);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

function resolveVersion(env: Env): string {
  const built = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '';
  return built || String(env.APP_VERSION || '').trim() || DEFAULTS.devVersion;
}

export function loadConfig(env: Env = process.env): LoadedConfig {
  const warnings: string[] = [];

  /* Aviso si un número no se entiende o se ha tenido que acotar. */
  const intVar = (name: string, min: number, max: number, fallback: number): number => {
    const raw = env[name];
    const value = clampedInt(raw, min, max, fallback);
    if (raw !== undefined && raw !== '' && String(value) !== String(Number.parseInt(raw, 10))) {
      warnings.push(`${name}=${JSON.stringify(raw)} no vale (${min}..${max}); se usa ${value}`);
    }
    return value;
  };

  const dataDir = env.DATA_DIR || DEFAULTS.dataDir;
  const stateFile = path.join(dataDir, 'state.json');
  const v2Dir = path.join(dataDir, 'v2');

  const scannerHost = sanitizeHost(env.ACESTREAM_SCANNER_HOST, '');
  const retryDelayMs = intVar('ACESTREAM_SCANNER_RETRY_DELAY_MS', 60_000, 1_800_000, 600_000);

  const ollamaBaseUrl = String(env.OLLAMA_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  const embedModel =
    String(env.OLLAMA_EMBED_MODEL || DEFAULTS.ollamaEmbedModel)
      .trim()
      .replace(/[^a-zA-Z0-9_.:/-]/g, '')
      .slice(0, 120) || DEFAULTS.ollamaEmbedModel;

  const controlToken = String(env.ENGINE_CONTROL_TOKEN || '')
    .trim()
    .slice(0, 200);

  // --- Política de mismo canal (D5) ---
  let sameChannelPolicy: SameChannelPolicy = DEFAULT_SAME_CHANNEL_POLICY;
  const rawPolicy = String(env.ACE_SAME_CHANNEL_POLICY || '')
    .trim()
    .toLowerCase();
  if (rawPolicy === 'share' || rawPolicy === 'handoff') sameChannelPolicy = rawPolicy;
  else if (rawPolicy) {
    warnings.push(`ACE_SAME_CHANNEL_POLICY=${JSON.stringify(rawPolicy)} no vale; se usa "share"`);
  }

  // --- Nivel de log ---
  let logLevel: LogLevel = 'info';
  const rawLevel = String(env.ACE_LOG_LEVEL || '')
    .trim()
    .toLowerCase();
  if ((LOG_LEVELS as readonly string[]).includes(rawLevel)) logLevel = rawLevel as LogLevel;
  else if (rawLevel)
    warnings.push(`ACE_LOG_LEVEL=${JSON.stringify(rawLevel)} no vale; se usa "info"`);

  // --- Material de las claves (seguridad: aquí sí se falla al arrancar) ---
  const aceSeed = String(env.ACE_SEED || '').trim();
  let seedSource: AppConfig['security']['seedSource'];
  let keys: DerivedKeys;
  if (aceSeed) {
    if (aceSeed.length < MIN_SEED_LENGTH) {
      throw new ConfigError(
        `ACE_SEED es demasiado corto (${aceSeed.length} caracteres; mínimo ${MIN_SEED_LENGTH})`,
      );
    }
    seedSource = 'ACE_SEED';
    keys = deriveKeys(aceSeed);
  } else if (controlToken.length >= MIN_SEED_LENGTH) {
    seedSource = 'ENGINE_CONTROL_TOKEN';
    keys = deriveKeys(controlToken);
  } else {
    /* Sin secreto (desarrollo, tests): claves de este arranque. Las URLs de
       vídeo firmadas dejan de valer al reiniciar, que es lo seguro. */
    seedSource = 'ephemeral';
    keys = deriveKeys(ephemeralSeed());
    warnings.push(
      'sin ACE_SEED ni ENGINE_CONTROL_TOKEN válidos: claves aleatorias de este arranque',
    );
  }

  const config: AppConfig = {
    appVersion: resolveVersion(env),
    host: '0.0.0.0',
    /* Como server.js:5158: `Number(PORT) || 3000`, sin comprobar el rango. */
    port: Number(env.PORT) || DEFAULTS.port,
    logLevel,
    dataDir,
    paths: {
      stateFile,
      stateBackupFile: `${stateFile}.bak`,
      stateTmpFile: `${stateFile}.tmp`,
      statePreMigrationFile: path.join(dataDir, 'state.pre-0.7.0.json'),
      remuxDir: path.join(dataDir, 'remux'),
      v2Dir,
      devicesFile: path.join(v2Dir, 'devices.json'),
      settingsFile: path.join(v2Dir, 'settings.json'),
      sessionsFile: path.join(v2Dir, 'sessions.json'),
      diagnosticsFile: path.join(v2Dir, 'diagnostics.jsonl'),
      teamsDir: path.join(v2Dir, 'teams'),
      iptvFile: path.join(dataDir, V2_FILES.iptv),
      iptvDir: path.join(dataDir, V2_FILES.iptvDir),
      iptvCatalogFile: path.join(dataDir, V2_FILES.iptvCatalog),
      iptvGuideFile: path.join(dataDir, V2_FILES.iptvGuide),
      iptvKeyFile: path.join(dataDir, V2_FILES.iptvKey),
    },
    engine: {
      host: sanitizeHost(env.ACESTREAM_HOST, DEFAULTS.acestreamHost),
      port: ENGINE_PORT,
      controlHost: sanitizeHost(env.ENGINE_CONTROL_HOST, DEFAULTS.engineControlHost),
      controlPort: ENGINE_CONTROL_PORT,
      controlToken,
    },
    scanner: {
      host: scannerHost,
      enabled: scannerHost !== '',
      port: intVar('ACESTREAM_SCANNER_PORT', 1, 65_535, 6878),
      probeTimeoutMs: intVar('ACESTREAM_SCANNER_TIMEOUT_MS', 6000, 30_000, 24_000),
      sampleBytes: intVar('ACESTREAM_SCANNER_SAMPLE_BYTES', 32 * 1024, 1024 * 1024, 128 * 1024),
      mediaProbeMs: intVar('ACESTREAM_SCANNER_MEDIA_PROBE_MS', 2500, 12_000, 7000),
      retryDelayMs,
      sustainMs: intVar('ACESTREAM_SCANNER_SUSTAIN_MS', 4000, 15_000, 12_000),
      jobTtlMs: retryDelayMs + 15 * 60 * 1000,
      badTtlMs: retryDelayMs,
    },
    sync: {
      autoSync: env.AUTO_SYNC !== 'false',
      defaultWebSyncUrl: env.DEFAULT_WEB_SYNC_URL || DEFAULTS.defaultWebSyncUrl,
      allowPrivateUrls: env.ALLOW_PRIVATE_SYNC_URLS === 'true',
      ipfsDelegatedRouting: env.IPFS_DELEGATED_ROUTING || DEFAULTS.ipfsDelegatedRouting,
      ipfsTrustlessGateway: env.IPFS_TRUSTLESS_GATEWAY || DEFAULTS.ipfsTrustlessGateway,
    },
    football: {
      apiKey:
        String(env.THESPORTSDB_API_KEY || DEFAULTS.footballApiKey)
          .trim()
          .replace(/[^a-zA-Z0-9_-]/g, '')
          .slice(0, 80) || DEFAULTS.footballApiKey,
      country:
        String(env.FOOTBALL_COUNTRY || DEFAULTS.footballCountry)
          .replace(/[^a-zA-Z _-]/g, '')
          .trim()
          .slice(0, 40) || DEFAULTS.footballCountry,
      days: intVar('FOOTBALL_DAYS', 3, 14, 7),
      demoOnly: env.FOOTBALL_DEMO_ONLY === 'true',
      timezone: 'Europe/Madrid',
    },
    teams: {
      enabled: env.FOOTBALL_DEMO_ONLY !== 'true' && env.ACE_TEAM_CRESTS !== 'false',
    },
    ai: {
      ollamaBaseUrl,
      embedModel,
      timeoutMs: intVar('OLLAMA_TIMEOUT_MS', 1500, 15_000, 6500),
      enabled: ollamaConfigured(ollamaBaseUrl, embedModel),
    },
    playback: { sameChannelPolicy },
    security: { seedSource, keys },
  };

  return { config: deepFreeze(config), warnings };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Buffer.isBuffer(value) && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
