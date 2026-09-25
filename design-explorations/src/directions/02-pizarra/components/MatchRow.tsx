/* Fila densa de la agenda: señal → minuto/hora → equipos con marcador.
   Franja de 3 px con los colores de los dos clubes. Destello al gol. */
import { useEffect, useState } from 'react';
import { isMine, useNow, useSim } from '../../../core/store';
import { team } from '../../../core/data/teams';
import { Crest } from '../../../core/ui/Crest';
import type { Match } from '../../../core/types';
import { Meter } from './atoms';
import { untilShort, useScore, useScoreHidden, useSignal } from './data';
import { IChevronRight } from './icons';

export function MatchRow({ match, selected, focused, onClick, wide }: { match: Match; selected?: boolean; focused?: boolean; onClick: () => void; wide?: boolean }) {
  const nowMs = useNow();
  const score = useScore(match)!;
  const hidden = useScoreHidden(match.id);
  const signal = useSignal('match', match.id);
  const prefs = useSim((s) => s.preferences);
  const lastGoal = useSim((s) => (s.lastGoal?.matchId === match.id ? s.lastGoal.at : 0));
  const [flash, setFlash] = useState(0);
  useEffect(() => {
    if (lastGoal && Date.now() - lastGoal < 3000) setFlash(lastGoal);
  }, [lastGoal]);

  const home = team(match.home);
  const away = team(match.away);
  const live = score.state === 'in';
  const post = score.state === 'post';
  const mineH = prefs.teams.includes(home.name) || prefs.nationalities.includes(home.name);
  const mineA = prefs.teams.includes(away.name) || prefs.nationalities.includes(away.name);
  const showSignal = !post && !(signal.kind === 'pending' && !signal.text);

  return (
    <button type="button" className={`pz-row${wide ? ' pz-row--wide' : ''}${selected ? ' is-selected' : ''}${focused ? ' is-focus' : ''}`} onClick={onClick} aria-current={selected ? 'true' : undefined}>
      {flash > 0 && <span key={flash} className="pz-row-goal pz-anim" aria-hidden="true" />}
      <span className="pz-row-stripe" aria-hidden="true">
        <i style={{ background: home.primary }} />
        <i style={{ background: away.primary }} />
      </span>
      <span style={{ display: 'grid', placeItems: 'center' }}>{showSignal ? <Meter kind={signal.kind} label={signal.text} /> : <span className="pz-dim" style={{ fontSize: 11 }} aria-hidden="true">·</span>}</span>
      <span className={`pz-row-time${live ? ' is-live' : ''}${post ? ' is-fin' : ''}`}>
        {live ? (
          <>
            <span className="pz-row-time-min">
              {score.halftime ? 'DESC' : score.clock}
            </span>
            <small>{score.halftime ? 'Descanso' : score.detail}</small>
          </>
        ) : post ? (
          <>
            <span>FIN</span>
            <small>{match.time}</small>
          </>
        ) : (
          <>
            <span>{match.time}</span>
            <small>{untilShort(match.start, nowMs)}</small>
          </>
        )}
      </span>
      <span className="pz-row-teams">
        <TeamLine name={home.name} crest={<Crest team={home} size={16} variant="flat" className="pz-crest" />} score={score.state === 'pre' ? null : score.home} hidden={hidden} mine={mineH} lose={post && score.home < score.away} />
        <TeamLine name={away.name} crest={<Crest team={away} size={16} variant="flat" className="pz-crest" />} score={score.state === 'pre' ? null : score.away} hidden={hidden} mine={mineA} lose={post && score.away < score.home} />
      </span>
      {wide && (
        <span className="pz-row-chev">
          <IChevronRight size={16} />
        </span>
      )}
    </button>
  );
}

function TeamLine({ name, crest, score, hidden, mine, lose }: { name: string; crest: React.ReactNode; score: number | null; hidden: boolean; mine: boolean; lose: boolean }) {
  return (
    <span className="pz-row-team">
      {crest}
      <span className={`name${mine ? ' is-mine' : ''}`}>{name}</span>
      {score === null ? (
        <span className="score" aria-hidden="true" />
      ) : hidden ? (
        <span className="score is-mask" aria-label="Marcador tapado">
          <i />
        </span>
      ) : (
        <span className={`score${lose ? ' is-lose' : ''}`}>{score}</span>
      )}
    </span>
  );
}

export function useIsMine(match: Match): boolean {
  const prefs = useSim((s) => s.preferences);
  return isMine(match, prefs);
}
