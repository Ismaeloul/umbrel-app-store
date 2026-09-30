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
     que el PTS avance (el origen puede haber cambiado de reloj).
   - `waitRap`: se tira todo hasta que un PES de vídeo con PUSI es un punto de
     acceso (RAI=1, o un NAL IDR/SPS en H.264, IRAP en HEVC o la cabecera de
     secuencia en MPEG-2, mirando sus 3 primeros paquetes). Con `forward` (una
     reconexión empalmada), además su PTS tiene que ir por delante del último
     entregado (con la vuelta de 33 bits), y el audio que no vaya por delante
     del suyo se sigue tirando. Al encontrarlo se reenvían la PAT y la PMT
     guardadas, IDÉNTICAS byte a byte (si cambiaran, ffmpeg sacaría un init
     nuevo sin discontinuidad y AVPlayer se rompe), y se vuelve a `pass`. Los
     demás PID esperan a su siguiente PUSI.

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
  private readonly lastPts = new Map<number, number>();
  private videoCc: number | null = null;
  private forward = false;
  private floorVideo: number | null = null;
  private candidate: Candidate | null = null;
  /* Tras volver a `pass`: PID que esperan a su siguiente PUSI (y el PTS que tiene que superar). */
  private readonly resume = new Map<number, number | null>();
  private out: Buffer[] = [];
  /* Lo que un paquete emite aparte (PAT/PMT y el punto de acceso retenido). */
  private pending: Buffer[] = [];

  /** Pasa a esperar un punto de acceso. */
  wait(options: TsGateWait): void {
    this.mode = 'waitRap';
    this.waitedBytes = 0;
    this.candidate = null;
    this.forward = options.forward;
    this.floorVideo = options.forward ? this.lastVideoPts : null;
    if (options.fresh) this.rest = null;
  }

  /** Olvida lo entregado (otra base de tiempos: el remux se reinicia). */
  resetTimeline(): void {
    this.lastVideoPts = null;
    this.lastPts.clear();
    this.videoCc = null;
    this.floorVideo = null;
    this.resume.clear();
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
    this.resume.clear();
    if (this.videoPid !== null) this.resume.set(this.videoPid, null);
    for (const pid of this.elementary) this.resume.set(pid, null);
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
    const pending = this.resume.get(pid);
    const isVideo = pid === this.videoPid;
    if (pending !== undefined) {
      if (!pusi) return false;
      const start = payloadStart(data, offset);
      const pts = start === null ? null : pesPts(data, start, offset + TS_PACKET);
      if (pending !== null && pts !== null && ptsDiff(pts, pending) <= 0) return false;
      this.resume.delete(pid);
      if (pts !== null) this.notePts(pid, pts);
      if (isVideo) this.videoCc = (data[offset + 3] as number) & 0x0f;
      return true;
    }
    if (!isVideo) {
      if (pusi && this.elementary.has(pid)) {
        const start = payloadStart(data, offset);
        const pts = start === null ? null : pesPts(data, start, offset + TS_PACKET);
        if (pts !== null) this.lastPts.set(pid, pts);
      }
      return true;
    }
    /* Vídeo: ¿costura dentro de la conexión? */
    let seam = (adaptationFlags(data, offset) & 0x80) !== 0;
    const start = payloadStart(data, offset);
    if (start !== null) {
      const cc = (data[offset + 3] as number) & 0x0f;
      if (this.videoCc !== null && cc !== this.videoCc && cc !== ((this.videoCc + 1) & 0x0f)) {
        seam = true;
      }
      this.videoCc = cc;
    }
    let pts: number | null = null;
    if (pusi && start !== null) {
      pts = pesPts(data, start, offset + TS_PACKET);
      if (pts !== null && this.lastVideoPts !== null) {
        const jump = Math.abs(ptsDiff(pts, this.lastVideoPts));
        if (jump > (IPTV_RELAY.seamPtsMs * 90_000) / 1000) seam = true;
      }
    }
    if (seam) {
      this.seams += 1;
      this.wait({ forward: false });
      this.waitedBytes = TS_PACKET;
      return this.waitPacket(data, offset, pid, pusi);
    }
    if (pts !== null) this.lastVideoPts = pts;
    return true;
  }

  private waitPacket(data: Buffer, offset: number, pid: number, pusi: boolean): boolean {
    if (this.videoPid === null || pid !== this.videoPid) return false;
    const start = payloadStart(data, offset);
    if (pusi) {
      this.candidate = null;
      if (start === null) return false;
      const pts = pesPts(data, start, offset + TS_PACKET);
      if (this.forward && this.floorVideo !== null && pts !== null) {
        if (ptsDiff(pts, this.floorVideo) <= 0) return false;
      }
      const packet = data.subarray(offset, offset + TS_PACKET);
      const cc = (data[offset + 3] as number) & 0x0f;
      if ((adaptationFlags(data, offset) & 0x40) !== 0) {
        this.open({ packets: [packet], payloads: [], pts, cc });
        return false;
      }
      /* Sin RAI: se miran los NAL de los primeros paquetes (tras la cabecera PES). */
      const headerEnd = start + 9 + (data[start + 8] as number);
      const payload = data.subarray(Math.min(headerEnd, offset + TS_PACKET), offset + TS_PACKET);
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
    this.resume.clear();
    for (const pid of this.elementary) {
      const last = this.lastPts.get(pid);
      this.resume.set(pid, this.forward && last !== undefined ? last : null);
    }
    this.forward = false;
    this.floorVideo = null;
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
