import { team } from '../../../core/data/teams';
import { hhmm, untilText } from '../../../core/format';
import { Crest } from '../../../core/ui/Crest';
import type { MatchVM } from './useAgenda';
import { MinuteBadge, ScoreView } from './Score';
import { SignalBadge, useMatchSignal } from './Signal';
import { I } from './icons';
import { useSim } from '../../../core/store';

/* Fila de partido: quién juega · cuándo o minuto · si hay señal. Nada más. */

export function MatchRow({ vm, onOpen, selected = false, compact = false }: { vm: MatchVM; onOpen: () => void; selected?: boolean; compact?: boolean }) {
  const { match, score, phase, mine } = vm;
  void mine;
  const home = team(match.home);
  const away = team(match.away);
  const signal = useMatchSignal(match.id, phase, score.untilKickoffMs);
  const myTeams = useSim((s) => s.preferences.teams);
  const myNations = useSim((s) => s.preferences.nationalities);
  const loved = (name: string) => myTeams.includes(name) || myNations.includes(name);
  const now = Date.now();
  const timeText = phase === 'upcoming' ? hhmm(match.start) : phase === 'finished' ? 'Final' : '';
  const sub = phase === 'upcoming' ? untilText(match.start, match.start - score.untilKickoffMs) : '';
  void now;
  return (
    <button type="button" className={`tb-row is-${phase}${selected ? ' is-selected' : ''}${compact ? ' is-compact' : ''}${mine ? ' is-mine' : ''}`} onClick={onOpen} aria-label={`${home.name} contra ${away.name}${phase === 'live' ? ', en directo' : ''}`}>
      <span className="tb-row__teams">
        <span className="tb-row__team">
          <Crest team={home} size={compact ? 22 : 26} />
          <span className="tb-row__name">{home.name}</span>
          {loved(home.name) && <span className="tb-row__mine" title="Tu equipo"><I.Heart size={12} filled /></span>}
        </span>
        <span className="tb-row__team">
          <Crest team={away} size={compact ? 22 : 26} />
          <span className="tb-row__name">{away.name}</span>
          {loved(away.name) && <span className="tb-row__mine" title="Tu equipo"><I.Heart size={12} filled /></span>}
        </span>
      </span>
      <span className="tb-row__right">
        {phase === 'live' && (
          <>
            <ScoreView matchId={match.id} score={score} size="row" />
            <MinuteBadge score={score} />
          </>
        )}
        {phase === 'finished' && (
          <>
            <ScoreView matchId={match.id} score={score} size="row" />
            <span className="tb-row__time is-final">{timeText}</span>
          </>
        )}
        {phase === 'upcoming' && (
          <>
            <span className="tb-row__time">{timeText}</span>
            <span className="tb-row__sub">{sub}</span>
          </>
        )}
        {signal.kind !== 'none' && phase !== 'finished' && (
          <span className={`tb-row__signal is-${signal.kind}`}>
            <SignalBadge kind={signal.kind} word={false} size={12} />
            {signal.text}
          </span>
        )}
      </span>
      <I.Chevron dir="r" size={16} className="tb-row__chev" />
    </button>
  );
}
