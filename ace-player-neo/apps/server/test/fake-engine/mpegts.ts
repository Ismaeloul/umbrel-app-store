/* Generador de MPEG-TS sintético para el motor falso.

   Objetivo: que lo que sale del motor falso se parezca a un canal de verdad
   lo bastante como para que:
   - `analyzeTransportStream` de la 0.6.59 saque el códec de la PMT y el
     bitrate de los PCR (la PMT lleva 0x1b/0x24 y 0x0f/0x03/0x81, y los PCR van
     pegados al byte en que sale cada paquete, como en un múltiplex CBR);
   - mpegts.js, hls.js y ffmpeg puedan demultiplexarlo y el vídeo H.264 se
     pueda DECODIFICAR (así las pruebas E2E llegan a "reproduciendo").

   Qué se genera:
   - Vídeo H.264 Constrained Baseline de 160x96 a 25 fps, GOP de 1 s: cada
     segundo empieza con un IDR hecho de macrobloques I_PCM (imagen de un color
     sacado del infohash, con una barra blanca que se mueve cada segundo para
     que se note que es "en directo") y el resto son P con todos los
     macrobloques saltados. No hace falta codificador: I_PCM lleva los
     píxeles en crudo y P_Skip no lleva nada.
   - HEVC: solo cabeceras NAL con relleno. Se detecta por la PMT (0x24) pero
     NO se puede decodificar; sirve para probar "códec no compatible".
   - Audio: AAC-LC estéreo en ADTS (trama de silencio de hls.js) y MP2 (capa
     II con todas las asignaciones a cero, que es silencio válido) se pueden
     decodificar. AC-3 lleva cabecera y tamaño de trama correctos para que se
     detecte, pero su contenido no es decodificable.
   - Relleno con paquetes nulos (PID 0x1FFF) hasta el bitrate pedido, como
     hace un múltiplex CBR. analyzeTransportStream cuenta todos los bytes entre
     dos PCR, así que el bitrate medido es exactamente el configurado.

   La línea de tiempo es la del contenido (segundos desde la "época" del motor
   falso). Un segmento HLS es el trozo [inicio, fin) de esa línea generado de
   forma determinista: dos peticiones del mismo segmento dan los mismos bytes. */

export type VideoCodec = 'h264' | 'hevc';
export type AudioCodec = 'aac' | 'mp2' | 'ac3';

export const TS_PACKET_SIZE = 188;
const TS_PACKET_BITS = TS_PACKET_SIZE * 8;
export const PID_PAT = 0x0000;
export const PID_PMT = 0x1000;
export const PID_VIDEO = 0x0100;
export const PID_AUDIO_FIRST = 0x0101;
export const PID_NULL = 0x1fff;

export const VIDEO_STREAM_TYPE: Record<VideoCodec, number> = { h264: 0x1b, hevc: 0x24 };
export const AUDIO_STREAM_TYPE: Record<AudioCodec, number> = { aac: 0x0f, mp2: 0x03, ac3: 0x81 };

export const FPS = 25;
export const GOP_FRAMES = 25;
export const VIDEO_WIDTH = 160;
export const VIDEO_HEIGHT = 96;
const WIDTH_MBS = VIDEO_WIDTH / 16;
const HEIGHT_MBS = VIDEO_HEIGHT / 16;
const MB_COUNT = WIDTH_MBS * HEIGHT_MBS;

const AUDIO_RATE = 48000;
/* Todos los relojes del TS arrancan 10 s por delante de la línea de tiempo
   (nada de PTS 0) y la presentación va 0,7 s por detrás del PCR: de sobra
   para que el IDR entero (unos 130 paquetes) llegue antes de su PTS incluso
   al bitrate mínimo. */
const TIME_BASE_S = 10;
const PTS_DELAY_S = 0.7;
const PTS_WRAP = 2 ** 33;
const PCR_WRAP = PTS_WRAP * 300;
const PSI_INTERVAL_S = 0.1;
const PCR_INTERVAL_S = 0.04;

/* Por debajo de esto no caben el IDR de cada segundo y el audio; por encima,
   un canal de TDT en HD no pasa de ~20 Mbit/s. */
export const MIN_BITRATE_KBPS = 1000;
export const MAX_BITRATE_KBPS = 20000;

// ---------------------------------------------------------------------------
// Utilidades de bits y CRC

class BitWriter {
  private readonly out: number[] = [];
  private acc = 0;
  private count = 0;

  bit(value: number): void {
    this.acc = (this.acc << 1) | (value & 1);
    this.count += 1;
    if (this.count === 8) {
      this.out.push(this.acc);
      this.acc = 0;
      this.count = 0;
    }
  }

  u(bits: number, value: number): void {
    for (let i = bits - 1; i >= 0; i -= 1) this.bit(Math.floor(value / 2 ** i) % 2);
  }

  ue(value: number): void {
    const x = value + 1;
    const length = 32 - Math.clz32(x);
    this.u(length - 1, 0);
    this.u(length, x);
  }

  se(value: number): void {
    this.ue(value <= 0 ? -2 * value : 2 * value - 1);
  }

  alignZero(): void {
    while (this.count !== 0) this.bit(0);
  }

  trailing(): void {
    this.bit(1);
    this.alignZero();
  }

  bytes(data: Uint8Array): void {
    if (this.count !== 0) throw new Error('BitWriter: bytes() sin alinear');
    for (const byte of data) this.out.push(byte);
  }

  toBuffer(): Buffer {
    if (this.count !== 0) throw new Error('BitWriter: flujo sin alinear');
    return Buffer.from(this.out);
  }
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

/* CRC-32/MPEG-2 de las tablas PSI (sin reflejar, sin XOR final). */
export function crc32Mpeg2(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = ((crc << 8) ^ (CRC32_TABLE[((crc >>> 24) ^ byte) & 0xff] ?? 0)) >>> 0;
  }
  return crc >>> 0;
}

/* Bytes de prevención de emulación: dentro de un NAL no puede aparecer
   00 00 0x con x <= 3, o el demultiplexor lo tomaría por un código de inicio. */
function escapeRbsp(rbsp: Buffer): Buffer {
  const out: number[] = [];
  let zeros = 0;
  for (const byte of rbsp) {
    if (zeros >= 2 && byte <= 3) {
      out.push(3);
      zeros = 0;
    }
    out.push(byte);
    zeros = byte === 0 ? zeros + 1 : 0;
  }
  return Buffer.from(out);
}

const START_CODE = Buffer.from([0, 0, 0, 1]);

function nal(header: number[], rbsp: Buffer): Buffer {
  return Buffer.concat([START_CODE, Buffer.from(header), escapeRbsp(rbsp)]);
}

// ---------------------------------------------------------------------------
// H.264

const H264_AUD = nal([0x09], Buffer.from([0xf0]));

const H264_SPS = (() => {
  const w = new BitWriter();
  w.u(8, 66); // profile_idc: Baseline
  w.u(8, 0xc0); // constraint_set0 y set1: Constrained Baseline (avc1.42C01E)
  w.u(8, 30); // level_idc 3.0
  w.ue(0); // seq_parameter_set_id
  w.ue(1); // log2_max_frame_num_minus4 -> frame_num de 5 bits (el GOP de 25 no da la vuelta)
  w.ue(2); // pic_order_cnt_type 2: orden de salida = orden de decodificación
  w.ue(1); // max_num_ref_frames
  w.u(1, 0); // gaps_in_frame_num_value_allowed_flag
  w.ue(WIDTH_MBS - 1);
  w.ue(HEIGHT_MBS - 1);
  w.u(1, 1); // frame_mbs_only_flag
  w.u(1, 1); // direct_8x8_inference_flag
  w.u(1, 0); // frame_cropping_flag
  w.u(1, 1); // vui_parameters_present_flag
  w.u(1, 0); // aspect_ratio_info_present_flag
  w.u(1, 0); // overscan_info_present_flag
  w.u(1, 0); // video_signal_type_present_flag
  w.u(1, 0); // chroma_loc_info_present_flag
  w.u(1, 1); // timing_info_present_flag
  w.u(32, 1); // num_units_in_tick
  w.u(32, FPS * 2); // time_scale: 25 fps
  w.u(1, 1); // fixed_frame_rate_flag
  w.u(1, 0); // nal_hrd_parameters_present_flag
  w.u(1, 0); // vcl_hrd_parameters_present_flag
  w.u(1, 0); // pic_struct_present_flag
  w.u(1, 1); // bitstream_restriction_flag: sin reordenar, salida inmediata
  w.u(1, 1); // motion_vectors_over_pic_boundaries_flag
  w.ue(0); // max_bytes_per_pic_denom
  w.ue(0); // max_bits_per_mb_denom
  w.ue(16); // log2_max_mv_length_horizontal
  w.ue(16); // log2_max_mv_length_vertical
  w.ue(0); // max_num_reorder_frames
  w.ue(1); // max_dec_frame_buffering
  w.trailing();
  return nal([0x67], w.toBuffer());
})();

const H264_PPS = (() => {
  const w = new BitWriter();
  w.ue(0); // pic_parameter_set_id
  w.ue(0); // seq_parameter_set_id
  w.u(1, 0); // entropy_coding_mode_flag: CAVLC
  w.u(1, 0); // bottom_field_pic_order_in_frame_present_flag
  w.ue(0); // num_slice_groups_minus1
  w.ue(0); // num_ref_idx_l0_default_active_minus1
  w.ue(0); // num_ref_idx_l1_default_active_minus1
  w.u(1, 0); // weighted_pred_flag
  w.u(2, 0); // weighted_bipred_idc
  w.se(0); // pic_init_qp_minus26
  w.se(0); // pic_init_qs_minus26
  w.se(0); // chroma_qp_index_offset
  w.u(1, 0); // deblocking_filter_control_present_flag
  w.u(1, 0); // constrained_intra_pred_flag
  w.u(1, 0); // redundant_pic_cnt_present_flag
  w.trailing();
  return nal([0x68], w.toBuffer());
})();

export interface PictureColor {
  y: number;
  cb: number;
  cr: number;
}

/* Color de un canal a partir de su infohash: cada canal se ve distinto en
   las capturas de las pruebas E2E. Todo dentro del rango de vídeo (16-235). */
export function colorFromSeed(seed: string): PictureColor {
  const hex = seed.replace(/[^0-9a-f]/gi, '').padEnd(6, '0');
  const byte = (i: number) => Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16) || 0;
  return { y: 60 + (byte(0) % 120), cb: 64 + (byte(1) % 128), cr: 64 + (byte(2) % 128) };
}

function h264IdrSlice(color: PictureColor, barColumn: number, idrPicId: number): Buffer {
  const w = new BitWriter();
  w.ue(0); // first_mb_in_slice
  w.ue(7); // slice_type: I (todas las del cuadro)
  w.ue(0); // pic_parameter_set_id
  w.u(5, 0); // frame_num
  w.ue(idrPicId);
  w.u(1, 0); // no_output_of_prior_pics_flag
  w.u(1, 0); // long_term_reference_flag
  w.se(0); // slice_qp_delta
  const plain = Buffer.alloc(256, color.y);
  const bar = Buffer.alloc(256, 235);
  const cb = Buffer.alloc(64, color.cb);
  const cr = Buffer.alloc(64, color.cr);
  for (let mb = 0; mb < MB_COUNT; mb += 1) {
    w.ue(25); // mb_type I_PCM
    w.alignZero(); // pcm_alignment_zero_bit
    w.bytes(mb % WIDTH_MBS === barColumn ? bar : plain);
    w.bytes(cb);
    w.bytes(cr);
  }
  w.trailing();
  return nal([0x65], w.toBuffer());
}

function h264PSlice(frameNum: number): Buffer {
  const w = new BitWriter();
  w.ue(0); // first_mb_in_slice
  w.ue(5); // slice_type: P
  w.ue(0); // pic_parameter_set_id
  w.u(5, frameNum);
  w.u(1, 0); // num_ref_idx_active_override_flag
  w.u(1, 0); // ref_pic_list_modification_flag_l0
  w.u(1, 0); // adaptive_ref_pic_marking_mode_flag
  w.se(0); // slice_qp_delta
  w.ue(MB_COUNT); // mb_skip_run: todo el cuadro repite el anterior
  w.trailing();
  return nal([0x41], w.toBuffer());
}

// ---------------------------------------------------------------------------
// HEVC (solo para detección)

function hevcNal(type: number, length: number): Buffer {
  return Buffer.concat([START_CODE, Buffer.from([type << 1, 1]), Buffer.alloc(length, 0xaa)]);
}

const HEVC_IDR = Buffer.concat([
  hevcNal(35, 1), // AUD
  hevcNal(32, 20), // VPS
  hevcNal(33, 40), // SPS
  hevcNal(34, 8), // PPS
  hevcNal(19, MB_COUNT * 385), // IDR_W_RADL, del mismo tamaño que el IDR H.264
]);
const HEVC_P = Buffer.concat([hevcNal(35, 1), hevcNal(1, 40)]);

// ---------------------------------------------------------------------------
// Audio

interface AudioSpec {
  samplesPerFrame: number;
  frame: Buffer;
}

function adts(raw: number[]): Buffer {
  const length = 7 + raw.length;
  return Buffer.from([
    0xff,
    0xf1, // MPEG-4, sin CRC
    0x4c, // AAC LC, 48 kHz
    0x80 | (length >> 11), // 2 canales
    (length >> 3) & 0xff,
    ((length & 7) << 5) | 0x1f,
    0xfc,
    ...raw,
  ]);
}

const AUDIO_SPECS: Record<AudioCodec, AudioSpec> = {
  // trama de silencio AAC-LC estéreo (la que usa hls.js para rellenar huecos)
  aac: {
    samplesPerFrame: 1024,
    frame: adts([0x21, 0x00, 0x49, 0x90, 0x02, 0x19, 0x00, 0x23, 0x80]),
  },
  // MPEG-1 capa II, 128 kbit/s, 48 kHz, estéreo: 384 bytes con asignaciones a cero
  mp2: {
    samplesPerFrame: 1152,
    frame: Buffer.concat([Buffer.from([0xff, 0xfd, 0x84, 0x00]), Buffer.alloc(380)]),
  },
  // AC-3 192 kbit/s, 48 kHz, 2/0: una trama de silencio DE VERDAD (768 bytes, con
  // sus CRC), sacada de `ffmpeg -f lavfi -i anullsrc=r=48000:cl=stereo -c:a ac3
  // -b:a 192k`. Con la de antes (solo cabecera y ceros) ffmpeg no podía
  // decodificar el audio y el remux IPTV (AC-3 → AAC) no sacaba nada.
  ac3: {
    samplesPerFrame: 1536,
    frame: Buffer.from(
      'C3dQUhRAQ+EG9GNwgICCEBAQQVx8+fPnz58+fPnz58+fPnz58+fPnz58+fPv+dXz58+fPnz58+fPnz58+fPnz58+' +
        'fPnz58+fPnz58+fPnz58+fPj/nV8+fPnz58+fPnz58+fPnz58+fPnz58+fPnz58+fPnz58+fPnz4y/xRIkSAAAAA' +
        'AHjbbbbx48eO7u7gAAAAAAAAAAAAAAAAAAAAAB3d3d48eNttvnzWta1rWta1rWta1oAAAAB422228ePHju7u4AAA' +
        'AAAAAAAAAAAAAAAAAAAd3d3ePHjbbb581rWta1rWta1rWtaYAAAAAAAHjbbbbx48eO7u7gAAAAAAAAAAAAAAAAAA' +
        'AAAB3d3d48eNttvnzWta1rWta1rWta1oAAAAB422228ePHju7u4AAAAAAAAAAAAAAAAAAAAAAd3d3ePHjbbb581r' +
        'Wta1rWta1rWtaYAAAAAAAHjbbbbx48eO7u7gAAAAAAAAAAAAAAAAAAAAAB3d3d48eNttvnzWta1rWta1rWta1oAA' +
        'AAB422228ePHju7u4AAAAAAAAAAAAAAAAAAAAAAd3d3ePHjbbb581rWta1rWta1rWtaYAAAAAAAHjbbbbx48eO7u' +
        '7gAAAAAAAAAAAAAAAAAAAAAB3d3d48eNttvnzWta1rWta1rWta1oAAAAB422228ePHju7u4AAAAAAAAAAAAAAAAA' +
        'AAAAAd3d3ePHjbbb581rWta1rWta1rWtaYAAAAAAAHjbbbbx48eO7u7gAAAAAAAAAAAAAAAAAAAAAB3d3d48eNtt' +
        'vnzWta1rWta1rWta1oAAAAB422228ePHju7u4AAAAAAAAAAAAAAAAAAAAAAd3d3ePHjbbb581rWta1rWta1rWtaY' +
        'AAAAAAAHjbbbbx48eO7u7gAAAAAAAAAAAAAAAAAAAAAB3d3d48eNttvnzWta1rWta1rWta1oAAAAB422228ePHju' +
        '7u4AAAAAAAAAAAAAAAAAAAAAAd3d3ePHjbbb581rWta1rWta1rWtaPR7',
      'base64',
    ),
  },
};

// ---------------------------------------------------------------------------
// Unidades de acceso de vídeo (con caché: el IDR cuesta ~23 KB de bits)

const videoCache = new Map<string, Buffer>();

function cached(key: string, build: () => Buffer): Buffer {
  let value = videoCache.get(key);
  if (!value) {
    value = build();
    if (videoCache.size > 512) videoCache.clear();
    videoCache.set(key, value);
  }
  return value;
}

/* Cuadro `frame` (índice absoluto desde la época) de un canal. */
export function videoAccessUnit(codec: VideoCodec, color: PictureColor, frame: number): Buffer {
  const inGop = frame % GOP_FRAMES;
  const gop = Math.floor(frame / GOP_FRAMES);
  if (codec === 'hevc') return inGop === 0 ? HEVC_IDR : HEVC_P;
  if (inGop === 0) {
    const bar = gop % WIDTH_MBS;
    const idrPicId = gop % 2;
    return cached(`idr:${color.y}:${color.cb}:${color.cr}:${bar}:${idrPicId}`, () =>
      Buffer.concat([H264_AUD, H264_SPS, H264_PPS, h264IdrSlice(color, bar, idrPicId)]),
    );
  }
  return cached(`p:${inGop}`, () => Buffer.concat([H264_AUD, h264PSlice(inGop)]));
}

// ---------------------------------------------------------------------------
// PES y paquetes TS

function writeTimestamp(target: Buffer, offset: number, prefix: number, ts: number): void {
  // redondeo: 10,7 s x 90 kHz no es exacto en coma flotante y un tick de más o
  // de menos rompería el paso constante de 3600 entre cuadros
  const value = Math.round(ts) % PTS_WRAP;
  const high = Math.floor(value / 2 ** 30);
  const mid = Math.floor(value / 2 ** 15) % 2 ** 15;
  const low = value % 2 ** 15;
  target[offset] = (prefix << 4) | (high << 1) | 1;
  target[offset + 1] = mid >> 7;
  target[offset + 2] = ((mid & 0x7f) << 1) | 1;
  target[offset + 3] = low >> 7;
  target[offset + 4] = ((low & 0x7f) << 1) | 1;
}

function pes(streamId: number, pts90k: number, payload: Buffer, bounded: boolean): Buffer {
  const header = Buffer.alloc(14);
  header[0] = 0;
  header[1] = 0;
  header[2] = 1;
  header[3] = streamId;
  const length = 8 + payload.length;
  // el vídeo puede ir sin longitud (0); el audio la necesita
  header.writeUInt16BE(bounded || length <= 0xffff ? Math.min(length, 0xffff) : 0, 4);
  header[6] = 0x84; // '10', data_alignment_indicator
  header[7] = 0x80; // solo PTS
  header[8] = 5;
  writeTimestamp(header, 9, 0x2, pts90k);
  return Buffer.concat([header, payload]);
}

function writePcr(target: Buffer, offset: number, pcr27: number): void {
  const value = pcr27 % PCR_WRAP;
  const base = Math.floor(value / 300);
  const ext = value % 300;
  target[offset] = Math.floor(base / 2 ** 25) % 256;
  target[offset + 1] = Math.floor(base / 2 ** 17) % 256;
  target[offset + 2] = Math.floor(base / 2 ** 9) % 256;
  target[offset + 3] = Math.floor(base / 2) % 256;
  target[offset + 4] = ((base % 2) << 7) | 0x7e | (ext >> 8);
  target[offset + 5] = ext & 0xff;
}

interface PacketParts {
  pid: number;
  pusi: boolean;
  cc: number;
  payload: Buffer;
  pcr27?: number;
  discontinuity?: boolean;
  randomAccess?: boolean;
  /* PSI: lo que sobra de la carga se rellena con 0xFF (lo normal en tablas)
     en vez de meter relleno en el campo de adaptación. */
  padPayload?: boolean;
}

function adaptationFlagsLength(parts: {
  pcr27?: number;
  discontinuity?: boolean;
  randomAccess?: boolean;
}): number {
  const hasFlags = parts.pcr27 !== undefined || !!parts.discontinuity || !!parts.randomAccess;
  if (!hasFlags) return -1;
  return 1 + (parts.pcr27 !== undefined ? 6 : 0);
}

/* Cuánta carga cabe en un paquete con esas banderas. */
function payloadCapacity(parts: {
  pcr27?: number;
  discontinuity?: boolean;
  randomAccess?: boolean;
}): number {
  const minAf = adaptationFlagsLength(parts);
  return minAf < 0 ? 184 : 184 - 1 - minAf;
}

function writePacket(target: Buffer, offset: number, parts: PacketParts): void {
  const minAf = adaptationFlagsLength(parts);
  let afLength: number; // -1: sin campo de adaptación
  let region: number;
  if (parts.padPayload) {
    afLength = minAf;
    region = 184 - (afLength >= 0 ? 1 + afLength : 0);
  } else if (parts.payload.length === 0) {
    afLength = 183;
    region = 0;
  } else if (parts.payload.length === 184 && minAf < 0) {
    afLength = -1;
    region = 184;
  } else {
    afLength = 183 - parts.payload.length;
    region = parts.payload.length;
    if (afLength < Math.max(0, minAf)) throw new Error('carga demasiado grande para un paquete TS');
  }
  if (parts.payload.length > region) throw new Error('carga demasiado grande para un paquete TS');
  target.fill(0xff, offset, offset + TS_PACKET_SIZE);
  const afc = (afLength >= 0 ? 2 : 0) | (region > 0 ? 1 : 0);
  target[offset] = 0x47;
  target[offset + 1] = (parts.pusi ? 0x40 : 0) | ((parts.pid >> 8) & 0x1f);
  target[offset + 2] = parts.pid & 0xff;
  target[offset + 3] = (afc << 4) | (parts.cc & 0x0f);
  let cursor = offset + 4;
  if (afLength >= 0) {
    target[cursor] = afLength;
    if (afLength > 0) {
      target[cursor + 1] =
        (parts.discontinuity ? 0x80 : 0) |
        (parts.randomAccess ? 0x40 : 0) |
        (parts.pcr27 !== undefined ? 0x10 : 0);
      if (parts.pcr27 !== undefined) writePcr(target, cursor + 2, parts.pcr27);
    }
    cursor += 1 + afLength;
  }
  parts.payload.copy(target, cursor);
}

function psiSection(tableId: number, idField: number, body: Buffer): Buffer {
  const sectionLength = 5 + body.length + 4;
  const head = Buffer.from([
    tableId,
    0xb0 | ((sectionLength >> 8) & 0x0f),
    sectionLength & 0xff,
    (idField >> 8) & 0xff,
    idField & 0xff,
    0xc1, // versión 0, current_next_indicator
    0x00,
    0x00,
  ]);
  const withoutCrc = Buffer.concat([head, body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32Mpeg2(withoutCrc), 0);
  return Buffer.concat([Buffer.from([0x00]), withoutCrc, crc]); // con pointer_field
}

function patSection(): Buffer {
  const body = Buffer.from([0x00, 0x01, 0xe0 | (PID_PMT >> 8), PID_PMT & 0xff]);
  return psiSection(0x00, 1, body);
}

function pmtSection(video: VideoCodec, audio: readonly AudioCodec[]): Buffer {
  const entries: number[] = [0xe0 | (PID_VIDEO >> 8), PID_VIDEO & 0xff, 0xf0, 0x00];
  const streams: Array<[number, number]> = [[VIDEO_STREAM_TYPE[video], PID_VIDEO]];
  audio.forEach((codec, index) =>
    streams.push([AUDIO_STREAM_TYPE[codec], PID_AUDIO_FIRST + index]),
  );
  for (const [type, pid] of streams) entries.push(type, 0xe0 | (pid >> 8), pid & 0xff, 0xf0, 0x00);
  return psiSection(0x02, 1, Buffer.from(entries));
}

// ---------------------------------------------------------------------------
// Múltiplex CBR

export interface MuxOptions {
  video: VideoCodec;
  audio: readonly AudioCodec[];
  bitrateKbps: number;
  /* Segundo (entero) de la línea de tiempo en que empieza: siempre es un
     principio de GOP, así el primer cuadro es un IDR. */
  startSec: number;
  /* Fin exclusivo, para segmentos HLS. Sin él, el flujo no se acaba. */
  endSec?: number;
  color: PictureColor;
  /* Segmentos HLS: cada segmento se genera por separado y sus contadores de
     continuidad empiezan de cero, así que el primer paquete de cada PID lleva
     discontinuity_indicator (si no, ffmpeg marcaría como corrupto el IDR con
     el que empieza cada segmento y el remux con +discardcorrupt lo tiraría). */
  markDiscontinuity?: boolean;
}

interface PesItem {
  pid: number;
  data: Buffer;
  offset: number;
  timeSec: number;
  key: boolean;
}

export class TsMuxer {
  readonly bitrate: number;
  private readonly pcrTicksPerSlot: number;
  private slot: number;
  private readonly endSlot: number;
  private readonly endFrame: number;
  private readonly audioEnd: number[];
  private nextFrame: number;
  private readonly nextAudio: number[];
  private nextPsiSec: number;
  private lastPcrSec: number | null = null;
  private readonly psiPending: number[] = [];
  private readonly queues = new Map<number, PesItem[]>();
  private readonly cc = new Map<number, number>();
  private readonly discontinuityPending = new Set<number>();
  private readonly pat: Buffer;
  private readonly pmt: Buffer;
  private readonly audioSpecs: AudioSpec[];

  constructor(private readonly options: MuxOptions) {
    const kbps = Math.round(options.bitrateKbps);
    if (!(kbps >= MIN_BITRATE_KBPS && kbps <= MAX_BITRATE_KBPS)) {
      throw new Error(`bitrate fuera de rango (${MIN_BITRATE_KBPS}-${MAX_BITRATE_KBPS} kbit/s)`);
    }
    if (!Number.isInteger(options.startSec) || options.startSec < 0)
      throw new Error('startSec debe ser un entero >= 0');
    this.bitrate = kbps * 1000;
    this.pcrTicksPerSlot = (TS_PACKET_BITS * 27_000_000) / this.bitrate;
    this.slot = Math.ceil((options.startSec * this.bitrate) / TS_PACKET_BITS);
    const end = options.endSec;
    this.endSlot =
      end === undefined
        ? Number.POSITIVE_INFINITY
        : Math.ceil((end * this.bitrate) / TS_PACKET_BITS);
    this.endFrame = end === undefined ? Number.POSITIVE_INFINITY : end * FPS;
    this.nextFrame = options.startSec * FPS;
    this.audioSpecs = options.audio.map((codec) => AUDIO_SPECS[codec]);
    this.nextAudio = this.audioSpecs.map((spec) =>
      Math.ceil((options.startSec * AUDIO_RATE) / spec.samplesPerFrame),
    );
    this.audioEnd = this.audioSpecs.map((spec) =>
      end === undefined
        ? Number.POSITIVE_INFINITY
        : Math.ceil((end * AUDIO_RATE) / spec.samplesPerFrame),
    );
    this.nextPsiSec = options.startSec;
    this.pat = patSection();
    this.pmt = pmtSection(options.video, options.audio);
    const pids = [PID_PAT, PID_PMT, PID_VIDEO, ...options.audio.map((_, i) => PID_AUDIO_FIRST + i)];
    for (const pid of pids) {
      this.cc.set(pid, 0);
      if (pid !== PID_PAT && pid !== PID_PMT) this.queues.set(pid, []);
      if (options.markDiscontinuity) this.discontinuityPending.add(pid);
    }
  }

  /* Siguientes `count` paquetes del flujo (progresivo). */
  nextPackets(count: number): Buffer {
    const out = Buffer.allocUnsafe(Math.max(0, count) * TS_PACKET_SIZE);
    for (let i = 0; i < count; i += 1) this.emitSlot(out, i * TS_PACKET_SIZE);
    return out;
  }

  /* Segmento completo: todas las ranuras hasta el final y, si al acabar queda
     algo en cola (no debería al bitrate mínimo), se vacía sin PCR. */
  finish(): Buffer {
    if (!Number.isFinite(this.endSlot)) throw new Error('finish() solo para segmentos con fin');
    const slots = Math.max(0, this.endSlot - this.slot);
    const main = this.nextPackets(slots);
    const extra: Buffer[] = [];
    for (;;) {
      const item = this.oldestQueued();
      if (!item) break;
      const packet = Buffer.allocUnsafe(TS_PACKET_SIZE);
      this.emitData(packet, 0, item, false);
      extra.push(packet);
    }
    return extra.length ? Buffer.concat([main, ...extra]) : main;
  }

  private emitSlot(target: Buffer, offset: number): void {
    // producto exacto de enteros: así el primer cuadro de un segmento cae justo en su ranura
    const t = (this.slot * TS_PACKET_BITS) / this.bitrate;
    const pcr27 = Math.round(this.slot * this.pcrTicksPerSlot + TIME_BASE_S * 27_000_000);
    this.slot += 1;
    this.enqueueUntil(t);
    const psi = this.psiPending.shift();
    if (psi !== undefined) {
      this.writeOwn(target, offset, psi === PID_PAT ? this.pat : this.pmt, psi, true);
      return;
    }
    if (this.lastPcrSec === null || t - this.lastPcrSec >= PCR_INTERVAL_S) {
      this.lastPcrSec = t;
      const video = this.queues.get(PID_VIDEO)?.[0];
      if (video) {
        this.emitData(target, offset, video, true, pcr27);
      } else {
        /* Solo PCR: un paquete sin carga no incrementa el contador de
           continuidad, así que repite el del último paquete con carga. */
        writePacket(target, offset, {
          pid: PID_VIDEO,
          pusi: false,
          cc: ((this.cc.get(PID_VIDEO) ?? 0) + 15) & 0x0f,
          payload: Buffer.alloc(0),
          pcr27,
          discontinuity: this.takeDiscontinuity(PID_VIDEO),
        });
      }
      return;
    }
    const item = this.oldestQueued();
    if (item) {
      this.emitData(target, offset, item, false);
      return;
    }
    writePacket(target, offset, {
      pid: PID_NULL,
      pusi: false,
      cc: 0,
      payload: Buffer.alloc(184, 0xff),
    });
  }

  private enqueueUntil(t: number): void {
    while (this.nextPsiSec <= t) {
      if (this.psiPending.length === 0) this.psiPending.push(PID_PAT, PID_PMT);
      this.nextPsiSec += PSI_INTERVAL_S;
    }
    while (this.nextFrame < this.endFrame && this.nextFrame / FPS <= t) {
      const frame = this.nextFrame;
      this.nextFrame += 1;
      const au = videoAccessUnit(this.options.video, this.options.color, frame);
      const pts = frame * (90000 / FPS) + (TIME_BASE_S + PTS_DELAY_S) * 90000;
      this.queues.get(PID_VIDEO)?.push({
        pid: PID_VIDEO,
        data: pes(0xe0, pts, au, false),
        offset: 0,
        timeSec: frame / FPS,
        key: frame % GOP_FRAMES === 0,
      });
    }
    this.audioSpecs.forEach((spec, index) => {
      const pid = PID_AUDIO_FIRST + index;
      for (;;) {
        const next = this.nextAudio[index] ?? 0;
        const timeSec = (next * spec.samplesPerFrame) / AUDIO_RATE;
        if (next >= (this.audioEnd[index] ?? 0) || timeSec > t) break;
        this.nextAudio[index] = next + 1;
        const pts =
          next * spec.samplesPerFrame * (90000 / AUDIO_RATE) + (TIME_BASE_S + PTS_DELAY_S) * 90000;
        this.queues.get(pid)?.push({
          pid,
          data: pes(0xc0 + index, pts, spec.frame, true),
          offset: 0,
          timeSec,
          key: false,
        });
      }
    });
  }

  private oldestQueued(): PesItem | undefined {
    let best: PesItem | undefined;
    for (const queue of this.queues.values()) {
      const head = queue[0];
      if (head && (!best || head.timeSec < best.timeSec)) best = head;
    }
    return best;
  }

  private takeDiscontinuity(pid: number): boolean {
    return this.discontinuityPending.delete(pid);
  }

  private nextCc(pid: number): number {
    const value = this.cc.get(pid) ?? 0;
    this.cc.set(pid, (value + 1) & 0x0f);
    return value;
  }

  private writeOwn(
    target: Buffer,
    offset: number,
    section: Buffer,
    pid: number,
    pusi: boolean,
  ): void {
    writePacket(target, offset, {
      pid,
      pusi,
      cc: this.nextCc(pid),
      payload: section,
      discontinuity: this.takeDiscontinuity(pid),
      padPayload: true,
    });
  }

  private emitData(
    target: Buffer,
    offset: number,
    item: PesItem,
    withPcr: boolean,
    pcr27?: number,
  ): void {
    const flags = {
      pcr27: withPcr ? pcr27 : undefined,
      discontinuity: this.discontinuityPending.has(item.pid),
      randomAccess: item.key && item.offset === 0,
    };
    const capacity = payloadCapacity(flags);
    const take = Math.min(capacity, item.data.length - item.offset);
    const payload = item.data.subarray(item.offset, item.offset + take);
    writePacket(target, offset, {
      pid: item.pid,
      pusi: item.offset === 0,
      cc: this.nextCc(item.pid),
      payload,
      pcr27: flags.pcr27,
      discontinuity: this.takeDiscontinuity(item.pid),
      randomAccess: flags.randomAccess,
    });
    item.offset += take;
    if (item.offset >= item.data.length) this.queues.get(item.pid)?.shift();
  }
}

/* Segmento HLS [startSec, endSec) de un canal. Determinista. */
export function generateSegment(
  options: Omit<MuxOptions, 'markDiscontinuity'> & { endSec: number },
): Buffer {
  return new TsMuxer({ ...options, markDiscontinuity: true }).finish();
}
