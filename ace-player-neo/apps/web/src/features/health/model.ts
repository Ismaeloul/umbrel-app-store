/* Lógica pura del panel de salud (inventario §12.1) y del registro de
   diagnóstico (arquitectura §5.14). Sin React ni red: se prueba sola.

   Por qué aquí y no en @ace/shared: son textos y reglas de PRESENTACIÓN
   (qué palabra y qué forma lleva cada estado, cómo se cuenta un tiempo en
   lenguaje claro). La app de iOS tendrá los suyos. Lo que sí es de dominio
   (los códigos de error y su mensaje) sale de @ace/shared (`describeError`).

   Importa de @ace/shared solo TIPOS y `describeError` (que ya está en el JS
   inicial por src/api/errors.ts): así este trozo no arrastra zod. */

import {
  describeError,
  type DiagnosticCause,
  type DiagnosticEntry,
  type EngineState,
  type EngineStatus,
  type HealthResponse,
  type PlayerMetrics,
} from '@ace/shared';
import type { IconName } from '../../ui/icons.ts';
import type { SignalState } from '../../ui/SignalBadge.tsx';

// ---- Números y tiempos en lenguaje claro -----------------------------------------

/** «1 partido», «3 partidos». */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

const DECIMAL = (() => {
  try {
    return new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 });
  } catch {
    return null;
  }
})();

/** 2300 → «2,3 s»; 800 → «0,8 s». */
export function seconds(ms: number): string {
  const value = Math.round(ms / 100) / 10;
  return `${DECIMAL ? DECIMAL.format(value) : String(value).replace('.', ',')} s`;
}

/** Tiempo activo del backend: «12 min», «3 h 5 min», «4 días». */
export function formatUptime(totalSeconds: number): string {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) {
    const rest = minutes % 60;
    return rest ? `${hours} h ${rest} min` : `${hours} h`;
  }
  return plural(Math.floor(hours / 24), 'día', 'días');
}

const pad = (n: number) => String(n).padStart(2, '0');

/** «20:31» en la hora del dispositivo (la 0.6.59 usaba toLocaleTimeString es-ES). */
export function clock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

const MONTHS = [
  'ene',
  'feb',
  'mar',
  'abr',
  'may',
  'jun',
  'jul',
  'ago',
  'sept',
  'oct',
  'nov',
  'dic',
];

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export interface When {
  /** «20:31». */
  time: string;
  /** «hace 5 min», «ayer», «21 sept». */
  relative: string;
}

/** Cuándo pasó algo, para leerlo de un vistazo. */
export function formatWhen(iso: string, now: number = Date.now()): When {
  const at = new Date(iso);
  const time = clock(at);
  if (Number.isNaN(at.getTime())) return { time: '—', relative: '' };
  const diff = Math.max(0, now - at.getTime());
  const minutes = Math.floor(diff / 60_000);
  const today = new Date(now);
  if (minutes < 1) return { time, relative: 'ahora mismo' };
  if (minutes < 60) return { time, relative: `hace ${minutes} min` };
  if (sameDay(at, today)) return { time, relative: `hace ${Math.floor(minutes / 60)} h` };
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(at, yesterday)) return { time, relative: 'ayer' };
  return { time, relative: `${at.getDate()} ${MONTHS[at.getMonth()] ?? ''}`.trim() };
}

/** Primera letra en mayúscula (algunos mensajes del backend empiezan en minúscula). */
export function sentence(text: string): string {
  const trimmed = text.trim();
  return trimmed ? trimmed.charAt(0).toLocaleUpperCase('es-ES') + trimmed.slice(1) : '';
}

// ---- Estado de cada servicio -------------------------------------------------------

/**
 * Palabra de cada estado. Las diez de la 0.6.59 (`healthStatusLabel`,
 * index.html:4271) más las de la v2 (motor reiniciándose o sin comprobar y
 * los datos guardados recuperados de una copia).
 */
export const STATUS_LABEL: Record<string, string> = {
  ready: 'Listo',
  warming: 'Preparando',
  discovered: 'Preparado',
  scanning: 'Comprobando',
  degraded: 'Con avisos',
  stale: 'Copia anterior',
  model_missing: 'Falta el modelo',
  offline: 'Sin conexión',
  disabled: 'Desactivado',
  empty: 'Vacío',
  // v2
  online: 'Listo',
  restarting: 'Reiniciándose',
  unknown: 'Comprobando',
  recovered: 'Recuperado',
  idle: 'En reposo',
  busy: 'En uso',
};

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? 'Desconocido';
}

/**
 * Forma del estado (SignalBadge compacto: glifo + palabra, nunca solo color).
 * Los colores son los de la 0.6.59 (index.html:1880-1883): verde para listo;
 * ámbar para avisos, preparando y falta el modelo; rojo para sin conexión,
 * fallido y vacío; gris para lo demás. Añadidos: reiniciándose y recuperado
 * van en ámbar, «sin comprobar» con el medidor hueco de «comprobando».
 */
export function statusSignal(status: string): SignalState {
  switch (status) {
    case 'ready':
    case 'online':
    case 'busy':
      return 'ok';
    case 'warming':
    case 'degraded':
    case 'stale':
    case 'model_missing':
    case 'restarting':
    case 'recovered':
    case 'discovered':
      return 'weak';
    case 'offline':
    case 'failed':
    case 'empty':
      return 'fail';
    case 'unknown':
    case 'scanning':
      return 'checking';
    default:
      return 'pending';
  }
}

export type ServiceId =
  'backend' | 'engine' | 'scanner' | 'ai' | 'agenda' | 'directories' | 'state' | 'playback';

export interface ServiceRow {
  id: ServiceId;
  name: string;
  icon: IconName;
  status: string;
  signal: SignalState;
  label: string;
  /** Lo principal, en una línea («120 partidos · 3 preparados»). */
  detail: string;
  /** Una línea aparte, si hay algo que contar («2 reinicios automáticos en la última hora»). */
  note: string | null;
  /** `warn`: es un aviso (ámbar); `info`: un dato más (gris). */
  noteTone: 'warn' | 'info';
}

function row(
  id: ServiceId,
  name: string,
  icon: IconName,
  status: string,
  detail: string,
  note: string | null = null,
  noteTone: ServiceRow['noteTone'] = 'warn',
): ServiceRow {
  return {
    id,
    name,
    icon,
    status,
    signal: statusSignal(status),
    label: statusLabel(status),
    detail,
    note,
    noteTone,
  };
}

/** Detalle del motor: el de la 0.6.59 («Aceptando reproducción» / «No responde») y la versión. */
export function engineDetail(engine: Pick<EngineStatus, 'status' | 'engineVersion'>): string {
  const version = engine.engineVersion ? ` · versión ${engine.engineVersion}` : '';
  switch (engine.status as EngineState) {
    case 'online':
      return `Aceptando reproducción${version}`;
    case 'restarting':
      return 'Arrancando…';
    case 'unknown':
      return 'Aún sin comprobar';
    default:
      return 'No responde';
  }
}

/** Aviso del cupo de reinicios automáticos (como mucho 3 por hora, arquitectura §5.5). */
export function engineNote(
  engine: Pick<EngineStatus, 'autoRestarts'>,
  now: number = Date.now(),
): string | null {
  const auto = engine.autoRestarts;
  if (auto.exhausted) {
    const next = auto.nextAllowedAt ? Date.parse(auto.nextAllowedAt) : Number.NaN;
    const when = Number.isFinite(next) && next > now ? ` hasta las ${clock(new Date(next))}` : '';
    return `Ya se ha reiniciado solo ${auto.max} veces en una hora: no lo volverá a hacer${when}.`;
  }
  if (auto.lastHour > 0) {
    return `${auto.lastHour} de ${auto.max} reinicios automáticos en la última hora.`;
  }
  return null;
}

/**
 * Cuadrícula por servicio (la de la 0.6.59, index.html:4282-4293, con
 * «Datos guardados» y «Reproducción» de la v2). El motor sale del estado en
 * vivo (SSE `engine.status`, con la histéresis del backend) si se tiene: es
 * el mismo que enseña el indicador de la cabecera, y así no se contradicen.
 */
export function serviceRows(
  health: HealthResponse,
  liveEngine: EngineStatus | null | undefined,
  now: number = Date.now(),
): ServiceRow[] {
  const c = health.components;
  const engine = liveEngine ?? c.engine;
  const scanner = c.scanner;
  const leaked = scanner.leakedSessionsLastHour;
  const ai = c.ai;
  const agenda = c.agenda;
  const agendaAt =
    agenda.status === 'stale' && agenda.generatedAt
      ? ` · de las ${clock(new Date(agenda.generatedAt))}`
      : '';
  const state = c.state;
  const playback = c.playback;
  return [
    row(
      'backend',
      'Backend',
      'info',
      c.backend.status,
      `v${health.version} · ${formatUptime(health.uptimeSeconds)} activo`,
    ),
    row(
      'engine',
      'Motor principal',
      'motor',
      engine.status,
      engineDetail(engine),
      engineNote(engine, now),
    ),
    row(
      'scanner',
      'Segundo motor',
      'senal',
      scanner.status,
      `${plural(scanner.activeJobs, 'trabajo', 'trabajos')} · ${scanner.queue} en cola`,
      leaked > 0 ? `${plural(leaked, 'sesión', 'sesiones')} sin cerrar en la última hora.` : null,
    ),
    row(
      'ai',
      'IA local',
      'learn',
      ai.status,
      ai.status === 'disabled'
        ? 'Sin configurar'
        : ai.status === 'model_missing'
          ? `Falta ${ai.model || 'el modelo'}`
          : ai.status === 'offline'
            ? 'Ollama no responde'
            : ai.model || 'Modelo no disponible',
    ),
    row(
      'agenda',
      'Agenda',
      'agenda',
      agenda.status,
      `${plural(agenda.matches, 'partido', 'partidos')} · ${agenda.preheated} ${agenda.preheated === 1 ? 'preparado' : 'preparados'}${agendaAt}`,
    ),
    row(
      'directories',
      'Directorios M3U',
      'list',
      c.directories.status,
      `${plural(c.directories.channels, 'canal', 'canales')} · ${plural(c.directories.total, 'lista', 'listas')}`,
    ),
    row(
      'state',
      'Datos guardados',
      'check',
      state.status,
      state.status === 'ready'
        ? 'Leídos sin problemas'
        : state.status === 'recovered'
          ? `Se usó una copia${state.recoveredFrom ? ` (${state.recoveredFrom})` : ''}`
          : 'Se arrancó sin ellos: hay ficheros apartados',
    ),
    row(
      'playback',
      'Reproducción',
      'play',
      playback.sessions > 0 ? 'busy' : 'idle',
      playback.sessions > 0
        ? `${plural(playback.sessions, 'sesión', 'sesiones')} · ${plural(playback.viewers, 'visor', 'visores')}`
        : 'Nada sonando ahora',
      `${plural(c.events.connections, 'conexión', 'conexiones')} en tiempo real${
        playback.remuxSessions > 0 ? ` · ${playback.remuxSessions} en remux (iPhone)` : ''
      }.`,
      'info',
    ),
  ];
}

export interface HealthSummary {
  tone: 'ok' | 'weak' | 'fail';
  /** Frase de arriba («Todo funciona.», «El motor principal no responde.»). */
  headline: string;
  /** El resumen de la 0.6.59: cuarentena, correcciones aprendidas y hora. */
  facts: string[];
}

export function healthSummary(health: HealthResponse, rows: readonly ServiceRow[]): HealthSummary {
  const failing = rows.filter((r) => r.signal === 'fail');
  const weak = rows.filter((r) => r.signal === 'weak');
  let tone: HealthSummary['tone'] = 'ok';
  let headline = 'Todo funciona.';
  if (failing.length === 1) {
    tone = 'fail';
    const only = failing[0] as ServiceRow;
    headline =
      only.status === 'empty'
        ? `${only.name}: no hay nada guardado.`
        : `${only.name}: sin conexión.`;
  } else if (failing.length > 1) {
    tone = 'fail';
    headline = `Hay ${failing.length} servicios con problemas.`;
  } else if (weak.length > 0 || health.warnings.length > 0) {
    tone = 'weak';
    headline = 'Todo funciona, con avisos.';
  }
  const reports = health.reports;
  return {
    tone,
    headline,
    facts: [
      plural(reports.quarantined, 'fuente en cuarentena', 'fuentes en cuarentena'),
      plural(reports.learningCount, 'corrección aprendida', 'correcciones aprendidas'),
      `comprobado ${clock(new Date(health.checkedAt))}`,
    ],
  };
}

// ---- Registro de diagnóstico -------------------------------------------------------

/** Las causas en el orden en que se enseñan (el de @ace/shared, DIAGNOSTIC_CAUSES). */
export const CAUSES = [
  'engine',
  'source',
  'network',
  'codec',
  'client',
  'state',
] as const satisfies readonly DiagnosticCause[];

export interface CauseInfo {
  label: string;
  icon: IconName;
  /** Qué quiere decir, en una frase. */
  help: string;
}

export const CAUSE_INFO: Record<DiagnosticCause, CauseInfo> = {
  engine: {
    label: 'Motor',
    icon: 'motor',
    help: 'El motor AceStream se cayó, no pudo abrir un canal o se reinició.',
  },
  source: {
    label: 'Fuente',
    icon: 'senal',
    help: 'La emisión no tenía pares, llegaba con muy poca entrada o se cortó.',
  },
  network: {
    label: 'Red',
    icon: 'link',
    help: 'Algo tardó demasiado o un servidor de fuera falló (listas, agenda o marcadores).',
  },
  codec: {
    label: 'Códec',
    icon: 'tv',
    help: 'El vídeo o el audio venían en un formato que no se pudo descodificar.',
  },
  client: {
    label: 'Reproductor',
    icon: 'play',
    help: 'Lo avisa un dispositivo: el reproductor falló, se bloqueó la reproducción automática o se perdió la conexión.',
  },
  state: {
    label: 'Datos guardados',
    icon: 'aviso',
    help: 'Un fichero guardado no se pudo leer y se apartó; se siguió con una copia.',
  },
};

/**
 * Qué pasó, en una frase: el mensaje del backend o, si viene vacío, el del
 * código. Un informe de métricas del reproductor (sin mensaje) no es un fallo:
 * se dice que es el resumen de una reproducción y las cifras van debajo.
 */
export function describeEntry(
  entry: Pick<DiagnosticEntry, 'message' | 'code' | 'cause'> &
    Partial<Pick<DiagnosticEntry, 'metrics'>>,
): string {
  const message = sentence(entry.message);
  if (message) return message;
  if (entry.metrics) return 'Resumen de una reproducción en un dispositivo.';
  const known = describeError(entry.code);
  if (known && known.code !== 'internal_error') return known.message;
  return CAUSE_INFO[entry.cause].help;
}

/** Métricas del reproductor en claro («imagen en 2,3 s · 2 cortes (4 s en total)»). */
export function metricsSentence(metrics: PlayerMetrics | undefined): string | null {
  if (!metrics) return null;
  const parts: string[] = [];
  if (metrics.timeToFirstFrameMs !== undefined)
    parts.push(`imagen en ${seconds(metrics.timeToFirstFrameMs)}`);
  if (metrics.remuxStartMs !== undefined)
    parts.push(`remux listo en ${seconds(metrics.remuxStartMs)}`);
  if (metrics.rebuffers !== undefined) {
    const total = metrics.rebufferMs ? ` (${seconds(metrics.rebufferMs)} en total)` : '';
    parts.push(`${plural(metrics.rebuffers, 'corte', 'cortes')}${total}`);
  }
  if (metrics.reconnects !== undefined)
    parts.push(plural(metrics.reconnects, 'reconexión', 'reconexiones'));
  if (metrics.liveLatencyS !== undefined) {
    parts.push(`${Math.round(metrics.liveLatencyS)} s por detrás del directo`);
  }
  return parts.length ? sentence(parts.join(' · ')) : null;
}

export interface SourceGroup {
  key: string;
  /** Nombre del canal (el más reciente) o el hash abreviado. */
  name: string;
  hash: string | null;
  count: number;
  causes: DiagnosticCause[];
  last: DiagnosticEntry;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * «Por fuente» (el prompt pedía la cuadrícula por fuente; la 0.6.59 la tenía
 * por servicio, inventario §27): los fallos de las últimas 24 h que traen
 * hash o canal, agrupados, de la fuente que más falla a la que menos.
 */
export function groupBySource(
  entries: readonly DiagnosticEntry[],
  now: number = Date.now(),
  max = 5,
): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const entry of entries) {
    if (!entry.hash && !entry.channel) continue;
    const at = Date.parse(entry.at);
    if (!Number.isFinite(at) || now - at > DAY_MS) continue;
    const key = entry.hash ? `h:${entry.hash}` : `c:${entry.channel}`;
    const group = groups.get(key);
    if (!group) {
      groups.set(key, {
        key,
        name: entry.channel || `Fuente ${entry.hash?.slice(0, 8) ?? ''}`,
        hash: entry.hash ?? null,
        count: 1,
        causes: [entry.cause],
        last: entry,
      });
      continue;
    }
    group.count += 1;
    if (!group.causes.includes(entry.cause)) group.causes.push(entry.cause);
    if (Date.parse(group.last.at) < at) {
      group.last = entry;
      if (entry.channel) group.name = entry.channel;
    }
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || Date.parse(b.last.at) - Date.parse(a.last.at))
    .slice(0, max);
}
