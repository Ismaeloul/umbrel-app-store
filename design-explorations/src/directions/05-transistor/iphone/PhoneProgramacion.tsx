/* Programación (iPhone): la semana como parrilla de radio. Bandas de día,
   Para ti / Todos y las filas por en directo / a continuación / terminados. */

import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../../../core/router';
import { isForYou, isMine, useSim } from '../../../core/store';
import type { Match } from '../../../core/types';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { dayLabel, untilText } from '../../../core/format';
import { Crest } from '../../../core/ui/Crest';
import { Empty, Key, Segmented } from '../components/Key';
import { SignalMeter } from '../components/SignalMeter';
import { Wave } from '../components/Wave';
import { isoOf, useDayMatches, useWeekDays } from '../components/hooks';
import { compShort, signalOf } from '../components/text';
import { IcChevronRight } from '../components/icons';
import { PageHead } from './NavBar';

type Filter = 'para-ti' | 'todos';
let savedFilter: Filter = 'para-ti';

export function PhoneProgramacion({ now, day }: { now: number; day: string | null }) {
  const days = useWeekDays(now);
  const today = isoOf(now);
  const current = day && days.some((d) => d.iso === day) ? day : today;
  const { matches } = useDayMatches(current);
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  const sessions = useSim((s) => s.sourceSessions);
  const watchingId = useSim((s) => (s.player.target?.kind === 'match' ? s.player.target.id : null));
  const revealed = useSim((s) => s.scoreRevealed);
  const [filter, setFilter] = useState<Filter>(savedFilter);
  useEffect(() => {
    savedFilter = filter;
  }, [filter]);
  const hasPrefs = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length > 0;
  const effective: Filter = hasPrefs ? filter : 'todos';
  const forYou = useMemo(() => matches.filter((m) => isForYou(m, prefs)), [matches, prefs]);
  const shown = effective === 'para-ti' ? forYou : matches;
  const setDay = (iso: string) => navigate('agenda', 'semana', iso, { replace: true });
  const dayIdx = days.findIndex((d) => d.iso === current);

  const live = shown.filter((m) => scoreAt(m, now).state === 'in');
  const pre = shown.filter((m) => scoreAt(m, now).state === 'pre');
  const post = shown.filter((m) => scoreAt(m, now).state === 'post');

  const row = (m: Match) => {
    const s = scoreAt(m, now);
    const hidden = m.id === watchingId && !revealed[m.id];
    const signal = signalOf(sessions[`match:${m.id}`], m, now);
    const mine = isMine(m, prefs);
    return (
      <button key={m.id} type="button" className={`tr-prow${s.state === 'in' ? ' is-live' : ''}${mine ? ' is-mine' : ''}`} onClick={() => navigate('partido', m.id)}>
        <span className="tr-prow-time">
          {m.time}
          <small>{compShort(m.competition)}</small>
        </span>
        <span className="tr-prow-teams">
          <span className="tr-prow-team">
            <Crest team={team(m.home)} size={20} variant="flat" />
            <span>{team(m.home).name}</span>
            {s.state !== 'pre' && <b>{hidden ? '—' : s.home}</b>}
          </span>
          <span className="tr-prow-team">
            <Crest team={team(m.away)} size={20} variant="flat" />
            <span>{team(m.away).name}</span>
            {s.state !== 'pre' && <b>{hidden ? '—' : s.away}</b>}
          </span>
        </span>
        <span className="tr-prow-side">
          {s.state === 'in' ? (
            <span className="tr-prow-min">
              <Wave size={10} /> {s.halftime ? 'Desc.' : s.clock}
            </span>
          ) : s.state === 'pre' ? (
            <span className="tr-prow-until">{untilText(m.start, now)}</span>
          ) : (
            <span className="tr-prow-until">Final</span>
          )}
          {s.state !== 'post' && <SignalMeter signal={signal} size="sm" />}
        </span>
        <IcChevronRight size={16} className="tr-prow-chev" />
      </button>
    );
  };

  return (
    <div className="tr-ph-prog">
      <PageHead title="Programación" sub={dayLabel(days[dayIdx]?.ms ?? now, now).long} />
      <div className="tr-ph-bands" role="tablist" aria-label="Días">
        {days.map((d) => {
          const l = dayLabel(d.ms, now);
          const n = agenda.filter((m) => m.date === d.iso).length;
          return (
            <button key={d.iso} type="button" role="tab" aria-selected={d.iso === current} className={`tr-band${d.iso === current ? ' is-on' : ''}${n === 0 ? ' is-empty' : ''}`} onClick={() => setDay(d.iso)}>
              <small>{l.rel ?? l.short}</small>
              <b>{l.num}</b>
              <span className="tr-band-n">{n || '—'}</span>
            </button>
          );
        })}
      </div>
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
      <div className="tr-ph-body">
        {shown.length === 0 ? (
          matches.length === 0 ? (
            <Empty
              title="Sin partidos anunciados"
              text="Este día no hay nada en la agenda."
              actions={
                dayIdx < days.length - 1 && (
                  <Key variant="orange" trailing={<IcChevronRight size={16} />} onClick={() => setDay(days[dayIdx + 1].iso)}>
                    Ver el día siguiente
                  </Key>
                )
              }
            />
          ) : (
            <Empty
              title="Nada de lo tuyo este día"
              text="Ninguno de tus equipos ni tus ligas juega."
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
          )
        ) : (
          <div className="tr-parrilla">
            {live.length > 0 && (
              <div className="tr-parrilla-sect is-live">
                <Wave size={10} /> En directo <span>{live.length}</span>
              </div>
            )}
            {live.map(row)}
            {pre.length > 0 && (
              <div className="tr-parrilla-sect">
                A continuación <span>{pre.length}</span>
              </div>
            )}
            {pre.map(row)}
            {post.length > 0 && (
              <div className="tr-parrilla-sect">
                Terminados <span>{post.length}</span>
              </div>
            )}
            {post.map(row)}
          </div>
        )}
      </div>
    </div>
  );
}
