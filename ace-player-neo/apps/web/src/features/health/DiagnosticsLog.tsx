/* Registro de diagnóstico (arquitectura §5.14): los últimos fallos con su
   causa (motor, fuente, red, códec, reproductor y datos guardados) y el
   recuento de las últimas 24 h, en lenguaje claro.

   - Filtro por causa con chips (aria-pressed); sale solo el chip de las causas
     con fallos en 24 h (y el elegido), para que en el móvil no ocupen tres
     líneas. «Todo» siempre.
   - Con una causa elegida se pide al backend ya filtrado (`?cause=`): así no
     se pierden fallos más viejos que los 200 últimos de todas las causas.
   - Nuevos fallos: el SSE `diagnostics.new` invalida esta consulta
     (src/api/sse.ts) y aparecen arriba; la animación de entrada solo corre en
     la fila nueva (claves estables, regla 2).
   - Más de 40 filas: lista virtualizada sobre el scroll de la página (la de la
     biblioteca), para no pintar 200 filas de golpe. */

import type { DiagnosticCause, DiagnosticEntry, DiagnosticsListResponse } from '@ace/shared';
import { useState, type CSSProperties } from 'react';
import { describeFailure, useApiQuery } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { Button } from '../../ui/Button.tsx';
import { Chip } from '../../ui/Chip.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Num } from '../../ui/Num.tsx';
import { SkeletonRows } from '../../ui/Skeleton.tsx';
import { VirtualList } from '../library/VirtualList.tsx';
import { CAUSE_INFO, CAUSES, describeEntry, formatWhen, metricsSentence } from './model.ts';

/** Cuántos fallos se piden (el backend guarda 500 en memoria). */
export const DIAG_LIMIT = 200;
/** A partir de cuántas filas se virtualiza. */
export const VIRTUAL_FROM = 40;

export interface DiagnosticsLogProps {
  /** La consulta sin filtro (la comparte con «por fuente»). */
  all: {
    data: DiagnosticsListResponse | undefined;
    isPending: boolean;
    isError: boolean;
    error: unknown;
    refetch(): unknown;
  };
  /** Recuento de 24 h de /health, por si el registro aún no ha llegado. */
  fallbackCounts: Record<DiagnosticCause, number> | null;
  /** Nombre de cada dispositivo emparejado, para los fallos que avisa uno. */
  deviceNames: ReadonlyMap<string, string>;
  now: number;
}

function EntryRow({
  entry,
  deviceName,
  now,
}: {
  entry: DiagnosticEntry;
  deviceName: string | null;
  now: number;
}) {
  const info = CAUSE_INFO[entry.cause];
  const when = formatWhen(entry.at, now);
  const metrics = metricsSentence(entry.metrics);
  return (
    <div className="salud-entry" data-cause={entry.cause}>
      <span className="salud-entry__icon" aria-hidden="true">
        <Icon name={info.icon} size={16} />
      </span>
      <div className="salud-entry__body">
        <p className="salud-entry__msg">{describeEntry(entry)}</p>
        <p className="salud-entry__meta">
          <span className="salud-entry__cause">{info.label}</span>
          {entry.channel ? <span>{entry.channel}</span> : null}
          {deviceName ? <span>{deviceName}</span> : null}
          <time dateTime={entry.at}>
            <Num value={when.time} condensed={false} /> · {when.relative}
          </time>
        </p>
        {metrics ? <p className="salud-entry__metrics">{metrics}</p> : null}
        <code className="salud-entry__code">{entry.code}</code>
      </div>
    </div>
  );
}

export function DiagnosticsLog({ all, fallbackCounts, deviceNames, now }: DiagnosticsLogProps) {
  const [cause, setCause] = useState<DiagnosticCause | null>(null);
  const filtered = useApiQuery(
    'diagnosticsList',
    { query: { cause: cause ?? undefined, limit: DIAG_LIMIT } },
    { enabled: cause !== null, refetchOnMount: 'always' },
  );
  const source = cause === null ? all : filtered;
  const counts = all.data?.counts24h ?? fallbackCounts;
  const total24 = counts ? CAUSES.reduce((sum, c) => sum + counts[c], 0) : null;
  const entries = source.data?.entries ?? [];
  const visibleCauses = CAUSES.filter((c) => c === cause || (counts?.[c] ?? 0) > 0);

  const toggle = (next: DiagnosticCause | null) => setCause((current) => (current === next ? null : next));
  const rowFor = (entry: DiagnosticEntry) => (
    <EntryRow
      entry={entry}
      now={now}
      deviceName={entry.deviceId ? (deviceNames.get(entry.deviceId) ?? null) : null}
    />
  );

  let body;
  if (source.isPending) {
    body = <SkeletonRows rows={3} label="Leyendo el registro…" />;
  } else if (source.isError) {
    body = (
      <div className="salud-inline salud-inline--err" role="alert">
        <Icon name="aviso" size={18} />
        <span>No se pudo leer el registro. {describeFailure(source.error)}</span>
        <Button size="sm" variant="quiet" icon="refresh" onClick={() => void source.refetch()}>
          Reintentar
        </Button>
      </div>
    );
  } else if (entries.length === 0) {
    body = (
      <p className="salud-inline salud-inline--ok">
        <Icon name="check" size={18} />
        <span>
          {cause
            ? `Sin fallos de «${CAUSE_INFO[cause].label}» registrados.`
            : 'Sin fallos registrados. Todo ha ido bien.'}
        </span>
      </p>
    );
  } else if (entries.length > VIRTUAL_FROM) {
    body = (
      <VirtualList
        rows={entries}
        rowKey={(entry) => entry.id}
        estimate={(entry) => (entry.metrics ? 116 : 92)}
        renderRow={(entry) => rowFor(entry)}
        label="Fallos registrados"
        className="salud-log"
      />
    );
  } else {
    body = (
      <ul className="salud-log stagger" aria-label="Fallos registrados">
        {entries.map((entry, index) => (
          <li key={entry.id} style={{ '--i': index } as CSSProperties}>
            {rowFor(entry)}
          </li>
        ))}
      </ul>
    );
  }

  const shown = entries.length;
  const stored = source.data?.total ?? 0;

  return (
    <section className="salud-block" aria-labelledby="salud-registro">
      <div className="salud-block__head">
        <h3 id="salud-registro" className="salud-block__title">
          Registro de fallos
        </h3>
        {total24 !== null ? (
          <span className="salud-block__aside">
            <Num value={total24} condensed={false} /> en 24 h
          </span>
        ) : null}
      </div>
      <div className="salud-causes" role="group" aria-label="Filtrar por causa">
        <Chip pressed={cause === null} onClick={() => setCause(null)} count={total24 ?? undefined}>
          Todo
        </Chip>
        {visibleCauses.map((c) => (
          <Chip
            key={c}
            icon={CAUSE_INFO[c].icon}
            pressed={cause === c}
            count={counts?.[c] ?? 0}
            onClick={() => toggle(c)}
            title={CAUSE_INFO[c].help}
          >
            {CAUSE_INFO[c].label}
          </Chip>
        ))}
      </div>
      {cause ? <p className="salud-help">{CAUSE_INFO[cause].help}</p> : null}
      {body}
      {!source.isPending && !source.isError && stored > shown ? (
        <p className={cx('salud-help', 'salud-help--foot')}>
          {shown === 1 ? 'Sale el más reciente' : `Salen los ${shown} más recientes`} de {stored} guardados.
        </p>
      ) : null}
    </section>
  );
}
