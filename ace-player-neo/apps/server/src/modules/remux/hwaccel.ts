/* Vídeo por la gráfica Intel del NAS (VAAPI) para lo que el remux RECODIFICA
   (docs/ver-juntos.md §17.6): la calidad ligera de «Ver juntos» (vod/lite.ts),
   la ligera del directo y el desentrelazado de la IPTV (args.ts). El remux de
   siempre (copiar el vídeo) no cambia: ni decodifica ni codifica nada.

   - Al arrancar se ensaya UNA vez con un ffmpeg de un segundo (`testsrc2` →
     subir a la gráfica → `scale_vaapi` → `h264_vaapi`, con los mismos
     parámetros que la ligera) y, si sale, otro con `deinterlace_vaapi`. Se
     prueban, en orden, el codificador de bajo consumo (VDENC: el único que
     tienen para H.264 las Intel desde la Gen12, el N300 del NAS) y el
     normal, con caudal variable (VBR, que en VDENC pide el firmware HuC) y,
     si no, con calidad fija (CQP). El primero que sale es el que se usa.
   - Si nada sale (sin `/dev/dri`, sin `intel-media-driver`, otra gráfica, sin
     ffmpeg, `ACE_HWACCEL=off`, Windows), todo sigue como antes: x264. El
     motivo queda en el registro y en `/api/v1/health` (`components.video`).
   - En uso: 3 ffmpeg seguidos con la gráfica que fallan (sin uno bueno entre
     medias) la apagan hasta el siguiente arranque, con el motivo. En el remux
     de un directo solo cuentan los fallos de la gráfica (`isVaapiFailure`): un
     canal sin pares, una IPTV caída o el motor que deja de mandar también
     terminan el ffmpeg, y no son culpa suya.
   - Con la gráfica caben más recodificaciones a la vez (`MAX_RECODE_HW`): el
     tope de 2 era por CPU (x264). Lo que siga en x264 (un desentrelazado sin
     `deinterlace_vaapi`) sigue contando en el tope de CPU.
   - El códec RFC 6381 de la ligera sale del `avcC` del propio ensayo:
     `h264_vaapi` marca las banderas de restricción 4 y 5 (High sin B), así
     que no es el `avc1.640028` de x264. */

import type { Clock, TimerHandle } from '../../core/clock.js';
import type { Logger } from '../../core/logger.js';
import {
  VAAPI_DEINTERLACE_RATE,
  VAAPI_DEVICE_NAME,
  VAAPI_LITE_LEVEL,
  VAAPI_LITE_RATE,
  vaapiEncoderArgs,
  vaapiScale,
  type VaapiProfile,
} from './args.js';
import { VOD_MOVFLAGS } from './vod/args.js';
import { parseAvcC } from './vod/codecs.js';
import { splitFmp4 } from './vod/lite.js';
import type { LiteProcessLauncher } from './vod/types.js';

/** El dispositivo de la gráfica por defecto (el `renderD128` del NAS, grupo render). */
export const VAAPI_DEFAULT_DEVICE = '/dev/dri/renderD128';
/** Recodificaciones a la vez con la gráfica (con x264 son `MAX_DEINTERLACE`, 2). */
export const MAX_RECODE_HW = 4;
/** Fallos seguidos con la gráfica en uso que la apagan hasta el siguiente arranque. */
export const HW_FAILURES_TO_DISABLE = 3;
/** Plazo de cada ensayo (un segundo de vídeo; con la gráfica tarda menos de uno). */
export const HW_PROBE_TIMEOUT_MS = 15_000;

/** `components.video` de `/api/v1/health`. */
export interface VideoAccelStatus {
  /** `probing`: el ensayo aún no ha terminado (mientras, x264). */
  readonly hwaccel: 'vaapi' | 'none' | 'probing';
  /** Por qué no hay gráfica (o se apagó), o null. */
  readonly reason: string | null;
  readonly device: string | null;
  readonly encoder: 'h264_vaapi' | 'libx264';
  readonly lowPower: boolean | null;
  readonly rateControl: 'VBR' | 'CQP' | null;
  /** Con qué se desentrelaza la IPTV para el iPhone. */
  readonly deinterlace: 'vaapi' | 'bwdif';
  /** Recodificaciones a la vez (ligeras y desentrelazados). */
  readonly recodeSlots: number;
  /** Fallos seguidos de ffmpeg con la gráfica en uso. */
  readonly failures: number;
}

export type { VaapiProfile };

export interface VideoAccel {
  /** El perfil de la gráfica, o null: x264 (sin gráfica, aún ensayando o apagada). */
  vaapi(): VaapiProfile | null;
  status(): VideoAccelStatus;
  /** Ensaya la gráfica (una sola vez; las siguientes devuelven el mismo ensayo). Nunca lanza. */
  probe(): Promise<void>;
  /** Un ffmpeg con la gráfica ha fallado (`HW_FAILURES_TO_DISABLE` seguidos la apagan). */
  failed(detail: string): void;
  /** Un ffmpeg con la gráfica ha ido bien. */
  succeeded(): void;
  /** Cuántas recodificaciones caben a la vez. */
  recodeSlots(): number;
}

/** Lo que deja en el registro de ffmpeg un fallo de la gráfica (VAAPI), no de la entrada. */
const VAAPI_FAILURE_RE =
  /vaapi|va-api|libva|hwaccel|hwupload|hwmap|hw_?device|hardware device|hw ?frames?|\/dev\/dri|renderD|iHD_drv|i965_drv|surface|Failed to (?:initiali[sz]e|sync|map)/i;

/**
 * ¿Un ffmpeg con la gráfica que ha terminado solo ha fallado por ella? Solo si salió con error
 * (nunca con 0) y la cola de su registro habla de la gráfica. El final de la entrada (el motor que
 * deja de mandar, la fuente que da 404) no cuenta para apagarla.
 */
export function isVaapiFailure(code: number | null, tail: string): boolean {
  if (code === 0) return false;
  return VAAPI_FAILURE_RE.test(tail);
}

// --- Los ensayos (los argumentos de verdad están en args.ts) ---

/** Los modos que se ensayan, en orden de preferencia. */
export const VAAPI_CANDIDATES: readonly Pick<VaapiProfile, 'lowPower' | 'rateControl'>[] = [
  { lowPower: true, rateControl: 'VBR' },
  { lowPower: false, rateControl: 'VBR' },
  { lowPower: true, rateControl: 'CQP' },
  { lowPower: false, rateControl: 'CQP' },
];

/**
 * El ensayo del codificador: un segundo de `testsrc2` 1080p subido a la gráfica, bajado a 720 con
 * `scale_vaapi` y codificado con los parámetros de la ligera del VOD, en fMP4 por `pipe:1` (para
 * leer su `avcC`). Sin `ace_session=`: el recolector de huérfanos no lo confunde con un remux.
 */
export function buildEncodeProbeArgs(
  device: string,
  candidate: Pick<VaapiProfile, 'lowPower' | 'rateControl'>,
): string[] {
  return [
    ...['-hide_banner', '-loglevel', 'error', '-nostdin'],
    ...['-init_hw_device', `vaapi=${VAAPI_DEVICE_NAME}:${device}`],
    ...['-filter_hw_device', VAAPI_DEVICE_NAME],
    ...['-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=1'],
    ...['-vf', `format=nv12,hwupload,${vaapiScale()}`],
    ...vaapiEncoderArgs(candidate, VAAPI_LITE_RATE, { gop: 9999, level: VAAPI_LITE_LEVEL }),
    ...['-an', '-frames:v', '30'],
    ...['-movflags', VOD_MOVFLAGS, '-f', 'mp4', 'pipe:1'],
  ];
}

/** El ensayo del desentrelazado: `deinterlace_vaapi` (un campo por imagen) y el mismo codificador. */
export function buildDeinterlaceProbeArgs(
  device: string,
  candidate: Pick<VaapiProfile, 'lowPower' | 'rateControl'>,
): string[] {
  return [
    ...['-hide_banner', '-loglevel', 'error', '-nostdin'],
    ...['-init_hw_device', `vaapi=${VAAPI_DEVICE_NAME}:${device}`],
    ...['-filter_hw_device', VAAPI_DEVICE_NAME],
    ...['-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=25:duration=1'],
    ...['-vf', 'format=nv12,hwupload,deinterlace_vaapi=rate=field'],
    ...vaapiEncoderArgs(candidate, VAAPI_DEINTERLACE_RATE),
    ...['-an', '-frames:v', '20', '-f', 'null', '-'],
  ];
}

/** El `avcC` de un `stsd` de vídeo (la caja entera sin su cabecera), o null. */
export function avcCOf(stsd: Buffer): Buffer | null {
  const at = stsd.indexOf('avcC', 0, 'latin1');
  if (at < 4) return null;
  const size = stsd.readUInt32BE(at - 4);
  if (size < 8 || at - 4 + size > stsd.length) return null;
  return stsd.subarray(at + 4, at - 4 + size);
}

// --- El ensayo ---

export interface ProbeRun {
  readonly code: number | null;
  readonly stdout: Buffer;
  /** La cola del registro de error de ffmpeg. */
  readonly stderr: string;
  /** No hay ffmpeg (ENOENT). */
  readonly missing: boolean;
}

/** Lanza un ensayo y recoge su salida (como mucho 4 MB) con plazo. Nunca lanza. */
export function runProbe(
  launcher: LiteProcessLauncher,
  clock: Clock,
  args: readonly string[],
  timeoutMs: number = HW_PROBE_TIMEOUT_MS,
): Promise<ProbeRun> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const errors: Buffer[] = [];
    let size = 0;
    let timer: TimerHandle | null = null;
    let settled = false;
    let exit: number | null | undefined;
    let closed = false;
    const settle = (run: ProbeRun): void => {
      if (settled) return;
      settled = true;
      clock.clearTimeout(timer);
      resolve(run);
    };
    const stderr = (): string => Buffer.concat(errors).toString('utf8').trim().slice(-400);
    const finish = (): void => {
      if (exit === undefined || !closed) return;
      settle({ code: exit, stdout: Buffer.concat(chunks, size), stderr: stderr(), missing: false });
    };
    let child: ReturnType<LiteProcessLauncher['spawn']>;
    try {
      child = launcher.spawn(args);
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      settle({ code: null, stdout: Buffer.alloc(0), stderr: '', missing: code === 'ENOENT' });
      return;
    }
    child.onError((error) =>
      settle({
        code: null,
        stdout: Buffer.alloc(0),
        stderr: error.message,
        missing: error.code === 'ENOENT',
      }),
    );
    child.onStderr((chunk) => {
      errors.push(chunk);
      while (errors.length > 32) errors.shift();
    });
    child.onExit((code) => {
      exit = code;
      finish();
    });
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > 4 * 1024 * 1024) {
        child.kill();
        return;
      }
      chunks.push(chunk);
    });
    child.stdout.once('close', () => {
      closed = true;
      finish();
    });
    child.stdout.on('error', () => undefined);
    child.stdin.on('error', () => undefined);
    child.stdin.end();
    timer = clock.setTimeout(
      () => {
        child.kill();
        settle({ code: null, stdout: Buffer.alloc(0), stderr: 'tarda demasiado', missing: false });
      },
      timeoutMs,
      { unref: true },
    );
  });
}

/** El códec RFC 6381 del vídeo de la salida de un ensayo, o null si no es un fMP4 H.264. */
export function probeCodecs(output: Buffer): string | null {
  try {
    const { init } = splitFmp4(output);
    const avcC = init.video ? avcCOf(init.video.stsd) : null;
    return avcC ? (parseAvcC(avcC)?.codecs ?? null) : null;
  } catch {
    return null;
  }
}

export interface VideoAccelOptions {
  readonly launcher: LiteProcessLauncher;
  readonly clock: Clock;
  readonly logger: Logger;
  /** `ACE_HWACCEL`: `auto` ensaya; `off` ni lo intenta. */
  readonly mode: 'auto' | 'off';
  /** `ACE_VAAPI_DEVICE`. */
  readonly device?: string;
  /** Recodificaciones a la vez sin gráfica (`MAX_DEINTERLACE`). */
  readonly softwareSlots: number;
  /** Plazo de cada ensayo (tests). */
  readonly probeTimeoutMs?: number;
  /** Cómo se lee el códec de la salida del ensayo (tests). Por defecto, `probeCodecs`. */
  readonly readCodecs?: (output: Buffer) => string | null;
}

/** Una línea del registro de ffmpeg sin saltos, para el motivo. */
function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 240);
}

export function createVideoAccel(options: VideoAccelOptions): VideoAccel {
  const device = options.device ?? VAAPI_DEFAULT_DEVICE;
  const logger = options.logger;
  let profile: VaapiProfile | null = null;
  let state: VideoAccelStatus['hwaccel'] = options.mode === 'off' ? 'none' : 'probing';
  let reason: string | null = options.mode === 'off' ? 'apagado (ACE_HWACCEL=off)' : null;
  let failures = 0;
  let probing: Promise<void> | null = null;

  const slots = (): number => (profile ? MAX_RECODE_HW : options.softwareSlots);

  async function runAll(): Promise<void> {
    const errors: string[] = [];
    for (const candidate of VAAPI_CANDIDATES) {
      const run = await runProbe(
        options.launcher,
        options.clock,
        buildEncodeProbeArgs(device, candidate),
        options.probeTimeoutMs,
      );
      if (run.missing) {
        state = 'none';
        reason = 'no hay ffmpeg';
        return;
      }
      const codecs = run.code === 0 ? (options.readCodecs ?? probeCodecs)(run.stdout) : null;
      if (!codecs) {
        const mode = `${candidate.lowPower ? 'low_power ' : ''}${candidate.rateControl}`;
        errors.push(
          `${mode}: ${oneLine(run.stderr) || (run.code === 0 ? 'salida sin avcC' : `salió con ${run.code}`)}`,
        );
        continue;
      }
      const deint = await runProbe(
        options.launcher,
        options.clock,
        buildDeinterlaceProbeArgs(device, candidate),
        options.probeTimeoutMs,
      );
      profile = { device, ...candidate, deinterlace: deint.code === 0, liteCodecs: codecs };
      state = 'vaapi';
      reason =
        deint.code === 0
          ? null
          : `deinterlace_vaapi no va (${oneLine(deint.stderr) || `salió con ${deint.code}`}): se desentrelaza con bwdif`;
      return;
    }
    state = 'none';
    reason = `ningún modo de h264_vaapi en ${device} (${errors[0] ?? 'sin detalle'})`.slice(0, 400);
  }

  const accel: VideoAccel = {
    vaapi: () => profile,

    status: () => ({
      hwaccel: state,
      reason,
      device: profile?.device ?? null,
      encoder: profile ? 'h264_vaapi' : 'libx264',
      lowPower: profile?.lowPower ?? null,
      rateControl: profile?.rateControl ?? null,
      deinterlace: profile?.deinterlace ? 'vaapi' : 'bwdif',
      recodeSlots: slots(),
      failures,
    }),

    probe() {
      if (options.mode === 'off') {
        logger.info({ video: accel.status() }, 'vídeo: sin la gráfica (ACE_HWACCEL=off), x264');
        return Promise.resolve();
      }
      probing ??= runAll()
        .catch((error: unknown) => {
          state = 'none';
          reason = `el ensayo ha fallado: ${(error as Error).message}`;
        })
        .then(() => {
          if (profile) {
            logger.info({ video: accel.status() }, 'vídeo: la gráfica (VAAPI) recodifica');
          } else {
            logger.warn({ video: accel.status() }, 'vídeo: sin la gráfica, se recodifica con x264');
          }
        });
      return probing;
    },

    failed(detail) {
      if (!profile) return;
      failures += 1;
      if (failures < HW_FAILURES_TO_DISABLE) return;
      profile = null;
      state = 'none';
      reason = `apagada tras ${failures} fallos seguidos en uso: ${oneLine(detail)}`;
      logger.warn({ video: accel.status() }, 'vídeo: la gráfica falla, se vuelve a x264');
    },

    succeeded() {
      failures = 0;
    },

    recodeSlots: slots,
  };
  return accel;
}

/** Sin gráfica y sin ensayo (tests con un ffmpeg falso y `ACE_HWACCEL=off`). */
export function softwareVideoAccel(softwareSlots: number, why = 'sin ensayo'): VideoAccel {
  const status: VideoAccelStatus = {
    hwaccel: 'none',
    reason: why,
    device: null,
    encoder: 'libx264',
    lowPower: null,
    rateControl: null,
    deinterlace: 'bwdif',
    recodeSlots: softwareSlots,
    failures: 0,
  };
  return {
    vaapi: () => null,
    status: () => status,
    probe: () => Promise.resolve(),
    failed: () => undefined,
    succeeded: () => undefined,
    recodeSlots: () => softwareSlots,
  };
}
