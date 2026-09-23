/* TanStack Query para todo lo que viene de /api/v1 (arquitectura §9).

   Claves por ruta: ['v1', <id de ruta>, params, query]. Así se invalida una
   ruta entera con invalidateRoute('libraryGet') (el SSE lo hace solo al
   llegar `state.changed`) o una consulta concreta con su clave.

     const agenda = useApiQuery('footballSchedule');
     const scan = useApiQuery('footballScan', { params: { id } }, { enabled: !!id });
     const fav = useApiMutation('libraryMutate');
     fav.mutate({ body: { action: 'favorite-upsert', item } });

   Política por defecto:
   - Con el SSE abierto, los datos no caducan solos (los invalida el evento
     que toque) y no se vuelve a pedir nada al volver a la pestaña. Sin SSE,
     caducan a los 30 s y se refrescan al volver.
   - Reintentos solo de fallos que tiene sentido reintentar (sin red, plazo,
     5xx), dos veces con espera creciente. Un 4xx no se reintenta.
   - Cada consulta pasa su `signal` al cliente: si la vista que la pedía
     desaparece, la petición se cancela. */

import {
  QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  type QueryKey,
  type UseMutationOptions,
  type UseQueryOptions,
} from '@tanstack/react-query';
import { api, type ApiArgs, type ApiInput } from './client.ts';
import { isApiError } from './errors.ts';
import type { ApiResponse, JsonRouteId } from './routes.ts';
import { realtimeStore } from './realtime-store.ts';

export type RouteKey = readonly ['v1', JsonRouteId, unknown, unknown];

export function routeKey<Id extends JsonRouteId>(id: Id, input?: Partial<ApiInput<Id>>): RouteKey {
  const { params = null, query = null } = (input ?? {}) as { params?: unknown; query?: unknown };
  return ['v1', id, params, query] as const;
}

/** Prefijo para invalidar todas las consultas de una ruta. */
export function routePrefix(id: JsonRouteId): QueryKey {
  return ['v1', id];
}

const realtimeOpen = () => realtimeStore.get().status === 'open';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: () => (realtimeOpen() ? Number.POSITIVE_INFINITY : 30_000),
        gcTime: 5 * 60_000,
        refetchOnWindowFocus: () => !realtimeOpen(),
        refetchOnReconnect: true,
        retry: (count, error) => count < 2 && (!isApiError(error) || error.retryable),
        retryDelay: (attempt) => Math.min(8_000, 1_000 * 2 ** attempt),
      },
      mutations: {
        retry: false,
      },
    },
  });
}

/** El cliente de la app (uno por pestaña). Los tests crean el suyo. */
export const queryClient = createQueryClient();

/** Opciones listas para useQuery / prefetchQuery / ensureQueryData. */
export function apiQuery<Id extends JsonRouteId>(id: Id, ...[input]: ApiArgs<Id>) {
  return queryOptions({
    queryKey: routeKey(id, input as Partial<ApiInput<Id>> | undefined),
    queryFn: ({ signal }) => api(id, ...([{ ...(input ?? {}), signal }] as unknown as ApiArgs<Id>)),
  });
}

type QueryExtras<Id extends JsonRouteId, TData> = Omit<
  UseQueryOptions<ApiResponse<Id>, Error, TData, RouteKey>,
  'queryKey' | 'queryFn'
>;

export function useApiQuery<Id extends JsonRouteId, TData = ApiResponse<Id>>(
  id: Id,
  input?: ApiInput<Id>,
  options?: QueryExtras<Id, TData>,
) {
  return useQuery({
    ...(apiQuery(id, ...([input] as ApiArgs<Id>)) as unknown as UseQueryOptions<
      ApiResponse<Id>,
      Error,
      TData,
      RouteKey
    >),
    ...options,
  });
}

export function useApiMutation<Id extends JsonRouteId, TContext = unknown>(
  id: Id,
  options?: Omit<UseMutationOptions<ApiResponse<Id>, Error, ApiInput<Id>, TContext>, 'mutationFn'>,
) {
  return useMutation<ApiResponse<Id>, Error, ApiInput<Id>, TContext>({
    mutationFn: (input) => api(id, ...([input] as ApiArgs<Id>)),
    ...options,
  });
}

export function invalidateRoute(id: JsonRouteId, client: QueryClient = queryClient): Promise<void> {
  return client.invalidateQueries({ queryKey: routePrefix(id) });
}
