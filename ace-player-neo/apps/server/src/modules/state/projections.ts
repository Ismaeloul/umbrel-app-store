/* Proyecciones públicas del estado (api.md §3.3 y §3.11; backend-modulos
   §2.9). Las antiguas conservan la forma EXACTA de la 0.6.59, rarezas
   incluidas (`web` y `streams` duplicados, `publicState` sin `success`); las
   v1 son las de @ace/shared/api/v1/library.ts. */

import type { LegacyDirectoryResponse, LegacyPublicState, LibraryView, StateV1 } from '@ace/shared';
import { sourceSummaries } from './normalize.js';

/** `publicState` (server.js:954-961): todo menos `channelFeedback`, más `learningCount`. */
export function publicState(state: Readonly<StateV1>): LegacyPublicState {
  return {
    favorites: state.favorites,
    history: state.history,
    web: state.web,
    webSyncedAt: state.webSyncedAt,
    webSources: sourceSummaries(state.webSources),
    activeWebSourceId: state.activeWebSourceId,
    preferences: state.preferences,
    channelBindings: state.channelBindings,
    sourceReports: state.sourceReports,
    sourceStats: state.sourceStats,
    nowPlaying: state.nowPlaying,
    learningCount: state.channelFeedback.length,
  };
}

/** `directoryResponse` (server.js:963-972): `web` y `streams` son el mismo array. */
export function directoryResponse(state: Readonly<StateV1>): LegacyDirectoryResponse {
  return {
    success: true,
    web: state.web,
    streams: state.web,
    webSyncedAt: state.webSyncedAt,
    webSources: sourceSummaries(state.webSources),
    activeWebSourceId: state.activeWebSourceId,
  };
}

export type LegacyLibraryCollection = 'favorites' | 'history' | 'web';

export type LegacyLibraryResponse =
  | { readonly success: true; readonly favorites: StateV1['favorites'] }
  | { readonly success: true; readonly history: StateV1['history'] }
  | LegacyDirectoryResponse;

/** `libraryResponse` (server.js:1111-1115): la colección tocada. */
export function libraryResponse(
  state: Readonly<StateV1>,
  collection: LegacyLibraryCollection | string,
): LegacyLibraryResponse {
  if (collection === 'favorites') return { success: true, favorites: state.favorites };
  if (collection === 'history') return { success: true, history: state.history };
  return directoryResponse(state);
}

/** GET /api/v1/library: favoritos, recientes y el directorio activo, sin `success` ni `streams`. */
export function libraryView(state: Readonly<StateV1>): LibraryView {
  return {
    web: state.web,
    webSyncedAt: state.webSyncedAt,
    webSources: sourceSummaries(state.webSources),
    activeWebSourceId: state.activeWebSourceId,
    favorites: state.favorites,
    history: state.history,
  };
}
