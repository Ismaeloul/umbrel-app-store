/* «Descargar fallos» (Ajustes → Salud, 0.9.0; docs/pendiente.md, punto 8).

   POST /api/v1/diagnostics/export (solo web): la web manda lo suyo (el
   anillo en memoria con sus últimos errores, apps/web/src/lib/web-log.ts) y
   el servidor devuelve UN fichero con todo junto y REDACTADO: sin
   contraseñas, usuarios, tokens, cookies, URLs con credenciales (Xtream
   `/live/usuario/clave/123.ts`, `?username=&password=`…) ni IPs públicas.

   Lleva la versión, el entorno, el estado de las piezas (motor, IPTV, remux,
   reproducción…), los fallos clasificados en «nuestro» (motor, decodificación,
   relé, remux, reproductor, web, servidor, datos) y «de fuera» (fuente,
   proveedor, red, terceros) con un resumen para leer de un vistazo, y el
   registro del servidor y de la web. La clasificación y la redacción de
   texto libre son funciones puras (domain/faults.ts). Va en su propio
   fichero porque usa HealthResponseSchema (system.ts), que a su vez usa el
   recuento de diagnostics.ts. */

import { z } from 'zod';
import {
  DIAGNOSTICS_EXPORT_MAX_FAULTS,
  SERVER_LOG_RING_LINES,
  WEB_LOG_MAX_ENTRIES,
} from '../../constants/limits.js';
import { IsoDateTimeSchema } from '../../primitives.js';
import { IptvKindSchema } from '../../state/v2.js';
import { IptvStatusSchema } from './iptv.js';
import { HealthResponseSchema } from './system.js';

/** Gravedad de una línea o un fallo. */
export const FAULT_LEVELS = ['error', 'warn', 'info'] as const;
export const FaultLevelSchema = z.enum(FAULT_LEVELS);
export type FaultLevel = z.infer<typeof FaultLevelSchema>;

/**
 * De dónde sale cada línea del anillo de la web:
 * - `error`: `window.onerror` (una excepción sin capturar);
 * - `rejection`: una promesa rechazada sin capturar;
 * - `console`: `console.error` / `console.warn` (React apunta ahí lo que
 *   recoge una ErrorBoundary, con la pila de componentes);
 * - `api`: una petición a /api/v1 que falló por la red, el plazo o un 5xx;
 * - `player`: lo que cuenta el reproductor (fallos de la fuente, del motor,
 *   vídeo que no se decodifica, huecos del búfer…).
 */
export const WEB_LOG_KINDS = ['error', 'rejection', 'console', 'api', 'player'] as const;
export const WebLogKindSchema = z.enum(WEB_LOG_KINDS);
export type WebLogKind = z.infer<typeof WebLogKindSchema>;

export const WebLogEntrySchema = z.strictObject({
  at: IsoDateTimeSchema,
  kind: WebLogKindSchema,
  level: FaultLevelSchema,
  message: z.string().max(1000),
  /** Pila del error o de componentes. */
  detail: z.string().max(4000).optional(),
  /** Código de la API o del reproductor (`network`, `remux_died`…). */
  code: z.string().max(60).optional(),
  /** Vista abierta cuando pasó (`partido/demo-4`, `ajustes/salud`). */
  view: z.string().max(160).optional(),
  /** Veces seguidas que se repitió (se apunta una sola vez). */
  repeated: z.number().int().min(2).optional(),
});
export type WebLogEntry = z.infer<typeof WebLogEntrySchema>;

/** Lo que la web cuenta de sí misma. */
export const WebDiagnosticsSchema = z.strictObject({
  userAgent: z.string().max(400),
  /** `1440x900@2` (ancho × alto en px CSS @ densidad). */
  viewport: z.string().max(40),
  /** `mobile`, `tablet`, `desktop` o `wide`. */
  layout: z.string().max(20).optional(),
  mode: z.enum(['live', 'demo']).optional(),
  view: z.string().max(160).optional(),
  online: z.boolean().optional(),
  /** Abierta como app instalada (PWA). */
  installed: z.boolean().optional(),
  /** Segundos desde que se abrió la pestaña. */
  uptimeSeconds: z.number().int().nonnegative().optional(),
  log: z.array(WebLogEntrySchema).max(WEB_LOG_MAX_ENTRIES),
});
export type WebDiagnostics = z.infer<typeof WebDiagnosticsSchema>;

export const DiagnosticsExportBodySchema = z.strictObject({ web: WebDiagnosticsSchema });
export type DiagnosticsExportBody = z.infer<typeof DiagnosticsExportBodySchema>;

/** «Nuestro» = lo arreglamos en la app; «de fuera» = una fuente, el proveedor, la red o un tercero. */
export const FAULT_SIDES = ['nuestro', 'de_fuera', 'sin_clasificar'] as const;
export const FaultSideSchema = z.enum(FAULT_SIDES);
export type FaultSide = z.infer<typeof FaultSideSchema>;

/**
 * La pieza de cada fallo (domain/faults.ts decide cuál):
 * - nuestro: `motor` (AceStream caído, plazos, reinicios), `decodificacion`
 *   (códec, vídeo que no se decodifica), `rele` (cortes del relé de la IPTV),
 *   `remux` (ffmpeg), `reproductor` (la web reproduciendo), `web` (errores de
 *   la página), `servidor` (errores internos), `datos` (lo guardado en disco);
 * - de fuera: `fuente` (sin pares, caída), `proveedor` (la IPTV: cuenta,
 *   caído, ocupado), `red` (DNS, plazos, la conexión con el NAS), `terceros`
 *   (futbolenlatv, escudos, IA);
 * - `otro`: sin clasificar.
 */
export const FAULT_PIECES = [
  'motor',
  'decodificacion',
  'rele',
  'remux',
  'reproductor',
  'web',
  'servidor',
  'datos',
  'fuente',
  'proveedor',
  'red',
  'terceros',
  'otro',
] as const;
export const FaultPieceSchema = z.enum(FAULT_PIECES);
export type FaultPiece = z.infer<typeof FaultPieceSchema>;

export const FaultSchema = z.strictObject({
  at: IsoDateTimeSchema,
  side: FaultSideSchema,
  piece: FaultPieceSchema,
  /** Quién lo vio: el servidor (registro de fallos o su log) o la web. */
  from: z.enum(['servidor', 'web']),
  level: FaultLevelSchema,
  code: z.string().max(60),
  message: z.string().max(4000),
  channel: z.string().max(120).optional(),
  /** Hash AceStream o id IPTV de la fuente (no son secretos: la identifican). */
  source: z.string().max(80).optional(),
});
export type Fault = z.infer<typeof FaultSchema>;

/** Una línea del registro del servidor (JSON de pino ya redactado). */
export const ServerLogLineSchema = z.looseObject({
  time: z.string().optional(),
  level: z.string().optional(),
  msg: z.string().optional(),
});
export type ServerLogLine = z.infer<typeof ServerLogLineSchema>;

/** La IPTV sin servidor, usuario ni contraseña (solo su estado). */
export const IptvExportStatusSchema = z.strictObject({
  kind: IptvKindSchema,
  enabled: z.boolean(),
  ...IptvStatusSchema.shape,
  /** Conexiones abiertas ahora con el proveedor (la regla es una). */
  connections: z.number().int().nonnegative(),
});

export const DiagnosticsExportSchema = z.strictObject({
  format: z.literal('ace-player-neo-fallos'),
  formatVersion: z.literal(1),
  createdAt: IsoDateTimeSchema,
  appVersion: z.string(),
  /** Para leer de un vistazo: recuentos y frases. */
  summary: z.strictObject({
    nuestro: z.number().int().nonnegative(),
    deFuera: z.number().int().nonnegative(),
    sinClasificar: z.number().int().nonnegative(),
    byPiece: z.array(
      z.strictObject({
        piece: FaultPieceSchema,
        side: FaultSideSchema,
        count: z.number().int().positive(),
      }),
    ),
    lines: z.array(z.string()).max(40),
  }),
  environment: z.strictObject({
    node: z.string(),
    platform: z.string(),
    arch: z.string(),
    uptimeSeconds: z.number().int().nonnegative(),
    memoryMb: z.number().int().nonnegative(),
    logLevel: z.string(),
    scanner: z.boolean(),
    autoSync: z.boolean(),
    allowPrivateUrls: z.boolean(),
    footballDemoOnly: z.boolean(),
    teams: z.boolean(),
    ai: z.boolean(),
    /** De dónde salen las claves (no las claves): `ACE_SEED`, `ENGINE_CONTROL_TOKEN` o `ephemeral`. */
    seedSource: z.string(),
    /** `false` si el servidor arrancó sin anillo de registro (no hay `serverLog`). */
    serverLog: z.boolean(),
  }),
  status: z.strictObject({
    /** La salud de siempre (GET /api/v1/health); null si no se pudo leer. */
    health: HealthResponseSchema.nullable(),
    iptv: IptvExportStatusSchema.nullable(),
    remux: z.strictObject({
      sessions: z.number().int().nonnegative(),
      max: z.number().int().nonnegative(),
      ffmpegMissing: z.boolean(),
    }),
  }),
  /** Del más nuevo al más viejo. */
  faults: z.array(FaultSchema).max(DIAGNOSTICS_EXPORT_MAX_FAULTS),
  /** Últimas líneas del registro del servidor, de la más vieja a la más nueva. */
  serverLog: z.array(ServerLogLineSchema).max(SERVER_LOG_RING_LINES),
  web: WebDiagnosticsSchema.nullable(),
  redaction: z.strictObject({
    note: z.string(),
    /** Textos en los que se tapó algo. */
    replaced: z.number().int().nonnegative(),
  }),
});
export type DiagnosticsExport = z.infer<typeof DiagnosticsExportSchema>;
