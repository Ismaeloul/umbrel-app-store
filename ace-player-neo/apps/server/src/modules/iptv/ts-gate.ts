/* Puerta de resincronía del relé TS (docs/diagnostico-iptv-0.8.2.md, P1 y A2).

   ffmpeg copia el vídeo tal cual (`-c:v copy -copyinkf`): si le llega un
   empalme que empieza a mitad de GOP, o que repite imagen ya entregada, saca
   cuadros sin sus referencias y Chrome da `PIPELINE_ERROR_DECODE`. La puerta
   se pone delante de ffmpeg y trabaja por paquetes de 188 bytes:

   - Se realinea al 0x47 y guarda el trozo de paquete que queda entre trozos.
   - Guarda la PAT y la PMT (los paquetes tal cual) y aprende de ellas el PID
     del vídeo, su tipo (0x1B H.264, 0x24 HEVC, 0x01/0x02 MPEG-2) y los demás
     PID elementales (audio, subtítulos…).
   - Apunta el último PTS entregado del vídeo y de cada PID elemental. Solo lee
     los paquetes con PUSI y no copia los trozos: lo que pasa sale como
     `subarray` del trozo de entrada.

   Dos modos:
   - `pass`: todo pasa. Dentro de una conexión, una costura en el vídeo (un
     salto del contador de continuidad, `discontinuity_indicator=1`, o el PTS
     que va atrás o adelante más de `seamPtsMs`) pasa a `waitRap` sin exigir
     que el PTS avance (el origen puede haber cambiado de reloj). Si solo ha
     saltado el contador (y el PTS sigue su línea), se marca `lossSeam`: son
     paquetes perdidos, no otra fuente, y el relé no reinicia el remux por
     ella si no llega el fotograma clave.
   - `waitRap`: se tira todo hasta que un PES de vídeo con PUSI es un punto de
     acceso (RAI=1, o un NAL IDR/SPS en H.264, IRAP en HEVC o la cabecera de
     secuencia en MPEG-2, mirando sus 3 primeros paquetes). Con `forward` (una
     reconexión empalmada), además su PTS tiene que ir por delante del último
     entregado (con la vuelta de 33 bits), y el audio que no vaya por delante
     del suyo se sigue tirando. Al encontrarlo se reenvían la PAT y la PMT
     guardadas, IDÉNTICAS byte a byte (si cambiaran, ffmpeg sacaría un init
     nuevo sin discontinuidad y AVPlayer se rompe), y se vuelve a `pass`. Los
     demás PID esperan a su siguiente PUSI con el PTS por delante del punto de
     acceso (menos `AUDIO_LEAD`): el audio muxeado detrás del IDR pero de
     antes no se adelanta a la imagen (salvo que vaya más de `seamPtsMs` por
     detrás: entonces es otro reloj y se deja pasar).

   Costura sin rastro en el TS (lab ts-costura, el patrón de Isma): el origen
   pega dos trozos y se pierde el IDR de la costura, pero el contador y el PTS
   siguen su línea (quien pega vuelve a muxear). Lo único que la delata es el
   `frame_num` de H.264: cada cuadro de referencia lo sube en 1 desde el IDR
   (que es 0), y el P de después de un IDR perdido lleva 1 donde tocaba el
   siguiente del GOP anterior. Por eso, en `pass`, se lee el SPS
   (`log2_max_frame_num`, `gaps_in_frame_num_value_allowed_flag`,
   `frame_mbs_only_flag`) y la cabecera del primer slice de cada PES de
   vídeo: un cuadro entero (de referencia o no) lleva el `frame_num` del
   último de referencia + 1, y solo el segundo campo de un par repite el
   mismo. Cualquier otro es una costura por pérdida (`lossSeam`: la línea de
   tiempo sigue). En el lab el último de referencia lleva 1 y el P de después
   también 1: dejar pasar «el mismo» a un cuadro entero no la veía. Si el
   número cae justo en el siguiente (el GOP anterior acabó en 0 módulo
   2^log2_max_frame_num), no hay forma de verla. Solo si la cabecera está en
   el primer paquete del PES (lo normal en un P o un B; si no, se deja de
   seguir hasta el siguiente): con el PES ya empezado no se puede tirar sin
   dejar a ffmpeg medio cuadro. Solo H.264 (HEVC no tiene `frame_num`).

   Esperas por pérdida (`lossSeam`, auditoría 0.9.0):
   - Lo que dice si la línea de tiempo sigue es el PTS del vídeo VISTO durante
     la espera (cuadro a cuadro), no el último entregado antes de la costura:
     si no, una espera de más de `seamPtsMs` (un GOP de 2 s o más) pasaba a
     «otra fuente» por el mero paso del tiempo y el relé reiniciaba el remux.
   - El audio (y los demás PID) siguen pasando: solo falta imagen, y el sonido
     no se corta. Al volver a `pass` esos PID no esperan a su PUSI.
   - `tolerant` (lo pone el relé cuando la puerta pasa demasiado tiempo
     esperando): las costuras por pérdida se cuentan pero no se esperan, como
     antes de la puerta (un poco de imagen rota antes que parones).

   Sin punto de acceso a tiempo (GOP abierto, refresco intra), quien la usa
   llama a `release()`: la PAT y la PMT y todo lo que venga (el relé reinicia
   el remux). La puerta no tiene relojes: el plazo lo lleva el relé. */

import { IPTV_RELAY } from '@ace/shared';

export const TS_PACKET = 188;
const SYNC = 0x47;
const PID_PAT = 0x0000;
const PID_NULL = 0x1fff;
const PTS_WRAP = 2 ** 33;
const PTS_HALF = 2 ** 32;
/* Paquetes del PES de vídeo en los que se buscan los NAL del punto de acceso. */
const RAP_PACKETS = 3;
/* Una PMT en más paquetes que esto no se guarda (no pasa en la práctica). */
const PMT_MAX_PACKETS = 4;
/* El audio puede empezar hasta esto antes del punto de acceso (unos 2 cuadros de AAC). */
const AUDIO_LEAD = Math.round(0.05 * 90_000);
const SEAM_TICKS = (IPTV_RELAY.seamPtsMs * 90_000) / 1000;

const VIDEO_TYPES = new Set([0x01, 0x02, 0x10, 0x1b, 0x24, 0x42, 0xea]);

export type TsGateMode = 'pass' | 'waitRap';

export interface TsGateWait {
  /** Reconexión empalmada: el vídeo y el audio tienen que ir por delante de lo entregado. */
  readonly forward: boolean;
  /** Conexión nueva: se tira el trozo de paquete que quedaba de la anterior. */
  readonly fresh?: boolean;
}

/** Diferencia `a − b` de dos PTS de 33 bits, en (−2³², 2³²]. */
export function ptsDiff(a: number, b: number): number {
  let diff = (a - b) % PTS_WRAP;
  if (diff < 0) diff += PTS_WRAP;
  if (diff > PTS_HALF) diff -= PTS_WRAP;
  return diff;
}

/* Inicio de la carga de un paquete (null si no lleva). */
function payloadStart(packet: Buffer, offset: number): number | null {
  const afc = ((packet[offset + 3] as number) >> 4) & 0x03;
  if ((afc & 0x01) === 0) return null;
  const start = afc & 0x02 ? offset + 5 + (packet[offset + 4] as number) : offset + 4;
  return start < offset + TS_PACKET ? start : null;
}

/* Banderas del campo de adaptación (0 si no lleva). */
function adaptationFlags(packet: Buffer, offset: number): number {
  const afc = ((packet[offset + 3] as number) >> 4) & 0x03;
  if ((afc & 0x02) === 0 || (packet[offset + 4] as number) === 0) return 0;
  return packet[offset + 5] as number;
}

/* PTS (90 kHz) de la cabecera PES que empieza en `start`, o null. */
function pesPts(packet: Buffer, start: number, end: number): number | null {
  if (start + 14 > end) return null;
  if (packet[start] !== 0 || packet[start + 1] !== 0 || packet[start + 2] !== 1) return null;
  if (((packet[start + 7] as number) & 0x80) === 0) return null;
  const p = start + 9;
  const b0 = packet[p] as number;
  const b1 = packet[p + 1] as number;
  const b2 = packet[p + 2] as number;
  const b3 = packet[p + 3] as number;
  const b4 = packet[p + 4] as number;
  return ((b0 >> 1) & 0x07) * 2 ** 30 + (b1 << 22) + ((b2 >> 1) << 15) + (b3 << 7) + (b4 >> 1);
}

/* ¿Hay un NAL / código de inicio de punto de acceso en los datos del PES? */
function hasRapNal(data: Buffer, streamType: number): boolean {
  for (let i = 0; i + 3 < data.length; i += 1) {
    if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 1) continue;
    const header = data[i + 3] as number;
    if (streamType === 0x1b) {
      const type = header & 0x1f;
      if (type === 5 || type === 7) return true;
    } else if (streamType === 0x24) {
      const type = (header >> 1) & 0x3f;
      if (type >= 16 && type <= 21) return true;
    } else if (streamType === 0x01 || streamType === 0x02) {
      if (header === 0xb3) return true;
    }
    i += 2;
  }
  return false;
}

/* Lo que se usa del SPS de H.264 para seguir el `frame_num`. */
interface AvcSps {
  readonly log2MaxFrameNum: number;
  readonly separateColourPlane: boolean;
  readonly gapsAllowed: boolean;
  /* Sin cuadros por campos (progresivo o MBAFF): no hay `field_pic_flag`. */
  readonly frameMbsOnly: boolean;
}

/* Perfiles de H.264 con los que se sabe leer el SPS (los demás no se siguen). */
const AVC_PROFILES = new Set([
  66, 77, 88, 100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135,
]);
const AVC_HIGH_PROFILES = new Set([100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135]);
/* Bytes del NAL que se leen: lo que ocupa un SPS con listas de escalado. */
const NAL_READ_BYTES = 96;

/* Lector de bits del RBSP de un NAL (sin los bytes 0x03 de prevención). Lanza al pasarse. */
class BitReader {
  private readonly bytes: number[] = [];
  private bit = 0;

  constructor(data: Buffer, from: number, to: number) {
    let zeros = 0;
    for (let i = from; i < to && this.bytes.length < NAL_READ_BYTES; i += 1) {
      const byte = data[i] as number;
      if (zeros >= 2 && byte === 0x03) {
        zeros = 0;
        continue;
      }
      /* Otro código de inicio: el NAL se acaba aquí. */
      if (zeros >= 2 && byte <= 0x01) break;
      this.bytes.push(byte);
      zeros = byte === 0 ? zeros + 1 : 0;
    }
  }

  u(bits: number): number {
    let value = 0;
    for (let i = 0; i < bits; i += 1) {
      const byte = this.bytes[this.bit >> 3];
      if (byte === undefined) throw new RangeError('fin del NAL');
      value = value * 2 + ((byte >> (7 - (this.bit & 7))) & 1);
      this.bit += 1;
    }
    return value;
  }

  ue(): number {
    let zeros = 0;
    while (this.u(1) === 0) {
      zeros += 1;
      if (zeros > 31) throw new RangeError('ue inválido');
    }
    return 2 ** zeros - 1 + this.u(zeros);
  }

  se(): number {
    const value = this.ue();
    return value % 2 ? (value + 1) / 2 : -value / 2;
  }
}

/* SPS de H.264 (lo que se usa), o null si no se entiende. */
function parseAvcSps(data: Buffer, from: number, to: number): AvcSps | null {
  try {
    const r = new BitReader(data, from, to);
    const profile = r.u(8);
    if (!AVC_PROFILES.has(profile)) return null;
    r.u(16); // constraint_set*, level_idc
    if (r.ue() > 31) return null; // seq_parameter_set_id
    let separateColourPlane = false;
    if (AVC_HIGH_PROFILES.has(profile)) {
      const chroma = r.ue();
      if (chroma > 3) return null;
      if (chroma === 3) separateColourPlane = r.u(1) === 1;
      if (r.ue() > 6 || r.ue() > 6) return null; // bit_depth_*_minus8
      r.u(1); // qpprime_y_zero_transform_bypass_flag
      if (r.u(1)) {
        for (let i = 0; i < (chroma === 3 ? 12 : 8); i += 1) {
          if (!r.u(1)) continue;
          let last = 8;
          let next = 8;
          for (let j = 0; j < (i < 6 ? 16 : 64); j += 1) {
            if (next !== 0) next = (last + r.se() + 256) % 256;
            last = next === 0 ? last : next;
          }
        }
      }
    }
    const log2MaxFrameNum = r.ue() + 4;
    if (log2MaxFrameNum > 16) return null;
    const pocType = r.ue();
    if (pocType === 0) {
      if (r.ue() > 12) return null;
    } else if (pocType === 1) {
      r.u(1);
      r.se();
      r.se();
      const cycle = r.ue();
      if (cycle > 255) return null;
      for (let i = 0; i < cycle; i += 1) r.se();
    } else if (pocType !== 2) return null;
    r.ue(); // max_num_ref_frames
    const gapsAllowed = r.u(1) === 1;
    r.ue(); // pic_width_in_mbs_minus1
    r.ue(); // pic_height_in_map_units_minus1
    const frameMbsOnly = r.u(1) === 1;
    return { log2MaxFrameNum, separateColourPlane, gapsAllowed, frameMbsOnly };
  } catch {
    return null;
  }
}

/* El primer slice de un PES de vídeo H.264 (tipo, nal_ref_idc y frame_num). */
interface AvcSlice {
  readonly idr: boolean;
  readonly reference: boolean;
  readonly frameNum: number;
  /* Un campo suelto (`field_pic_flag`): el segundo campo repite el `frame_num` del primero. */
  readonly field: boolean;
}

/* ¿El mismo paquete PSI salvo el contador de continuidad? Entonces se guarda
   el de antes: lo que se reenvía es idéntico a lo que ffmpeg ya vio. */
function samePsi(cached: Buffer, data: Buffer, offset: number): boolean {
  if (cached.compare(data, offset, offset + 3, 0, 3) !== 0) return false;
  if (((cached[3] as number) & 0xf0) !== ((data[offset + 3] as number) & 0xf0)) return false;
  return cached.compare(data, offset + 4, offset + TS_PACKET, 4, TS_PACKET) === 0;
}

/* Sección PSI completa a partir de las cargas de sus paquetes (con pointer_field). */
function psiSection(payloads: readonly Buffer[]): Buffer | null {
  const data = payloads.length === 1 ? (payloads[0] as Buffer) : Buffer.concat(payloads);
  if (!data.length) return null;
  const start = 1 + (data[0] as number);
  if (start + 3 > data.length) return null;
  const length = (((data[start + 1] as number) & 0x0f) << 8) | (data[start + 2] as number);
  const end = start + 3 + length;
  if (end > data.length || length < 9) return null;
  return data.subarray(start, end);
}

/* Tras volver a `pass`, lo que tiene que superar el PTS de un PID: `hard`,
   lo ya entregado (siempre); `soft`, el punto de acceso (solo si va cerca). */
interface ResumeFloor {
  readonly hard: number | null;
  readonly soft: number | null;
}

interface Candidate {
  readonly packets: Buffer[];
  readonly payloads: Buffer[];
  readonly pts: number | null;
  readonly cc: number;
}

export class TsGate {
  mode: TsGateMode = 'pass';
  /** Bytes que han entrado mientras se espera un punto de acceso. */
  waitedBytes = 0;
  /** Costuras vistas dentro de una conexión (para el registro). */
  seams = 0;
  /** Cuántas veces se ha pasado a `waitRap` (el relé ata su plazo a la espera de ahora). */
  waits = 0;
  /** La espera de ahora es por paquetes perdidos (solo el contador, el PTS sigue su línea). */
  lossSeam = false;
  /** Modo tolerante (lo pone el relé): las costuras por pérdida no se esperan. */
  tolerant = false;
  /** Costuras por pérdida que han pasado sin esperar (modo tolerante). */
  tolerated = 0;

  private rest: Buffer | null = null;
  private pmtPid: number | null = null;
  private pat: Buffer | null = null;
  private pmt: Buffer[] = [];
  private pmtParts: Buffer[] = [];
  private pmtPayloads: Buffer[] = [];
  private videoPid: number | null = null;
  private videoType = 0;
  private readonly elementary = new Set<number>();
  private lastVideoPts: number | null = null;
  /* PTS del último cuadro de vídeo VISTO durante la espera (para `lossSeam`). */
  private seenVideoPts: number | null = null;
  /* PID que siguen pasando durante una espera por pérdida (no esperan a su PUSI al abrir). */
  private readonly flowing = new Set<number>();
  /* El primer slice que delató el hueco del `frame_num` (para aceptarlo en modo tolerante). */
  private gapSlice: AvcSlice | null = null;
  /* Seguimiento del `frame_num` (H.264): el SPS y el del último cuadro de referencia. */
  private avcSps: AvcSps | null = null;
  private prevRefFrameNum: number | null = null;
  /* Primeros paquetes del PES de vídeo que está pasando (para ver su SPS). */
  private pesPayloads: Buffer[] = [];
  private readonly lastPts = new Map<number, number>();
  private videoCc: number | null = null;
  private forward = false;
  private floorVideo: number | null = null;
  private candidate: Candidate | null = null;
  /* Tras volver a `pass`: PID que esperan a su siguiente PUSI (y el PTS que tiene que superar). */
  private readonly resume = new Map<number, ResumeFloor>();
  private out: Buffer[] = [];
  /* Lo que un paquete emite aparte (PAT/PMT y el punto de acceso retenido). */
  private pending: Buffer[] = [];

  /** Pasa a esperar un punto de acceso. */
  wait(options: TsGateWait): void {
    this.mode = 'waitRap';
    this.waits += 1;
    this.lossSeam = false;
    this.waitedBytes = 0;
    this.candidate = null;
    this.forward = options.forward;
    this.floorVideo = options.forward ? this.lastVideoPts : null;
    this.seenVideoPts = this.lastVideoPts;
    this.flowing.clear();
    this.forgetFrameNum();
    if (options.fresh) this.rest = null;
  }

  /** Olvida lo entregado (otra base de tiempos: el remux se reinicia). */
  resetTimeline(): void {
    this.lastVideoPts = null;
    this.seenVideoPts = null;
    this.lastPts.clear();
    this.videoCc = null;
    this.floorVideo = null;
    this.forgetFrameNum();
    this.resume.clear();
    this.flowing.clear();
  }

  /** Olvida la PAT y la PMT (otra variante). */
  resetPsi(): void {
    this.pmtPid = null;
    this.pat = null;
    this.pmt = [];
    this.pmtParts = [];
    this.pmtPayloads = [];
    this.videoPid = null;
    this.videoType = 0;
    this.avcSps = null;
    this.forgetFrameNum();
    this.elementary.clear();
  }

  /**
   * Deja de esperar sin punto de acceso: devuelve la PAT y la PMT guardadas
   * (van delante de lo que siga) y pasa a `pass`. Cada PID espera a su PUSI.
   */
  release(): Buffer[] {
    const head = this.psi();
    this.mode = 'pass';
    this.candidate = null;
    this.waitedBytes = 0;
    this.videoCc = null;
    this.lastVideoPts = null;
    this.forgetFrameNum();
    this.resume.clear();
    const free: ResumeFloor = { hard: null, soft: null };
    if (this.videoPid !== null) this.resume.set(this.videoPid, free);
    /* Los que siguieron pasando durante la espera van por la mitad de un PES: siguen. */
    for (const pid of this.elementary) if (!this.flowing.has(pid)) this.resume.set(pid, free);
    this.flowing.clear();
    return head;
  }

  /** Mete un trozo del proveedor; devuelve lo que puede ir a ffmpeg (en orden). */
  push(chunk: Buffer): Buffer[] {
    this.out = [];
    let offset = 0;
    if (this.rest) {
      const need = TS_PACKET - this.rest.length;
      if (chunk.length < need) {
        this.rest = Buffer.concat([this.rest, chunk]);
        return [];
      }
      const packet = Buffer.concat([this.rest, chunk.subarray(0, need)]);
      this.rest = null;
      /* Si no encaja con lo que sigue, el trozo guardado era basura. */
      if (chunk.length === need || chunk[need] === SYNC) {
        const passes = this.packet(packet, 0);
        this.emitPending();
        if (passes) this.out.push(packet);
        offset = need;
      }
    }
    let runStart = offset;
    let runEnd = offset;
    while (offset < chunk.length) {
      if (chunk[offset] !== SYNC || !this.aligned(chunk, offset)) {
        this.flush(chunk, runStart, runEnd);
        offset = this.resync(chunk, offset + 1);
        runStart = offset;
        runEnd = offset;
        continue;
      }
      if (offset + TS_PACKET > chunk.length) {
        this.flush(chunk, runStart, runEnd);
        this.rest = Buffer.from(chunk.subarray(offset));
        return this.out;
      }
      const passes = this.packet(chunk, offset);
      if (this.pending.length) {
        /* Lo que se emite aparte va detrás del tramo que ya pasaba. */
        this.flush(chunk, runStart, runEnd);
        this.emitPending();
        runStart = offset;
        runEnd = offset;
      }
      if (passes) {
        if (runEnd !== offset) {
          this.flush(chunk, runStart, runEnd);
          runStart = offset;
        }
        runEnd = offset + TS_PACKET;
      } else {
        this.flush(chunk, runStart, runEnd);
        runStart = offset + TS_PACKET;
        runEnd = runStart;
      }
      offset += TS_PACKET;
    }
    this.flush(chunk, runStart, runEnd);
    return this.out;
  }

  /* ¿El 0x47 de `offset` es de verdad un inicio de paquete? */
  private aligned(chunk: Buffer, offset: number): boolean {
    const next = offset + TS_PACKET;
    return next >= chunk.length || chunk[next] === SYNC;
  }

  private resync(chunk: Buffer, from: number): number {
    for (let i = from; i < chunk.length; i += 1) {
      if (chunk[i] === SYNC && this.aligned(chunk, i)) return i;
    }
    return chunk.length;
  }

  private flush(chunk: Buffer, start: number, end: number): void {
    if (end > start) this.out.push(chunk.subarray(start, end));
  }

  private emit(parts: readonly Buffer[]): void {
    for (const part of parts) this.pending.push(part);
  }

  private emitPending(): void {
    for (const part of this.pending) this.out.push(part);
    this.pending = [];
  }

  private psi(): Buffer[] {
    return this.pat && this.pmt.length ? [this.pat, ...this.pmt] : [];
  }

  /**
   * Un paquete. Devuelve true si pasa tal cual; false si se tira o si sale
   * por otro camino (`emit`, detrás de lo que ya pasaba).
   */
  private packet(data: Buffer, offset: number): boolean {
    const pid = (((data[offset + 1] as number) & 0x1f) << 8) | (data[offset + 2] as number);
    const pusi = ((data[offset + 1] as number) & 0x40) !== 0;
    const passing = this.mode === 'pass';
    if (!passing) this.waitedBytes += TS_PACKET;
    if (pid === PID_PAT) {
      if (pusi) this.learnPat(data, offset);
      return passing;
    }
    if (pid === this.pmtPid) {
      /* En espera, la PMT sale con la PAT al abrir (aunque sea este mismo paquete). */
      this.learnPmt(data, offset, pusi);
      return passing;
    }
    if (this.mode === 'pass') return this.passPacket(data, offset, pid, pusi);
    return this.waitPacket(data, offset, pid, pusi);
  }

  private passPacket(data: Buffer, offset: number, pid: number, pusi: boolean): boolean {
    if (pid === PID_NULL) return true;
    if (pid !== this.videoPid || this.resume.has(pid))
      return this.passOther(data, offset, pid, pusi);
    /* Vídeo: ¿costura dentro de la conexión? */
    let seam = (adaptationFlags(data, offset) & 0x80) !== 0;
    let ccBreak = false;
    const start = payloadStart(data, offset);
    if (start !== null) {
      const cc = (data[offset + 3] as number) & 0x0f;
      if (this.videoCc !== null && cc !== this.videoCc && cc !== ((this.videoCc + 1) & 0x0f)) {
        ccBreak = true;
      }
      this.videoCc = cc;
    }
    let pts: number | null = null;
    if (pusi && start !== null) {
      pts = pesPts(data, start, offset + TS_PACKET);
      if (pts !== null && this.lastVideoPts !== null) {
        if (Math.abs(ptsDiff(pts, this.lastVideoPts)) > SEAM_TICKS) seam = true;
      }
    }
    let frameGap = false;
    if (!seam && !ccBreak && start !== null && this.videoType === 0x1b) {
      frameGap = this.followFrameNum(data, offset, start, pusi);
    }
    if ((ccBreak || frameGap) && !seam && this.tolerant) {
      /* Modo tolerante: la pérdida se cuenta pero no se espera (la línea de tiempo sigue). */
      this.seams += 1;
      this.tolerated += 1;
      this.acceptGap();
      if (pts !== null) this.lastVideoPts = pts;
      return true;
    }
    if (seam || ccBreak || frameGap) {
      this.seams += 1;
      this.wait({ forward: false });
      /* Solo el contador o el `frame_num`: paquetes perdidos, la línea de
         tiempo sigue (si luego salta el PTS, deja de serlo). */
      this.lossSeam = !seam;
      this.waitedBytes = TS_PACKET;
      return this.waitPacket(data, offset, pid, pusi);
    }
    if (pts !== null) this.lastVideoPts = pts;
    return true;
  }

  /*
   * Un PID que no es el vídeo (o el vídeo esperando a su PUSI tras abrir):
   * con su suelo de reanudación si lo tiene, y apuntando su último PTS.
   */
  private passOther(data: Buffer, offset: number, pid: number, pusi: boolean): boolean {
    const pending = this.resume.get(pid);
    if (pending !== undefined) {
      if (!pusi) return false;
      const start = payloadStart(data, offset);
      const pts = start === null ? null : pesPts(data, start, offset + TS_PACKET);
      if (pts !== null && this.behind(pts, pending)) return false;
      this.resume.delete(pid);
      if (pts !== null) this.notePts(pid, pts);
      if (pid === this.videoPid) this.videoCc = (data[offset + 3] as number) & 0x0f;
      return true;
    }
    if (pusi && this.elementary.has(pid)) {
      const start = payloadStart(data, offset);
      const pts = start === null ? null : pesPts(data, start, offset + TS_PACKET);
      if (pts !== null) this.lastPts.set(pid, pts);
    }
    return true;
  }

  /* Modo tolerante: el cuadro que delató el hueco del `frame_num` pasa a ser el de referencia. */
  private acceptGap(): void {
    const slice = this.gapSlice;
    this.gapSlice = null;
    if (!slice) return;
    this.prevRefFrameNum = slice.reference ? slice.frameNum : null;
  }

  private forgetFrameNum(): void {
    this.prevRefFrameNum = null;
    this.pesPayloads = [];
    this.gapSlice = null;
  }

  /*
   * Sigue el `frame_num` de H.264 en un paquete de vídeo que pasa. Devuelve
   * true si el primer slice de este PES delata cuadros de referencia
   * perdidos (y el paquete, el primero del PES, aún no ha pasado).
   */
  private followFrameNum(data: Buffer, offset: number, start: number, pusi: boolean): boolean {
    const end = offset + TS_PACKET;
    if (pusi) {
      if (start + 9 > end) {
        this.forgetFrameNum();
        return false;
      }
      const body = Math.min(start + 9 + (data[start + 8] as number), end);
      const payload = data.subarray(body, end);
      this.pesPayloads = [payload];
      /* El SPS suele ir delante del slice: se mira primero en este paquete. */
      this.learnSps(this.pesPayloads);
      const slice = this.firstSlice(payload);
      if (!slice) {
        /* La cabecera no está en el primer paquete: no se puede actuar sobre este cuadro. */
        this.prevRefFrameNum = null;
        return false;
      }
      const sps = this.avcSps;
      let gap = false;
      if (!slice.idr && sps && !sps.gapsAllowed && this.prevRefFrameNum !== null) {
        const max = 2 ** sps.log2MaxFrameNum;
        const prev = this.prevRefFrameNum;
        /* Un cuadro entero (de referencia o no) lleva siempre el siguiente;
           el mismo solo lo repite el segundo campo de un par. */
        gap = slice.frameNum !== (prev + 1) % max && !(slice.field && slice.frameNum === prev);
      }
      if (gap) {
        this.gapSlice = slice;
        return true;
      }
      if (slice.reference) this.prevRefFrameNum = slice.frameNum;
      return false;
    }
    /* Paquetes 2 y 3 del PES: por si el SPS va partido o más adelante. */
    if (this.pesPayloads.length && this.pesPayloads.length < RAP_PACKETS) {
      this.pesPayloads.push(data.subarray(start, end));
      if (this.pesPayloads.length === RAP_PACKETS) {
        this.learnSps(this.pesPayloads);
        this.pesPayloads = [];
      }
    }
    return false;
  }

  /* Aprende el SPS de H.264 si aparece en estas cargas (seguidas). */
  private learnSps(payloads: readonly Buffer[]): void {
    const data = payloads.length === 1 ? (payloads[0] as Buffer) : Buffer.concat(payloads);
    for (let i = 0; i + 3 < data.length; i += 1) {
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 1) continue;
      if (((data[i + 3] as number) & 0x1f) === 7) {
        const sps = parseAvcSps(data, i + 4, data.length);
        if (sps) {
          /* Otro SPS (otra fuente): el `frame_num` de antes ya no vale. */
          const old = this.avcSps;
          if (
            old &&
            (old.log2MaxFrameNum !== sps.log2MaxFrameNum || old.gapsAllowed !== sps.gapsAllowed)
          ) {
            this.prevRefFrameNum = null;
          }
          this.avcSps = sps;
        }
        return;
      }
      i += 2;
    }
  }

  /* El primer slice (tipo 1 o 5) de estos datos, si su cabecera está entera. */
  private firstSlice(data: Buffer): AvcSlice | null {
    const sps = this.avcSps;
    if (!sps) return null;
    for (let i = 0; i + 3 < data.length; i += 1) {
      if (data[i] !== 0 || data[i + 1] !== 0 || data[i + 2] !== 1) continue;
      const header = data[i + 3] as number;
      const type = header & 0x1f;
      if (type !== 1 && type !== 5) {
        i += 2;
        continue;
      }
      try {
        const r = new BitReader(data, i + 4, data.length);
        /* Solo el primer slice del cuadro (los demás repiten el frame_num). */
        if (r.ue() !== 0) return null;
        r.ue(); // slice_type
        r.ue(); // pic_parameter_set_id
        if (sps.separateColourPlane) r.u(2);
        const frameNum = r.u(sps.log2MaxFrameNum);
        const field = !sps.frameMbsOnly && r.u(1) === 1;
        return { idr: type === 5, reference: (header & 0x60) !== 0, frameNum, field };
      } catch {
        return null;
      }
    }
    return null;
  }

  private waitPacket(data: Buffer, offset: number, pid: number, pusi: boolean): boolean {
    if (this.videoPid === null || pid !== this.videoPid) {
      /* Espera por pérdida: solo falta imagen; el audio y lo demás siguen pasando. */
      if (this.lossSeam && this.elementary.has(pid) && this.passOther(data, offset, pid, pusi)) {
        this.flowing.add(pid);
        return true;
      }
      return false;
    }
    const start = payloadStart(data, offset);
    if (pusi) {
      this.candidate = null;
      if (start === null) return false;
      const pts = pesPts(data, start, offset + TS_PACKET);
      /* Se compara con el cuadro de antes (visto en la espera), no con el último
         entregado: esperar más de `seamPtsMs` no convierte la pérdida en otra fuente. */
      if (pts !== null) {
        if (
          this.lossSeam &&
          this.seenVideoPts !== null &&
          Math.abs(ptsDiff(pts, this.seenVideoPts)) > SEAM_TICKS
        ) {
          this.lossSeam = false;
          /* Otra línea de tiempo: el audio deja de pasar y, al abrir, espera a su PUSI. */
          this.flowing.clear();
        }
        this.seenVideoPts = pts;
      }
      if (this.forward && this.floorVideo !== null && pts !== null) {
        if (ptsDiff(pts, this.floorVideo) <= 0) return false;
      }
      const packet = data.subarray(offset, offset + TS_PACKET);
      const cc = (data[offset + 3] as number) & 0x0f;
      const headerEnd = start + 9 + (data[start + 8] as number);
      const payload = data.subarray(Math.min(headerEnd, offset + TS_PACKET), offset + TS_PACKET);
      if ((adaptationFlags(data, offset) & 0x40) !== 0) {
        this.open({ packets: [packet], payloads: [payload], pts, cc });
        return false;
      }
      /* Sin RAI: se miran los NAL de los primeros paquetes (tras la cabecera PES). */
      this.candidate = { packets: [packet], payloads: [payload], pts, cc };
      return this.check();
    }
    const candidate = this.candidate;
    if (!candidate || start === null) return false;
    candidate.packets.push(data.subarray(offset, offset + TS_PACKET));
    candidate.payloads.push(data.subarray(start, offset + TS_PACKET));
    this.candidate = { ...candidate, cc: (data[offset + 3] as number) & 0x0f };
    return this.check();
  }

  /* ¿El candidato ya es punto de acceso? Si no lo será, se descarta. */
  private check(): boolean {
    const candidate = this.candidate;
    if (!candidate) return false;
    const joined =
      candidate.payloads.length === 1
        ? (candidate.payloads[0] as Buffer)
        : Buffer.concat(candidate.payloads);
    if (hasRapNal(joined, this.videoType)) {
      this.open(candidate);
      return false;
    }
    if (candidate.packets.length >= RAP_PACKETS) this.candidate = null;
    return false;
  }

  /* Punto de acceso encontrado: PAT y PMT guardadas, el candidato, y a `pass`. */
  private open(candidate: Candidate): void {
    /* Los paquetes del candidato son `subarray` del trozo que llega: se copian
       (pocos) porque el tramo que sale después no los incluye. */
    this.emit(this.psi());
    this.emit(candidate.packets.map((packet) => Buffer.from(packet)));
    this.mode = 'pass';
    this.candidate = null;
    this.waitedBytes = 0;
    this.videoCc = candidate.cc;
    if (candidate.pts !== null) this.lastVideoPts = candidate.pts;
    /* El punto de acceso sale entero por aquí: su SPS se aprende, y el
       `frame_num` se vuelve a seguir desde el cuadro siguiente (un punto de
       acceso sin IDR no tiene por qué empezar en 0). */
    if (this.videoType === 0x1b) this.learnSps(candidate.payloads);
    this.forgetFrameNum();
    this.resume.clear();
    const soft = candidate.pts === null ? null : (candidate.pts - AUDIO_LEAD + PTS_WRAP) % PTS_WRAP;
    for (const pid of this.elementary) {
      /* El que siguió pasando durante la espera por pérdida va en su línea: sigue. */
      if (this.flowing.has(pid)) continue;
      const last = this.lastPts.get(pid);
      this.resume.set(pid, { hard: this.forward && last !== undefined ? last : null, soft });
    }
    this.flowing.clear();
    this.forward = false;
    this.floorVideo = null;
  }

  /* ¿Este PTS no supera lo que tiene que superar para volver a pasar? */
  private behind(pts: number, floor: ResumeFloor): boolean {
    if (floor.hard !== null && ptsDiff(pts, floor.hard) <= 0) return true;
    if (floor.soft === null) return false;
    const diff = ptsDiff(pts, floor.soft);
    return diff <= 0 && -diff <= SEAM_TICKS;
  }

  private notePts(pid: number, pts: number): void {
    if (pid === this.videoPid) this.lastVideoPts = pts;
    else this.lastPts.set(pid, pts);
  }

  private learnPat(data: Buffer, offset: number): void {
    const start = payloadStart(data, offset);
    if (start === null) return;
    const section = psiSection([data.subarray(start, offset + TS_PACKET)]);
    if (!section || section[0] !== 0x00) return;
    let pmtPid: number | null = null;
    for (let i = 8; i + 4 <= section.length - 4; i += 4) {
      const program = ((section[i] as number) << 8) | (section[i + 1] as number);
      if (program === 0) continue;
      pmtPid = (((section[i + 2] as number) & 0x1f) << 8) | (section[i + 3] as number);
      break;
    }
    if (pmtPid === null) return;
    if (!this.pat || !samePsi(this.pat, data, offset)) {
      this.pat = Buffer.from(data.subarray(offset, offset + TS_PACKET));
    }
    if (pmtPid !== this.pmtPid) {
      this.pmtPid = pmtPid;
      this.pmt = [];
      this.pmtParts = [];
      this.pmtPayloads = [];
    }
  }

  private learnPmt(data: Buffer, offset: number, pusi: boolean): void {
    const start = payloadStart(data, offset);
    if (start === null) return;
    if (pusi) {
      this.pmtParts = [];
      this.pmtPayloads = [];
    } else if (!this.pmtParts.length || this.pmtParts.length >= PMT_MAX_PACKETS) return;
    this.pmtParts.push(Buffer.from(data.subarray(offset, offset + TS_PACKET)));
    this.pmtPayloads.push(data.subarray(start, offset + TS_PACKET));
    const section = psiSection(this.pmtPayloads);
    if (!section) return;
    const parts = this.pmtParts;
    this.pmtParts = [];
    this.pmtPayloads = [];
    if (section[0] !== 0x02) return;
    const end = section.length - 4;
    const infoLength = (((section[10] as number) & 0x0f) << 8) | (section[11] as number);
    let videoPid: number | null = null;
    let videoType = 0;
    const elementary = new Set<number>();
    for (let i = 12 + infoLength; i + 5 <= end;) {
      const type = section[i] as number;
      const pid = (((section[i + 1] as number) & 0x1f) << 8) | (section[i + 2] as number);
      const esInfo = (((section[i + 3] as number) & 0x0f) << 8) | (section[i + 4] as number);
      if (videoPid === null && VIDEO_TYPES.has(type)) {
        videoPid = pid;
        videoType = type;
      } else elementary.add(pid);
      i += 5 + esInfo;
    }
    const unchanged =
      parts.length === this.pmt.length &&
      parts.every((part, index) => samePsi(this.pmt[index] as Buffer, part, 0));
    if (!unchanged) this.pmt = parts;
    if (videoPid !== this.videoPid) {
      this.videoCc = null;
      this.lastVideoPts = null;
    }
    this.videoPid = videoPid;
    this.videoType = videoType;
    this.elementary.clear();
    for (const pid of elementary) this.elementary.add(pid);
    /* Sin vídeo (una radio): no hay punto de acceso que esperar. */
    if (videoPid === null && this.mode === 'waitRap' && this.pat) {
      this.emit(this.release());
    }
  }
}
