/* «Dónde se emite» (diseño A + injerto B3): todos los canales anunciados
   (regla 30: el backend limita a 8, aquí se pintan todos), con borde
   continuo si el canal está en tu biblioteca y discontinuo si se buscará al
   reproducir. Debajo, el día y la hora y, con ratón y teclado, los atajos
   que más se usan (el resto, con «?»). */

import type { FootballMatch } from '@ace/shared';
import { Chip, Kbd } from '../../ui/index.ts';
import { dayLabel, type ChannelInfo } from '../agenda/domain.ts';

const HINTS: ReadonlyArray<[string, string]> = [
  ['Espacio', 'Pausa y reanuda'],
  ['J', 'Retrocede 30 s'],
  ['N', 'Siguiente fuente'],
  ['S', 'Datos técnicos'],
  ['G', 'Favorito'],
  ['?', 'Todos los atajos'],
];

export function WhereAired({
  match,
  channels,
  today,
}: {
  match: FootballMatch;
  channels: readonly ChannelInfo[];
  today: string;
}) {
  const day = dayLabel(match.date, today);
  const dayText = ['Hoy', 'Mañana', 'Ayer'].includes(day.primary)
    ? day.primary
    : `${day.primary} ${day.secondary}`;
  const when = /^\d{2}:\d{2}$/.test(match.time)
    ? `${dayText}, ${match.time}`
    : `${dayText}, hora por confirmar`;
  return (
    <section className="mc-where" aria-labelledby={`mc-where-${match.id}`}>
      <h2 id={`mc-where-${match.id}`} className="mc-where__title">
        Dónde se emite
      </h2>
      {channels.length ? (
        <ul className="mc-where__chips">
          {channels.map((channel) => (
            <li key={channel.name}>
              <Chip
                icon="tv"
                outline={channel.inLibrary ? 'solid' : 'dashed'}
                title={
                  channel.inLibrary ? 'Disponible en tu biblioteca' : 'Se buscará al reproducir'
                }
              >
                {channel.name}
              </Chip>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mc-where__muted">Canal por confirmar</p>
      )}
      <p className="mc-where__meta">{[match.competition, when].filter(Boolean).join(' · ')}</p>
      <dl className="mc-where__keys" aria-label="Atajos de teclado">
        {HINTS.map(([key, label]) => (
          <div key={key} className="mc-where__key">
            <dt>
              <Kbd>{key}</Kbd>
            </dt>
            <dd>{label}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
