/* Ajustes → Registro: «Descargar logs» (0.9.0; docs/registro.md). Va en su
   propio trozo de JS (React.lazy en SettingsView): solo se descarga al abrir
   la sección.

   Lo pidió Isma: un botón para descargar los logs y pasarlos si dentro de un
   mes algo falla. De arriba abajo:
   1. Lo que hay guardado en el Umbrel (desde cuándo, cuánto ocupa y cuándo se
      borra solo), de GET /api/v1/diagnostics/log al abrir la sección.
   2. El periodo: último día, última semana o último mes (por defecto).
   3. «Descargar logs»: un .zip (model.ts) con su aviso al terminar y, si
      falla, la frase debajo (role=alert, la lee el lector de pantalla).
   4. Una línea que dice qué lleva y que NO lleva contraseñas.
   Piel «Palco»: reutiliza .set-stack, .set-field, .set-about, .set-row y
   .set-help de settings.css. */

import type { LogPeriod } from '@ace/shared';
import { useState } from 'react';
import { describeFailure, useApiQuery, useAppMode } from '../../api/index.ts';
import { useLayout } from '../../app/layout.tsx';
import { haptic } from '../../lib/haptics.ts';
import { notify } from '../../notices/index.ts';
import { Button, Segmented, Skeleton } from '../../ui/index.ts';
import { registerLogsDemo } from './demo.ts';
import { LOGS_HELP, LOGS_PERIODS, downloadLogs, logsNotice, storageRows } from './model.ts';
import './logs.css';

// Lo que contesta la demo (lo guardado de muestra). Solo cuenta en demo.
registerLogsDemo();

function Stored() {
  const info = useApiQuery('diagnosticsLogInfo', undefined, { refetchOnMount: 'always' });
  if (!info.data) {
    return info.isError ? (
      <p className="set-help">No se pudo leer lo que hay guardado. {describeFailure(info.error)}</p>
    ) : (
      <div className="set-about logs-store" role="status" aria-busy="true">
        <span className="sr-only">Mirando lo que hay guardado…</span>
        {[44, 52, 48].map((width) => (
          <div key={width} aria-hidden="true">
            <Skeleton width={`${width}%`} height={14} radius="s" />
            <Skeleton width="22%" height={14} radius="s" />
          </div>
        ))}
      </div>
    );
  }
  const rows = storageRows(info.data);
  if (typeof rows === 'string') return <p className="set-help logs-note">{rows}</p>;
  return (
    <dl className="set-about logs-store" aria-label="Lo que hay guardado en el Umbrel">
      {rows.map((row) => (
        <div key={row.label}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function LogsSection() {
  const mode = useAppMode();
  const { kind } = useLayout();
  const [period, setPeriod] = useState<LogPeriod>('mes');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const { name, bytes } = await downloadLogs(period, {
        layout: kind,
        mode: mode === 'pending' ? undefined : mode,
      });
      haptic('success');
      notify(logsNotice(name, bytes), { tone: 'ok', icon: 'descargar' });
    } catch (failure) {
      setError(`No se pudieron descargar los logs. ${describeFailure(failure)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="set-stack logs">
      <Stored />
      <div className="set-field">
        <p className="set-label" id="logs-periodo">
          Qué periodo
        </p>
        <Segmented
          label="Qué periodo"
          block
          value={period}
          onChange={(next: LogPeriod) => {
            haptic('selection');
            setPeriod(next);
          }}
          items={LOGS_PERIODS}
        />
      </div>
      <div className="set-row">
        <Button variant="primary" icon="descargar" busy={busy} onClick={() => void download()}>
          {busy ? 'Preparando los logs…' : 'Descargar logs'}
        </Button>
      </div>
      <p className="set-help">{LOGS_HELP}</p>
      {error ? (
        <p className="set-help set-help--err" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
