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

/**
 * «Descargar fallos» (Salud, 0.9.0): lo que guarda cada anillo en memoria y
 * lo que entra en el fichero. La web apunta sus últimos errores (sin disco);
 * el servidor, sus últimas líneas de registro (y su tamaño total).
 */
export const WEB_LOG_MAX_ENTRIES = 200;
export const SERVER_LOG_RING_LINES = 2000;
export const SERVER_LOG_RING_BYTES = 1024 * 1024;
/** Fallos (servidor + web) como mucho en el fichero, de los más nuevos. */
export const DIAGNOSTICS_EXPORT_MAX_FAULTS = 1000;

/**
 * Registro en disco («Descargar logs», Ajustes → Registro, 0.9.0; docs/registro.md).
 * Un fichero por día (hora de Madrid) en `<DATA_DIR>/v2/registro/`; los días
 * cerrados se comprimen (gzip). Se borra lo de más de LOG_STORE_MAX_DAYS días
 * y, si todo junto pasa de LOG_STORE_MAX_BYTES en el disco, lo más viejo.
 * Un día que pasa de LOG_STORE_DAY_SOFT_BYTES solo guarda avisos y errores;
 * de LOG_STORE_DAY_HARD_BYTES, nada más (con una línea que lo dice).
 */
export const LOG_STORE_MAX_DAYS = 45;
export const LOG_STORE_MAX_BYTES = 40 * 1024 * 1024;
export const LOG_STORE_DAY_SOFT_BYTES = 8 * 1024 * 1024;
export const LOG_STORE_DAY_HARD_BYTES = 12 * 1024 * 1024;
/** Una línea más larga se guarda con sus textos recortados (pilas, mensajes). */
export const LOG_STORE_LINE_MAX_CHARS = 16 * 1024;
/** Registro sin comprimir que entra como mucho en el zip de «Descargar logs» (lo más nuevo). */
export const LOG_DOWNLOAD_MAX_BYTES = 48 * 1024 * 1024;
/** Errores de la web que se mandan al servidor para el registro: por envío y por minuto (en total). */
export const WEB_LOG_UPLOAD_MAX_ENTRIES = 20;
export const WEB_LOG_UPLOAD_PER_MINUTE = 60;

/** Emparejamiento: intentos por código y por minuto en total (arquitectura §5.12). */
export const PAIRING_ATTEMPTS_PER_CODE = 5;
export const PAIRING_ATTEMPTS_PER_MINUTE = 10;
/**
 * Emparejamiento: códigos que puede crear un mismo iPhone por minuto (0.8.1).
 * Cada uno anula el vivo; sin tope, un iPhone en bucle dejaría a la web sin
 * poder emparejar. La web (login de Umbrel) no tiene tope.
 */
export const PAIRING_CREATES_PER_DEVICE_PER_MINUTE = 5;

/** Emparejamiento: dígitos del código y bits del secreto del token (arquitectura §5.12). */
export const PAIRING_CODE_DIGITS = 6;
export const DEVICE_SECRET_BYTES = 32;

/** Remux: búfer circular de la salida de error de ffmpeg (arquitectura §5.7). */
export const REMUX_LOG_BYTES = 64 * 1024;

/** Motor: reinicios automáticos por hora como máximo (arquitectura §5.5). */
export const ENGINE_MAX_AUTO_RESTARTS_PER_HOUR = 3;

/* Copia de seguridad de tus ajustes (0.8.4, decisiones.md D25). Sin zod: la
   web los usa para avisar antes de subir nada. */

/** Formato del fichero de copia (`format`). */
export const BACKUP_FORMAT = 'ace-player-neo-copia';
/** Versión del esquema del fichero que escribe esta versión (y la más nueva que sabe leer). */
export const BACKUP_SCHEMA_VERSION = 1;
/**
 * Tamaño máximo de la copia al restaurarla: el del cuerpo de la petición
 * (MAX_BODY_BYTES, el `client_max_body_size 2m` de nginx). La web la manda
 * compacta, así que el fichero con sangrías que se descarga puede pesar algo más.
 */
export const BACKUP_MAX_BYTES = MAX_BODY_BYTES;
/** Fichero que la web acepta leer antes de compactarlo (el doble, por las sangrías). */
export const BACKUP_MAX_FILE_BYTES = 2 * MAX_BODY_BYTES;
/** Clave con la que se protege la contraseña de la IPTV dentro de la copia. */
export const BACKUP_PASSPHRASE_MIN = 8;
export const BACKUP_PASSPHRASE_MAX = 256;
