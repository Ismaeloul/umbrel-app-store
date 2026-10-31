/* La línea de estado viva: el aviso de turno o, si no hay, el estado base
   que fija el reproductor. role="status" + aria-live="polite": se lee sin
   robar el foco. La región se queda montada aunque esté vacía para que los
   lectores de pantalla la conozcan antes del primer aviso.

   `quietWhenOk` (el reproductor de escritorio): el estado base de «todo va
   bien» (sin dato al lado: «Fuente 2. Vas en directo.») no se pinta; ya lo
   dicen la píldora de la fuente y la de DIRECTO. Los avisos y los estados
   con algo que contar (señal floja, por detrás) sí. */

import { useStore } from '../lib/store.ts';
import { StatusLineView } from '../ui/StatusLine.tsx';
import { statusStore } from './statusLine.ts';
import './notices.css';

export function StatusLineHost({
  className,
  quietWhenOk = false,
}: {
  className?: string;
  quietWhenOk?: boolean;
}) {
  const { message, base } = useStore(statusStore);
  const calm = quietWhenOk && base?.signal === 'ok' && !base.meta;
  const shown = message ?? (base && !calm ? { ...base, id: 0, count: 1, leaving: false } : null);
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
