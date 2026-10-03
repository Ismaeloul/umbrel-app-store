/* Agenda híbrida (docs/iptv.md §4.7): «Confirmado en tu guía: M+ LaLiga TV 2 ·
   21:00». Una línea pequeña y aparte, para que la tarjeta y «Dónde se emite»
   solo tengan que ponerla:
   - `row`: la tarjeta de la agenda; una línea que se recorta con «…» (la
     hora movida o el partido añadido, en el `title`);
   - `detail`: «Dónde se emite» del partido; con la nota debajo.
   Sin `guide` (sin IPTV, en pausa, sin guía o sin datos de ese partido) no
   pinta nada: el partido se ve como siempre. */

import type { FootballGuideInfo } from '@ace/shared';
import { cx } from '../../lib/cx.ts';
import { Icon } from '../../ui/index.ts';
import './guide-note.css';

export interface GuideNoteText {
  /** «Confirmado en tu guía». */
  lead: string;
  channel: string;
  /** «21:00», o '' si no hay hora. */
  time: string;
  /** La hora movida o el partido añadido; null si no hay nada más que contar. */
  extra: string | null;
}

/** Los textos de la nota (puro: lo comparten la tarjeta, el partido y los tests). */
export function guideNoteText(guide: FootballGuideInfo): GuideNoteText {
  const time = /^\d{2}:\d{2}$/.test(guide.time) ? guide.time : '';
  let extra: string | null = null;
  if (guide.added) extra = 'No salía en la agenda: lo añade tu guía.';
  else if (guide.agendaTime && time) {
    extra = `Tu guía lo pone a las ${time}; la agenda decía ${guide.agendaTime}.`;
  }
  return { lead: 'Confirmado en tu guía', channel: guide.channel, time, extra };
}

/** La frase entera, para lectores de pantalla y para el `title`. */
export function guideNoteSentence(guide: FootballGuideInfo): string {
  const text = guideNoteText(guide);
  const main = `${text.lead}: ${text.channel}${text.time ? ` · ${text.time}` : ''}`;
  return text.extra ? `${main}. ${text.extra}` : main;
}

export function GuideNote({
  guide,
  variant = 'row',
  className,
}: {
  guide: FootballGuideInfo | null | undefined;
  variant?: 'row' | 'detail';
  className?: string;
}) {
  if (!guide?.channel) return null;
  const text = guideNoteText(guide);
  return (
    <p
      className={cx('guide-note', `guide-note--${variant}`, className)}
      title={variant === 'row' ? guideNoteSentence(guide) : undefined}
    >
      <Icon name="check" size={16} className="guide-note__icon" />
      <span className="guide-note__main">
        {text.lead}: {/* Canal y hora juntos: si no cabe, la línea se parte antes del canal. */}
        <span className="guide-note__where">
          <span className="guide-note__channel">{text.channel}</span>
          {text.time ? (
            <>
              <span className="guide-note__sep" aria-hidden="true">
                {' · '}
              </span>
              <span className="sr-only">, a las </span>
              <span className="guide-note__time">{text.time}</span>
            </>
          ) : null}
        </span>
      </span>
      {variant === 'detail' && text.extra ? (
        <span className="guide-note__extra">{text.extra}</span>
      ) : null}
    </p>
  );
}
