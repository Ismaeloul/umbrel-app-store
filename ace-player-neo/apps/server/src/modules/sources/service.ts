/* El servicio de fuentes: informes, resultados de reproducción,
   correcciones y fiabilidad (arquitectura §5.9; api.md §4.14-4.16).

   Todo lo que escribe pasa por la cola del estado (`state.enqueue`) y el
   comprobador se usa por su interfaz (un informe lanza una sonda forzada y
   prioritaria, T-079). Del comprobador se entera por el bus: `scan.jobDone`
   con la clave del informe decide su destino (`updateReportFromProbe`).

   Arreglos respecto a la 0.6.59:
   - El informe ya no borra el veredicto guardado si manda el del reproductor
     (§8.2.8): la fuente que se está viendo no se vuelve a probar.
   - Un informe cuyo trabajo se cancela o se poda pasa de `checking` a
     `reported` (§8.2.11); al arrancar, los que quedaron en `checking` de
     antes del reinicio también (ningún trabajo sobrevive a un reinicio).
   - Sin comprobador, el informe se guarda ya como `reported` y no se queda
     en `checking` para siempre (api.md §6.8). */

import {
  cleanTitle,
  normalizeHash,
  type FeedbackBody,
  type FeedbackResponse,
  type OutcomeBody,
  type OutcomeResponse,
  type ReportBody,
  type ReportResponse,
  type ResolutionCandidate,
  type SourceReport,
  type SourceStatEntry,
} from '@ace/shared';
import type { DomainEvents, Unsubscribe } from '../../core/bus.js';
import { AppError } from '../../core/errors.js';
import {
  applyLearnedSourceRules,
  asRecord,
  buildFeedback,
  buildReport,
  newReportId,
  normalizeChannelFeedback,
  normalizeChannelFeedbacks,
  normalizeSourceReports,
  publicSourceReport,
  reportAfterProbe,
  reportWithoutProbe,
  isoAt,
} from './reports.js';
import {
  OUTCOME_RESULTS,
  anotarResultado,
  fiabilidadDeCandidato,
  normalizeSourceStats,
  ownEntry,
  proveedorDeSeñal,
  setOwn,
  tasaFiable,
  veredictoDelReproductor,
} from './stats.js';
import type { ReportOptions, SourcesDeps, SourcesService } from './types.js';

export class SourcesServiceImpl implements SourcesService {
  private unsubscribe: Unsubscribe | null = null;
  /** Informe → trabajo vigente del comprobador: solo ese decide su destino. */
  private readonly reportJobs = new Map<string, string>();

  constructor(
    private readonly deps: SourcesDeps,
    private readonly makeId: () => string = newReportId,
  ) {}

  async start(): Promise<void> {
    if (this.unsubscribe) return;
    this.unsubscribe = this.deps.bus.on('scan.jobDone', (event) => this.onJobDone(event));
    /* Ningún trabajo sobrevive a un reinicio: lo que quedó en `checking` ya
       no lo va a actualizar nadie (backend-modulos §8.2.11). */
    try {
      if (this.deps.state.get().sourceReports.some((report) => report.state === 'checking')) {
        await this.releaseReports(() => true);
      }
    } catch (error) {
      this.deps.logger.error(
        { err: error },
        '[sources] no se pudieron soltar los informes en checking',
      );
    }
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.reportJobs.clear();
  }

  // --- Informes ---

  async report(
    body: ReportBody | Record<string, unknown>,
    options: ReportOptions = {},
  ): Promise<ReportResponse> {
    const { clock, scanner, state } = this.deps;
    const value = asRecord(body);
    const id = normalizeHash(value.id);
    if (!id) throw new AppError('bad_request', { detail: 'informe sin hash' });
    const now = clock.now();
    const matchId = String(value.matchId || '');
    const programChannel =
      !cleanTitle(value.channel, '') && matchId && options.programChannels
        ? (options.programChannels(matchId)[0] ?? null)
        : null;
    const enabled = scanner.isEnabled();
    let report = await state.enqueue(
      (draft) => {
        const built = buildReport(draft, value, { now, newId: this.makeId, programChannel });
        /* Sin comprobador no hay nadie que lo vaya a comprobar (api.md §6.8). */
        const saved = enabled ? built.report : reportWithoutProbe(built.report);
        draft.sourceReports = normalizeSourceReports([saved, ...built.sourceReports.slice(1)], now);
        draft.channelFeedback = normalizeChannelFeedbacks(built.channelFeedback, now);
        return saved;
      },
      { scopes: ['reports', 'learning'] },
    );
    /* server.js:4558 borraba el veredicto siempre; si manda el reproductor se
       conserva y la sonda forzada lo respeta (backend-modulos §8.2.8). */
    if (!scanner.playerVerdictHeld(id)) scanner.forget(id);
    /* Un informe repetido cancela su trabajo anterior (misma clave de
       cliente): ese aviso ya no decide nada. */
    this.reportJobs.delete(report.reportId);
    const scan = enabled
      ? scanner.enqueue({
          kind: 'report',
          candidates: [{ id, ih: report.ih }],
          clientKey: `report_${report.reportId}`,
          reportKey: report.reportId,
          force: true,
          priority: true,
        })
      : null;
    if (scan) this.reportJobs.set(report.reportId, scan.id);
    else if (enabled) {
      const reportId = report.reportId;
      await this.releaseReports((item) => item.reportId === reportId);
      report = reportWithoutProbe(report);
    }
    return { report: publicSourceReport(report), scan };
  }

  /** `scan.jobDone` de un informe: su destino (updateReportFromProbe, server.js:4567-4592). */
  private onJobDone(event: DomainEvents['scan.jobDone']): void {
    const reportId = event.reportKey;
    if (!reportId || this.reportJobs.get(reportId) !== event.jobId) return;
    this.reportJobs.delete(reportId);
    let outcome: { state: string; reason: string; checkedAt: string | null } | null = null;
    if (event.status === 'complete') {
      try {
        outcome = this.deps.scanner.job(event.jobId).candidates[0] ?? null;
      } catch {
        outcome = null;
      }
    }
    const now = this.deps.clock.now();
    const apply = (report: SourceReport): SourceReport =>
      outcome ? reportAfterProbe(report, outcome, now) : reportWithoutProbe(report);
    this.deps.state
      .enqueue(
        (draft) => {
          if (!draft.sourceReports.some((report) => report.reportId === reportId)) return;
          draft.sourceReports = normalizeSourceReports(
            draft.sourceReports.map((report) =>
              report.reportId === reportId ? apply(report) : report,
            ),
            now,
          );
        },
        { scopes: ['reports'] },
      )
      .catch((error: unknown) => {
        /* Un fallo al guardar no tumba el proceso (B-028, backend-modulos §8.2.12). */
        this.deps.logger.error(
          { err: error, reportId },
          '[sources] no se pudo anotar la comprobación',
        );
      });
  }

  /** Pasa a `reported` los informes en `checking` que cumplan `match`. */
  private async releaseReports(match: (report: SourceReport) => boolean): Promise<void> {
    const now = this.deps.clock.now();
    await this.deps.state.enqueue(
      (draft) => {
        draft.sourceReports = normalizeSourceReports(
          draft.sourceReports.map((report) =>
            match(report) ? reportWithoutProbe(report) : report,
          ),
          now,
        );
      },
      { scopes: ['reports'] },
    );
  }

  // --- Resultados de reproducción ---

  async outcome(body: OutcomeBody | Record<string, unknown>): Promise<OutcomeResponse> {
    const value = asRecord(body);
    const id = normalizeHash(value.id);
    const resultado = String(value.resultado || '');
    if (!id || !(OUTCOME_RESULTS as readonly string[]).includes(resultado)) {
      throw new AppError('bad_outcome');
    }
    const now = this.deps.clock.now();
    const segundos = Math.min(86_400, Math.max(0, Number(value.segundos) || 0));
    /* Siempre: el veredicto del reproductor, que manda 3 min (server.js:3946-3950). */
    this.deps.scanner.recordVerdict(id, {
      ...veredictoDelReproductor(resultado, segundos),
      by: 'player',
    });
    /* "sigue" solo renueva el veredicto mientras se ve: no es un intento (T-123). */
    if (resultado === 'sigue') return { hash: null, proveedor: null };
    const proveedor = proveedorDeSeñal({
      title: value.title,
      listaId: value.listaId,
      source: value.source,
    });
    return this.deps.state.enqueue(
      (draft) => {
        const stats = normalizeSourceStats(draft.sourceStats);
        setOwn(
          stats.hashes,
          id,
          anotarResultado(ownEntry(stats.hashes, id), resultado, segundos, now),
        );
        if (proveedor) {
          setOwn(
            stats.proveedores,
            proveedor,
            anotarResultado(ownEntry(stats.proveedores, proveedor), resultado, segundos, now),
          );
        }
        const next = normalizeSourceStats(stats);
        draft.sourceStats = next;
        return {
          hash: ownEntry(next.hashes, id) ?? null,
          proveedor: proveedor ? (ownEntry(next.proveedores, proveedor) ?? null) : null,
        };
      },
      { scopes: ['stats'] },
    );
  }

  // --- Correcciones ---

  async feedback(body: FeedbackBody | Record<string, unknown>): Promise<FeedbackResponse> {
    const value = asRecord(body);
    const now = this.deps.clock.now();
    if (!normalizeChannelFeedback({ ...value, updatedAt: isoAt(now) }, now)) {
      throw new AppError('bad_feedback');
    }
    return this.deps.state.enqueue(
      (draft) => {
        const built = buildFeedback(draft, value, now);
        draft.channelFeedback = normalizeChannelFeedbacks(built.channelFeedback, now);
        draft.sourceReports = normalizeSourceReports(built.sourceReports, now);
        return { feedback: built.feedback, learningCount: draft.channelFeedback.length };
      },
      { scopes: ['learning', 'reports'] },
    );
  }

  // --- Lecturas ---

  applyLearnedRules(
    channels: readonly string[],
    candidates: readonly ResolutionCandidate[],
    now: number = this.deps.clock.now(),
  ): ResolutionCandidate[] {
    return applyLearnedSourceRules(this.deps.state.get(), channels, candidates, now);
  }

  reliability(
    candidate: Pick<ResolutionCandidate, 'id' | 'title' | 'listaId' | 'source'>,
  ): number | null {
    return fiabilidadDeCandidato(candidate, this.deps.state.get().sourceStats);
  }

  counts(): {
    readonly total: number;
    readonly quarantined: number;
    readonly learningCount: number;
  } {
    const current = this.deps.state.get();
    const now = this.deps.clock.now();
    return {
      total: current.sourceReports.length,
      quarantined: current.sourceReports.filter(
        (report) => Date.parse(report.quarantineUntil || '') > now,
      ).length,
      learningCount: current.channelFeedback.length,
    };
  }

  // --- Funciones puras ---

  addOutcome(
    stat: SourceStatEntry | null,
    result: 'arranco' | 'fallo' | 'cayo',
    seconds: number,
    now: number,
  ): SourceStatEntry {
    return anotarResultado(stat, result, seconds, now);
  }

  reliableRate(stat: Pick<SourceStatEntry, 'intentos' | 'exitos'> | null): number | null {
    return tasaFiable(stat);
  }

  providerOf(candidate: {
    readonly title?: string;
    readonly listaId?: string | null;
    readonly source?: string;
  }): string {
    return proveedorDeSeñal(candidate);
  }
}
