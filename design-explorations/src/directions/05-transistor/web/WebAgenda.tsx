/* Sintonía (web): bandas de día, Para ti / Todos, el dial a lo ancho, la
   tarjeta sintonizada y la parrilla del día. */

import { useEffect, useMemo, useState } from 'react';
import { navigate } from '../../../core/router';
import { completeOnboarding, isForYou, isMine, playMatch, useSim } from '../../../core/store';
import type { Match, Preferences } from '../../../core/types';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { dayLabel, untilText } from '../../../core/format';
import { Crest } from '../../../core/ui/Crest';
import { Dial } from '../components/Dial';
import { MatchCard } from '../components/MatchCard';
import { SignalMeter } from '../components/SignalMeter';
import { Empty, Key, Segmented } from '../components/Key';
import { Wave } from '../components/Wave';
import { isoOf, useDayMatches, useGoalPulse, useWeekDays } from '../components/hooks';
import { compShort, signalOf } from '../components/text';
import { IcChevronRight, IcDial } from '../components/icons';

type Filter = 'para-ti' | 'todos';
let savedDay: string | null = null;
let savedFilter: Filter = 'para-ti';

export function WebAgenda({ now }: { now: number }) {
  const days = useWeekDays(now);
  const today = isoOf(now);
  const [day, setDay] = useState<string>(() => savedDay ?? today);
  const [filter, setFilter] = useState<Filter>(savedFilter);
  const prefs = useSim((s) => s.preferences);
  const sessions = useSim((s) => s.sourceSessions);
  const watchingId = useSim((s) => (s.player.target?.kind === 'match' ? s.player.target.id : null));
  const revealed = useSim((s) => s.scoreRevealed);
  const agenda = useSim((s) => s.agenda);
  const goal = useGoalPulse();
  const { matches } = useDayMatches(day);

  const hasPrefs = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length > 0;
  const effectiveFilter: Filter = hasPrefs ? filter : 'todos';
  const forYou = useMemo(() => matches.filter((m) => isForYou(m, prefs)), [matches, prefs]);
  const shown = effectiveFilter === 'para-ti' ? forYou : matches;
  const liveCount = matches.filter((m) => scoreAt(m, now).state === 'in').length;

  const [tuned, setTuned] = useState<string | null>(null);
  useEffect(() => {
    if (tuned && shown.some((m) => m.id === tuned)) return;
    const live = shown.find((m) => scoreAt(m, now).state === 'in' && isMine(m, prefs)) ?? shown.find((m) => scoreAt(m, now).state === 'in');
    const next = shown.find((m) => scoreAt(m, now).state === 'pre');
    setTuned((live ?? next ?? shown[shown.length - 1] ?? null)?.id ?? null);
  }, [shown, tuned]);

  useEffect(() => {
    savedDay = day;
    savedFilter = filter;
  }, [day, filter]);

  // ← → giran el dial cuando no suena nada; Intro abre lo sintonizado.
  useEffect(() => {
    const onDial = (e: Event) => {
      const dir = (e as CustomEvent<number>).detail;
      if (!shown.length) return;
      const i = shown.findIndex((m) => m.id === tuned);
      const n = Math.max(0, Math.min(shown.length - 1, (i < 0 ? 0 : i) + dir));
      setTuned(shown[n].id);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && tuned && (e.target as HTMLElement)?.tagName === 'BODY') navigate('partido', tuned);
    };
    window.addEventListener('tr-dial', onDial);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('tr-dial', onDial);
      window.removeEventListener('keydown', onKey);
    };
  }, [shown, tuned]);

  const tunedMatch = shown.find((m) => m.id === tuned) ?? null;
  const dayIdx = days.findIndex((d) => d.iso === day);

  return (
    <div className="tr-agenda">
      <div className="tr-agenda-bar">
        <div className="tr-bands" role="tablist" aria-label="Días">
          {days.map((d) => {
            const l = dayLabel(d.ms, now);
            const n = agenda.filter((m) => m.date === d.iso).length;
            return (
              <button key={d.iso} type="button" role="tab" aria-selected={d.iso === day} className={`tr-band${d.iso === day ? ' is-on' : ''}${n === 0 ? ' is-empty' : ''}`} onClick={() => setDay(d.iso)}>
                <small>{l.rel ?? l.short}</small>
                <b>{l.num}</b>
                <span className="tr-band-n">{n ? `${n} part.` : '—'}</span>
              </button>
            );
          })}
        </div>
        <div className="tr-agenda-bar-right">
          <Segmented<Filter>
            value={effectiveFilter}
            onChange={setFilter}
            label="Filtro"
            options={[
              { id: 'para-ti', label: 'Para ti', count: forYou.length, disabled: !hasPrefs },
              { id: 'todos', label: 'Todos', count: matches.length },
            ]}
          />
          {liveCount > 0 && (
            <span className="tr-agenda-live">
              <Wave size={12} /> {liveCount} en directo
            </span>
          )}
        </div>
      </div>

      {!prefs.onboardingComplete && <FirstUseCard />}

      <Dial matches={shown} tunedId={tuned} onTune={setTuned} now={now} isMine={(m) => isMine(m, prefs)} watchingId={watchingId} label={`Dial del ${dayLabel(days[dayIdx]?.ms ?? now, now).long}`} />

      <div className="tr-agenda-grid">
        <div className="tr-agenda-card">
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
              size="lg"
            />
          ) : matches.length === 0 ? (
            <Empty
              title="Sin partidos anunciados"
              text="Este día no hay nada en la agenda. Prueba el siguiente."
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
              text="Ninguno de tus equipos ni tus ligas juega. Puedes ver todos los partidos o ajustar tus gustos."
              actions={
                <>
                  <Key variant="orange" onClick={() => setFilter('todos')}>
                    Ver todos
                  </Key>
                  <Key variant="ghost" onClick={() => navigate('gustos')}>
                    Editar mis gustos
                  </Key>
                </>
              }
            />
          )}
        </div>
        <Parrilla matches={shown} now={now} tuned={tuned} watchingId={watchingId} revealed={revealed} prefs={prefs} onOpen={(id) => navigate('partido', id)} />
      </div>
    </div>
  );
}

function FirstUseCard() {
  return (
    <div className="tr-firstuse">
      <IcDial size={28} />
      <div className="tr-firstuse-text">
        <strong>Personaliza tu sintonía</strong>
        <span>Dinos tus ligas y equipos: «Para ti» los pondrá en el dial y los marcará en la parrilla.</span>
      </div>
      <div className="tr-firstuse-keys">
        <Key variant="ghost" onClick={() => completeOnboarding()}>
          Ahora no
        </Key>
        <Key variant="orange" onClick={() => navigate('gustos')}>
          Elegir ligas y equipos
        </Key>
      </div>
    </div>
  );
}

function Parrilla({ matches, now, tuned, watchingId, revealed, prefs, onOpen }: { matches: Match[]; now: number; tuned: string | null; watchingId: string | null; revealed: Record<string, boolean>; prefs: Preferences; onOpen: (id: string) => void }) {
  const sessions = useSim((s) => s.sourceSessions);
  const live = matches.filter((m) => scoreAt(m, now).state === 'in');
  const pre = matches.filter((m) => scoreAt(m, now).state === 'pre');
  const post = matches.filter((m) => scoreAt(m, now).state === 'post');
  if (!matches.length) return <div className="tr-parrilla" />;
  const section = (label: string, list: Match[], isLive = false) =>
    list.length > 0 && (
      <>
        <div className={`tr-parrilla-sect${isLive ? ' is-live' : ''}`}>
          {isLive && <Wave size={10} />}
          {label} <span>{list.length}</span>
        </div>
        {list.map((m) => {
          const s = scoreAt(m, now);
          const hidden = m.id === watchingId && !revealed[m.id];
          const signal = signalOf(sessions[`match:${m.id}`], m, now);
          return (
            <button key={m.id} type="button" className={`tr-row${m.id === tuned ? ' is-tuned' : ''}${s.state === 'in' ? ' is-live' : ''}${isMine(m, prefs) ? ' is-mine' : ''}`} onClick={() => onOpen(m.id)}>
              <span className="tr-row-time">
                {m.time}
                <small>{compShort(m.competition)}</small>
              </span>
              <span className="tr-row-teams">
                <span className="tr-row-team is-home">
                  <Crest team={team(m.home)} size={22} variant="flat" />
                  <span>{team(m.home).name}</span>
                </span>
                <span className={`tr-row-score${s.state === 'pre' ? ' is-pre' : ''}`}>{s.state === 'pre' ? '–' : hidden ? '— —' : `${s.home}–${s.away}`}</span>
                <span className="tr-row-team is-away">
                  <span>{team(m.away).name}</span>
                  <Crest team={team(m.away)} size={22} variant="flat" />
                </span>
              </span>
              <span className="tr-row-meta">
                {s.state === 'in' ? <span className="tr-row-min">{s.halftime ? 'Desc.' : s.clock}</span> : s.state === 'pre' ? <span className="tr-row-until">{untilText(m.start, now)}</span> : <span className="tr-row-until">Final</span>}
                {s.state !== 'post' && <SignalMeter signal={signal} size="sm" />}
                <span className="tr-row-ch">{m.channels[0]?.name}{m.channels.length > 1 ? ` +${m.channels.length - 1}` : ''}</span>
                <IcChevronRight size={16} className="tr-row-chev" />
              </span>
            </button>
          );
        })}
      </>
    );
  return (
    <div className="tr-parrilla" aria-label="Parrilla del día">
      {section('En directo', live, true)}
      {section('A continuación', pre)}
      {section('Terminados', post)}
    </div>
  );
}
