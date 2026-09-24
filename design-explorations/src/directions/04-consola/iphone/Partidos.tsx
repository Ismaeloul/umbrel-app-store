/* Consola · iPhone · Partidos (lista compacta por competición, plegable) y
   Partido (hoja de propiedades: vídeo, Estado, Señal, Dónde se emite, Detalles). */

import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { navigate } from '../../../core/router';
import { completeOnboarding, ensureSources, isForYou, isMine, openTarget, research, revealScore, stop, toggleTeamFollow, useNow, useSim } from '../../../core/store';
import { phaseOf, scoreAt } from '../../../core/score';
import { competition, team } from '../../../core/data/teams';
import { dayLabel, hhmm, secondsText, untilText } from '../../../core/format';
import type { Match } from '../../../core/types';
import { Crest } from '../../../core/ui/Crest';
import { Icon } from '../components/icons';
import { ClubDot, Dot } from '../components/ui';
import { VideoSurface } from '../components/video';
import { compLabel, idLabel, isoDay, modeWord, playerTone, playerWord, signalSummary, sourceLabel, techRows, useDays, usePreheat, usePulse, useReducedMotionPref, useScoreHidden } from '../components/lib';
import { openInItems } from '../components/sheets';
import { EmptyView, NavBar, NavButton, PillButton, Row, Section, Seg, Value } from './ui';
import { PhoneControls, PhoneSources, PhoneStatus, sourcesSummary } from './Player';
import { openSheet } from './state';

export function openMatchPhone(id: string) {
  navigate('partido', id);
}

export function Partidos({ hasMini }: { hasMini: boolean }) {
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  const nowMs = useNow();
  const days = useDays(agenda);
  const today = isoDay(nowMs);
  const [dayKey, setDayKey] = useState(today);
  const hasPrefs = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length > 0;
  const [filter, setFilter] = useState<'foryou' | 'all'>(hasPrefs ? 'foryou' : 'all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const dayMatches = useMemo(() => agenda.filter((m) => m.date === dayKey).sort((a, b) => a.start - b.start), [agenda, dayKey]);
  usePreheat(dayMatches);
  const visible = filter === 'foryou' && hasPrefs ? dayMatches.filter((m) => isForYou(m, prefs)) : dayMatches;
  const groups = useMemo(() => {
    const map = new Map<string, Match[]>();
    const order = (m: Match) => (phaseOf(m, nowMs) === 'live' ? 0 : phaseOf(m, nowMs) === 'upcoming' ? 1 : 2);
    for (const m of [...visible].sort((a, b) => order(a) - order(b) || a.start - b.start)) {
      const k = m.competition;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(m);
    }
    return [...map.entries()].sort((a, b) => competition(a[0]).rank - competition(b[0]).rank).map(([id, items]) => ({ id, name: competition(id).name, items, live: items.filter((m) => phaseOf(m, nowMs) === 'live').length }));
  }, [visible, Math.floor(nowMs / 30000)]);
  const liveCount = dayMatches.filter((m) => phaseOf(m, nowMs) === 'live').length;
  const nextDay = days[days.findIndex((d) => d.key === dayKey) + 1];

  return (
    <>
      <NavBar title="Partidos" large right={<NavButton icon="edit" label="Editar mis gustos" onClick={() => navigate('gustos')} />} />
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        <div className="ip-days" role="tablist" aria-label="Día" data-testid="tira-dias">
          {days.map((d) => {
            const lab = dayLabel(d.ms, nowMs);
            const on = d.key === dayKey;
            return (
              <button key={d.key} type="button" role="tab" aria-selected={on} className={`ip-day ${on ? 'is-on' : ''}`} onClick={() => setDayKey(d.key)}>
                <span>{lab.rel === 'hoy' ? 'Hoy' : lab.rel === 'mañana' ? 'Mañana' : lab.rel === 'ayer' ? 'Ayer' : lab.short}</span>
                <span className="ip-mono">{lab.num}</span>
                {d.count > 0 && <span className="ip-day-count">· {d.count}</span>}
                {d.live > 0 && <Dot tone="live" size="sm" />}
              </button>
            );
          })}
        </div>
        <div className="ip-toolbar">
          <Seg
            value={filter}
            onChange={setFilter}
            ariaLabel="Filtro"
            options={[
              { id: 'foryou', label: 'Para ti', count: dayMatches.filter((m) => isForYou(m, prefs)).length, disabled: !hasPrefs },
              { id: 'all', label: 'Todos', count: dayMatches.length },
            ]}
          />
          {liveCount > 0 && (
            <span className="ip-value" style={{ flex: 'none', color: 'var(--co-live)', fontWeight: 600, fontSize: 13 }}>
              <Dot tone="live" size="sm" /> {liveCount} en directo
            </span>
          )}
        </div>
        {!prefs.onboardingComplete && (
          <Section inset>
            <div style={{ padding: '12px 12px 12px' }}>
              <div style={{ fontWeight: 600 }}>Personaliza tu agenda</div>
              <p className="ip-row-sub" style={{ margin: '2px 0 10px' }}>Dinos tus ligas y equipos: «Para ti» los resalta.</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <PillButton kind="primary" onClick={() => navigate('gustos')}>
                  Personalizar
                </PillButton>
                <PillButton onClick={completeOnboarding}>Ahora no</PillButton>
              </div>
            </div>
          </Section>
        )}
        {groups.map((g) => (
          <Section
            key={g.id}
            title={
              <>
                {g.live > 0 && <Dot tone="live" size="sm" />}
                {g.name}
              </>
            }
            count={g.items.length}
            collapsible
            collapsed={!!collapsed[g.id]}
            onToggle={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
          >
            {g.items.map((m) => (
              <MatchRow key={m.id} m={m} mine={isMine(m, prefs)} />
            ))}
          </Section>
        ))}
        {visible.length === 0 && dayMatches.length > 0 && (
          <EmptyView
            icon="heart"
            title="Nada de lo tuyo este día"
            text={`Hay ${dayMatches.length} partidos en «Todos».`}
            action={
              <>
                <PillButton onClick={() => setFilter('all')}>Ver todos</PillButton>
                <PillButton kind="tint" onClick={() => navigate('gustos')}>
                  Editar gustos
                </PillButton>
              </>
            }
          />
        )}
        {dayMatches.length === 0 && <EmptyView icon="calendar" title="Sin partidos anunciados" text="Este día no trae fútbol." action={nextDay ? <PillButton icon="arrow-right" onClick={() => setDayKey(nextDay.key)}>Ver el día siguiente</PillButton> : undefined} />}
      </div>
    </>
  );
}

function MatchRow({ m, mine }: { m: Match; mine: boolean }) {
  const nowMs = useNow();
  const sc = scoreAt(m, nowMs);
  const hidden = useScoreHidden(m.id);
  const session = useSim((s) => s.sourceSessions[`match:${m.id}`]);
  const sig = signalSummary(session, m, nowMs);
  const pulse = usePulse(sc.home + sc.away);
  const reduced = useReducedMotionPref();
  const home = team(m.home);
  const away = team(m.away);
  const live = sc.state === 'in';
  const winner = sc.state === 'post' ? (sc.home > sc.away ? 'home' : sc.away > sc.home ? 'away' : null) : null;
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const followed = useSim((s) => s.preferences.teams.includes(home.name) || s.preferences.teams.includes(away.name));
  return (
    <div className={`ip-swipe ${open || dragging ? 'is-open' : ''}`}>
      <div className="ip-swipe-actions">
        <button
          type="button"
          className="ip-swipe-action"
          onClick={() => {
            toggleTeamFollow(followed ? (useSimTeam(home.name) ? home.name : away.name) : home.name);
            setOpen(false);
          }}
        >
          <Icon name={followed ? 'star-filled' : 'star'} size={18} />
          {followed ? 'Dejar' : 'Seguir'}
        </button>
      </div>
      <motion.div
        className="ip-swipe-front"
        drag={reduced ? false : 'x'}
        dragConstraints={{ left: -88, right: 0 }}
        dragElastic={0.05}
        dragMomentum={false}
        animate={{ x: open ? -88 : 0 }}
        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
        onDragStart={() => setDragging(true)}
        onDragEnd={(_, info) => {
          setDragging(false);
          setOpen(info.offset.x < -40);
        }}
      >
        <button type="button" className="ip-match" onClick={() => (open ? setOpen(false) : openMatchPhone(m.id))}>
          <Dot tone={live ? 'live' : sc.state === 'post' ? 'idle' : 'queued'} pulse={pulse} />
          <span className={`ip-match-time ${live ? 'is-live' : ''}`}>
            <span>{live ? sc.clock : sc.state === 'post' ? 'Final' : m.time}</span>
            {sig.short && (
              <span className={`ip-match-sig is-${sig.tone}`} title={sig.text} aria-label={sig.text}>
                <Dot tone={sig.tone} size="sm" />
                <span>{sig.short}</span>
              </span>
            )}
          </span>
          <span className="ip-match-teams">
            <span className={`ip-match-team ${winner === 'home' ? 'is-winner' : ''}`}>
              <ClubDot color={home.primary} />
              <span className="co-truncate">{home.name}</span>
              {mine && <Icon name="star-filled" size={10} className="ip-mine" />}
            </span>
            <span className={`ip-match-team ${winner === 'away' ? 'is-winner' : ''}`}>
              <ClubDot color={away.primary} />
              <span className="co-truncate">{away.name}</span>
            </span>
          </span>
          <span className={`ip-match-score ${pulse ? 'is-goal' : ''}`}>
            {sc.state === 'pre' ? (
              <span className="is-hidden">{untilText(m.start, nowMs).replace('En ', '')}</span>
            ) : hidden ? (
              <>
                <span className="is-hidden">•</span>
                <span className="is-hidden">•</span>
              </>
            ) : (
              <>
                <span>{sc.home}</span>
                <span>{sc.away}</span>
              </>
            )}
          </span>
        </button>
      </motion.div>
    </div>
  );
}

function useSimTeam(name: string): boolean {
  return useSim((s) => s.preferences.teams.includes(name));
}

// ---------------------------------------------------------------- Partido

export function Partido({ id, hasMini }: { id: string; hasMini: boolean }) {
  const m = useSim((s) => s.agenda.find((x) => x.id === id));
  const nowMs = useNow();
  const player = useSim((s) => s.player);
  const session = useSim((s) => s.sourceSessions[`match:${id}`]);
  const mode = useSim((s) => s.playbackMode);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ detalles: true });
  const hidden = useScoreHidden(id);
  const sc = m ? scoreAt(m, nowMs) : null;
  const pulse = usePulse(sc ? sc.home + sc.away : 0);
  useEffect(() => {
    if (m && Math.abs(m.start - nowMs) < 150 * 60000) ensureSources('match', id);
  }, [id]);
  if (!m || !sc) return <EmptyView icon="ball" title="Este partido ya no está en la agenda" />;
  const isTarget = player.target?.kind === 'match' && player.target.id === id;
  const active = isTarget && session ? session.sources.find((x) => x.id === player.target?.sourceId) : undefined;
  const home = team(m.home);
  const away = team(m.away);
  const phaseM = phaseOf(m, nowMs);
  const sig = signalSummary(session, m, nowMs);

  const more = () =>
    openSheet({
      type: 'actions',
      title: `${home.name} – ${away.name}`,
      items: [
        { id: 'research', label: 'Rebuscar fuentes', icon: 'refresh', run: () => research('match', id) },
        { id: 'paste', label: 'Pegar Content ID…', icon: 'clipboard', run: () => openSheet({ type: 'paste', kind: 'match', id }) },
        { id: 'report', label: 'Reportar la fuente en pantalla…', icon: 'flag', disabled: !active, run: () => active && openSheet({ type: 'report', kind: 'match', id, sourceId: active.id }) },
        { id: 'reveal', label: hidden ? 'Ver marcador' : 'Tapar marcador', icon: hidden ? 'eye' : 'eye-off', disabled: !isTarget, run: () => revealScore(id, hidden) },
        { id: 'fh', label: `Seguir a ${home.name}`, icon: 'star', run: () => toggleTeamFollow(home.name) },
        { id: 'fa', label: `Seguir a ${away.name}`, icon: 'star', run: () => toggleTeamFollow(away.name) },
        ...openInItems(active),
        ...(isTarget ? [{ id: 'stop', label: 'Detener', icon: 'stop' as const, danger: true, run: () => stop('usuario') }] : []),
      ],
    });

  return (
    <>
      <NavBar title={`${home.short} – ${away.short}`} subtitle={compLabel(m)} backLabel="Partidos" right={<NavButton icon="more" label="Más" onClick={more} />} />
      <div className={`ip-scroll ${hasMini ? 'has-mini' : ''}`}>
        <div className="ip-inline-video" style={{ ['--co-home' as string]: home.primary, ['--co-away' as string]: away.primary }}>
          {isTarget ? (
            <VideoSurface radius={14} />
          ) : (
            <div className="ip-inline-idle">
              <span className="ip-inline-crests">
                <Crest team={home} size={44} variant="flat" />
                <Crest team={away} size={44} variant="flat" />
              </span>
              <p>{phaseM === 'finished' ? 'El partido ha terminado' : sig.text}</p>
              {phaseM !== 'finished' && (
                <PillButton kind="primary" icon="play" onClick={() => openTarget('match', id)}>
                  Ver ahora
                </PillButton>
              )}
            </div>
          )}
        </div>
        {isTarget && (
          <div style={{ padding: '0 16px' }}>
            <PhoneStatus />
            <PhoneControls compact />
          </div>
        )}

        <div className="ip-board">
          <div className="ip-board-team">
            <Crest team={home} size={36} variant="flat" />
            <span className="co-truncate">{home.name}</span>
          </div>
          <div className={`ip-board-score ${pulse ? 'is-goal' : ''}`}>
            {sc.state === 'pre' ? (
              <span className="ip-board-pre">{m.time}</span>
            ) : hidden ? (
              <button type="button" className="ip-board-hidden" onClick={() => revealScore(id, true)} aria-label="Ver marcador">
                <span>•</span>
                <span style={{ color: 'var(--co-ink-3)' }}>–</span>
                <span>•</span>
              </button>
            ) : (
              <>
                <span>{sc.home}</span>
                <span style={{ color: 'var(--co-ink-3)' }}>–</span>
                <span>{sc.away}</span>
              </>
            )}
          </div>
          <div className="ip-board-team">
            <Crest team={away} size={36} variant="flat" />
            <span className="co-truncate">{away.name}</span>
          </div>
        </div>
        <div className="ip-board-clock">
          {sc.state === 'in' ? (
            <span className="is-live">
              <Dot tone="live" size="sm" pulse={pulse} /> {sc.halftime ? 'Descanso' : `${sc.clock} · ${sc.detail}`}
            </span>
          ) : sc.state === 'post' ? (
            <span>Final</span>
          ) : (
            <span>{untilText(m.start, nowMs)}</span>
          )}
          {sc.state !== 'pre' && (
            <span className="ip-bar">
              <span style={{ transform: `scaleX(${sc.progress})`, background: sc.state === 'in' ? 'var(--co-live)' : 'var(--co-ink-3)' }} />
            </span>
          )}
          {hidden && (
            <button type="button" className="ip-link" onClick={() => revealScore(id, true)}>
              <Icon name="eye" size={13} /> Ver marcador
            </button>
          )}
        </div>
        {!hidden && sc.goals.length > 0 && (
          <ul className="ip-goals">
            {sc.goals.map((g, i) => (
              <li key={i} className="ip-goal">
                <span className="ip-goal-min">{g.minute}'</span>
                <ClubDot color={g.side === 'home' ? home.primary : away.primary} />
                <span>
                  {g.scorer}
                  {g.kind === 'pen' && <span style={{ color: 'var(--co-ink-3)' }}> (p.)</span>}
                </span>
              </li>
            ))}
          </ul>
        )}

        <Section title="Estado" inset>
          <Row title="Reproducción" trailing={<Value tone={isTarget ? playerTone(player) : 'idle'}>{isTarget ? playerWord(player) : 'En reposo'}</Value>} />
          <Row title="Señal" trailing={active ? <Value tone={sourceLabel(active, nowMs).tone}>{sourceLabel(active, nowMs).word} · {active.resolution}</Value> : <Value tone={sig.tone}>{sig.text}</Value>} />
          {isTarget && player.conn === 'activa' && <Row title="Retraso" trailing={<Value>{player.behindS >= 1.25 ? `${Math.round(player.behindS)} s por detrás` : 'en directo'}</Value>} />}
          <Row title="Modo" trailing={<Value>{modeWord(mode)}</Value>} onClick={() => navigate('ajustes', 'reproduccion')} chevron />
        </Section>

        {session ? (
          <Section title="Fuentes" count={sourcesSummary(session)} right={<button type="button" className="ip-link" onClick={() => research('match', id)}>{session.research ? 'Rebuscando…' : 'Rebuscar'}</button>} footer={session.automatic ? 'Cambio automático si la fuente en pantalla se cae. Elegir una a mano lo apaga. Mantén pulsada una fuente para más opciones.' : 'Elegiste a mano: no habrá cambio automático.'}>
            <PhoneSources session={session} kind="match" id={id} limit={5} />
            {session.sources.every((x) => x.state === 'failed') && (
              <div style={{ padding: '10px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Dot tone="fail" /> <span style={{ fontSize: 13 }}>Ninguna fuente da señal ahora mismo.</span>
                <PillButton icon="clipboard" onClick={() => openSheet({ type: 'paste', kind: 'match', id })}>
                  Pegar Content ID
                </PillButton>
              </div>
            )}
          </Section>
        ) : (
          <Section title="Fuentes" inset>
            <Row title={phaseM === 'finished' ? 'El partido ha terminado' : 'Se comprueban 45 min antes'} subtitle={phaseM === 'finished' ? undefined : 'Puedes adelantarlo'} onClick={phaseM === 'finished' ? undefined : () => ensureSources('match', id)} trailing={phaseM === 'finished' ? undefined : <span className="ip-link">Comprobar ahora</span>} />
          </Section>
        )}

        <Section title="Dónde se emite" inset>
          {m.channels.map((c) => (
            <Row key={c.id} leading={<Icon name="tv" size={18} className="co-ink-3" />} title={c.name} subtitle={hhmm(m.start)} />
          ))}
          {m.venue && <Row leading={<Icon name="shield" size={18} className="co-ink-3" />} title={m.venue} subtitle={compLabel(m)} />}
        </Section>

        <Section title="Detalles" inset collapsible collapsed={!!collapsed.detalles} onToggle={() => setCollapsed((c) => ({ ...c, detalles: !c.detalles }))}>
          {isTarget ? (
            techRows(player, active).map((r) => <Row key={r.k} title={r.k} trailing={<span className="ip-mono" style={{ fontSize: 13 }}>{r.v}</span>} />)
          ) : (
            <Row title="Sin datos hasta que se reproduzca" />
          )}
          {!isTarget && session?.sources[0] && <Row title="Content ID" trailing={<span className="ip-mono" style={{ fontSize: 13 }}>{idLabel(session.sources[0].id)}</span>} />}
        </Section>
        {isTarget && player.conn === 'activa' && <p className="ip-note" style={{ paddingTop: 12 }}>Colchón de {secondsText(player.bufferS)}: si la señal flojea, hay margen antes de que se corte.</p>}
      </div>
    </>
  );
}
