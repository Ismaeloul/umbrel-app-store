/* Estado del motor, discreto: un rayo y «Motor en línea» en gris; solo se
   tiñe de ámbar o rojo si algo falla. Va en la barra superior (desde 768) y
   en la cabecera de cada vista (móvil). Un toque lleva a Ajustes → Salud.
   La variante `rail` (texto en dos líneas) queda para quien lo apile. */

import { useAppMode, useEngineSummary } from '../api/index.ts';
import { cx } from '../lib/cx.ts';
import { Icon } from '../ui/Icon.tsx';
import { useNavigate } from './router.tsx';

export function EngineIndicator({
  variant = 'inline',
  className,
}: {
  variant?: 'inline' | 'rail';
  className?: string;
}) {
  const summary = useEngineSummary();
  const mode = useAppMode();
  const navigate = useNavigate();
  // En demo el motor «está» en línea; que es la demo ya lo dice la etiqueta
  // «Modo demo» de la cabecera.
  const text = mode === 'demo' ? 'Motor en línea' : summary.text;
  const [first, ...rest] = text.split(' ');
  return (
    <button
      type="button"
      className={cx('engine', `engine--${variant}`, 'press', className)}
      data-tone={mode === 'demo' ? 'ok' : summary.tone}
      title="Salud del sistema"
      onClick={() => navigate({ vista: 'ajustes', seccion: 'salud' })}
    >
      <Icon name="motor" size={16} />
      {variant === 'rail' ? (
        <span className="engine__text">
          <span>{first}</span> <span>{rest.join(' ')}</span>
        </span>
      ) : (
        <span className="engine__text">{text}</span>
      )}
    </button>
  );
}
