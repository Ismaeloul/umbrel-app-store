/* Normalización de un directorio guardado, portada de server.js:436-469 y
   868-946 (`normalizeItem`, `normalizeItems`, `normalizeWebUrl`,
   `normalizeSourceRenames`, `normalizeHiddenHashes`, `applySourceOverrides`
   y `normalizeWebSource`).

   El módulo `state` vuelve a normalizar al guardar (`enqueue`); aquí se
   entrega ya normalizado para que el directorio que se escribe sea
   exactamente el de la 0.6.59 pase lo que pase en el otro lado (la
   normalización es idempotente). Lo único que cambia es de dónde sale la
   hora: el reloj inyectado. Contrato pedido: mover estas funciones a
   `@ace/shared/domain` para que `state` y `directories` compartan UNA. */

import {
  DEFAULT_WEB_SOURCE_ID,
  MAX_WEB_STREAMS,
  TEXT_LIMITS,
  cleanTitle,
  normalizeHash,
  type Item,
  type WebSource,
} from '@ace/shared';

/** `normalizeWebUrl` (server.js:868-878): solo http/https y sin usuario ni contraseña. */
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

type Loose = Record<string, unknown> | null | undefined;

/** `normalizeItem` (server.js:436-457) para los canales de un directorio. */
export function normalizeItem(item: Loose, fallbackType: Item['type'], now: Date): Item | null {
  const id = normalizeHash(item?.id || item?.hash || item?.url);
  if (!id) return null;
  const title = String(item?.title || item?.name || `Stream ${id.slice(0, 8)}`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_LIMITS.itemTitle);
  const rawType = item?.type;
  const type =
    rawType === 'fav' || rawType === 'recent' || rawType === 'web' ? rawType : fallbackType;
  const category = String(item?.category || (type === 'web' ? 'Importado' : 'General'))
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_LIMITS.itemCategory);
  const date =
    typeof item?.date === 'string' && Number.isFinite(Date.parse(item.date))
      ? new Date(item.date).toISOString()
      : now.toISOString();
  const alias = String(item?.alias || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_LIMITS.itemAlias);
  return {
    id,
    title,
    ...(alias && alias !== title ? { alias } : {}),
    type,
    category,
    date,
    fromWebSync: item?.fromWebSync === true,
    ih: item?.ih === true,
  };
}

/** `normalizeItems` (server.js:458-469): sin duplicados y como mucho `max`. */
export function normalizeItems(items: unknown, type: Item['type'], max: number, now: Date): Item[] {
  const output: Item[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(items) ? items : []) {
    const normalized = normalizeItem({ ...(item as Record<string, unknown>), type }, type, now);
    if (!normalized || seen.has(normalized.id)) continue;
    seen.add(normalized.id);
    output.push(normalized);
    if (output.length >= max) break;
  }
  return output;
}

/** `normalizeSourceRenames` (server.js:880-891). */
function normalizeSourceRenames(value: unknown): Record<string, string> {
  const output: Record<string, string> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return output;
  for (const [rawId, rawTitle] of Object.entries(value)) {
    const id = normalizeHash(rawId);
    const title = cleanTitle(rawTitle, '');
    if (!id || !title) continue;
    output[id] = title;
    if (Object.keys(output).length >= MAX_WEB_STREAMS) break;
  }
  return output;
}

/** `normalizeHiddenHashes` (server.js:893-904). */
function normalizeHiddenHashes(value: unknown): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const rawId of Array.isArray(value) ? value : []) {
    const id = normalizeHash(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    output.push(id);
    if (output.length >= MAX_WEB_STREAMS) break;
  }
  return output;
}

/** `applySourceOverrides` (server.js:906-911): renombres y ocultos sobre los canales. */
function applySourceOverrides(
  streams: Item[],
  renames: Record<string, string>,
  hidden: string[],
): Item[] {
  const hiddenIds = new Set(hidden);
  return streams
    .filter((stream) => !hiddenIds.has(stream.id))
    .map((stream) => (renames[stream.id] ? { ...stream, title: renames[stream.id]! } : stream));
}

/**
 * `normalizeWebSource` (server.js:913-946). `defaultUrl` es
 * `DEFAULT_WEB_SYNC_URL` (solo cuenta en la posición 0). Devuelve `null`
 * si la URL no vale.
 */
export function normalizeWebSource(
  source: Loose,
  index: number,
  context: { readonly defaultUrl: string; readonly now: Date },
): WebSource | null {
  const url = normalizeWebUrl(source?.url || (index === 0 ? context.defaultUrl : ''));
  if (!url) return null;
  const type = source?.type === 'html' ? 'html' : 'm3u';
  let id = String(source?.id || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, TEXT_LIMITS.webSourceId);
  if (!id) id = index === 0 ? DEFAULT_WEB_SOURCE_ID : `directorio-${index + 1}`;
  let fallbackName = `Directorio ${index + 1}`;
  try {
    fallbackName = new URL(url).hostname.replace(/^www\./, '') || fallbackName;
  } catch {}
  const name =
    String(source?.name || fallbackName)
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, TEXT_LIMITS.webSourceName) || fallbackName;
  const renames = normalizeSourceRenames(source?.renames);
  const hidden = normalizeHiddenHashes(source?.hidden);
  const streams = applySourceOverrides(
    normalizeItems(source?.streams, 'web', MAX_WEB_STREAMS, context.now),
    renames,
    hidden,
  );
  return {
    id,
    name,
    url,
    type,
    streams,
    renames,
    hidden,
    syncedAt: typeof source?.syncedAt === 'string' ? source.syncedAt : null,
    lastErrorAt: typeof source?.lastErrorAt === 'string' ? source.lastErrorAt : null,
    /* Motivo corto del último fallo ("http_429", "fetch_timeout"…) para que la
       tarjeta diga por qué, no solo que falló (server.js:940-944). */
    lastError:
      typeof source?.lastError === 'string'
        ? source.lastError
            .toLowerCase()
            .replace(/[^a-z0-9_]/g, '')
            .slice(0, TEXT_LIMITS.webSourceLastError) || null
        : null,
  };
}
