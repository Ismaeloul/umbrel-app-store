/* Marcador-tablero: pizarra oscura con las cifras en Barlow Condensed, el
   minuto, la línea de tiempo con los goles como marcas y la señal. */
import { revealScore, useNow, useSim } from '../../../core/store';
import { competition, team } from '../../../core/data/teams';
import { Crest } from '../../../core/ui/Crest';
import { untilText } from '../../../core/format';
import type { Match } from '../../../core/types';
import { Meter, Roll, Timeline } from './atoms';
import { useScore, useScoreHidden, useSignal } from './data';
import { IEye, IEyeOff } from './icons';

export function Scoreboard({ match, size = 'phone', timeline = true, meta = true, compactMeta = false, onClick }: { match: Match; size?: 'web' | 'phone' | 'tile'; timeline?: boolean; meta?: boolean; compactMeta?: boolean; onClick?: () => void }) {
  const nowMs = useNow();
  const score = useScore(match)!;
  const hidden = useScoreHidden(match.id);
  const signal = useSignal('match', match.id);
  const home = team(match.home);
  const away = team(match.away);
  const comp = competition(match.competition);
  const watching = useSim((s) => s.player.target?.kind === 'match' && s.player.target.id === match.id);
  const fontSize = size === 'web' ? 64 : size === 'tile' ? 34 : 40;
  const crest = size === 'web' ? 48 : size === 'tile' ? 28 : 36;
  const live = score.state === 'in';

  const Tag = onClick ? 'button' : 'div';

  if (size === 'tile') {
    const post = score.state === 'post';
    return (
      <Tag className="pz-board pz-board--tile" style={{ textAlign: 'left', width: '100%' }} onClick={onClick} type={onClick ? 'button' : undefined}>
        <div className="pz-board-head">
          <span className="pz-ellipsis">
            {comp.name}
            {match.round ? ` · ${match.round}` : ''}
          </span>
          {live ? (
            <span className="pz-tag pz-tag--live">
              <i className="pz-dot pz-dot--pulse pz-anim" /> En directo
            </span>
          ) : post ? (
            <span className="pz-tag pz-tag--slate">Final</span>
          ) : (
            <span className="pz-tag pz-tag--slate">{untilText(match.start, nowMs)}</span>
          )}
        </div>
        <div className="pz-tile-teams">
          {[
            { t: home, g: score.home, lose: post && score.home < score.away },
            { t: away, g: score.away, lose: post && score.away < score.home },
          ].map(({ t, g, lose }) => (
            <div className="pz-tile-team" key={t.id}>
              <Crest team={t} size={20} variant="flat" className="pz-crest" />
              <span className={`name${lose ? ' is-lose' : ''}`}>{t.name}</span>
              {score.state === 'pre' ? (
                <span className="sc" aria-hidden="true" />
              ) : hidden ? (
                <span className="sc is-mask" aria-label="Marcador tapado">
                  <i />
                </span>
              ) : (
                <span className="sc">
                  <Roll value={g} />
                </span>
              )}
            </div>
          ))}
        </div>
        {timeline && score.state !== 'pre' && (
          <div className="pz-board-timeline">
            <Timeline score={score} goals={hidden ? [] : score.goals} homeColor={home.primary} awayColor={away.primary} showLabels={false} />
          </div>
        )}
        {meta && (
          <div className="pz-board-meta">
            <span className={`when${live ? ' is-live' : ''}`}>
              {live ? (
                <>
                  {score.halftime ? 'Desc.' : score.clock}
                  <small>{score.halftime ? 'Descanso' : score.detail}</small>
                </>
              ) : post ? (
                <>
                  Final<small>{match.time}</small>
                </>
              ) : (
                <>
                  {match.time}
                  <small>{match.venue ?? match.channels[0]?.name}</small>
                </>
              )}
            </span>
            <span style={{ marginLeft: 'auto' }}>
              <Meter kind={signal.kind} word slate label={signal.text} />
            </span>
          </div>
        )}
      </Tag>
    );
  }

  return (
    <Tag className={`pz-board pz-board--${size}`} style={{ ['--pz-score' as string]: `${fontSize}px`, textAlign: 'left', width: '100%' }} onClick={onClick} type={onClick ? 'button' : undefined}>
      <div className="pz-board-head">
        <span className="pz-ellipsis">
          {comp.name}
          {match.round ? ` · ${match.round}` : ''}
        </span>
        {live ? (
          <span className="pz-tag pz-tag--live">
            <i className="pz-dot pz-dot--pulse pz-anim" /> En directo
          </span>
        ) : score.state === 'post' ? (
          <span className="pz-tag pz-tag--slate">Final</span>
        ) : (
          <span className="pz-tag pz-tag--slate">{untilText(match.start, nowMs)}</span>
        )}
      </div>
      <div className="pz-board-main">
        <div className="pz-board-team">
          <Crest team={home} size={crest} variant="flat" className="pz-crest" />
          <span className="pz-board-team-name">
            <b>{home.name}</b>
          </span>
        </div>
        <div className={`pz-board-score${hidden ? ' pz-board-score--hidden' : ''}${score.state === 'pre' ? ' pz-board-score--pre' : ''}`}>
          {score.state === 'pre' ? (
            <span className="pz-cond">{match.time}</span>
          ) : hidden ? (
            <span className="pz-board-mask" aria-label="Marcador tapado">
              <i />
              <em>–</em>
              <i />
            </span>
          ) : (
            <>
              <Roll value={score.home} />
              <em>–</em>
              <Roll value={score.away} />
            </>
          )}
        </div>
        <div className="pz-board-team pz-board-team--away">
          <Crest team={away} size={crest} variant="flat" className="pz-crest" />
          <span className="pz-board-team-name">
            <b>{away.name}</b>
          </span>
        </div>
        <div className="pz-board-sub">
          {live ? (
            <>
              <span className={`pz-cond${live ? ' is-live' : ''}`}>{score.halftime ? 'Desc.' : score.clock}</span>
              <span>{score.detail}</span>
            </>
          ) : score.state === 'post' ? (
            <span>Terminado</span>
          ) : (
            <span>
              {match.venue ? `${match.venue} · ` : ''}
              {match.time}
            </span>
          )}
          {watching && (
            <button type="button" className="pz-board-reveal" onClick={(e) => { e.stopPropagation(); revealScore(match.id, hidden); }}>
              {hidden ? <IEye size={14} /> : <IEyeOff size={14} />}
              {hidden ? 'Ver marcador' : 'Tapar'}
            </button>
          )}
        </div>
      </div>
      {timeline && score.state !== 'pre' && (
        <div className="pz-board-timeline">
          <Timeline score={score} goals={hidden ? [] : score.goals} homeColor={home.primary} awayColor={away.primary} />
        </div>
      )}
      {meta && (
        <div className="pz-board-meta">
          <Meter kind={signal.kind} word={compactMeta} slate label={signal.text} />
          {!compactMeta && <span>{signal.text}</span>}
          <span style={{ marginLeft: 'auto' }} className="pz-ellipsis">
            {match.channels.map((c) => c.name).join(' · ')}
          </span>
        </div>
      )}
    </Tag>
  );
}
