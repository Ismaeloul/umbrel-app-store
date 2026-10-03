/* Agenda híbrida (docs/iptv.md §4.7): lo que dice la guía de tu IPTV de un
   partido de hoy o mañana. Una línea pequeña y aparte, para que la tarjeta y
   «Dónde se emite» solo tengan que ponerla:
   - confirmado (icono check): «Confirmado en tu guía: M+ LaLiga TV 2 · 21:00»;
   - hora movida (icono reloj): «Hora de tu guía: DAZN LaLiga 2 · 21:30 · antes 21:00»;
   - añadido (icono más): «Añadido por tu guía: M+ LaLiga TV · 19:00».
   Lo de la hora movida y el partido añadido se VE (también en el móvil, sin
   ratón), no solo en el `title`.
   - `row`: la tarjeta de la agenda; dos líneas como mucho. El canal se
     recorta con «…» y la hora no se pierde nunca;
   - `detail`: «Dónde se emite» del partido; con la nota entera debajo.
   Sin `guide` (sin IPTV, en pausa, sin guía o sin datos de ese partido) no
   pinta nada: el partido se ve como siempre. */

import type { FootballGuideInfo } from '@ace/shared';
import { cx } from '../../lib/cx.ts';
import { Icon } from '../../ui/index.ts';
import type { IconName } from '../../ui/icons.ts';
import './guide-note.css';

export type GuideNoteKind = 'confirmed' | 'moved' | 'added';

export interface GuideNoteText {
  readonly kind: GuideNoteKind;
  /** «Confirmado en tu guía», «Hora de tu guía» o «Añadido por tu guía». */
  readonly lead: string;
  readonly channel: string;
  /** «21:00», o '' si no hay hora. */
  readonly time: string;
  /** La hora que decía la agenda si la guía la ha movido; '' si no. */
  readonly before: string;
  /** La hora movida o el partido añadido, en una frase; null si no hay nada más que contar. */
  readonly extra: string | null;
}

const LEADS: Readonly<Record<GuideNoteKind, string>> = {
  confirmed: 'Confirmado en tu guía',
  moved: 'Hora de tu guía',
  added: 'Añadido por tu guía',
};

const ICONS: Readonly<Record<GuideNoteKind, IconName>> = {
  confirmed: 'check',
  moved: 'clock',
  added: 'plus',
};

const CLOCK_RE = /^\d{2}:\d{2}$/;

/** Los textos de la nota (puro: lo comparten la tarjeta, el partido y los tests). */
export function guideNoteText(guide: FootballGuideInfo): GuideNoteText {
  const time = CLOCK_RE.test(guide.time) ? guide.time : '';
  const before =
    !guide.added && time && guide.agendaTime && CLOCK_RE.test(guide.agendaTime)
      ? guide.agendaTime
      : '';
  const kind: GuideNoteKind = guide.added ? 'added' : before ? 'moved' : 'confirmed';
  let extra: string | null = null;
  if (kind === 'added') extra = 'No salía en la agenda: lo añade tu guía.';
  else if (kind === 'moved') extra = `Tu guía lo pone a las ${time}; la agenda decía ${before}.`;
  return { kind, lead: LEADS[kind], channel: guide.channel, time, before, extra };
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
      className={cx('guide-note', `guide-note--${variant}`, `guide-note--${text.kind}`, className)}
      title={variant === 'row' ? guideNoteSentence(guide) : undefined}
    >
      <Icon name={ICONS[text.kind]} size={16} className="guide-note__icon" />
      <span className="guide-note__main">
        {text.lead}:{' '}
        {/* Canal y hora juntos: si no caben detrás del rótulo, pasan a la línea de abajo; si
            tampoco caben ahí, el canal se recorta con «…» y la hora se queda. */}
        <span className="guide-note__where">
          <span className="guide-note__channel">{text.channel}</span>
          {text.time ? (
            <>
              <span className="guide-note__sep" aria-hidden="true">
                ·
              </span>
              <span className="sr-only">, a las </span>
              <span className="guide-note__time">{text.time}</span>
            </>
          ) : null}
          {variant === 'row' && text.before ? (
            <span className="guide-note__before">
              <span className="guide-note__sep" aria-hidden="true">
                ·
              </span>
              <span className="sr-only">; la agenda decía {text.before}</span>
              <span aria-hidden="true">antes {text.before}</span>
            </span>
          ) : null}
        </span>
      </span>
      {variant === 'detail' && text.extra ? (
        <span className="guide-note__extra">{text.extra}</span>
      ) : null}
    </p>
  );
}
