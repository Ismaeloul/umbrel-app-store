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
  /**
   * IPTV entrelazada con un iPhone mirando: el vídeo se desentrelaza y se codifica en vez de copiarse
   * (AVPlayer no desentrelaza; ver `deinterlaceVideoArgs`).
   */
  readonly deinterlace?: boolean;
  /** 0.9.8: calidad ligera para un iPhone con poca conexión (ver `liteVideoArgs`). Con `deinterlace`, las dos. */
  readonly lite?: boolean;
  /**
   * La gráfica del NAS (hwaccel.ts), o nada: con `lite` o `deinterlace` (y `deinterlace_vaapi` si
   * desentrelaza), decodifica, escala y codifica ella en vez de x264 (`vaapiLiveVideoArgs`). Copiar
   * el vídeo no la usa nunca.
   */
  readonly vaapi?: VaapiProfile | null;
}

/** Hilos de x264 al desentrelazar: ~2 núcleos del N300 por canal 1080i (medido en la 0.9.2). */
export const DEINTERLACE_THREADS = 4;

/**
 * Vídeo de una IPTV entrelazada (1080i25, dos campos por imagen) para el iPhone: AVPlayer no desentrelaza y
 * se veía a tirones y con «peinado». `bwdif` en `send_field` saca una imagen por campo (1080p50, sin bajar
 * de resolución) y x264 la codifica en H.264 High 8 bits, que AVPlayer reproduce siempre. Una clave cada
 * 2 s exactos (`-force_key_frames`, sin cortes de escena): cada segmento HLS de 2 s empieza en una y es
 * independiente, también con 29,97i (59,94p), donde un GOP fijo en imágenes no cuadraría. `-threads:v` va
 * DETRÁS del `-threads 2` general (el del audio): el más concreto manda.
 */
export function deinterlaceVideoArgs(): string[] {
  return [
    '-vf',
    'bwdif=mode=send_field',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '21',
    '-maxrate',
    '12M',
    '-bufsize',
    '12M',
    '-g',
    '250',
    '-sc_threshold',
    '0',
    '-force_key_frames',
    'expr:gte(t,n_forced*2)',
  ];
}

/** Altura y caudal de la calidad ligera (0.9.8). */
export const LITE_HEIGHT = 720;
export const LITE_MAXRATE = '2500k';

/**
 * Calidad ligera (0.9.8): el iPhone fuera de casa con poca conexión. 720p (sin agrandar lo que ya es
 * menor), H.264 High a unos 2,5 Mb/s como mucho, una clave cada 2 s exactos como el desentrelazado (los
 * segmentos HLS de 2 s empiezan en una). Si la fuente es entrelazada, `bwdif` en `send_frame` (una imagen
 * por imagen: 25p, la mitad de trabajo que 50p y de sobra con poca conexión).
 */
export function liteVideoArgs(interlaced = false): string[] {
  const filters = [
    ...(interlaced ? ['bwdif=mode=send_frame'] : []),
    `scale=-2:'min(${LITE_HEIGHT},ih)'`,
  ];
  return [
    '-vf',
    filters.join(','),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-tune',
    'zerolatency',
    '-profile:v',
    'high',
    '-pix_fmt',
    'yuv420p',
    '-crf',
    '24',
    '-maxrate',
    LITE_MAXRATE,
    '-bufsize',
    '5000k',
    '-g',
    '250',
    '-sc_threshold',
    '0',
    '-force_key_frames',
    'expr:gte(t,n_forced*2)',
  ];
}

// --- La gráfica del NAS (VAAPI, docs/ver-juntos.md §17.6; el ensayo está en hwaccel.ts) ---

/** Nombre del dispositivo dentro de ffmpeg (`-init_hw_device vaapi=va:…`). */
export const VAAPI_DEVICE_NAME = 'va';

/** Lo que el ensayo dejó listo para usar la gráfica. */
export interface VaapiProfile {
  readonly device: string;
  /** `-low_power 1` (VDENC). */
  readonly lowPower: boolean;
  /** `VBR` (caudal, como la ligera de x264) o `CQP` (calidad fija, sin HuC). */
  readonly rateControl: 'VBR' | 'CQP';
  /** `deinterlace_vaapi` funciona: el desentrelazado de la IPTV también va por la gráfica. */
  readonly deinterlace: boolean;
  /** Códec RFC 6381 de la ligera del VOD con este codificador (del `avcC` del ensayo). */
  readonly liteCodecs: string;
}

/** Caudales de un codificador de la gráfica. */
export interface VaapiRate {
  readonly bitrate: string;
  readonly maxrate: string;
  readonly bufsize: string;
  /** Con `CQP`. */
  readonly qp: number;
}

/**
 * La ligera (VOD y directo): el techo y el búfer de la de x264 (`LITE_MAXRATE`, 5000k) y un
 * objetivo de 1,5 Mb/s (x264 con CRF 23 sacaba ~1 Mb/s en 720p; VDENC necesita algo más).
 */
export const VAAPI_LITE_RATE: VaapiRate = {
  bitrate: '1500k',
  maxrate: LITE_MAXRATE,
  bufsize: '5000k',
  qp: 25,
};
/** El desentrelazado (1080p50): el techo de x264 (12M) con un objetivo de 8 Mb/s. */
export const VAAPI_DEINTERLACE_RATE: VaapiRate = {
  bitrate: '8M',
  maxrate: '12M',
  bufsize: '12M',
  qp: 22,
};

/**
 * Delante de `-i`: abre la gráfica, decodifica con ella y deja las imágenes en ella. Si el
 * decodificador no puede (un perfil raro), ffmpeg decodifica en la CPU y `VAAPI_UPLOAD` las sube.
 */
export function vaapiInputArgs(device: string): string[] {
  return [
    ...['-init_hw_device', `vaapi=${VAAPI_DEVICE_NAME}:${device}`],
    ...['-filter_hw_device', VAAPI_DEVICE_NAME],
    ...['-hwaccel', 'vaapi', '-hwaccel_device', VAAPI_DEVICE_NAME],
    ...['-hwaccel_output_format', 'vaapi'],
  ];
}

/** Primer filtro: deja pasar lo que ya está en la gráfica y sube lo que no (decodificado en la CPU). */
export const VAAPI_UPLOAD = 'format=nv12|vaapi,hwupload';

/** `scale=-2:'min(720,ih)'` en la gráfica: el mismo ancho par y sin agrandar. */
export function vaapiScale(height: number = LITE_HEIGHT): string {
  return `scale_vaapi=w=-2:h='min(${height},ih)':format=nv12`;
}

/**
 * `h264_vaapi` High 8 bits sin fotogramas B. `level` (solo la ligera del VOD) va en número
 * (`40`): «4.0» no es ninguna de sus constantes y se leería como 4.
 */
export function vaapiEncoderArgs(
  profile: Pick<VaapiProfile, 'lowPower' | 'rateControl'>,
  rate: VaapiRate,
  options: { readonly gop: number; readonly level?: string } = { gop: 250 },
): string[] {
  return [
    ...['-c:v', 'h264_vaapi'],
    ...(profile.lowPower ? ['-low_power', '1'] : []),
    ...['-profile:v', 'high'],
    ...(options.level ? ['-level:v', options.level] : []),
    ...(profile.rateControl === 'VBR'
      ? [
          '-rc_mode',
          'VBR',
          '-b:v',
          rate.bitrate,
          '-maxrate',
          rate.maxrate,
          '-bufsize',
          rate.bufsize,
        ]
      : ['-rc_mode', 'CQP', '-qp', String(rate.qp)]),
    ...['-bf', '0', '-g', String(options.gop)],
  ];
}

/** Nivel H.264 de la ligera del VOD con `h264_vaapi` (el 4.0 de x264, en número). */
export const VAAPI_LITE_LEVEL = '40';

/**
 * ¿Puede ir por la gráfica una generación del directo que recodifica? La ligera progresiva, sí; lo
 * entrelazado (desentrelazar, con o sin ligera), solo si el ensayo de `deinterlace_vaapi` salió.
 */
export function liveUsesVaapi(
  vaapi: VaapiProfile | null | undefined,
  recode: { readonly lite?: boolean; readonly deinterlace?: boolean },
): vaapi is VaapiProfile {
  if (!vaapi || !(recode.lite || recode.deinterlace)) return false;
  return !recode.deinterlace || vaapi.deinterlace;
}

/**
 * El vídeo del directo por la gráfica: lo mismo que `deinterlaceVideoArgs` / `liteVideoArgs` con
 * `deinterlace_vaapi` (un campo por imagen al desentrelazar; una imagen por imagen en la ligera),
 * `scale_vaapi` y `h264_vaapi`, sin B y con la clave cada 2 s exactos.
 */
export function vaapiLiveVideoArgs(
  vaapi: VaapiProfile,
  recode: { readonly lite?: boolean; readonly deinterlace?: boolean },
): string[] {
  const filters = [
    VAAPI_UPLOAD,
    ...(recode.deinterlace ? [`deinterlace_vaapi=rate=${recode.lite ? 'frame' : 'field'}`] : []),
    ...(recode.lite ? [vaapiScale()] : []),
  ];
  return [
    '-vf',
    filters.join(','),
    ...vaapiEncoderArgs(vaapi, recode.lite ? VAAPI_LITE_RATE : VAAPI_DEINTERLACE_RATE, {
      gop: 250,
    }),
    '-force_key_frames',
    'expr:gte(t,n_forced*2)',
  ];
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
  const hw = liveUsesVaapi(input.vaapi, input) ? input.vaapi : null;
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
    /* La gráfica (§17.6): solo cuando se recodifica, y delante de -i (decodifica ella). */
    ...(hw ? vaapiInputArgs(hw.device) : []),
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
       disposición de canales es fatal. La IPTV entrelazada para el iPhone, desentrelazada (0.9.2). */
    ...(hw
      ? vaapiLiveVideoArgs(hw, input)
      : input.lite
        ? liteVideoArgs(input.deinterlace)
        : input.deinterlace
          ? deinterlaceVideoArgs()
          : ['-c:v', 'copy', '-copyinkf']),
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
    /* Los hilos de x264; con la gráfica no codifica la CPU. */
    ...((input.deinterlace || input.lite) && !hw
      ? ['-threads:v', String(DEINTERLACE_THREADS)]
      : []),
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
