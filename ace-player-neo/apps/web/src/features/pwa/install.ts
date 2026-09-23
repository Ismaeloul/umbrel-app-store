/* PWA (inventario §16, arquitectura §9): service worker y aviso de versión
   nueva. Lo carga main.tsx con import() cuando la página ya ha cargado: no
   pesa en el JS inicial ni compite con el primer pintado.

   1. Service worker (el /sw.js que genera scripts/release.mjs):
      - solo en producción (en desarrollo Vite no sirve sw.js y un worker
        cacheando los módulos del servidor de desarrollo estorbaría);
      - solo en contexto seguro, como la 0.6.59 (index.html:6147): HTTPS o
        localhost. Por http:// de la LAN el navegador no deja registrarlo;
      - en localhost, antes se comprueba que /sw.js existe y es JavaScript:
        `vite preview` no lo tiene (lo añade la release) y el navegador se
        quejaría en la consola al recibir el index.html en su lugar;
      - si falla, la app funciona igual (sin caché del armazón).
   2. Versión nueva, por dos caminos, con un solo aviso:
      - el worker: sw.js hace skipWaiting + clients.claim, así que una release
        nueva toma el control sola (`controllerchange`). Se avisa solo si la
        página YA estaba controlada: la primera instalación no es «nueva». Si
        un día sw.js dejara de hacer skipWaiting, también se avisa con el
        worker nuevo esperando;
      - el servidor: funciona también por http:// (sin worker). La versión del
        backend al arrancar (bootstrap) es la de esta página (nginx sirve la
        web de la misma release). Si más tarde /api/v1/ping dice otra, se ha
        actualizado el Umbrel y esta pestaña tiene el JS viejo. Se pregunta al
        reconectar el SSE (una actualización reinicia el contenedor y el SSE
        vuelve con `resync`) y al volver a la pestaña tras 30 min oculta.
      El aviso es un toast con «Recargar»: recargar corta lo que suena, así
      que nunca se recarga solo. */

import type { QueryClient } from '@tanstack/react-query';
import { api, isDemo, onSseEvent, routeKey, whenModeReady } from '../../api/index.ts';
import { realtimeStore } from '../../api/realtime-store.ts';
import { createStore, useStore } from '../../lib/store.ts';
import { toast } from '../../notices/index.ts';

// ---- Aviso de versión nueva ------------------------------------------------------

export interface UpdateState {
  available: boolean;
  /** Versión del servidor, si se sabe. */
  version: string | null;
}

export const updateStore = createStore<UpdateState>({ available: false, version: null });

/** Para quien quiera enseñarlo en otro sitio (Ajustes → Acerca de, por ejemplo). */
export function useUpdateAvailable(): UpdateState {
  return useStore(updateStore);
}

export const UPDATE_TOAST_MS = 15_000;

let reload = () => globalThis.location.reload();

/** Solo para los tests. */
export function setReloadForTests(fn: (() => void) | null): void {
  reload = fn ?? (() => globalThis.location.reload());
}

/** Avisa UNA vez por versión (el worker y el servidor pueden decir lo mismo). */
export function announceUpdate(version: string | null = null): boolean {
  const current = updateStore.get();
  if (current.available) {
    // Ya avisado. Si ahora se sabe la versión, se apunta sin repetir el aviso.
    if (version !== null && current.version === null) {
      updateStore.set({ available: true, version });
      return false;
    }
    if (version === null || current.version === version) return false;
  }
  updateStore.set({ available: true, version: version ?? current.version });
  toast(
    version
      ? `Hay una versión nueva de Ace Player Neo (${version}). Recarga para usarla.`
      : 'Hay una versión nueva de Ace Player Neo. Recarga para usarla.',
    {
      tone: 'info',
      icon: 'subir',
      ms: UPDATE_TOAST_MS,
      action: { label: 'Recargar', onAction: () => reload() },
    },
  );
  return true;
}

// ---- Service worker --------------------------------------------------------------

export interface SwEnvironment {
  prod: boolean;
  isSecureContext: boolean;
  hostname: string;
  serviceWorker: ServiceWorkerContainer | undefined;
  fetch: typeof fetch;
}

export const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|::1)$/;

export type SwDecision = 'register' | 'probe' | 'skip';

/** ¿Se registra el worker aquí? */
export function swDecision(
  env: Pick<SwEnvironment, 'prod' | 'isSecureContext' | 'hostname' | 'serviceWorker'>,
): SwDecision {
  if (!env.prod || !env.serviceWorker || !env.isSecureContext) return 'skip';
  return LOCAL_HOST.test(env.hostname) ? 'probe' : 'register';
}

/** En localhost: ¿hay un /sw.js de verdad (JavaScript) o es el index.html de `vite preview`? */
export async function swAvailable(fetchImpl: typeof fetch): Promise<boolean> {
  try {
    const response = await fetchImpl('/sw.js', { method: 'HEAD', cache: 'no-store' });
    return response.ok && /javascript/i.test(response.headers.get('content-type') ?? '');
  } catch {
    return false;
  }
}

export async function registerServiceWorker(
  env: SwEnvironment,
  onUpdate: () => void = () => announceUpdate(),
): Promise<ServiceWorkerRegistration | null> {
  const decision = swDecision(env);
  if (decision === 'skip') return null;
  if (decision === 'probe' && !(await swAvailable(env.fetch))) return null;
  const container = env.serviceWorker as ServiceWorkerContainer;

  // ¿Controlaba ya un worker esta página? Solo entonces un cambio es «nuevo».
  let controlled = Boolean(container.controller);
  container.addEventListener('controllerchange', () => {
    if (controlled) onUpdate();
    controlled = true;
  });

  let registration: ServiceWorkerRegistration;
  try {
    registration = await container.register('/sw.js');
  } catch {
    // Sin worker la app funciona igual (sin caché del armazón).
    return null;
  }

  const watch = (worker: ServiceWorker | null) => {
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed' && container.controller) onUpdate();
    });
  };
  if (registration.waiting && container.controller) onUpdate();
  watch(registration.installing);
  registration.addEventListener('updatefound', () => watch(registration.installing));
  return registration;
}

// ---- Versión del servidor ----------------------------------------------------------

/** Tras cuánto tiempo oculta se vuelve a preguntar la versión al volver. */
export const RECHECK_AFTER_HIDDEN_MS = 30 * 60_000;

export interface VersionWatchOptions {
  client: QueryClient;
  /** Versión actual del servidor (por defecto, GET /api/v1/ping). */
  fetchVersion?: () => Promise<string | null>;
  onUpdate?: (version: string) => void;
  now?: () => number;
  doc?: Document;
}

export function watchServerVersion({
  client,
  fetchVersion = async () => (await api('ping')).version,
  onUpdate = (version) => void announceUpdate(version),
  now = () => Date.now(),
  doc = globalThis.document,
}: VersionWatchOptions): () => void {
  let baseline: string | null = null;
  let checking = false;

  const see = (version: string | null | undefined) => {
    if (!version) return;
    if (baseline === null) baseline = version;
    else if (version !== baseline) onUpdate(version);
  };

  const check = async () => {
    if (checking || isDemo()) return;
    checking = true;
    try {
      see(await fetchVersion());
    } catch {
      // Sin red o con el backend reiniciándose: ya se preguntará en la próxima.
    } finally {
      checking = false;
    }
  };

  // La primera versión conocida: la del bootstrap que sembró el arranque.
  const seeded = client.getQueryData<{ version?: string }>(routeKey('bootstrap'));
  see(seeded?.version);
  const offCache = client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.query.queryKey[1] !== 'bootstrap') return;
    see((event.query.state.data as { version?: string } | undefined)?.version);
  });

  const offResync = onSseEvent('resync', () => void check());

  // El SSE vuelve tras un corte (una actualización reinicia el contenedor).
  let wasOpen = realtimeStore.get().status === 'open';
  const offRealtime = realtimeStore.subscribe(() => {
    const open = realtimeStore.get().status === 'open';
    if (open && !wasOpen && baseline !== null) void check();
    wasOpen = open;
  });

  let hiddenAt: number | null = null;
  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') {
      hiddenAt = now();
      return;
    }
    if (hiddenAt !== null && now() - hiddenAt >= RECHECK_AFTER_HIDDEN_MS) void check();
    hiddenAt = null;
  };
  doc?.addEventListener('visibilitychange', onVisibility);

  // Sin bootstrap sembrado (arranque sin backend que luego vuelve): se pregunta una vez.
  if (baseline === null) void check();

  return () => {
    offCache();
    offResync();
    offRealtime();
    doc?.removeEventListener('visibilitychange', onVisibility);
  };
}

// ---- Entrada ---------------------------------------------------------------------

let installed = false;

/** Lo llama main.tsx una vez (con import()). */
export function installPwa({ client }: { client: QueryClient }): void {
  if (installed) return;
  installed = true;
  const start = () => {
    void registerServiceWorker({
      prod: import.meta.env.PROD,
      isSecureContext: globalThis.isSecureContext === true,
      hostname: globalThis.location?.hostname ?? '',
      serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
      fetch: (...args) => globalThis.fetch(...args),
    });
    // La versión del servidor, solo con backend (en la demo no hay nada que actualizar).
    void whenModeReady().then((mode) => {
      if (mode === 'live') watchServerVersion({ client });
    });
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start, { once: true });
}
