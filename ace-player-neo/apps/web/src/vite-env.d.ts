/// <reference types="vite/client" />

/* Tabla de rutas v1 sin esquemas (la genera build/plugins.ts desde
   @ace/shared/routes.ts en cada arranque de Vite). */
declare module 'virtual:ace-routes' {
  import type { RouteContent, V1Method, V1RouteId } from '@ace/shared';

  export interface LightRoute {
    readonly method: V1Method;
    readonly path: string;
    readonly content: RouteContent;
    readonly sideEffects: boolean;
  }

  export const ROUTES: Readonly<Record<V1RouteId, LightRoute>>;
}

interface ImportMetaEnv {
  /** Backend del servidor de desarrollo (vite.config.ts). */
  readonly VITE_BACKEND?: string;
}
