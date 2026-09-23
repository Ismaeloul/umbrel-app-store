/* La línea de estado viva: el aviso de turno o, si no hay, el estado base
   que fija el reproductor. role="status" + aria-live="polite": se lee sin
   robar el foco. La región se queda montada aunque esté vacía para que los
   lectores de pantalla la conozcan antes del primer aviso. */

import { useStore } from '../lib/store.ts';
import { StatusLineView } from '../ui/StatusLine.tsx';
import { statusStore } from './statusLine.ts';
import './notices.css';

export function StatusLineHost({ className }: { className?: string }) {
  const { message, base } = useStore(statusStore);
  const shown = message ?? (base ? { ...base, id: 0, count: 1, leaving: false } : null);
  return (
    <div
      className={className ? `status-host ${className}` : 'status-host'}
      role="status"
      aria-live="polite"
    >
      {shown ? (
        <StatusLineView
          key={shown.id}
          text={shown.text}
          tone={shown.tone}
          signal={shown.signal}
          icon={shown.icon}
          meta={shown.meta}
          count={shown.count}
          state={shown.leaving ? 'leaving' : 'in'}
        />
      ) : null}
    </div>
  );
}
