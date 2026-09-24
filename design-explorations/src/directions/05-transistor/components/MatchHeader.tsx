/* Cabecera LCD de un partido: escudos, marcador de 7 segmentos (tapado con
   «-·-» mientras se ve), minuto, línea de tiempo con muescas de goles y la
   línea de contexto. Se comparte entre la tarjeta de Sintonía y el centro. */

import type { Match } from '../../../core/types';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { Crest } from '../../../core/ui/Crest';
import { untilText } from '../../../core/format';
import { LcdScore, LcdTime, Lcd } from './Lcd';
import { Wave } from './Wave';
import { Key } from './Key';
import { matchMeta } from './text';

export interface MatchHeaderProps {
  match: Match;
  now: number;
  /** Se está viendo aquí: el marcador va tapado salvo que se destape. */
  watching: boolean;
  revealed: boolean;
  onReveal?: (v: boolean) => void;
  size?: 'md' | 'lg';
  /** Lado del gol que acaba de entrar (pulso 3 s). */
  goalSide?: 'home' | 'away' | null;
  /** Sin la línea de contexto. */
  bare?: boolean;
  /** Línea de contexto propia (si no, competición · jornada · hora). */
  meta?: string;
  timeline?: boolean;
}

export function MatchHeader({ match, now, watching, revealed, onReveal, size = 'md', goalSide, bare, meta, timeline = true }: MatchHeaderProps) {
  const s = scoreAt(match, now);
  const home = team(match.home);
  const away = team(match.away);
  const hidden = watching && !revealed && s.state !== 'pre';
  const lcdH = size === 'lg' ? 64 : 44;
  const crest = size === 'lg' ? 56 : 44;

  return (
    <div className={`tr-mh tr-mh--${size}${goalSide ? ` is-goal is-goal-${goalSide}` : ''}${s.state === 'in' ? ' is-live' : ''}`}>
      <div className="tr-mh-row">
        <div className="tr-mh-team is-home">
          <Crest team={home} size={crest} variant="flat" />
          <span className="tr-mh-name">{home.name}</span>
        </div>
        <div className="tr-mh-lcdpanel">
          {s.state === 'pre' ? (
            <>
              <LcdTime text={match.time} height={lcdH * 0.8} />
              <span className="tr-mh-sub">{untilText(match.start, now)}</span>
            </>
          ) : (
            <>
              <LcdScore home={s.home} away={s.away} hidden={hidden} height={lcdH} />
              <span className="tr-mh-sub">
                {s.state === 'in' && <Wave size={11} />}
                {s.state === 'in' ? (
                  s.halftime ? (
                    <span>Descanso</span>
                  ) : (
                    <>
                      <Lcd text={`${s.minute}'`} height={14} plain label={`minuto ${s.minute}`} />
                      <span>{s.detail}</span>
                    </>
                  )
                ) : (
                  <span>Final</span>
                )}
              </span>
            </>
          )}
        </div>
        <div className="tr-mh-team is-away">
          <Crest team={away} size={crest} variant="flat" />
          <span className="tr-mh-name">{away.name}</span>
        </div>
      </div>
      {watching && s.state !== 'pre' && onReveal && (
        <div className="tr-mh-reveal">
          <Key size="sm" variant={hidden ? 'paper' : 'ghost'} onClick={() => onReveal(hidden)}>
            {hidden ? 'Ver marcador' : 'Tapar marcador'}
          </Key>
          {hidden && <span className="tr-mh-hint">Tu emisión va por detrás del directo</span>}
        </div>
      )}
      {timeline && s.state !== 'pre' && <Timeline match={match} now={now} hidden={hidden} />}
      {!bare && (
        <div className="tr-mh-meta">
          {meta ?? `${matchMeta(match, now)}${match.venue ? ` · ${match.venue}` : ''}`}
        </div>
      )}
    </div>
  );
}

const SPAN = 96; // minutos que ocupa la línea (90 + añadidos)

export function Timeline({ match, now, hidden }: { match: Match; now: number; hidden: boolean }) {
  const s = scoreAt(match, now);
  return (
    <div className="tr-tl" aria-hidden="true">
      <div className="tr-tl-track">
        <i className="tr-tl-fill" style={{ transform: `scaleX(${s.progress})` }} />
        <i className="tr-tl-half" style={{ left: `${(47 / SPAN) * 100}%` }} />
        {!hidden &&
          s.goals.map((g, i) => (
            <i key={i} className={`tr-tl-goal is-${g.side}`} style={{ left: `${Math.min(99, (g.minute / SPAN) * 100)}%` }} title={`${g.minute}' ${g.scorer}`} />
          ))}
      </div>
      <div className="tr-tl-labels">
        <span>0'</span>
        <span>Desc.</span>
        <span>90'</span>
      </div>
    </div>
  );
}
