/* Capa de datos de la web: lo que usan las vistas. */

export {
  api,
  setFetch,
  timeoutFor,
  type ApiArgs,
  type ApiInput,
  type RequestOptions,
} from './client.ts';
export {
  ApiError,
  CLIENT_ERRORS,
  describeFailure,
  isAbortError,
  isApiError,
  messageFor,
} from './errors.ts';
export {
  registerDemoHandler,
  registerDemoHandlers,
  type DemoHandler,
  type DemoHandlers,
  type DemoRequest,
} from './demo-registry.ts';
export { getDeviceId, getViewerId, isForThisViewer } from './identity.ts';
export { isDemo, useAppMode, whenModeReady, type AppMode } from './mode.ts';
export {
  apiQuery,
  createQueryClient,
  invalidateRoute,
  queryClient,
  routeKey,
  routePrefix,
  useApiMutation,
  useApiQuery,
  type RouteKey,
} from './query.ts';
export { useRealtimeStatus, type RealtimeStatus } from './realtime-store.ts';
export {
  buildPath,
  buildQuery,
  routeOf,
  routeUrl,
  type ApiBody,
  type ApiParams,
  type ApiQuery,
  type ApiResponse,
  type ApiRouteId,
  type JsonRouteId,
} from './routes.ts';
export { onSseEvent, useSseEvent } from './sse.ts';
export {
  summarizeEngine,
  useBootstrap,
  useEngineStatus,
  useEngineSummary,
  type EngineSummary,
} from './hooks.ts';
