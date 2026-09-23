/* Topes que comparten servidor, web e iOS y que no son de state.json.
   Los de state.json (60, 500, 8, 12/24/24, 120/300/300, 600) viven en
   state/limits.ts (sin zod, para la web), que importa y reexporta el esquema
   de state/v1.ts: un solo sitio donde cambiarlos. */

/** Cuerpo máximo de una petición a la API (server.js:29, nginx `client_max_body_size 2m`). */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;

/** Sesiones de remux vivas a la vez (server.js:39). */
export const MAX_REMUX_SESSIONS = 3;

/** Rótulos de canal por partido que usa la resolución (server.js:66). */
export const MAX_RESOLUTION_CHANNELS = 8;

/** Candidatos por trabajo del comprobador (server.js:82). */
export const SCANNER_MAX_CANDIDATES = 100;

/** Candidatos que la interfaz enseña al instante al empezar un trabajo (server.js:81). */
export const SCANNER_INITIAL_SOURCES = 3;

/** Trabajos en la cola del comprobador (nuevo en la 0.7.0, arquitectura §5.8). */
export const SCANNER_MAX_JOBS = 20;

/** Resultados del buscador del motor (server.js:3627). */
export const MAX_SEARCH_RESULTS = 100;

/** Longitud mínima y máxima de una búsqueda en el motor (server.js:4944-4945). */
export const SEARCH_QUERY_MIN = 2;
export const SEARCH_QUERY_MAX = 80;

/** Redirecciones que sigue el cliente saliente (server.js:42). */
export const MAX_REDIRECTS = 5;

/** Tope de bytes por defecto de una descarga de directorio (server.js:1342). */
export const FETCH_MAX_BYTES = 2 * 1024 * 1024;

/** Tope de cuerpo de las respuestas del motor (nuevo: hoy `aceRequest` no tiene, arquitectura §5.5). */
export const ENGINE_MAX_BODY_BYTES = 512 * 1024;

/** SSE: eventos que se guardan para reanudar con Last-Event-ID (arquitectura §5.13). */
export const SSE_BUFFER_EVENTS = 200;

/** SSE: si el búfer de escritura de una conexión pasa de esto, se cierra (arquitectura §5.13). */
export const SSE_MAX_BUFFERED_BYTES = 256 * 1024;

/** Registro de fallos: entradas en memoria y tamaño de cada fichero JSONL (arquitectura §5.14). */
export const DIAGNOSTICS_MEMORY_ENTRIES = 500;
export const DIAGNOSTICS_FILE_BYTES = 1024 * 1024;

/** Registro de fallos: informes por minuto de un mismo cliente y de todos juntos (arquitectura §5.14). */
export const DIAGNOSTICS_CLIENT_REPORTS_PER_MINUTE = 30;
export const DIAGNOSTICS_TOTAL_REPORTS_PER_MINUTE = 120;

/** Registro de fallos: entradas que devuelve GET /api/v1/diagnostics sin `limit`. */
export const DIAGNOSTICS_DEFAULT_LIST_LIMIT = 100;

/** Emparejamiento: intentos por código y por minuto en total (arquitectura §5.12). */
export const PAIRING_ATTEMPTS_PER_CODE = 5;
export const PAIRING_ATTEMPTS_PER_MINUTE = 10;

/** Emparejamiento: dígitos del código y bits del secreto del token (arquitectura §5.12). */
export const PAIRING_CODE_DIGITS = 6;
export const DEVICE_SECRET_BYTES = 32;

/** Remux: búfer circular de la salida de error de ffmpeg (arquitectura §5.7). */
export const REMUX_LOG_BYTES = 64 * 1024;

/** Motor: reinicios automáticos por hora como máximo (arquitectura §5.5). */
export const ENGINE_MAX_AUTO_RESTARTS_PER_HOUR = 3;
