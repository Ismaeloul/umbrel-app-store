/* Normalizadores de state.json portados TAL CUAL de la 0.6.59
   (backend-modulos §2.2-2.3 y §3.3). Son la "lectura tolerante": aceptan
   cualquier JSON y devuelven la forma v1 normalizada que describe
   @ace/shared/state/v1.ts. Mismas entradas, mismas salidas, mismos topes.

   Única diferencia con server.js: lo que allí salía del entorno o del reloj
   real (`DEFAULT_WEB_SYNC_URL`, `FOOTBALL_COUNTRY`, `new Date()`,
   `crypto.randomBytes`) llega aquí en un `NormalizeContext`, para que los
   tests usen FakeClock y el servicio su configuración. */

import {
  DEFAULT_WEB_SOURCE_ID,
  MAX_CHANNEL_BINDINGS,
  MAX_CHANNEL_FEEDBACK,
  MAX_FOOTBALL_LEAGUES,
  MAX_FOOTBALL_NATIONALITIES,
  MAX_FOOTBALL_TEAMS,
  MAX_HISTORY,
  MAX_SOURCE_REPORTS,
  MAX_WEB_SOURCES,
  MAX_WEB_STREAMS,
  STATS_MAX_KEYS,
  cleanTitle,
  normalizeChannelKey,
  normalizeHash,
  type ChannelBinding,
  type ChannelFeedback,
  type Item,
  type NowPlaying,
  type Preferences,
  type SourceReport,
  type SourceReportReason,
  type SourceReportState,
  type SourceStatEntry,
  type SourceStats,
  type StateV1,
  type WebSource,
  type WebSourceSummary,
} from '@ace/shared';

/** Lo que server.js leía del entorno, del reloj o del azar. */
export interface NormalizeContext {
  /** `new Date().toISOString()`. */
  nowIso(): string;
  /** `DEFAULT_WEB_SYNC_URL` (config.sync.defaultWebSyncUrl). */
  readonly defaultWebSyncUrl: string;
  /** `FOOTBALL_COUNTRY` (config.football.country): defecto de `preferences.country`. */
  readonly footballCountry: string;
  /** `crypto.randomBytes(n).toString("hex")`. */
  randomHex(bytes: number): string;
}

type Loose = Record<string, unknown>;

/* `value?.key` de JS: undefined si el valor es null/undefined; si no, la
   propiedad (también en primitivos, que no tienen ninguna de las nuestras). */
export function field(value: unknown, key: string): unknown {
  if (value === null || value === undefined) return undefined;
  return (Object(value) as Loose)[key];
}

/* `{ ...value, extra }` de JS, que acepta cualquier cosa (un null no aporta
   nada y una cadena aporta sus índices). */
function spread(value: unknown, extra: Loose): Loose {
  return { ...(value as object), ...extra };
}

/* `Number.parseInt(value, 10)` de JS, que convierte con ToString. */
function parseIntLoose(value: unknown): number {
  return Number.parseInt(String(value), 10);
}

// --- Item (server.js:436-470) ---

export const ITEM_TYPES = ['fav', 'recent', 'web'] as const;
type ItemType = Item['type'];

/** `normalizeItem` (server.js:436-457): elemento de biblioteca o null si no hay hash. */
export function normalizeItem(
  item: unknown,
  fallbackType: ItemType = 'recent',
  ctx: NormalizeContext,
): Item | null {
  const id = normalizeHash(field(item, 'id') || field(item, 'hash') || field(item, 'url'));
  if (!id) return null;
  const title = String(field(item, 'title') || field(item, 'name') || `Stream ${id.slice(0, 8)}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  const rawType = field(item, 'type');
  const type: ItemType = (ITEM_TYPES as readonly unknown[]).includes(rawType)
    ? (rawType as ItemType)
    : fallbackType;
  const category = String(field(item, 'category') || (type === 'web' ? 'Importado' : 'General'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);
  const rawDate = field(item, 'date');
  const date =
    typeof rawDate === 'string' && Number.isFinite(Date.parse(rawDate))
      ? new Date(rawDate).toISOString()
      : ctx.nowIso();
  // nombre canónico del canal (tvg-id del M3U); solo se usa para emparejar
  const alias = String(field(item, 'alias') || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return {
    id,
    title,
    ...(alias && alias !== title ? { alias } : {}),
    type,
    category,
    date,
    fromWebSync: field(item, 'fromWebSync') === true,
    // true si el id es un infohash (resultados del buscador): se reproduce con ?infohash=
    ih: field(item, 'ih') === true,
  };
}

/** `normalizeItems` (server.js:459-470): fuerza el tipo de la lista, sin repetidos y con tope. */
export function normalizeItems(
  items: unknown,
  type: ItemType,
  max: number,
  ctx: NormalizeContext,
): Item[] {
  const output: Item[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(items) ? (items as unknown[]) : []) {
    const normalized = normalizeItem(spread(item, { type }), type, ctx);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    output.push(normalized);
    if (output.length >= max) break;
  }
  return output;
}

// --- Preferencias (server.js:472-494) ---

/** `normalizePreferenceList` (server.js:472-484): cleanTitle, tope y sin repetidos (sin tildes ni mayúsculas). */
export function normalizePreferenceList(values: unknown, max: number, maxLength: number): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(values) ? (values as unknown[]) : []) {
    const value = cleanTitle(raw, '').slice(0, maxLength);
    const key = value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    output.push(value);
    if (output.length >= max) break;
  }
  return output;
}

/** `normalizePreferences` (server.js:486-494). */
export function normalizePreferences(value: unknown, ctx: NormalizeContext): Preferences {
  return {
    onboardingComplete: field(value, 'onboardingComplete') === true,
    country: cleanTitle(field(value, 'country'), ctx.footballCountry).slice(0, 40),
    leagues: normalizePreferenceList(field(value, 'leagues'), MAX_FOOTBALL_LEAGUES, 60),
    teams: normalizePreferenceList(field(value, 'teams'), MAX_FOOTBALL_TEAMS, 80),
    nationalities: normalizePreferenceList(
      field(value, 'nationalities'),
      MAX_FOOTBALL_NATIONALITIES,
      60,
    ),
  };
}

// --- Vínculos partido-canal (server.js:839-866) ---

/** `normalizeChannelBinding` (server.js:839-853). */
export function normalizeChannelBinding(
  value: unknown,
  ctx: NormalizeContext,
): ChannelBinding | null {
  const channel = cleanTitle(field(value, 'channel'), '');
  const channelKey = normalizeChannelKey(channel);
  const id = normalizeHash(field(value, 'id'));
  if (!channel || !channelKey || !id) return null;
  const updatedAt = field(value, 'updatedAt');
  return {
    channel,
    channelKey,
    id,
    title: cleanTitle(field(value, 'title'), channel),
    ih: field(value, 'ih') === true,
    updatedAt:
      typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt))
        ? new Date(updatedAt).toISOString()
        : ctx.nowIso(),
  };
}

/** `normalizeChannelBindings` (server.js:855-866): uno por `channelKey`, 120 como mucho. */
export function normalizeChannelBindings(values: unknown, ctx: NormalizeContext): ChannelBinding[] {
  const output: ChannelBinding[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(values) ? (values as unknown[]) : []) {
    const binding = normalizeChannelBinding(raw, ctx);
    if (!binding || seen.has(binding.channelKey)) continue;
    seen.add(binding.channelKey);
    output.push(binding);
    if (output.length >= MAX_CHANNEL_BINDINGS) break;
  }
  return output;
}

// --- Directorios (server.js:868-952) ---

/** `normalizeWebUrl` (server.js:868-878): http(s) sin usuario ni contraseña, o "". */
export function normalizeWebUrl(value: unknown): string {
  try {
    const parsed = new URL(String(value || '').trim());
    if (!['http:', 'https:'].includes(parsed.protocol)) return '';
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return '';
  }
}

/** `normalizeSourceRenames` (server.js:880-891). */
export function normalizeSourceRenames(value: unknown): Record<string, string> {
  const output: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [rawId, rawTitle] of Object.entries(value as Loose)) {
    const id = normalizeHash(rawId);
    const title = cleanTitle(rawTitle, '');
    if (!id || !title) continue;
    output[id] = title;
    if (Object.keys(output).length >= MAX_WEB_STREAMS) break;
  }
  return output;
}

/** `normalizeHiddenHashes` (server.js:893-904). */
export function normalizeHiddenHashes(value: unknown): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const rawId of Array.isArray(value) ? (value as unknown[]) : []) {
    const id = normalizeHash(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(id);
    if (output.length >= MAX_WEB_STREAMS) break;
  }
  return output;
}

/** `applySourceOverrides` (server.js:906-911): quita ocultos y aplica renombres. */
export function applySourceOverrides(
  streams: readonly Item[],
  renames: Readonly<Record<string, string>>,
  hidden: readonly string[],
): Item[] {
  const hiddenIds = new Set(hidden);
  return streams
    .filter((stream) => !hiddenIds.has(stream.id))
    .map((stream) => {
      const renamed = Object.hasOwn(renames, stream.id) ? renames[stream.id] : undefined;
      return renamed ? { ...stream, title: renamed } : stream;
    });
}

/** `normalizeWebSource` (server.js:913-946): directorio o null si no tiene URL válida. */
export function normalizeWebSource(
  source: unknown,
  index = 0,
  fallbackStreams: unknown = [],
  fallbackSyncedAt: unknown = null,
  ctx: NormalizeContext,
): WebSource | null {
  const url = normalizeWebUrl(field(source, 'url') || (index === 0 ? ctx.defaultWebSyncUrl : ''));
  if (!url) return null;
  const type = field(source, 'type') === 'html' ? 'html' : 'm3u';
  let id = String(field(source, 'id') || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 48);
  if (!id) id = index === 0 ? DEFAULT_WEB_SOURCE_ID : `directorio-${index + 1}`;
  let fallbackName = `Directorio ${index + 1}`;
  try {
    fallbackName = new URL(url).hostname.replace(/^www\./, '') || fallbackName;
  } catch {}
  const name =
    String(field(source, 'name') || fallbackName)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 60) || fallbackName;
  const renames = normalizeSourceRenames(field(source, 'renames'));
  const hidden = normalizeHiddenHashes(field(source, 'hidden'));
  const streams = applySourceOverrides(
    normalizeItems(field(source, 'streams') || fallbackStreams, 'web', MAX_WEB_STREAMS, ctx),
    renames,
    hidden,
  );
  const syncedAt = field(source, 'syncedAt');
  const lastErrorAt = field(source, 'lastErrorAt');
  const lastError = field(source, 'lastError');
  return {
    id,
    name,
    url,
    type,
    streams,
    renames,
    hidden,
    syncedAt:
      typeof syncedAt === 'string'
        ? syncedAt
        : typeof fallbackSyncedAt === 'string'
          ? fallbackSyncedAt
          : null,
    lastErrorAt: typeof lastErrorAt === 'string' ? lastErrorAt : null,
    // motivo corto del último fallo ("http_429", "fetch_timeout"...)
    lastError:
      typeof lastError === 'string'
        ? lastError
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '')
            .slice(0, 40) || null
        : null,
  };
}

/** `sourceSummaries` (server.js:948-952): sin streams, renombres ni ocultos. */
export function sourceSummaries(sources: readonly WebSource[]): WebSourceSummary[] {
  return sources.map(({ id, name, url, type, streams, syncedAt, lastErrorAt, lastError }) => ({
    id,
    name,
    url,
    type,
    count: streams.length,
    syncedAt,
    lastErrorAt,
    lastError: lastErrorAt ? lastError : null,
  }));
}

// --- Mando (server.js:975-987) ---

/** `normalizeNowPlaying` (server.js:975-987): null si falta el hash o `at`. */
export function normalizeNowPlaying(np: unknown): NowPlaying | null {
  if (!np || typeof np !== 'object') return null;
  const value = np as Loose;
  const id = normalizeHash(value.id);
  const at = Number(value.at) || 0;
  if (!id || !at) return null;
  return {
    id,
    title: String(value.title || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120),
    dev: String(value.dev || '')
      .trim()
      .slice(0, 40),
    token: String(value.token || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 64),
    at,
  };
}

// --- Informes y correcciones (server.js:2579-2662) ---

/** `SOURCE_REPORT_REASONS` (server.js:2579-2581). */
export const SOURCE_REPORT_REASON_SET: ReadonlySet<unknown> = new Set<SourceReportReason>([
  'not_starting',
  'stuttering',
  'wrong_channel',
  'bad_quality',
  'audio',
]);

const REPORT_STATES: readonly SourceReportState[] = [
  'reported',
  'checking',
  'working',
  'weak',
  'failed',
];

/** `validIso` (server.js:2583-2586). */
export function validIso(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;
}

/** `normalizeSourceReport` (server.js:2588-2615): motivo desconocido → `not_starting`. */
export function normalizeSourceReport(value: unknown, ctx: NormalizeContext): SourceReport | null {
  const id = normalizeHash(field(value, 'id'));
  if (!id) return null;
  const rawReason = field(value, 'reason');
  const reason = SOURCE_REPORT_REASON_SET.has(rawReason)
    ? (rawReason as SourceReportReason)
    : 'not_starting';
  const channel = cleanTitle(field(value, 'channel'), '');
  const channelKey = normalizeChannelKey(field(value, 'channelKey') || channel);
  const reportedAt = validIso(field(value, 'reportedAt'), ctx.nowIso()) as string;
  const rawState = field(value, 'state');
  const state = (REPORT_STATES as readonly unknown[]).includes(rawState)
    ? (rawState as SourceReportState)
    : 'reported';
  return {
    reportId: String(field(value, 'reportId') || ctx.randomHex(8))
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 40),
    id,
    title: cleanTitle(field(value, 'title'), `Stream ${id.slice(0, 8)}`),
    ih: field(value, 'ih') === true,
    source: cleanTitle(field(value, 'source'), '').slice(0, 30),
    channel,
    channelKey,
    matchId: String(field(value, 'matchId') || '')
      .trim()
      .replace(/[^a-zA-Z0-9_.:-]/g, '')
      .slice(0, 100),
    reason,
    state,
    checkReason: String(field(value, 'checkReason') || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, 40),
    reportCount: Math.min(999, Math.max(1, parseIntLoose(field(value, 'reportCount')) || 1)),
    reportedAt,
    lastCheckedAt: validIso(field(value, 'lastCheckedAt')),
    quarantineUntil: validIso(field(value, 'quarantineUntil')),
  };
}

/** `normalizeSourceReports` (server.js:2617-2630): uno por `id:channelKey:reason`, 300 como mucho. */
export function normalizeSourceReports(values: unknown, ctx: NormalizeContext): SourceReport[] {
  const output: SourceReport[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(values) ? (values as unknown[]) : []) {
    const report = normalizeSourceReport(raw, ctx);
    if (!report) continue;
    const key = `${report.id}:${report.channelKey}:${report.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(report);
    if (output.length >= MAX_SOURCE_REPORTS) break;
  }
  return output;
}

/** `normalizeChannelFeedback` (server.js:2632-2649). */
export function normalizeChannelFeedback(
  value: unknown,
  ctx: NormalizeContext,
): ChannelFeedback | null {
  const id = normalizeHash(field(value, 'id'));
  const channel = cleanTitle(field(value, 'channel'), '');
  const channelKey = normalizeChannelKey(field(value, 'channelKey') || channel);
  const rawVerdict = field(value, 'verdict');
  const verdict =
    rawVerdict === 'correct' ? 'correct' : rawVerdict === 'incorrect' ? 'incorrect' : '';
  if (!id || !channelKey || !verdict) return null;
  const rawReason = field(value, 'reason');
  return {
    id,
    title: cleanTitle(field(value, 'title'), `Stream ${id.slice(0, 8)}`),
    channel: channel || cleanTitle(field(value, 'channelKey'), 'Canal'),
    channelKey,
    verdict,
    reason: SOURCE_REPORT_REASON_SET.has(rawReason)
      ? (rawReason as SourceReportReason)
      : 'wrong_channel',
    corrections: Math.min(999, Math.max(1, parseIntLoose(field(value, 'corrections')) || 1)),
    updatedAt: validIso(field(value, 'updatedAt'), ctx.nowIso()) as string,
  };
}

/** `normalizeChannelFeedbacks` (server.js:2651-2662): uno por `id:channelKey`, 300 como mucho. */
export function normalizeChannelFeedbacks(
  values: unknown,
  ctx: NormalizeContext,
): ChannelFeedback[] {
  const output: ChannelFeedback[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(values) ? (values as unknown[]) : []) {
    const feedback = normalizeChannelFeedback(raw, ctx);
    if (!feedback) continue;
    const key = `${feedback.id}:${feedback.channelKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(feedback);
    if (output.length >= MAX_CHANNEL_FEEDBACK) break;
  }
  return output;
}

// --- Estadísticas (server.js:3833-3873) ---

/** `statsVacias` (server.js:3837-3839). */
export function statsVacias(): SourceStatEntry {
  return { intentos: 0, exitos: 0, caidas: 0, segundos: 0, ultimo: 0 };
}

/** `normalizeSourceStatEntry` (server.js:3841-3853): números >= 0 con tope; DECIMALES permitidos. */
export function normalizeSourceStatEntry(value: unknown): SourceStatEntry {
  const numero = (raw: unknown, tope: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.min(n, tope) : 0;
  };
  return {
    intentos: numero(field(value, 'intentos'), 100000),
    exitos: numero(field(value, 'exitos'), 100000),
    caidas: numero(field(value, 'caidas'), 100000),
    segundos: numero(field(value, 'segundos'), 100000000),
    ultimo: numero(field(value, 'ultimo'), Number.MAX_SAFE_INTEGER),
  };
}

/** `normalizeSourceStatsGroup` (server.js:3855-3866): las 600 más recientes; 0 intentos se borra. */
export function normalizeSourceStatsGroup(value: unknown): Record<string, SourceStatEntry> {
  const salida: Record<string, SourceStatEntry> = {};
  const entradas = value && typeof value === 'object' ? Object.entries(value as Loose) : [];
  // se conservan las más recientes: la memoria no puede crecer sin tope
  const ordenadas = entradas
    .map(([clave, stat]) => [String(clave).slice(0, 120), normalizeSourceStatEntry(stat)] as const)
    .filter(([clave, stat]) => clave && stat.intentos > 0)
    .sort((a, b) => b[1].ultimo - a[1].ultimo)
    .slice(0, STATS_MAX_KEYS);
  for (const [clave, stat] of ordenadas) salida[clave] = stat;
  return salida;
}

/** `normalizeSourceStats` (server.js:3868-3873): `{hashes: {}, proveedores: {}}` si no hay nada. */
export function normalizeSourceStats(value: unknown): SourceStats {
  return {
    hashes: normalizeSourceStatsGroup(field(value, 'hashes')),
    proveedores: normalizeSourceStatsGroup(field(value, 'proveedores')),
  };
}

// --- El estado entero (server.js:1017-1102) ---

/** Nombre del directorio que se crea si no hay ninguno (server.js:1025-1030). */
export const DEFAULT_WEB_SOURCE_NAME = 'Directorio principal';

/**
 * Lo que hacen `readState` (server.js:1019-1055) y `writeState`
 * (server.js:1068-1102) con el objeto: normalizar las 12 claves, con la
 * migración antigua de `web`/`webSyncedAt` sin `webSources` a un directorio
 * `principal`. Todo lo que no sea una de las 12 claves se ignora aquí (el
 * servicio lo guarda aparte y lo deja donde estaba).
 *
 * Diferencia a propósito: si no queda NINGÚN directorio válido (solo pasa
 * con un `DEFAULT_WEB_SYNC_URL` que no es http/https), la 0.6.59 lanzaba
 * dentro del `try` y devolvía el estado vacío, perdiendo favoritos e
 * historial en la siguiente escritura. Aquí se conservan y los directorios
 * quedan vacíos, como en su `catch` (activeWebSourceId null).
 */
export function normalizeStateV1(parsed: unknown, ctx: NormalizeContext): StateV1 {
  const legacyWeb = normalizeItems(field(parsed, 'web'), 'web', MAX_WEB_STREAMS, ctx);
  const rawSources = field(parsed, 'webSources');
  let webSources = Array.isArray(rawSources)
    ? (rawSources as unknown[])
        .map((source, index) => normalizeWebSource(source, index, [], null, ctx))
        .filter((source): source is WebSource => source !== null)
        .slice(0, MAX_WEB_SOURCES)
    : [];
  if (!webSources.length) {
    webSources = [
      normalizeWebSource(
        {
          id: DEFAULT_WEB_SOURCE_ID,
          name: DEFAULT_WEB_SOURCE_NAME,
          url: ctx.defaultWebSyncUrl,
          type: 'm3u',
        },
        0,
        legacyWeb,
        field(parsed, 'webSyncedAt'),
        ctx,
      ),
    ].filter((source): source is WebSource => source !== null);
  }
  const ids = new Set<string>();
  webSources = webSources.filter((source) => {
    if (ids.has(source.id)) return false;
    ids.add(source.id);
    return true;
  });
  const requestedActive = field(parsed, 'activeWebSourceId');
  const activeWebSourceId = webSources.some((source) => source.id === requestedActive)
    ? (requestedActive as string)
    : (webSources[0]?.id ?? null);
  const activeSource =
    webSources.find((source) => source.id === activeWebSourceId) ?? webSources[0] ?? null;
  return {
    favorites: normalizeItems(field(parsed, 'favorites'), 'fav', MAX_HISTORY, ctx),
    history: normalizeItems(field(parsed, 'history'), 'recent', MAX_HISTORY, ctx),
    web: activeSource ? activeSource.streams : [],
    webSyncedAt: activeSource ? activeSource.syncedAt : null,
    webSources,
    /* null solo en el caso sin directorios (ver arriba), como el `catch` de la 0.6.59. */
    activeWebSourceId: activeWebSourceId as string,
    preferences: normalizePreferences(field(parsed, 'preferences'), ctx),
    channelBindings: normalizeChannelBindings(field(parsed, 'channelBindings'), ctx),
    sourceReports: normalizeSourceReports(field(parsed, 'sourceReports'), ctx),
    channelFeedback: normalizeChannelFeedbacks(field(parsed, 'channelFeedback'), ctx),
    sourceStats: normalizeSourceStats(field(parsed, 'sourceStats')),
    nowPlaying: normalizeNowPlaying(field(parsed, 'nowPlaying')),
  };
}

/** Estado de una instalación nueva (o si no se puede leer nada): el `catch` de readState (server.js:1056-1065). */
export function defaultStateV1(ctx: NormalizeContext): StateV1 {
  return normalizeStateV1({}, ctx);
}
