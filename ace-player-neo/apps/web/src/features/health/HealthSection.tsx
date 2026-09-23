/* Ajustes → Salud del sistema (inventario §12; el indicador del motor de la
   cabecera y del carril lleva aquí).

   Qué enseña, de arriba abajo:
   1. Resumen en una frase («Todo funciona.») con los datos de la 0.6.59
      (fuentes en cuarentena, correcciones aprendidas y hora de la
      comprobación) y «Volver a comprobar».
   2. Avisos del backend tal cual (cupo de reinicios agotado, fugas del
      comprobador…).
   3. Cuadrícula por servicio: backend, motor, segundo motor, IA, agenda,
      directorios, datos guardados y reproducción. Cada uno con forma + palabra
      (nunca solo color). El motor, con su reinicio de segundo toque.
   4. Por fuente, si hay datos: las fuentes con fallos en 24 h.
   5. El registro de diagnóstico por causa.

   Datos: GET /api/v1/health y /api/v1/diagnostics. NADA de sondeos: se
   consultan al abrir la sección (refetchOnMount 'always': cada vez que la
   vista vuelve a verse) y al pulsar el botón, como la 0.6.59; lo que cambia
   solo llega por SSE (`engine.status` actualiza el motor, `diagnostics.new` y
   `state.changed` invalidan la salud y el registro, src/api/sse.ts). */

import { useQueryClient } from '@tanstack/react-query';
import { useMemo, type CSSProperties } from 'react';
import {
  invalidateRoute,
  useApiQuery,
  useAppMode,
  useEngineStatus,
} from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { Button } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { Icon } from '../../ui/Icon.tsx';
import type { IconName } from '../../ui/icons.ts';
import { Num } from '../../ui/Num.tsx';
import { SignalBadge } from '../../ui/SignalBadge.tsx';
import { Skeleton } from '../../ui/Skeleton.tsx';
import { useSecondTap } from '../settings/second-tap.ts';
import { DIAG_LIMIT, DiagnosticsLog } from './DiagnosticsLog.tsx';
import { CONFIRM_RESTART_MS, RESTART_WARNING, useEngineRestart } from './engine.ts';
import {
  CAUSE_INFO,
  formatWhen,
  groupBySource,
  healthSummary,
  plural,
  serviceRows,
  type ServiceRow,
  type SourceGroup,
} from './model.ts';
import { useNow } from './useNow.ts';
import './health.css';

const TONE_ICON: Record<'ok' | 'weak' | 'fail', IconName> = {
  ok: 'check',
  weak: 'aviso',
  fail: 'x',
};

function EngineRestart() {
  const confirm = useSecondTap(CONFIRM_RESTART_MS);
  const { busy, restart } = useEngineRestart();
  const armed = confirm.armed === 'motor';
  return (
    <div className="salud-tile__act">
      <Button
        size="sm"
        variant={armed ? 'danger' : 'quiet'}
        icon="refresh"
        busy={busy}
        onClick={() => confirm.tap('motor', () => void restart())}
      >
        {armed ? '¿Seguro? Pulsa otra vez' : 'Reiniciar el motor'}
      </Button>
      <p className="salud-tile__warn" aria-live="polite">
        {armed ? RESTART_WARNING : ''}
      </p>
    </div>
  );
}

function Tile({ row, index }: { row: ServiceRow; index: number }) {
  return (
    <li
      className="salud-tile"
      data-signal={row.signal}
      data-service={row.id}
      style={{ '--i': index } as CSSProperties}
    >
      <div className="salud-tile__head">
        <span className="salud-tile__icon" aria-hidden="true">
          <Icon name={row.icon} size={18} />
        </span>
        <h3 className="salud-tile__name">{row.name}</h3>
        <SignalBadge compact size="sm" state={row.signal} label={row.label} className="salud-tile__state" />
      </div>
      <p className="salud-tile__detail">{row.detail}</p>
      {row.note ? (
        <p className="salud-tile__note" data-tone={row.noteTone}>
          {row.note}
        </p>
      ) : null}
      {row.id === 'engine' ? <EngineRestart /> : null}
    </li>
  );
}

function SourceRow({ group, now }: { group: SourceGroup; now: number }) {
  const when = formatWhen(group.last.at, now);
  return (
    <li className="salud-src">
      <div className="salud-src__main">
        <span className="salud-src__name">{group.name}</span>
        <span className="salud-src__causes">
          {group.causes.map((cause) => CAUSE_INFO[cause].label).join(' · ')}
        </span>
      </div>
      <div className="salud-src__side">
        <span className="salud-src__count">
          <Num value={group.count} /> {group.count === 1 ? 'fallo' : 'fallos'}
        </span>
        <span className="salud-src__when">último {when.relative}</span>
      </div>
    </li>
  );
}

function GridSkeleton() {
  return (
    <ul className="salud-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="salud-tile salud-tile--skeleton">
          <Skeleton width="55%" height={18} radius="s" />
          <Skeleton width="80%" height={14} radius="s" />
        </li>
      ))}
    </ul>
  );
}

export function HealthSection() {
  const client = useQueryClient();
  const mode = useAppMode();
  const now = useNow();
  const health = useApiQuery('health', undefined, { refetchOnMount: 'always' });
  const engine = useEngineStatus();
  const all = useApiQuery(
    'diagnosticsList',
    { query: { limit: DIAG_LIMIT } },
    { refetchOnMount: 'always' },
  );
  const entries = all.data?.entries;
  const needsDevices = Boolean(entries?.some((entry) => entry.deviceId));
  const devices = useApiQuery('devicesList', undefined, { enabled: needsDevices });
  const deviceNames = useMemo(
    () => new Map((devices.data?.devices ?? []).map((d) => [d.id, d.name])),
    [devices.data],
  );

  const rows = useMemo(
    () => (health.data ? serviceRows(health.data, engine.data, now) : null),
    [health.data, engine.data, now],
  );
  const summary = health.data && rows ? healthSummary(health.data, rows) : null;
  const sources = useMemo(() => groupBySource(entries ?? [], now), [entries, now]);
  const refreshing = health.isFetching || all.isFetching;

  const refresh = () => {
    void health.refetch();
    void all.refetch();
    void invalidateRoute('engineStatus', client);
  };

  if (health.isError && !health.data) {
    return (
      <div className="salud">
        <EmptyState
          tone="error"
          title="No se pudo leer la salud"
          actions={
            <Button variant="primary" icon="refresh" busy={refreshing} onClick={refresh}>
              Volver a comprobar
            </Button>
          }
        >
          Vuelve a comprobar cuando el NAS esté accesible.
        </EmptyState>
      </div>
    );
  }

  return (
    <div className="salud">
      <div className="salud-top">
        <div
          className={cx('salud-sum', summary && `salud-sum--${summary.tone}`)}
          role="status"
          aria-live="polite"
          aria-busy={!summary || undefined}
        >
          {summary ? (
            <>
              <span className="salud-sum__icon" aria-hidden="true">
                <Icon name={TONE_ICON[summary.tone]} size={20} />
              </span>
              <div className="salud-sum__text">
                <p className="salud-sum__head">
                  {summary.headline}
                  {mode === 'demo' ? <span className="salud-sum__demo"> (demo)</span> : null}
                </p>
                <p className="salud-sum__facts">{summary.facts.join(' · ')}</p>
              </div>
            </>
          ) : (
            <p className="salud-sum__facts salud-sum__facts--pulse">Comprobando el NAS y los servicios…</p>
          )}
        </div>
        <Button variant="quiet" icon="refresh" busy={refreshing} onClick={refresh} className="salud-top__btn">
          Volver a comprobar
        </Button>
      </div>

      {health.data?.warnings.length ? (
        <ul className="salud-warn" aria-label="Avisos">
          {health.data.warnings.map((warning) => (
            <li key={warning.code} className="salud-warn__item">
              <Icon name="aviso" size={18} />
              <span>{warning.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {rows ? (
        <ul className="salud-grid stagger" aria-label="Servicios">
          {rows.map((row, index) => (
            <Tile key={row.id} row={row} index={index} />
          ))}
        </ul>
      ) : (
        <GridSkeleton />
      )}

      {sources.length > 0 ? (
        <section className="salud-block" aria-labelledby="salud-fuentes">
          <div className="salud-block__head">
            <h3 id="salud-fuentes" className="salud-block__title">
              Fuentes con fallos
            </h3>
            <span className="salud-block__aside">últimas 24 h</span>
          </div>
          <ul className="salud-srcs" aria-label="Fuentes con fallos en las últimas 24 horas">
            {sources.map((group) => (
              <SourceRow key={group.key} group={group} now={now} />
            ))}
          </ul>
          {health.data ? (
            <p className="salud-help">
              {plural(health.data.components.scanner.cachedSources, 'fuente comprobada', 'fuentes comprobadas')}{' '}
              en caché del segundo motor.
            </p>
          ) : null}
        </section>
      ) : null}

      <DiagnosticsLog
        all={all}
        fallbackCounts={health.data?.diagnostics.counts24h ?? null}
        deviceNames={deviceNames}
        now={now}
      />
    </div>
  );
}
