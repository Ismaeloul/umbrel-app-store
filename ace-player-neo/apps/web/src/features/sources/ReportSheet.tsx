/* «Reportar fuente» (inventario §7.7): cinco motivos, «No arranca» marcado
   por defecto. Al enviar, la fuente queda apartada y el segundo motor la
   vuelve a comprobar; reportar NO cambia de fuente sola (index.html:4034). */

import type { SourceReportReason } from '@ace/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Sheet } from '../../ui/index.ts';
import { REPORT_REASONS } from './model.ts';
import { openReport, reportSource, useSession } from './session.ts';

export function ReportSheet() {
  const hash = useSession((state) => state.reportFor);
  const entries = useSession((state) => state.entries);
  const [reason, setReason] = useState<SourceReportReason>('not_starting');
  const [busy, setBusy] = useState(false);
  const formId = useId();
  const first = useRef<HTMLInputElement>(null);
  // Lo último abierto, para que la hoja no se quede vacía durante su salida.
  const last = useRef<string | null>(null);
  if (hash) last.current = hash;
  const target = last.current;
  const index = entries.findIndex((entry) => entry.id === target);
  const entry = index >= 0 ? entries[index] : undefined;

  useEffect(() => {
    if (hash) setReason('not_starting');
  }, [hash]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!target || busy) return;
    setBusy(true);
    try {
      await reportSource(target, reason);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={hash !== null}
      onClose={() => openReport(null)}
      title="Reportar fuente"
      size="sm"
      initialFocus={first}
      description={
        <p className="src-report__lede">
          ¿Qué ocurre con esta señal?
          {entry ? (
            <span className="src-report__which">
              Fuente {index + 1} · {entry.title} · <code className="mono">{entry.id.slice(0, 12)}</code>
            </span>
          ) : null}
        </p>
      }
      footer={
        <Button variant="primary" icon="flag" type="submit" form={formId} busy={busy} block>
          Reportar y comprobar
        </Button>
      }
    >
      <form id={formId} className="src-report" onSubmit={(event) => void submit(event)}>
        <fieldset className="src-report__reasons">
          <legend className="sr-only">Motivo</legend>
          {REPORT_REASONS.map((item, i) => (
            <label key={item.id} className="src-report__reason press">
              <input
                ref={i === 0 ? first : undefined}
                type="radio"
                name="motivo"
                value={item.id}
                checked={reason === item.id}
                onChange={() => setReason(item.id)}
              />
              <span>{item.label}</span>
            </label>
          ))}
        </fieldset>
        <p className="src-report__note">
          La fuente se apartará temporalmente y el segundo motor la comprobará en segundo plano.
        </p>
      </form>
    </Sheet>
  );
}
