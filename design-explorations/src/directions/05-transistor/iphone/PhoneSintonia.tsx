/* Sintonía (iPhone): «qué hay ahora». Para ti / Todos, el dial de hoy, la
   emisora sintonizada y la tarjeta de primer uso. */

import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../../../core/router';
import { completeOnboarding, isForYou, isMine, playMatch, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { longDate } from '../../../core/format';
import { Dial } from '../components/Dial';
import { MatchCard } from '../components/MatchCard';
import { Empty, Key, Segmented } from '../components/Key';
import { Wave } from '../components/Wave';
import { isoOf, useDayMatches, useGoalPulse } from '../components/hooks';
import { engineWord } from '../components/text';
import { IcChevronRight, IcDial } from '../components/icons';
import { PageHead } from './NavBar';

type Filter = 'para-ti' | 'todos';
let savedFilter: Filter = 'para-ti';

export function PhoneSintonia({ now }: { now: number }) {
  const today = isoOf(now);
  const { matches } = useDayMatches(today);
  const prefs = useSim((s) => s.preferences);
  const sessions = useSim((s) => s.sourceSessions);
  const watchingId = useSim((s) => (s.player.target?.kind === 'match' ? s.player.target.id : null));
  const revealed = useSim((s) => s.scoreRevealed);
  const engine = useSim((s) => s.engine.status);
  const goal = useGoalPulse();
  const [filter, setFilter] = useState<Filter>(savedFilter);
  useEffect(() => {
    savedFilter = filter;
  }, [filter]);

  const hasPrefs = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length > 0;
  const effective: Filter = hasPrefs ? filter : 'todos';
  const forYou = useMemo(() => matches.filter((m) => isForYou(m, prefs)), [matches, prefs]);
  const shown = effective === 'para-ti' ? forYou : matches;
  const liveCount = matches.filter((m) => scoreAt(m, now).state === 'in').length;

  const [tuned, setTuned] = useState<string | null>(null);
  useEffect(() => {
    if (tuned && shown.some((m) => m.id === tuned)) return;
    const live = shown.find((m) => scoreAt(m, now).state === 'in' && isMine(m, prefs)) ?? shown.find((m) => scoreAt(m, now).state === 'in');
    const next = shown.find((m) => scoreAt(m, now).state === 'pre');
    setTuned((live ?? next ?? shown[shown.length - 1] ?? null)?.id ?? null);
  }, [shown, tuned]);
  const tunedMatch = shown.find((m) => m.id === tuned) ?? null;

  return (
    <div className="tr-ph-sint">
      <PageHead
        title="Sintonía"
        sub={longDate(now)}
        aside={
          liveCount > 0 && (
            <span className="tr-agenda-live">
              <Wave size={12} /> {liveCount} en directo
            </span>
          )
        }
      />
      {engine !== 'online' && (
        <div className={`tr-phone-strip tr-tone-${engine === 'restarting' ? 'yellow' : 'red'}`} role="status">
          <i className="tr-dot is-pulse" />
          {engineWord(engine)}: la señal se reengancha sola cuando vuelve.
        </div>
      )}
      <div className="tr-ph-filter">
        <Segmented<Filter>
          value={effective}
          onChange={setFilter}
          label="Filtro"
          options={[
            { id: 'para-ti', label: 'Para ti', count: forYou.length, disabled: !hasPrefs },
            { id: 'todos', label: 'Todos', count: matches.length },
          ]}
        />
      </div>
      <Dial matches={shown} tunedId={tuned} onTune={setTuned} now={now} isMine={(m) => isMine(m, prefs)} watchingId={watchingId} compact label="Dial de hoy" />
      <div className="tr-ph-body">
        {!prefs.onboardingComplete && (
          <div className="tr-firstuse">
            <IcDial size={26} />
            <div className="tr-firstuse-text">
              <strong>Personaliza tu sintonía</strong>
              <span>Dinos tus ligas y equipos y «Para ti» los pondrá primero en el dial.</span>
            </div>
            <div className="tr-firstuse-keys">
              <Key variant="ghost" size="sm" onClick={() => completeOnboarding()}>
                Ahora no
              </Key>
              <Key variant="orange" size="sm" onClick={() => navigate('gustos')}>
                Elegir
              </Key>
            </div>
          </div>
        )}
        {tunedMatch ? (
          <MatchCard
            match={tunedMatch}
            now={now}
            session={sessions[`match:${tunedMatch.id}`]}
            watching={watchingId === tunedMatch.id}
            revealed={!!revealed[tunedMatch.id]}
            mine={isMine(tunedMatch, prefs)}
            goalSide={goal.matchId === tunedMatch.id ? goal.side : null}
            onOpen={() => navigate('partido', tunedMatch.id)}
            onPlay={() => {
              playMatch(tunedMatch.id);
              navigate('partido', tunedMatch.id);
            }}
          />
        ) : matches.length === 0 ? (
          <Empty
            title="Sin partidos anunciados"
            text="Hoy no hay nada en la agenda."
            actions={
              <Key variant="orange" onClick={() => navigate('agenda', 'semana')}>
                Ver la programación
              </Key>
            }
          />
        ) : (
          <Empty
            title="Nada de lo tuyo hoy"
            text="Ninguno de tus equipos ni tus ligas juega hoy."
            actions={
              <>
                <Key variant="orange" onClick={() => setFilter('todos')}>
                  Ver todos
                </Key>
                <Key variant="ghost" onClick={() => navigate('gustos')}>
                  Editar gustos
                </Key>
              </>
            }
          />
        )}
        <button type="button" className="tr-ph-link" onClick={() => navigate('agenda', 'semana')}>
          <span>
            Programación de hoy · {matches.length} {matches.length === 1 ? 'partido' : 'partidos'}
            {liveCount ? ` · ${liveCount} en directo` : ''}
          </span>
          <IcChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
