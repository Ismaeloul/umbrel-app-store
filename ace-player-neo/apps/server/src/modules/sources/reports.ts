/* Informes, cuarentenas y correcciones de las fuentes (server.js:2579-2658,
   4194-4225 y 4471-4592; backend-modulos §7.4; B-052 a B-054, B-066).

   Funciones puras: calculan el siguiente `sourceReports`/`channelFeedback`
   y el servicio los guarda por la cola del estado. Reglas de siempre:
   - un informe por `id + channelKey + reason` (suma `reportCount`);
   - cuarentena de 30 min, 10 min si es corte, calidad o audio, y 30 días si
     es canal equivocado (y entonces solo en ese canal);
   - un canal equivocado crea una corrección `incorrect` para ese canal;
   - "es el canal correcto" sube a 98 como mínimo y levanta los informes
     `wrong_channel` de ese hash y canal. */

import { randomBytes } from 'node:crypto';
import {
  MAX_CHANNEL_FEEDBACK,
  MAX_SOURCE_REPORTS,
  SOURCE_REPORT_REASONS,
  TEXT_LIMITS,
  cleanTitle,
  normalizeChannelKey,
  normalizeHash,
  type ChannelFeedback,
  type PublicSourceReport,
  type SourceReport,
  type SourceReportReason,
  type SourceReportState,
} from '@ace/shared';
import { AppError } from '../../core/errors.js';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

/** Cuarentenas (server.js:110-112). */
export const SOURCE_REPORT_QUARANTINE_MS = 30 * MINUTE;
export const SOURCE_QUALITY_QUARANTINE_MS = 10 * MINUTE;
export const SOURCE_WRONG_CHANNEL_QUARANTINE_MS = 30 * DAY;

const REASONS: ReadonlySet<string> = new Set(SOURCE_REPORT_REASONS);
const QUALITY_REASONS: ReadonlySet<string> = new Set(['stuttering', 'bad_quality', 'audio']);
const REPORT_STATES: ReadonlySet<string> = new Set([
  'reported',
  'checking',
  'working',
  'weak',
  'failed',
]);

type Loose = Readonly<Record<string, unknown>>;

/** Lo que se lee de un cuerpo o de un valor guardado: cualquier cosa, sin lanzar. */
export function asRecord(value: unknown): Loose {
  return value && typeof value === 'object' ? (value as Loose) : {};
}

export function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}

/** `validIso` (server.js:2583-2586). */
export function validIso(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : fallback;
}

export function newReportId(): string {
  return randomBytes(8).toString('hex');
}

/** Cuarentena según el motivo (server.js:4523-4525). */
export function quarantineMsFor(reason: string): number {
  if (reason === 'wrong_channel') return SOURCE_WRONG_CHANNEL_QUARANTINE_MS;
  if (QUALITY_REASONS.has(reason)) return SOURCE_QUALITY_QUARANTINE_MS;
  return SOURCE_REPORT_QUARANTINE_MS;
}

function reasonOf(value: unknown, fallback: SourceReportReason): SourceReportReason {
  return REASONS.has(value as string) ? (value as SourceReportReason) : fallback;
}

function countOf(value: unknown): number {
  return Math.min(999, Math.max(1, Number.parseInt(String(value), 10) || 1));
}

/** `normalizeSourceReport` (server.js:2588-2615): motivo desconocido → `not_starting`. T-076. */
export function normalizeSourceReport(
  value: unknown,
  now: number,
  makeId: () => string = newReportId,
): SourceReport | null {
  const v = asRecord(value);
  const id = normalizeHash(v.id);
  if (!id) return null;
  const channel = cleanTitle(v.channel, '');
  return {
    reportId: String(v.reportId || makeId())
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, TEXT_LIMITS.reportId),
    id,
    title: cleanTitle(v.title, `Stream ${id.slice(0, 8)}`),
    ih: v.ih === true,
    source: cleanTitle(v.source, '').slice(0, TEXT_LIMITS.reportSource),
    channel,
    channelKey: normalizeChannelKey(v.channelKey || channel),
    matchId: String(v.matchId || '')
      .trim()
      .replace(/[^a-zA-Z0-9_.:-]/g, '')
      .slice(0, TEXT_LIMITS.reportMatchId),
    reason: reasonOf(v.reason, 'not_starting'),
    state: REPORT_STATES.has(v.state as string) ? (v.state as SourceReportState) : 'reported',
    checkReason: String(v.checkReason || '')
      .trim()
      .replace(/[^a-zA-Z0-9_-]/g, '')
      .slice(0, TEXT_LIMITS.reportCheckReason),
    reportCount: countOf(v.reportCount),
    reportedAt: validIso(v.reportedAt, isoAt(now)) as string,
    lastCheckedAt: validIso(v.lastCheckedAt),
    quarantineUntil: validIso(v.quarantineUntil),
  };
}

/** `normalizeSourceReports` (server.js:2617-2630): uno por `id:channelKey:reason`, 300 como máximo. */
export function normalizeSourceReports(values: unknown, now: number): SourceReport[] {
  const output: SourceReport[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(values) ? values : []) {
    const report = normalizeSourceReport(raw, now);
    if (!report) continue;
    const key = `${report.id}:${report.channelKey}:${report.reason}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(report);
    if (output.length >= MAX_SOURCE_REPORTS) break;
  }
  return output;
}

/** `normalizeChannelFeedback` (server.js:2632-2649): veredicto inválido → null. T-076. */
export function normalizeChannelFeedback(value: unknown, now: number): ChannelFeedback | null {
  const v = asRecord(value);
  const id = normalizeHash(v.id);
  const channel = cleanTitle(v.channel, '');
  const channelKey = normalizeChannelKey(v.channelKey || channel);
  const verdict =
    v.verdict === 'correct' ? 'correct' : v.verdict === 'incorrect' ? 'incorrect' : '';
  if (!id || !channelKey || !verdict) return null;
  return {
    id,
    title: cleanTitle(v.title, `Stream ${id.slice(0, 8)}`),
    channel: channel || cleanTitle(v.channelKey, 'Canal'),
    channelKey,
    verdict,
    reason: reasonOf(v.reason, 'wrong_channel'),
    corrections: countOf(v.corrections),
    updatedAt: validIso(v.updatedAt, isoAt(now)) as string,
  };
}

/** `normalizeChannelFeedbacks` (server.js:2651-2664): una por `id:channelKey`, 300 como máximo. */
export function normalizeChannelFeedbacks(values: unknown, now: number): ChannelFeedback[] {
  const output: ChannelFeedback[] = [];
  const seen = new Set<string>();
  for (const raw of Array.isArray(values) ? values : []) {
    const feedback = normalizeChannelFeedback(raw, now);
    if (!feedback) continue;
    const key = `${feedback.id}:${feedback.channelKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(feedback);
    if (output.length >= MAX_CHANNEL_FEEDBACK) break;
  }
  return output;
}

/**
 * `sourceReportApplies` (server.js:4194-4199): cuarentena vigente; si es de
 * canal equivocado, solo en ese canal (B-066).
 */
export function sourceReportApplies(
  report: Loose | null | undefined,
  channelKeys: ReadonlySet<string>,
  now: number,
): boolean {
  const until = Date.parse(String(report?.quarantineUntil || ''));
  if (!Number.isFinite(until) || until <= now) return false;
  if (report?.reason !== 'wrong_channel') return true;
  return Boolean(report.channelKey) && channelKeys.has(String(report.channelKey));
}

export interface LearnedState {
  readonly channelFeedback?: readonly Loose[] | unknown;
  readonly sourceReports?: readonly Loose[] | unknown;
}

export interface LearnedCandidate {
  readonly id: string;
  readonly score: number;
}

export type WithLearning<T> = T & {
  score: number;
  learned: 'correct' | 'incorrect' | null;
  reported: {
    reason: SourceReportReason;
    state: SourceReportState;
    quarantineUntil: string | null;
  } | null;
  rejectedByLearning: boolean;
  quarantined: boolean;
};

/**
 * `applyLearnedSourceRules` (server.js:4205-4225): quita lo que está en
 * cuarentena o marcado "no es este canal" y sube a 98 lo confirmado. T-077.
 */
export function applyLearnedSourceRules<T extends LearnedCandidate>(
  state: LearnedState | null | undefined,
  channels: readonly unknown[],
  candidates: readonly T[],
  now: number,
): WithLearning<T>[] {
  const channelKeys = new Set(
    channels.map((channel) => normalizeChannelKey(channel)).filter(Boolean),
  );
  const feedback = (Array.isArray(state?.channelFeedback) ? state.channelFeedback : []) as Loose[];
  const reports = (Array.isArray(state?.sourceReports) ? state.sourceReports : []) as Loose[];
  return candidates
    .map((candidate) => {
      const learned = feedback.find(
        (item) => item.id === candidate.id && channelKeys.has(String(item.channelKey)),
      );
      const report = reports.find(
        (item) => item.id === candidate.id && sourceReportApplies(item, channelKeys, now),
      );
      const verdict: 'correct' | 'incorrect' | null =
        learned?.verdict === 'correct' || learned?.verdict === 'incorrect' ? learned.verdict : null;
      return {
        ...candidate,
        score: verdict === 'correct' ? Math.max(98, candidate.score) : candidate.score,
        learned: verdict,
        reported: report
          ? {
              reason: report.reason as SourceReportReason,
              state: report.state as SourceReportState,
              quarantineUntil: (report.quarantineUntil as string | null) ?? null,
            }
          : null,
        rejectedByLearning: verdict === 'incorrect',
        quarantined: Boolean(report),
      };
    })
    .filter((candidate) => !candidate.rejectedByLearning && !candidate.quarantined);
}

/** `publicSourceReport` (server.js:4471-4485). */
export function publicSourceReport(report: SourceReport): PublicSourceReport;
export function publicSourceReport(
  report: SourceReport | null | undefined,
): PublicSourceReport | null;
export function publicSourceReport(
  report: SourceReport | null | undefined,
): PublicSourceReport | null {
  if (!report) return null;
  return {
    reportId: report.reportId,
    id: report.id,
    channel: report.channel,
    matchId: report.matchId,
    reason: report.reason,
    state: report.state,
    checkReason: report.checkReason,
    reportedAt: report.reportedAt,
    lastCheckedAt: report.lastCheckedAt,
    quarantineUntil: report.quarantineUntil,
  };
}

export interface ReportsAndFeedback {
  readonly sourceReports: readonly SourceReport[];
  readonly channelFeedback: readonly ChannelFeedback[];
}

export interface ReportContext {
  readonly now: number;
  readonly newId?: () => string;
  /** El primer canal del partido `matchId` de la agenda, si el cuerpo no trae canal (api.md §4.14). */
  readonly programChannel?: string | null;
}

export interface BuiltReport extends ReportsAndFeedback {
  readonly report: SourceReport;
}

/**
 * El cálculo de `reportSource` (server.js:4509-4557): el informe en
 * `checking` con su cuarentena y, si es canal equivocado, la corrección
 * `incorrect`. Lanza `bad_request` sin hash. T-079.
 */
export function buildReport(
  current: ReportsAndFeedback,
  value: unknown,
  context: ReportContext,
): BuiltReport {
  const v = asRecord(value);
  const id = normalizeHash(v.id);
  const reason = reasonOf(v.reason, 'not_starting');
  const channel = cleanTitle(v.channel, '') || cleanTitle(context.programChannel, '');
  const channelKey = normalizeChannelKey(channel);
  if (!id) throw new AppError('bad_request', { detail: 'informe sin hash' });
  const { now } = context;
  const makeId = context.newId ?? newReportId;
  const reportedAt = isoAt(now);
  const previous = current.sourceReports.find(
    (item) => item.id === id && item.channelKey === channelKey && item.reason === reason,
  );
  const report = normalizeSourceReport(
    {
      ...previous,
      reportId: previous?.reportId || makeId(),
      id,
      title: v.title,
      ih: v.ih === true,
      source: v.source,
      channel,
      channelKey,
      matchId: v.matchId,
      reason,
      state: 'checking',
      checkReason: '',
      reportCount: (previous?.reportCount || 0) + 1,
      reportedAt,
      lastCheckedAt: null,
      quarantineUntil: isoAt(now + quarantineMsFor(reason)),
    },
    now,
    makeId,
  ) as SourceReport;
  const sourceReports = [
    report,
    ...current.sourceReports.filter((item) => item.reportId !== report.reportId),
  ];
  let channelFeedback = [...current.channelFeedback];
  if (reason === 'wrong_channel' && channelKey) {
    const feedback = normalizeChannelFeedback(
      {
        id,
        title: v.title,
        channel,
        channelKey,
        verdict: 'incorrect',
        reason,
        updatedAt: reportedAt,
        corrections:
          (current.channelFeedback.find((item) => item.id === id && item.channelKey === channelKey)
            ?.corrections || 0) + 1,
      },
      now,
    ) as ChannelFeedback;
    channelFeedback = [
      feedback,
      ...current.channelFeedback.filter(
        (item) => !(item.id === id && item.channelKey === channelKey),
      ),
    ];
  }
  return { report, sourceReports, channelFeedback };
}

export interface BuiltFeedback extends ReportsAndFeedback {
  readonly feedback: ChannelFeedback;
}

/**
 * El cálculo de `saveSourceFeedback` (server.js:4487-4507). El `corrections`
 * del cliente se descarta; con `correct`, los informes `wrong_channel` de ese
 * hash y canal pasan a `working` sin cuarentena. Lanza `bad_feedback`. T-080.
 */
export function buildFeedback(
  current: ReportsAndFeedback,
  value: unknown,
  now: number,
): BuiltFeedback {
  const parsed = normalizeChannelFeedback({ ...asRecord(value), updatedAt: isoAt(now) }, now);
  if (!parsed) throw new AppError('bad_feedback');
  const previous = current.channelFeedback.find(
    (item) => item.id === parsed.id && item.channelKey === parsed.channelKey,
  );
  const feedback: ChannelFeedback = {
    ...parsed,
    corrections: Math.min(999, (previous?.corrections || 0) + 1),
  };
  const channelFeedback = [
    feedback,
    ...current.channelFeedback.filter(
      (item) => !(item.id === feedback.id && item.channelKey === feedback.channelKey),
    ),
  ];
  const sourceReports =
    feedback.verdict === 'correct'
      ? current.sourceReports.map((report) =>
          report.id === feedback.id &&
          report.channelKey === feedback.channelKey &&
          report.reason === 'wrong_channel'
            ? {
                ...report,
                state: 'working' as const,
                quarantineUntil: null,
                lastCheckedAt: feedback.updatedAt,
              }
            : report,
        )
      : [...current.sourceReports];
  return { feedback, sourceReports, channelFeedback };
}

/** Lo que se sabe de la comprobación de un informe (el candidato de su trabajo). */
export interface ProbeOutcome {
  readonly state: string;
  readonly reason?: string | null;
  readonly checkedAt?: string | null;
}

/**
 * `updateReportFromProbe` (server.js:4567-4592): el destino del informe
 * según la comprobación (B-053). Solo con un resultado definitivo.
 */
export function reportAfterProbe(
  report: SourceReport,
  probe: ProbeOutcome,
  now: number,
): SourceReport {
  if (probe.state !== 'working' && probe.state !== 'weak' && probe.state !== 'failed')
    return report;
  const checkedAt = probe.checkedAt || isoAt(now);
  let state: SourceReportState = probe.state;
  let quarantineUntil: string | null = null;
  if (report.reason === 'wrong_channel') {
    state = 'reported';
    quarantineUntil = isoAt(now + SOURCE_WRONG_CHANNEL_QUARANTINE_MS);
  } else if (QUALITY_REASONS.has(report.reason) && probe.state !== 'failed') {
    /* El muestreo confirma que hay vídeo, no que el audio vaya bien ni que no
       haya microcortes: cuarentena corta y "viva pero reportada". */
    state = 'reported';
    quarantineUntil = isoAt(now + SOURCE_QUALITY_QUARANTINE_MS);
  } else if (probe.state === 'failed') {
    quarantineUntil = isoAt(now + SOURCE_REPORT_QUARANTINE_MS);
  }
  return {
    ...report,
    state,
    checkReason: probe.reason || '',
    lastCheckedAt: checkedAt,
    quarantineUntil,
  };
}

/**
 * NUEVO (backend-modulos §8.2.11 y api.md §6.8): un informe que se queda sin
 * comprobación (sin comprobador, trabajo cancelado o podado, reinicio) pasa
 * de `checking` a `reported`; la cuarentena no se toca.
 */
export function reportWithoutProbe(report: SourceReport): SourceReport {
  return report.state === 'checking' ? { ...report, state: 'reported' } : report;
}
