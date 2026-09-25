/* Consola · Partidos (web): tira de 7 días, Para ti / Todos, secciones
   En directo / Próximos / Terminados, filas de 40 px con columnas alineadas.
   El clic selecciona (inspector); Enter o doble clic abre la vista completa. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { navigate } from '../../../core/router';
import { completeOnboarding, featuredLiveMatch, isForYou, isMine, openTarget, revealScore, toggleTeamFollow, useNow, useSim } from '../../../core/store';
import { phaseOf, scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { dayLabel, untilText } from '../../../core/format';
import type { Match } from '../../../core/types';
import { Icon } from '../components/icons';
import { Button, ClubDot, Dot, Empty, GroupHead, IconButton, Keys, Menu, Segmented, useMenu } from '../components/ui';
import { compLabel, compShort, isoDay, signalSummary, useDays, usePreheat, usePulse, useScoreHidden } from '../components/lib';
import { isModalOpen, select, useUi } from './state';

export function openMatch(id: string) {
  openTarget('match', id);
  navigate('partido', id);
}

export function Agenda({ narrow }: { narrow: boolean }) {
  const agenda = useSim((s) => s.agenda);
  const prefs = useSim((s) => s.preferences);
  const nowMs = useNow();
  const days = useDays(agenda);
  const today = isoDay(nowMs);
  const [dayKey, setDayKey] = useState(today);
  const hasPrefs = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length > 0;
  const [filter, setFilter] = useState<'foryou' | 'all'>(hasPrefs ? 'foryou' : 'all');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const selection = useUi((u) => u.selection);

  const dayMatches = useMemo(() => agenda.filter((m) => m.date === dayKey).sort((a, b) => a.start - b.start), [agenda, dayKey]);
  usePreheat(dayMatches);
  const forYouCount = dayMatches.filter((m) => isForYou(m, prefs)).length;
  const visible = useMemo(() => (filter === 'foryou' && hasPrefs ? dayMatches.filter((m) => isForYou(m, prefs)) : dayMatches), [dayMatches, filter, hasPrefs, prefs]);

  const groups = useMemo(() => {
    const live = visible.filter((m) => phaseOf(m, nowMs) === 'live');
    const up = visible.filter((m) => phaseOf(m, nowMs) === 'upcoming');
    const done = visible.filter((m) => phaseOf(m, nowMs) === 'finished');
    return [
      { id: 'live', title: 'En directo', items: live },
      { id: 'up', title: 'Próximos', items: up },
      { id: 'done', title: 'Terminados', items: done },
    ].filter((g) => g.items.length);
  }, [visible, Math.floor(nowMs / 30000)]);

  const flat = useMemo(() => groups.flatMap((g) => (collapsed[g.id] ? [] : g.items)), [groups, collapsed]);

  // Selección por defecto: el partido en directo destacado
  useEffect(() => {
    if (narrow) return;
    const inList = selection?.kind === 'match' && flat.some((m) => m.id === selection.id);
    if (inList) return;
    const f = featuredLiveMatch();
    const pick = (f && flat.find((m) => m.id === f.id)) ?? flat[0];
    if (pick) select({ kind: 'match', id: pick.id });
  }, [flat, narrow]);

  // Teclado: ↑↓ / j k mover, Enter abrir
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select')) return;
      if (isModalOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
      if (!flat.length) return;
      const idx = flat.findIndex((m) => m.id === selection?.id);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = e.key === 'ArrowDown' ? Math.min(flat.length - 1, idx + 1) : Math.max(0, idx - 1);
        select({ kind: 'match', id: flat[n].id });
      } else if (e.key === 'Enter' && idx >= 0) {
        e.preventDefault();
        openMatch(flat[idx].id);
      } else if (e.key === 'j' && idx < flat.length - 1) select({ kind: 'match', id: flat[idx + 1].id });
      else if (e.key === 'k' && idx > 0) select({ kind: 'match', id: flat[idx - 1].id });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat, selection]);

  // ← → cambian de día cuando no hay nada sonando
  useEffect(() => {
    const on = (e: Event) => {
      const dir = (e as CustomEvent<number>).detail;
      const i = days.findIndex((d) => d.key === dayKey);
      const n = days[i + dir];
      if (n) setDayKey(n.key);
    };
    window.addEventListener('co:arrow', on);
    return () => window.removeEventListener('co:arrow', on);
  }, [days, dayKey]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = listRef.current?.querySelector('.co-row.is-selected') as HTMLElement | null;
    el?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  const liveCount = dayMatches.filter((m) => phaseOf(m, nowMs) === 'live').length;
  const nextDay = days[days.findIndex((d) => d.key === dayKey) + 1];

  return (
    <div className="co-screen">
      <div className="co-toolbar">
        <div className="co-days" role="tablist" aria-label="Día">
          {days.map((d) => {
            const lab = dayLabel(d.ms, nowMs);
            const on = d.key === dayKey;
            return (
              <button key={d.key} type="button" role="tab" aria-selected={on} className={`co-day ${on ? 'is-on' : ''} ${d.count === 0 ? 'is-empty' : ''}`} onClick={() => setDayKey(d.key)}>
                <span className="co-day-name">{lab.rel === 'hoy' ? 'Hoy' : lab.rel === 'mañana' ? 'Mañana' : lab.rel === 'ayer' ? 'Ayer' : lab.short}</span>
                <span className="co-day-num co-mono">{lab.num}</span>
                {d.count > 0 && (
                  <span className="co-day-count">
                    {d.live > 0 ? <Dot tone="live" size="sm" /> : <span className="co-day-sep">·</span>}
                    {d.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        <span className="co-grow" />
        <Segmented
          value={filter}
          onChange={setFilter}
          ariaLabel="Filtro"
          options={[
            { id: 'foryou', label: 'Para ti', count: forYouCount, disabled: !hasPrefs },
            { id: 'all', label: 'Todos', count: dayMatches.length },
          ]}
        />
        <IconButton icon="edit" label="Editar mis gustos" onClick={() => navigate('gustos')} />
      </div>

      {!prefs.onboardingComplete && (
        <div className="co-banner">
          <Icon name="heart" size={15} className="co-ink-3" />
          <div className="co-grow">
            <strong>Personaliza tu agenda</strong>
            <span className="co-label"> · Dinos tus ligas y equipos y «Para ti» los pondrá delante.</span>
          </div>
          <Button size="sm" kind="ghost" onClick={completeOnboarding}>
            Ahora no
          </Button>
          <Button size="sm" kind="primary" onClick={() => navigate('gustos')}>
            Personalizar
          </Button>
        </div>
      )}

      <div className="co-list" ref={listRef} role="grid" aria-label="Partidos">
        {visible.length > 0 && (
          <div className="co-thead" aria-hidden="true">
            <span className="co-c-time">Hora</span>
            <span className="co-c-match">Partido</span>
            <span className="co-c-comp">Competición</span>
            <span className="co-c-signal">Señal</span>
            <span className="co-c-where">Dónde se emite</span>
            <span className="co-c-more" />
          </div>
        )}
        {groups.map((g) => (
          <section key={g.id} className="co-section">
            <GroupHead
              title={
                <span className="co-row-flex" style={{ gap: 6 }}>
                  {g.id === 'live' && <Dot tone="live" size="sm" />}
                  {g.title}
                </span>
              }
              count={g.items.length}
              collapsed={!!collapsed[g.id]}
              onToggle={() => setCollapsed((c) => ({ ...c, [g.id]: !c[g.id] }))}
            />
            {!collapsed[g.id] && g.items.map((m) => <MatchRow key={m.id} m={m} selected={selection?.kind === 'match' && selection.id === m.id} narrow={narrow} mine={isMine(m, prefs)} />)}
          </section>
        ))}
        {visible.length === 0 && dayMatches.length > 0 && (
          <Empty
            icon="heart"
            title="Nada de lo tuyo este día"
            text={`Hay ${dayMatches.length} partidos en «Todos».`}
            actions={
              <>
                <Button onClick={() => setFilter('all')}>Ver todos</Button>
                <Button kind="ghost" onClick={() => navigate('gustos')}>
                  Editar mis gustos
                </Button>
              </>
            }
          />
        )}
        {dayMatches.length === 0 && (
          <Empty
            icon="calendar"
            title="Sin partidos anunciados"
            text="La agenda cubre dos semanas; este día no trae fútbol."
            actions={
              nextDay ? (
                <Button icon="arrow-right" onClick={() => setDayKey(nextDay.key)}>
                  Ver el día siguiente
                </Button>
              ) : undefined
            }
          />
        )}
        <footer className="co-list-foot">
          {liveCount > 0 && (
            <span className="co-row-flex" style={{ gap: 6 }}>
              <Dot tone="live" size="sm" /> {liveCount} en directo
            </span>
          )}
          <span className="co-grow" />
          <span className="co-row-flex" style={{ gap: 6 }}>
            <Keys keys="↑ ↓" /> mover <Keys keys="↵" /> abrir <Keys keys="← →" /> día
          </span>
        </footer>
      </div>
    </div>
  );
}

function MatchRow({ m, selected, narrow, mine }: { m: Match; selected: boolean; narrow: boolean; mine: boolean }) {
  const nowMs = useNow();
  const sc = scoreAt(m, nowMs);
  const hidden = useScoreHidden(m.id);
  const session = useSim((s) => s.sourceSessions[`match:${m.id}`]);
  const sig = signalSummary(session, m, nowMs);
  const pulse = usePulse(sc.home + sc.away);
  const home = team(m.home);
  const away = team(m.away);
  const menu = useMenu();
  const live = sc.state === 'in';
  const timeText = live ? sc.clock : sc.state === 'post' ? 'Final' : m.time;
  const sub = live ? (sc.halftime ? 'Descanso' : sc.detail) : sc.state === 'pre' ? untilText(m.start, nowMs) : '';
  const winner = sc.state === 'post' ? (sc.home > sc.away ? 'home' : sc.away > sc.home ? 'away' : null) : null;
  const onClick = () => {
    if (narrow) openMatch(m.id);
    else select({ kind: 'match', id: m.id });
  };
  return (
    <div
      className={`co-row co-row--match ${selected ? 'is-selected' : ''} ${live ? 'is-live' : ''} ${sc.state === 'post' ? 'is-done' : ''}`}
      role="row"
      aria-selected={selected}
      tabIndex={-1}
      onClick={onClick}
      onDoubleClick={() => openMatch(m.id)}
      onContextMenu={menu.openPointer}
    >
      <span className="co-c-time">
        {live && <Dot tone="live" size="sm" pulse={pulse} />}
        <span className={`co-mono co-time ${live ? 'is-live' : ''}`}>{timeText}</span>
        {sub && <span className="co-time-sub co-truncate">{sub}</span>}
      </span>
      <span className="co-c-match">
        <span className={`co-team co-team--home ${winner === 'home' ? 'is-winner' : ''} ${mine && (home.name === team(m.home).name) ? '' : ''}`}>
          <span className="co-truncate" title={home.name}>{home.name}</span>
          <ClubDot color={home.primary} />
        </span>
        <span className={`co-score co-mono ${pulse ? 'is-goal' : ''} ${hidden ? 'is-hidden' : ''}`}>
          {sc.state === 'pre' ? (
            <span className="co-ink-3">–</span>
          ) : hidden ? (
            <button
              type="button"
              className="co-reveal"
              title="Ver marcador"
              onClick={(e) => {
                e.stopPropagation();
                revealScore(m.id, true);
              }}
            >
              <Icon name="eye-off" size={12} />
            </button>
          ) : (
            <>
              {sc.home}–{sc.away}
            </>
          )}
        </span>
        <span className={`co-team co-team--away ${winner === 'away' ? 'is-winner' : ''}`}>
          <ClubDot color={away.primary} />
          <span className="co-truncate" title={away.name}>{away.name}</span>
        </span>
        {mine && <Icon name="star-filled" size={10} className="co-mine" title="Tu equipo" />}
      </span>
      <span className="co-c-comp co-truncate" title={compLabel(m)}>{compShort(m)}</span>
      <span className="co-c-signal">
        {sig.text ? (
          <>
            <Dot tone={sig.tone} size="sm" />
            <span className="co-truncate">{sig.text}</span>
          </>
        ) : (
          <span className="co-ink-3">—</span>
        )}
      </span>
      <span className="co-c-where co-truncate">
        {m.channels.slice(0, 2).map((c, i) => (
          <span key={c.id}>
            {i > 0 && <span className="co-ink-3"> · </span>}
            {c.name}
          </span>
        ))}
        {m.channels.length > 2 && <span className="co-ink-3"> +{m.channels.length - 2}</span>}
      </span>
      <span className="co-c-more">
        <IconButton icon="more" label="Más opciones" onClick={(e) => menu.openAt(e, 'right')} className="co-row-more" />
      </span>
      {menu.state && (
        <Menu
          at={menu.state}
          align={menu.state.align}
          onClose={menu.close}
          items={[
            { id: 'open', label: 'Ver ahora', icon: 'play', keys: 'Enter', run: () => openMatch(m.id) },
            { id: 'reveal', label: hidden ? 'Ver marcador' : 'Tapar marcador', icon: hidden ? 'eye' : 'eye-off', run: () => revealScore(m.id, hidden), disabled: sc.state === 'pre' },
            { id: 'sep', label: '', sep: true },
            { id: 'fh', label: `Seguir a ${home.name}`, icon: 'star', run: () => toggleTeamFollow(home.name) },
            { id: 'fa', label: `Seguir a ${away.name}`, icon: 'star', run: () => toggleTeamFollow(away.name) },
          ]}
        />
      )}
    </div>
  );
}
