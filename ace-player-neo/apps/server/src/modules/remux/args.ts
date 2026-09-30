/* Argumentos de ffmpeg del remux (arquitectura §5.7; T-125).

   Son los de la 0.6.59 (server.js:261-318) uno a uno, en el mismo orden, con
   dos cambios que pide la v2:
   - la entrada es la `playbackUrl` de la sesión que abrió el backend
     (progresiva o HLS), nunca un `getstream` abierto por ffmpeg por su cuenta
     (server.js:259), que nadie podía parar (P7, P8);
   - `-threads 2` (tope de hilos del codificador de audio) y
     `-metadata ace_session=<id>`, que deja el id de la sesión en la línea de
     órdenes para reconocer los ffmpeg huérfanos en /proc.
   `-hide_banner -loglevel warning -nostdin` ya estaban en la 0.6.59. */

import path from 'node:path';
import { IPTV_FFMPEG_RW_TIMEOUT_US } from '@ace/shared';
import { initFileName } from './files.js';

export interface RemuxArgsInput {
  /** URL absoluta de la entrada: la `playbackUrl` en el motor principal o la del relé IPTV. */
  readonly url: string;
  /** Carpeta de la sesión (index.m3u8, init.mp4 e index<N>.m4s). */
  readonly dir: string;
  /** Id `s_…` de la sesión del backend. */
  readonly sessionId: string;
  /** De dónde sale la entrada (por defecto, el motor). */
  readonly origin?: 'engine' | 'iptv';
  /** La entrada del relé es HLS (lista) y no TS continuo. */
  readonly isHls?: boolean;
  /** Sistema en el que corre ffmpeg (por defecto, el del proceso). */
  readonly platform?: NodeJS.Platform;
  /**
   * Generación del remux en la misma carpeta (1, o nada, el primer ffmpeg). A partir de la 2 (reinicio
   * continuo de la IPTV, diagnostico-iptv-0.8.2 B2): `-start_number`, `+discont_start` e `init_<n>.mp4`.
   */
  readonly generation?: number;
  /** Número del primer segmento de esta generación (con `generation` > 1). */
  readonly startNumber?: number;
}

/** Marca que lleva cada ffmpeg del remux en su línea de órdenes. */
export const ACE_SESSION_MARK = 'ace_session=';

/**
 * Entrada con origen IPTV (docs/iptv.md §6.3): sin `-reconnect*` (reconecta
 * el relé), `-rw_timeout` en MICROsegundos por encima del peor caso del relé
 * (49 s con el cambio de variante), solo los protocolos del relé en 127.0.0.1 y, con HLS, empezando 3
 * segmentos antes del final. La URL es la del relé: sin credenciales.
 *
 * Con HLS, `-http_multiple 0`: el relé sirve la lista y los segmentos de uno en uno por ticket (§6.1), y
 * ffmpeg, por defecto, pide el segmento siguiente antes de terminar de leer el actual. Con segmentos que no
 * caben en el búfer del socket (los de 2 MB de las televisiones públicas) se quedaban los dos esperando al
 * otro hasta el plazo de 20 s (`iptv_timeout`).
 */
function iptvInputArgs(input: RemuxArgsInput): string[] {
  return [
    '-protocol_whitelist',
    'http,tcp,crypto',
    '-rw_timeout',
    String(IPTV_FFMPEG_RW_TIMEOUT_US),
    ...(input.isHls ? ['-live_start_index', '-3', '-http_multiple', '0'] : []),
  ];
}

/**
 * `-hls_flags` de la 0.6.59. En Windows (solo el PC de desarrollo y el E2E) sin
 * `temp_file`: ffmpeg escribe index.m3u8.tmp y lo renombra encima de la lista,
 * y en Windows ese renombrado falla en cuanto el backend la está leyendo (lo
 * hace en cada aviso de la carpeta); ffmpeg no lo reintenta y la lista se queda
 * con el primer segmento para siempre. En Linux (el Umbrel) no cambia nada.
 */
export function hlsFlags(platform: NodeJS.Platform, discontStart = false): string {
  const flags =
    platform === 'win32'
      ? 'delete_segments+independent_segments+omit_endlist'
      : 'delete_segments+independent_segments+temp_file+omit_endlist';
  return discontStart ? `${flags}+discont_start` : flags;
}

/** Ruta de index.m3u8 para ffmpeg, siempre con «/» (también en Windows). */
export function playlistPath(dir: string): string {
  return path.join(dir, 'index.m3u8').replaceAll(path.win32.sep, path.posix.sep);
}

/**
 * Salida de una generación que sigue a otra en la misma carpeta (B2): la numeración continúa donde la dejó
 * la anterior (la MEDIA-SEQUENCE no vuelve a 0 y hls.js no salta 30-58 s atrás), el primer segmento lleva
 * `#EXT-X-DISCONTINUITY` y su init es otro fichero (`init_<n>.mp4`), así que la lista nueva solo nombra lo
 * suyo bajo su propio `#EXT-X-MAP`. Sin `append_list`: daría un MAP único con el init equivocado.
 */
function continuation(input: RemuxArgsInput): boolean {
  return (input.generation ?? 1) > 1;
}

export function buildRemuxArgs(input: RemuxArgsInput): string[] {
  const next = continuation(input);
  const reconnect =
    input.origin === 'iptv'
      ? iptvInputArgs(input)
      : [
          // server.js:269-271: reconexión sola si el motor corta (B-224)
          '-reconnect',
          '1',
          '-reconnect_streamed',
          '1',
          '-reconnect_at_eof',
          '1',
          '-reconnect_on_network_error',
          '1',
          '-reconnect_delay_max',
          '4',
          '-rw_timeout',
          '20000000',
        ];
  return [
    // server.js:262
    '-hide_banner',
    '-loglevel',
    'warning',
    '-nostdin',
    // server.js:263 (B-220)
    '-fflags',
    '+genpts+discardcorrupt',
    ...reconnect,
    // server.js:272-273
    '-probesize',
    '5000000',
    '-analyzeduration',
    '5000000',
    '-thread_queue_size',
    '512',
    // server.js:274 (la entrada, ahora la de la sesión del backend)
    '-i',
    input.url,
    // server.js:275
    '-map',
    '0:v:0',
    '-map',
    '0:a:0?',
    /* server.js:306-307: vídeo copiado con -copyinkf, audio AAC 160k estéreo (B-218, B-219). Sin el
       `first_pts=0` de la 0.6.59: rellenaba de silencio desde 0 hasta «ahora» cada vez que el grafo de
       audio se rehacía (p. ej. al pasar de 2.0 a 5.1), miles de tramas AAC en un solo segmento y un
       pico de CPU (diagnostico-iptv-0.8.2 P8, B1). Tampoco `-reinit_filter 0`: con un cambio de
       disposición de canales es fatal. */
    '-c:v',
    'copy',
    '-copyinkf',
    '-c:a',
    'aac',
    '-b:a',
    '160k',
    '-ac',
    '2',
    '-af',
    'aresample=async=1000:min_hard_comp=0.100',
    // Nuevo en la v2 (arquitectura §5.7)
    '-threads',
    '2',
    '-metadata',
    `${ACE_SESSION_MARK}${input.sessionId}`,
    // server.js:313-317: HLS fMP4 de 2 s en ventana de 15 (B-225)
    '-f',
    'hls',
    '-hls_time',
    '2',
    '-hls_list_size',
    '15',
    '-hls_delete_threshold',
    '2',
    '-hls_flags',
    hlsFlags(input.platform ?? process.platform, next),
    '-hls_segment_type',
    'fmp4',
    ...(next ? ['-start_number', String(input.startNumber ?? 0)] : []),
    '-hls_fmp4_init_filename',
    initFileName(input.generation ?? 1),
    /* Con barras «/»: ffmpeg deja init.mp4 junto a la lista solo si encuentra
       una «/» en su ruta; con las «\» de Windows lo escribía en el directorio
       de trabajo del backend (en Linux, el del Umbrel, no cambia nada). */
    playlistPath(input.dir),
  ];
}
