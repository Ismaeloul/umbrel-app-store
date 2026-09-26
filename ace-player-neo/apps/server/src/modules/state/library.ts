/* Biblioteca y preferencias: las mutaciones de la 0.6.59 escritas como
   cambios sobre un BORRADOR del estado (el que da `enqueue`). La cola
   normaliza el borrador entero después, igual que `writeState`, así que aquí
   solo se porta la lógica de cada acción (server.js:1117-1175, 4458-4461 y
   4827-4851). Los errores son los mismos códigos, ahora como AppError. */

import { MAX_HISTORY, MAX_WEB_STREAMS, cleanTitle, normalizeHash, type StateV1 } from '@ace/shared';
import { AppError } from '../../core/errors.js';
import {
  field,
  normalizeItem,
  normalizeItems,
  normalizeNowPlaying,
  normalizePreferences,
  type NormalizeContext,
} from './normalize.js';
import type { LegacyLibraryCollection } from './projections.js';

/**
 * `mutateLibrary` (server.js:1123-1175) sobre el borrador: alta en favoritos
 * o recientes (primero y sin duplicado), renombrado o borrado. En el
 * directorio el renombre va a `renames` y el borrado a `hidden`, para que
 * sobrevivan a la siguiente sincronización (T-036). Devuelve la colección
 * tocada (la respuesta la arma `libraryResponse`).
 */
export function applyLibraryMutation(
  draft: StateV1,
  body: unknown,
  ctx: NormalizeContext,
): LegacyLibraryCollection {
  const action = String(field(body, 'action') || '');
  if (action === 'history-upsert' || action === 'favorite-upsert') {
    const collection = action === 'history-upsert' ? 'history' : 'favorites';
    const type = collection === 'history' ? 'recent' : 'fav';
    const item = normalizeItem({ ...(field(body, 'item') as object), type }, type, ctx);
    if (!item) throw new AppError('bad_request', { detail: 'elemento sin hash válido' });
    draft[collection] = [item, ...draft[collection].filter((entry) => entry.id !== item.id)].slice(
      0,
      MAX_HISTORY,
    );
    return collection;
  }

  if (!['rename', 'delete'].includes(action)) throw new AppError('bad_action');
  const collection = String(field(body, 'collection') || '');
  if (collection !== 'favorites' && collection !== 'history' && collection !== 'web') {
    throw new AppError('bad_collection');
  }
  const id = normalizeHash(field(body, 'id'));
  if (!id) throw new AppError('bad_request', { detail: 'id sin hash válido' });

  if (collection === 'web') {
    const sourceId = String(field(body, 'sourceId') || draft.activeWebSourceId || '');
    const source = draft.webSources.find((entry) => entry.id === sourceId);
    if (!source) throw new AppError('source_not_found');
    let updated: typeof source;
    if (action === 'rename') {
      const title = cleanTitle(field(body, 'title'), '');
      if (!title) throw new AppError('bad_title');
      updated = {
        ...source,
        renames: { ...source.renames, [id]: title },
        hidden: source.hidden.filter((entry) => entry !== id),
        streams: source.streams.map((entry) => (entry.id === id ? { ...entry, title } : entry)),
      };
    } else {
      updated = {
        ...source,
        hidden: [id, ...source.hidden.filter((entry) => entry !== id)].slice(0, MAX_WEB_STREAMS),
        streams: source.streams.filter((entry) => entry.id !== id),
      };
    }
    draft.webSources = draft.webSources.map((entry) => (entry.id === sourceId ? updated : entry));
    return 'web';
  }

  if (action === 'rename') {
    const title = cleanTitle(field(body, 'title'), '');
    if (!title) throw new AppError('bad_title');
    draft[collection] = draft[collection].map((entry) => {
      if (entry.id !== id) return entry;
      /* Un canal guardado desde el buscador IPTV conserva su nombre en la IPTV
         como `alias` al renombrarlo: es el que usa el re-emparejado
         (docs/iptv.md §14.6). Al guardarlo, el alias igual al título no se
         guarda (normalizeItem), así que aquí se recupera del título viejo. */
      const keepName =
        entry.category === 'IPTV' && !entry.alias && entry.title && entry.title !== title;
      return { ...entry, title, ...(keepName ? { alias: entry.title } : {}) };
    });
  } else {
    draft[collection] = draft[collection].filter((entry) => entry.id !== id);
  }
  return collection;
}

/** `mergeLegacyItems` (server.js:1117-1121): solo altas, delante; lo que ya estaba no cambia. */
export function mergeLegacyItems(
  incoming: unknown,
  current: StateV1['favorites'],
  type: 'fav' | 'recent',
  ctx: NormalizeContext,
): StateV1['favorites'] {
  const currentIds = new Set(current.map((item) => item.id));
  const additions = normalizeItems(incoming, type, MAX_HISTORY, ctx).filter(
    (item) => !currentIds.has(item.id),
  );
  return normalizeItems([...additions, ...current], type, MAX_HISTORY, ctx);
}

/**
 * PUT /api/state de los clientes 0.6.8 (server.js:4827-4851): fusiona
 * favoritos e historial SOLO con altas y acepta el mando. El resto del
 * cuerpo se ignora. Devuelve qué ámbitos ha tocado.
 */
export function applyLegacyPut(
  draft: StateV1,
  body: unknown,
  nowMs: number,
  ctx: NormalizeContext,
): { readonly nowPlaying: boolean } {
  /* La 0.6.59 hacía `body.favorites` sin `?.`: un cuerpo `null` era un
     TypeError y salía como 500 (api.md §4.2). Se conserva. */
  if (body === null || body === undefined) throw new TypeError('cuerpo nulo en PUT /api/state');
  const favorites = field(body, 'favorites');
  const history = field(body, 'history');
  if (Array.isArray(favorites)) {
    draft.favorites = mergeLegacyItems(favorites, draft.favorites, 'fav', ctx);
  }
  if (Array.isArray(history)) {
    draft.history = mergeLegacyItems(history, draft.history, 'recent', ctx);
  }
  const incoming = normalizeNowPlaying(field(body, 'nowPlaying'));
  if (incoming) {
    const current = draft.nowPlaying;
    const sameClaim = current?.id === incoming.id && current?.dev === incoming.dev;
    draft.nowPlaying = sameClaim
      ? current
      : { ...incoming, at: Math.max(nowMs, (Number(current?.at) || 0) + 1) };
    return { nowPlaying: true };
  }
  return { nowPlaying: false };
}

/** `updateFootballPreferences` (server.js:4458-4461): SUSTITUYE, no fusiona (api.md §6.7). */
export function applyPreferences(draft: StateV1, value: unknown, ctx: NormalizeContext): void {
  draft.preferences = normalizePreferences(value, ctx);
}
