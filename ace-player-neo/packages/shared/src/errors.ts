/* Catálogo único de códigos de error (arquitectura §6.4, arregla P10: hoy la
   web traduce unos pocos y el resto sale como texto crudo, y el iPhone ve el
   mismo mensaje para tres fallos distintos del remux).

   Cada código tiene:
   - `status`: el HTTP que usa /api/v1, el "correcto" (502/504 para fallos
     del motor o de terceros).
   - `legacyStatus`: el HTTP que da hoy la 0.6.59 en /api/* y /remux/*, con
     sus rarezas (errores de terceros como 400, api.md §2.6 y §6.4). `null` si
     la 0.6.59 no lo devolvía nunca: en una ruta antigua sale entonces como
     500 `internal_error`, igual que hoy (lista blanca `safeErrors`,
     server.js:5032-5069).
   - `public`: si /api/v1 lo enseña tal cual. Los internos (`scanner_*`,
     `epg_*`, `ollama_*`…) no deberían llegar nunca a una respuesta; si lo
     hacen es un fallo de programación y salen como `internal_error`.
   - `message`: texto en español para enseñárselo a Isma tal cual. */

import { z } from 'zod';

export interface ErrorDefinition {
  readonly status: number;
  readonly legacyStatus: number | null;
  readonly public: boolean;
  readonly message: string;
}

const REMOTE_LIST = 'No se pudo descargar la lista.';

export const ERROR_CATALOG = {
  // --- Genéricos de HTTP ---
  bad_request: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'La petición no es válida.',
  },
  bad_json: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'El cuerpo de la petición no es un JSON válido.',
  },
  validation_error: {
    status: 400,
    legacyStatus: null,
    public: true,
    message: 'Falta algún dato o no tiene el formato esperado.',
  },
  body_too_large: {
    status: 413,
    legacyStatus: 413,
    public: true,
    message: 'La petición es demasiado grande (máximo 2 MiB).',
  },
  not_found: {
    status: 404,
    legacyStatus: 404,
    public: true,
    message: 'Esa dirección no existe.',
  },
  method_not_allowed: {
    status: 405,
    legacyStatus: 405,
    public: true,
    message: 'Esa dirección no admite este método.',
  },
  cross_origin: {
    status: 403,
    legacyStatus: 403,
    public: true,
    message: 'Se ha bloqueado una petición que venía de otra web.',
  },
  internal_error: {
    status: 500,
    legacyStatus: 500,
    public: true,
    message: 'Algo ha fallado en el servidor. Queda anotado en el registro.',
  },
  not_implemented: {
    status: 501,
    legacyStatus: 501,
    public: true,
    message: 'Esta función todavía no está disponible en esta versión.',
  },

  // --- Acceso (nuevo en la 0.7.0, arquitectura §5.12) ---
  unauthorized: {
    status: 401,
    legacyStatus: null,
    public: true,
    message: 'Este dispositivo no está emparejado o su acceso ha caducado. Vuelve a emparejarlo.',
  },
  device_revoked: {
    status: 401,
    legacyStatus: null,
    public: true,
    message: 'Se ha retirado el acceso de este dispositivo. Vuelve a emparejarlo desde la web.',
  },
  origin_forbidden: {
    status: 403,
    legacyStatus: 403,
    public: true,
    message: 'Esta función no está disponible desde aquí.',
  },
  video_token_invalid: {
    status: 401,
    legacyStatus: null,
    public: true,
    message: 'El enlace del vídeo ha caducado. Vuelve a abrir el canal.',
  },
  pairing_invalid: {
    status: 401,
    legacyStatus: null,
    public: true,
    message: 'El código no es correcto. Revísalo en la web y vuelve a intentarlo.',
  },
  pairing_expired: {
    status: 410,
    legacyStatus: null,
    public: true,
    message: 'El código ha caducado o ya se ha usado. Pide uno nuevo en la web.',
  },
  pairing_rate_limited: {
    status: 429,
    legacyStatus: null,
    public: true,
    message: 'Demasiados intentos. Espera un minuto y vuelve a probar.',
  },
  device_not_found: {
    status: 404,
    legacyStatus: null,
    public: true,
    message: 'Ese dispositivo no existe.',
  },
  rate_limited: {
    status: 429,
    legacyStatus: null,
    public: true,
    message: 'Demasiadas peticiones seguidas. Espera un momento.',
  },

  // --- Sesiones de reproducción (arquitectura §6.3) ---
  session_expired: {
    status: 410,
    legacyStatus: null,
    public: true,
    message: 'La sesión de este canal ha terminado. Vuelve a abrirlo.',
  },
  session_not_found: {
    status: 404,
    legacyStatus: null,
    public: true,
    message: 'Esa sesión de reproducción no existe.',
  },
  handoff_denied: {
    status: 409,
    legacyStatus: null,
    public: true,
    message: 'Otro dispositivo tiene el mando y no se ha podido pasar a este.',
  },
  source_no_peers: {
    status: 504,
    legacyStatus: null,
    public: true,
    message: 'Esta señal no tiene pares ahora mismo. Prueba otra fuente.',
  },
  engine_timeout: {
    status: 504,
    legacyStatus: null,
    public: true,
    message: 'El motor AceStream no ha respondido a tiempo.',
  },
  ffmpeg_missing: {
    status: 501,
    legacyStatus: null,
    public: true,
    message: 'Falta ffmpeg en el servidor: no se puede preparar el vídeo para el iPhone.',
  },

  // --- Motor ---
  engine_unavailable: {
    status: 503,
    legacyStatus: 503,
    public: true,
    message: 'El motor AceStream no responde. Si sigue así, reinícialo desde Ajustes.',
  },
  engine_bad_response: {
    status: 502,
    legacyStatus: 502,
    public: true,
    message: 'El motor AceStream ha dado una respuesta que no se entiende.',
  },
  ace_timeout: {
    status: 504,
    legacyStatus: 400,
    public: true,
    message: 'El motor AceStream tarda demasiado en responder.',
  },
  restart_cooldown: {
    status: 429,
    legacyStatus: 429,
    public: true,
    message: 'El motor se acaba de reiniciar. Espera unos segundos antes de volver a intentarlo.',
  },
  restart_failed: {
    status: 502,
    legacyStatus: 502,
    public: true,
    message: 'No se pudo reiniciar el motor.',
  },

  // --- Remux del iPhone ---
  remux_busy: {
    status: 503,
    legacyStatus: 503,
    public: true,
    message: 'Hay demasiados vídeos preparándose para iPhone a la vez. Cierra alguno y reintenta.',
  },
  remux_died: {
    status: 502,
    legacyStatus: 502,
    public: true,
    message: 'La conversión del vídeo para iPhone se ha detenido. Vuelve a intentarlo.',
  },
  remux_timeout: {
    status: 504,
    legacyStatus: 504,
    public: true,
    message: 'El vídeo para iPhone no ha llegado a tiempo. La señal va lenta.',
  },

  // --- Biblioteca y estado ---
  bad_action: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'Esa acción sobre la biblioteca no existe.',
  },
  bad_collection: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'Esa colección de la biblioteca no existe.',
  },
  bad_title: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'El nombre no puede quedar vacío.',
  },

  // --- Directorios ---
  source_not_found: {
    status: 404,
    legacyStatus: 400,
    public: true,
    message: 'Ese directorio ya no existe.',
  },
  source_limit: {
    status: 409,
    legacyStatus: 400,
    public: true,
    message: 'Ya tienes 8 directorios. Elimina uno antes de añadir otro.',
  },
  last_source: {
    status: 409,
    legacyStatus: 400,
    public: true,
    message: 'Debe quedar al menos un directorio guardado.',
  },
  empty_directory: {
    status: 422,
    legacyStatus: 400,
    public: true,
    message: 'La fuente respondió, pero no contenía enlaces AceStream válidos.',
  },
  bad_url: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'La dirección no es válida: tiene que empezar por http:// o https://.',
  },
  private_url: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message:
      'Por seguridad, las direcciones de tu red local están bloqueadas. Usa una lista publicada en internet.',
  },
  dns_failed: {
    status: 502,
    legacyStatus: 400,
    public: true,
    message: 'No se pudo resolver el dominio de esa fuente.',
  },
  fetch_timeout: {
    status: 504,
    legacyStatus: 400,
    public: true,
    message: 'La fuente no respondió a tiempo.',
  },
  fetch_failed: {
    status: 502,
    legacyStatus: 400,
    public: true,
    message: REMOTE_LIST,
  },
  redirect_limit: {
    status: 502,
    legacyStatus: 400,
    public: true,
    message: 'La fuente entra en un bucle o encadena demasiadas redirecciones.',
  },
  redirect_loop: {
    status: 502,
    legacyStatus: 400,
    public: true,
    message: 'La fuente entra en un bucle o encadena demasiadas redirecciones.',
  },
  response_too_large: {
    status: 502,
    legacyStatus: 400,
    public: true,
    message: 'La lista es demasiado grande (máximo 2 MiB).',
  },
  unsupported_encoding: {
    status: 502,
    legacyStatus: 400,
    public: true,
    message: 'La fuente envía la lista comprimida de una forma que no se admite.',
  },
  ipfs_not_found: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'Esa ruta ya no existe en IPFS.',
  },
  ipfs_bad_cid: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.',
  },
  ipfs_bad_block: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.',
  },
  ipfs_bad_data: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.',
  },
  ipfs_bad_record: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.',
  },
  ipfs_hamt_unsupported: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.',
  },
  ipfs_missing_block: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.',
  },
  ipfs_not_file: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.',
  },
  ipfs_unsupported_codec: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.',
  },
  ipfs_unsupported_hash: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La red IPFS no entregó la lista. Vuelve a intentarlo en un rato.',
  },

  // --- Fútbol, fuentes y búsqueda ---
  football_unavailable: {
    status: 502,
    legacyStatus: 502,
    public: true,
    message: 'No se pudo cargar la agenda de partidos. Vuelve a intentarlo en un rato.',
  },
  channel_required: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'Este partido no anuncia ningún canal.',
  },
  bad_binding: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'Hace falta un canal y un ID AceStream válido para vincularlos.',
  },
  scan_not_found: {
    status: 404,
    legacyStatus: 404,
    public: true,
    message: 'Esa comprobación de fuentes ya no existe. Vuelve a buscar el canal.',
  },
  bad_outcome: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'El resultado de la reproducción no es válido.',
  },
  bad_feedback: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'La corrección no es válida.',
  },
  empty_query: {
    status: 400,
    legacyStatus: 400,
    public: true,
    message: 'Escribe al menos 2 letras para buscar.',
  },

  /* --- IPTV (docs/iptv.md §5.6) ---
     Todos son errores DE FUENTE, nunca de sistema: agotan la fuente y
     permiten el salto a AceStream (puente, §7.2). La 0.6.59 no los conocía. */
  iptv_not_configured: {
    status: 409,
    legacyStatus: null,
    public: true,
    message: 'Todavía no has conectado ninguna IPTV.',
  },
  iptv_disabled: {
    status: 409,
    legacyStatus: null,
    public: true,
    message: 'Tu IPTV está en pausa.',
  },
  iptv_removed: {
    status: 410,
    legacyStatus: null,
    public: true,
    message: 'Has eliminado tu IPTV.',
  },
  iptv_credentials_required: {
    status: 400,
    legacyStatus: null,
    public: true,
    message: 'Si cambias el servidor o el tipo, vuelve a escribir el usuario y la contraseña.',
  },
  iptv_secret_unreadable: {
    status: 409,
    legacyStatus: null,
    public: true,
    message: 'No se pueden leer los datos guardados de tu IPTV. Vuelve a escribirlos.',
  },
  iptv_auth_failed: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'Tu proveedor de IPTV no acepta ese usuario y contraseña.',
  },
  iptv_account_expired: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La cuenta de tu IPTV ha caducado o está desactivada.',
  },
  iptv_unreachable: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'Tu proveedor de IPTV no responde.',
  },
  iptv_timeout: {
    status: 504,
    legacyStatus: null,
    public: true,
    message: 'Tu IPTV no respondió a tiempo.',
  },
  iptv_busy: {
    status: 503,
    legacyStatus: null,
    public: true,
    message:
      'Tu IPTV ya tiene todas sus conexiones en uso. Cierra la otra reproducción o espera un momento.',
  },
  iptv_gone: {
    status: 404,
    legacyStatus: null,
    public: true,
    message: 'Ese canal ya no está en tu IPTV.',
  },
  iptv_dropped: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'Tu IPTV ha cortado la emisión.',
  },
  iptv_unsupported: {
    status: 422,
    legacyStatus: null,
    public: true,
    message: 'Ese canal de tu IPTV usa un formato que no se puede reproducir aquí.',
  },
  iptv_bad_list: {
    status: 422,
    legacyStatus: null,
    public: true,
    message: 'La dirección respondió, pero no es una lista M3U con canales en directo.',
  },
  iptv_empty: {
    status: 422,
    legacyStatus: null,
    public: true,
    message: 'La lista no trae ningún canal en directo que se pueda usar.',
  },
  iptv_too_large: {
    status: 502,
    legacyStatus: null,
    public: true,
    message: 'La lista de tu IPTV es demasiado grande para el Umbrel.',
  },

  // --- Internos: no deberían salir nunca en una respuesta ---
  state_unreadable: {
    status: 500,
    legacyStatus: null,
    public: false,
    message: 'No se pudo leer el estado guardado.',
  },
  scanner_unavailable: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'El comprobador no responde.',
  },
  scanner_timeout: {
    status: 504,
    legacyStatus: null,
    public: false,
    message: 'El comprobador tarda demasiado.',
  },
  scanner_session_failed: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'El comprobador no pudo abrir la señal.',
  },
  scanner_bad_response: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'El comprobador dio una respuesta que no se entiende.',
  },
  scanner_response_too_large: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'El comprobador dio una respuesta demasiado grande.',
  },
  epg_unavailable: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'La EPG de Movistar+ no responde.',
  },
  epg_bad_response: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'La EPG de Movistar+ dio una respuesta que no se entiende.',
  },
  epg_empty: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'La EPG de Movistar+ no trae partidos.',
  },
  fltv_empty: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'futbolenlatv no trae partidos.',
  },
  ollama_unavailable: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'La IA local no responde.',
  },
  ollama_timeout: {
    status: 504,
    legacyStatus: null,
    public: false,
    message: 'La IA local tarda demasiado.',
  },
  ollama_bad_response: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'La IA local dio una respuesta que no se entiende.',
  },
  ollama_response_too_large: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'La IA local dio una respuesta demasiado grande.',
  },
  restart_timeout: {
    status: 504,
    legacyStatus: null,
    public: false,
    message: 'engine_control no respondió a tiempo.',
  },
  not_file: {
    status: 404,
    legacyStatus: null,
    public: false,
    message: 'No es un fichero.',
  },

  // --- Solo para el registro de fallos (nunca llegan a una respuesta HTTP) ---
  engine_stalled: {
    status: 503,
    legacyStatus: null,
    public: false,
    message: 'El motor responde pero no entrega vídeo a quien está viendo.',
  },
  engine_auto_restart: {
    status: 503,
    legacyStatus: null,
    public: false,
    message: 'El motor no respondía con alguien esperando y se ha reiniciado solo.',
  },
  engine_auto_restart_exhausted: {
    status: 503,
    legacyStatus: null,
    public: false,
    message: 'El motor ya se ha reiniciado solo 3 veces en la última hora; no se reinicia más.',
  },
  engine_not_ready: {
    status: 503,
    legacyStatus: null,
    public: false,
    message: 'El motor no ha vuelto a responder a tiempo después de reiniciarse.',
  },
  engine_stop_failed: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'El motor no ha confirmado el cierre de una sesión.',
  },
  scanner_session_leak: {
    status: 502,
    legacyStatus: null,
    public: false,
    message: 'El comprobador puede haber dejado sesiones abiertas en su motor.',
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CATALOG;

/** Errores HTTP de terceros tal cual los nombra `fetchText`: `http_404`, `http_429`… */
export type HttpStatusErrorCode = `http_${number}`;

/** Cualquier código que puede llevar un error de la app. */
export type AnyErrorCode = ErrorCode | HttpStatusErrorCode;

export const ERROR_CODES = Object.keys(ERROR_CATALOG) as ErrorCode[];

/** Códigos de la IPTV (docs/iptv.md §5.6): los 16 `iptv_*`, todos de fuente. */
export type IptvErrorCode = Extract<ErrorCode, `iptv_${string}`>;
export const IPTV_ERROR_CODES = ERROR_CODES.filter((code): code is IptvErrorCode =>
  code.startsWith('iptv_'),
);

export function isIptvErrorCode(value: unknown): value is IptvErrorCode {
  return isErrorCode(value) && value.startsWith('iptv_');
}

const HTTP_STATUS_ERROR_RE = /^http_(\d{3})$/;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CATALOG, value);
}

export function isHttpStatusErrorCode(value: unknown): value is HttpStatusErrorCode {
  return typeof value === 'string' && HTTP_STATUS_ERROR_RE.test(value);
}

export function isAnyErrorCode(value: unknown): value is AnyErrorCode {
  return isErrorCode(value) || isHttpStatusErrorCode(value);
}

/**
 * Definición de un código, también de los dinámicos `http_NNN` (la 0.6.59
 * los deja pasar por su forma, server.js:5069, siempre como 400). En /api/v1
 * son 502: el fallo es del servidor remoto, no de quien pregunta.
 */
export function describeError(code: string): (ErrorDefinition & { readonly code: string }) | null {
  if (isErrorCode(code)) return { code, ...ERROR_CATALOG[code] };
  const http = HTTP_STATUS_ERROR_RE.exec(code);
  if (http) {
    const status = http[1];
    const message =
      status === '429'
        ? 'Ese servidor limita las descargas (429). Vuelve a intentarlo en unos minutos.'
        : `El servidor respondió con un error ${status}.`;
    return { code, status: 502, legacyStatus: 400, public: true, message };
  }
  return null;
}

/** Mensaje en español de un código; el de `internal_error` si no se conoce. */
export function errorMessage(code: string): string {
  return describeError(code)?.message ?? ERROR_CATALOG.internal_error.message;
}

/** Error de /api/v1: `{ error: { code, message, requestId } }` (arquitectura §6.4). */
export const ApiErrorSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1).max(64),
    message: z.string().min(1),
    requestId: z.string().min(1).max(128),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** Error de las rutas antiguas: `{ "error": "<código>" }` (api.md §2.6). */
export const LegacyErrorSchema = z.strictObject({ error: z.string().min(1) });
export type LegacyError = z.infer<typeof LegacyErrorSchema>;
