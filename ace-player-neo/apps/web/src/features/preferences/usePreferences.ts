/* Leer y guardar las preferencias de fútbol. Las lee la agenda (para «Para
   ti» y la tarjeta de primer uso) y Ajustes (el resumen): las dos comparten
   la consulta `preferencesGet`, que el arranque ya siembra desde
   /api/v1/bootstrap y que el SSE invalida (`state.changed` → preferences). */

import type { Preferences } from '@ace/shared';
import { useQueryClient } from '@tanstack/react-query';
import { routeKey, useApiMutation, useApiQuery, type ApiResponse } from '../../api/index.ts';

export function usePreferences(): {
  preferences: Preferences | null;
  isPending: boolean;
  isError: boolean;
} {
  const query = useApiQuery('preferencesGet');
  return {
    preferences: query.data?.preferences ?? null,
    isPending: query.isPending,
    isError: query.isError,
  };
}

/**
 * PUT /api/v1/preferences. Al volver, la caché se actualiza sin esperar al
 * SSE (el otro dispositivo lo recibirá por `state.changed`).
 */
export function useSavePreferences() {
  const client = useQueryClient();
  return useApiMutation('preferencesUpdate', {
    onSuccess: (data) => {
      client.setQueryData(routeKey('preferencesGet'), data);
      client.setQueryData<ApiResponse<'bootstrap'>>(routeKey('bootstrap'), (old) =>
        old ? { ...old, preferences: data.preferences } : old,
      );
    },
  });
}
