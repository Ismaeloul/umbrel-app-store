/* «Descargar logs» (Ajustes → Registro, 0.9.0; docs/registro.md).

   Lo pidió Isma: «un botón de descargar logs para que, si de aquí a un mes
   hacemos mantenimiento, te paso el log y ves dónde ha fallado». Encima de
   «Descargar fallos» (Salud, diagnostics-export.ts), que solo ve lo que hay
   en memoria desde el último arranque, el servidor guarda ahora un REGISTRO
   EN DISCO de unos 45 días (apps/server/src/core/log-store.ts), ya redactado
   al escribirse, y la web le manda sus errores importantes para que queden
   en el mismo registro.

   Rutas (todas solo web, con la regla anti-CSRF; routes.ts):
   - GET  /api/v1/diagnostics/log: cuánto hay guardado (para la sección).
   - POST /api/v1/diagnostics/log/download: el zip
     `ace-player-neo-logs-AAAA-MM-DD-HHMM.zip` con LEEME.txt, resumen.json
     (LogsSummary), fallos.json (el fichero de «Descargar fallos») y
     registro.jsonl (el registro del periodo elegido: día, semana o mes).
   - POST /api/v1/diagnostics/web-log: los errores de la web, en tandas
     pequeñas (WEB_LOG_UPLOAD_MAX_ENTRIES) y con tope por minuto. */

import { z } from 'zod';
import { WEB_LOG_UPLOAD_MAX_ENTRIES } from '../../constants/limits.js';
import { IsoDateTimeSchema } from '../../primitives.js';
import {
  DiagnosticsExportSchema,
  FaultPieceSchema,
  FaultSideSchema,
  WebDiagnosticsSchema,
  WebLogEntrySchema,
} from './diagnostics-export.js';

/** Periodo del zip: el último día, la última semana o el último mes (por defecto). */
export const LOG_PERIODS = ['dia', 'semana', 'mes'] as const;
export const LogPeriodSchema = z.enum(LOG_PERIODS);
export type LogPeriod = z.infer<typeof LogPeriodSchema>;
/** Días de cada periodo (contados hacia atrás desde ahora). */
export const LOG_PERIOD_DAYS: Readonly<Record<LogPeriod, number>> = { dia: 1, semana: 7, mes: 30 };

/** Lo que hay guardado en el disco del Umbrel. */
export const DiagnosticsLogInfoSchema = z.strictObject({
  /** `false` si el servidor arrancó sin registro en disco (no debería pasar en el Umbrel). */
  enabled: z.boolean(),
  /** Hora de la línea más vieja que queda (null si aún no hay nada). */
  since: IsoDateTimeSchema.nullable(),
  /** Días con fichero. */
  days: z.number().int().nonnegative(),
  /** Lo que ocupa en el disco (los días cerrados van comprimidos). */
  bytes: z.number().int().nonnegative(),
  maxBytes: z.number().int().positive(),
  maxDays: z.number().int().positive(),
});
export type DiagnosticsLogInfo = z.infer<typeof DiagnosticsLogInfoSchema>;

/** La web pide el zip y manda lo suyo (lo mismo que «Descargar fallos»). */
export const DiagnosticsLogDownloadBodySchema = z.strictObject({
  period: LogPeriodSchema.default('mes'),
  web: WebDiagnosticsSchema,
});
export type DiagnosticsLogDownloadBody = z.input<typeof DiagnosticsLogDownloadBodySchema>;

/** De qué navegador vienen los errores (sin nada que identifique a nadie). */
export const WebLogClientSchema = z.strictObject({
  userAgent: z.string().max(400),
  /** `1440x900@2`. */
  viewport: z.string().max(40).optional(),
  /** `mobile`, `tablet`, `desktop` o `wide`. */
  layout: z.string().max(20).optional(),
  /** Abierta como app instalada (PWA). */
  installed: z.boolean().optional(),
});
export type WebLogClient = z.infer<typeof WebLogClientSchema>;

export const WebLogUploadBodySchema = z.strictObject({
  client: WebLogClientSchema,
  entries: z.array(WebLogEntrySchema).min(1).max(WEB_LOG_UPLOAD_MAX_ENTRIES),
});
export type WebLogUploadBody = z.infer<typeof WebLogUploadBodySchema>;

export const WebLogUploadResponseSchema = z.strictObject({
  /** Guardadas en el registro. */
  accepted: z.number().int().nonnegative(),
  /**
   * No guardadas: pasan del tope por minuto, no son errores ni avisos, o son
   * el mismo fallo del reproductor que ya llegó con su canal por el registro
   * de fallos (POST /api/v1/diagnostics).
   */
  dropped: z.number().int().nonnegative(),
});
export type WebLogUploadResponse = z.infer<typeof WebLogUploadResponseSchema>;

/** Cómo terminó el arranque anterior (lo apunta el servidor al arrancar). */
export const PREVIOUS_STOPS = ['limpio', 'corte', 'desconocido'] as const;
export const PreviousStopSchema = z.enum(PREVIOUS_STOPS);
export type PreviousStop = z.infer<typeof PreviousStopSchema>;

const CountSchema = z.number().int().nonnegative();

/** resumen.json del zip: lo mismo que LEEME.txt, para leerlo con un programa. */
export const LogsSummarySchema = z.strictObject({
  format: z.literal('ace-player-neo-logs'),
  formatVersion: z.literal(1),
  createdAt: IsoDateTimeSchema,
  appVersion: z.string(),
  /** Las horas del registro van en UTC (ISO con «Z»); Madrid y París son +1 h en invierno y +2 h en verano. */
  timeZone: z.literal('UTC'),
  period: z.strictObject({
    name: LogPeriodSchema,
    days: z.number().int().positive(),
    from: IsoDateTimeSchema,
    to: IsoDateTimeSchema,
  }),
  storage: DiagnosticsLogInfoSchema,
  log: z.strictObject({
    lines: CountSchema,
    /** Bytes de registro.jsonl sin comprimir. */
    bytes: CountSchema,
    /** `true` si el periodo no cabía (LOG_DOWNLOAD_MAX_BYTES): falta lo más viejo. */
    truncated: z.boolean(),
    firstAt: IsoDateTimeSchema.nullable(),
    lastAt: IsoDateTimeSchema.nullable(),
    levels: z.strictObject({ error: CountSchema, warn: CountSchema, info: CountSchema }),
  }),
  /** Cada arranque del servidor en el periodo, del más viejo al más nuevo. */
  starts: z
    .array(
      z.strictObject({
        at: IsoDateTimeSchema,
        version: z.string(),
        previousVersion: z.string().nullable(),
        previousStop: PreviousStopSchema,
      }),
    )
    .max(1000),
  /** Recuentos «nuestro» / «de fuera» del periodo (como en «Descargar fallos»). */
  faults: DiagnosticsExportSchema.shape.summary,
  /** Los fallos que más se repiten, con un ejemplo. */
  topFaults: z
    .array(
      z.strictObject({
        code: z.string().max(60),
        side: FaultSideSchema,
        piece: FaultPieceSchema,
        count: z.number().int().positive(),
        lastAt: IsoDateTimeSchema,
        example: z.string().max(400),
      }),
    )
    .max(20),
  files: z.array(z.strictObject({ name: z.string(), about: z.string() })),
  redaction: z.strictObject({ note: z.string() }),
});
export type LogsSummary = z.infer<typeof LogsSummarySchema>;
