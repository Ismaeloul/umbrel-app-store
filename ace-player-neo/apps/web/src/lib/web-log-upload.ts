/* Los avisos y errores de la web, al registro en disco del servidor
   («Descargar logs», Ajustes → Registro, 0.9.0; docs/registro.md).

   El anillo de src/lib/web-log.ts vive en memoria y se pierde al cerrar la
   pestaña; para que dentro de un mes se vea qué falló también en la web,
   cada línea NUEVA de nivel `warn` o `error` (nunca las notas `info` del
   reproductor) se manda al servidor (POST /api/v1/diagnostics/web-log), que
   la redacta y la guarda con las suyas. Acotado y sin bucles:

   - se juntan las que llegan seguidas (UPLOAD_DELAY_MS) y van en tandas de
     WEB_LOG_UPLOAD_MAX_ENTRIES; esperando, como mucho UPLOAD_QUEUE_MAX (si
     el NAS no contesta, salen las más viejas);
   - el envío usa fetch directamente, no `api()`: un envío que falla NO se
     apunta en el anillo (si no, cada fallo traería otro envío);
   - sin red o con 5xx/429 se reintenta más tarde (de 10 s a 5 min); un 4xx
     tira la tanda (no se arregla repitiendo) y un 404 apaga el envío (un
     servidor sin la ruta);
   - al cerrar u ocultar la página se manda lo que quede con `keepalive`
     (si cabe en sus 64 KiB);
   - en la demo no se manda nada.
   Datos: lo del anillo (sin datos personales: la frase, la pila, el código y
   la vista) y el navegador (User-Agent, tamaño y si es la app instalada). */

import { WEB_LOG_UPLOAD_MAX_ENTRIES, type WebLogClient, type WebLogEntry } from '@ace/shared';
import { isDemo, whenModeReady } from '../api/mode.ts';
import { routeOf } from '../api/routes.ts';
import { subscribeWebLog } from './web-log.ts';

/** Espera desde el primer error hasta mandarlo (junta los que vengan seguidos). */
export const UPLOAD_DELAY_MS = 4000;
/** Errores esperando como mucho. */
export const UPLOAD_QUEUE_MAX = 50;
const RETRY_MIN_MS = 10_000;
const RETRY_MAX_MS = 5 * 60_000;
/** `keepalive` solo admite 64 KiB de cuerpo. */
const KEEPALIVE_MAX_CHARS = 60_000;

/** El navegador, sin nada que identifique a nadie. */
export function webLogClient(): WebLogClient {
  const width = Math.round(globalThis.innerWidth ?? 0);
  const height = Math.round(globalThis.innerHeight ?? 0);
  const ratio = Math.round((globalThis.devicePixelRatio ?? 1) * 100) / 100;
  let installed: boolean;
  try {
    installed =
      (globalThis.navigator as { standalone?: boolean } | undefined)?.standalone === true ||
      globalThis.matchMedia?.('(display-mode: standalone)').matches === true;
  } catch {
    installed = false;
  }
  return {
    userAgent: (globalThis.navigator?.userAgent ?? '').slice(0, 400),
    viewport: `${width}x${height}@${ratio}`.slice(0, 40),
    installed,
  };
}

type Timer = ReturnType<typeof setTimeout>;

export interface WebLogUploadOptions {
  readonly fetch?: typeof fetch;
  /** Donde se escucha `pagehide` y `visibilitychange` (la ventana). */
  readonly target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  readonly visibility?: () => DocumentVisibilityState | undefined;
}

/** Engancha el envío (lo llama main.tsx una vez). Devuelve cómo soltarlo. */
export function installWebLogUpload(options: WebLogUploadOptions = {}): () => void {
  const doFetch =
    options.fetch ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const target = options.target ?? globalThis.window;
  const visibility = options.visibility ?? (() => globalThis.document?.visibilityState);
  const path = routeOf('diagnosticsWebLog').path;
  const queue: WebLogEntry[] = [];
  let timer: Timer | null = null;
  let sending = false;
  let failures = 0;
  let disabled = false;

  const schedule = (ms: number) => {
    if (timer || disabled) return;
    timer = setTimeout(() => {
      timer = null;
      void send(false);
    }, ms);
  };

  async function send(closing: boolean): Promise<void> {
    if (sending || disabled || !queue.length) return;
    sending = true;
    try {
      await whenModeReady();
      if (isDemo()) {
        queue.length = 0;
        return;
      }
      const batch = queue.slice(0, WEB_LOG_UPLOAD_MAX_ENTRIES);
      const body = JSON.stringify({ client: webLogClient(), entries: batch });
      let status = 0;
      try {
        const response = await doFetch(path, {
          method: 'POST',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body,
          cache: 'no-store',
          credentials: 'same-origin',
          ...(closing && body.length <= KEEPALIVE_MAX_CHARS ? { keepalive: true } : {}),
        });
        status = response.status;
      } catch {
        status = 0; // sin red: se reintenta (y NO se apunta en el anillo)
      }
      const retry = status === 0 || status === 429 || status >= 500;
      if (!retry) {
        queue.splice(0, batch.length);
        failures = 0;
        if (status === 404) {
          disabled = true;
          queue.length = 0;
        }
      } else failures += 1;
    } finally {
      sending = false;
    }
    // Quedan más (una tanda no cabía o falló): la siguiente al segundo, o más tarde si falla.
    if (queue.length && !closing) {
      schedule(failures ? Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** (failures - 1)) : 1000);
    }
  }

  const off = subscribeWebLog((entry) => {
    if (entry.level === 'info' || disabled) return;
    queue.push(entry);
    if (queue.length > UPLOAD_QUEUE_MAX) queue.splice(0, queue.length - UPLOAD_QUEUE_MAX);
    schedule(UPLOAD_DELAY_MS);
  });

  /* Al cerrar u ocultar la página: lo que quede, ya. */
  const flushNow = () => {
    if (!queue.length) return;
    if (timer) clearTimeout(timer);
    timer = null;
    void send(true);
  };
  const onVisibility = () => {
    if (visibility() === 'hidden') flushNow();
  };
  target?.addEventListener('pagehide', flushNow);
  target?.addEventListener('visibilitychange', onVisibility);

  return () => {
    off();
    if (timer) clearTimeout(timer);
    timer = null;
    target?.removeEventListener('pagehide', flushNow);
    target?.removeEventListener('visibilitychange', onVisibility);
  };
}
