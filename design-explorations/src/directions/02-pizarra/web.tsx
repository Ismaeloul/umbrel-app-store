/* Pizarra · web de escritorio (1440×900, adaptable hasta 390 px).
   Cabecera con ticker de marcadores y LED del motor; tres columnas fijas
   sin scroll global: agenda densa · tablero + vídeo · rack de fuentes. */
import { useEffect, useMemo, useRef } from 'react';
import './fonts';
import './tokens.css';
import './components/shared.css';
import './web/web.css';
import { useRoute, navigate, tabOf, back } from '../../core/router';
import { useWebShortcuts } from '../../core/keys';
import { allChannels, completeOnboarding, isFavorite, itemById, openTarget, playChannel, setFullscreen, stop, toggleFavorite, togglePlay, useNow, useSim } from '../../core/store';
import { competition, team } from '../../core/data/teams';
import { ChannelMark } from '../../core/ui/ChannelMark';
import { hhmm, untilText } from '../../core/format';
import type { Match } from '../../core/types';
import { Empty, Meter, Segmented } from './components/atoms';
import { groupByCompetition, matchTitle, resolveDay, useDayMatches, useDays, useLiveMatches, useMatch, useMatchOnChannel, usePlayerSampler, usePrewarm, useScore, useScoreHidden, useSignal } from './components/data';
import { MatchRow } from './components/MatchRow';
import { Scoreboard } from './components/Scoreboard';
import { SourceRack } from './components/SourceRack';
import { FullscreenPlayer, PlayerBlock, StatusLine, Video, useActiveSource } from './components/Player';
import { SheetHost } from './components/Sheets';
import { Toasts } from './components/Toasts';
import { Library, useDefaultLibTab, type LibTab } from './components/Library';
import { Search } from './components/Search';
import { Gustos, SettingsIndex, SettingsSection, SETTINGS_SECTIONS, type SettingsId } from './components/Settings';
import { IChevronLeft, IDensity, IDensityLoose, IHelp, IPause, IPlay, IStar, IStop } from './components/icons';
import { closeSheet, getUi, openSheet, setFilter, setFocusId, setPane, toggleDensity, useUi } from './components/prefs';

function currentScreen(): string {
  return location.hash.replace(/^#\/?/, '').split('/')[2] ?? 'agenda';
}

export default function Web() {
  const route = useRoute();
  const density = useUi((u) => u.density);
  const pane = useUi((u) => u.pane);
  const filter = useUi((u) => u.filter);
  const searchRef = useRef<HTMLInputElement>(null);
  const nowMs = useNow();
  const dayIso = resolveDay(route.screen === 'agenda' ? route.param : null, nowMs);
  const days = useDays();
  const dayMatches = useDayMatches(dayIso, filter);
  usePlayerSampler();

  // El zapping cambia el canal en pantalla: el centro sigue al reproductor.
  const targetKind = useSim((s) => s.player.target?.kind ?? null);
  const targetId = useSim((s) => s.player.target?.id ?? null);
  useEffect(() => {
    if (targetKind === 'channel' && targetId && (route.screen === 'partido' || route.screen === 'canal') && route.param !== targetId) {
      navigate('canal', targetId, null, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKind, targetId]);

  // En web estrecha, cambiar de pantalla lleva al panel central.
  useEffect(() => {
    if (route.screen !== 'agenda') setPane('centro');
  }, [route.screen, route.param]);

  const handlers = useMemo(
    () => ({
      onSearch: () => {
        navigate('buscar');
        setTimeout(() => searchRef.current?.focus(), 30);
      },
      onHelp: () => openSheet(getUi().sheet?.type === 'help' ? null : { type: 'help' }),
      onEscape: () => {
        if (getUi().sheet) {
          closeSheet();
          return true;
        }
        setFullscreen(false);
        return true;
      },
      onArrowIdle: (dir: -1 | 1) => {
        if (currentScreen() !== 'agenda') return;
        const idx = days.findIndex((d) => d.iso === dayIso);
        const next = days[idx + dir];
        if (next) navigate('agenda', next.iso, null, { replace: true });
      },
    }),
    [days, dayIso],
  );
  useWebShortcuts(handlers);

  // Atajos propios de Pizarra: ↑↓ partido, Intro abre, D densidad, T filtro.
  const listIds = useMemo(() => groupByCompetition(dayMatches.list, nowMs).flatMap((g) => g.matches.map((m) => m.id)), [dayMatches.list, nowMs]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const cur = getUi().focusId ?? (route.screen === 'partido' ? route.param : null);
        const i = cur ? listIds.indexOf(cur) : -1;
        const next = listIds[Math.max(0, Math.min(listIds.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
        if (next) setFocusId(next);
      } else if (e.key === 'Enter' && getUi().focusId && !(t && t.closest('button, a, [role="button"]'))) {
        navigate('partido', getUi().focusId);
      } else if (e.key === 'd') {
        toggleDensity();
      } else if (e.key === 't' || e.key === 'T') {
        setFilter(getUi().filter === 'para-ti' ? 'todos' : 'para-ti');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [listIds, route.screen, route.param]);

  return (
    <div className="pz-root pz-web" data-density={density} data-pane={pane}>
      <Header route={route} />
      <div className="pz-web-body">
        <AgendaColumn dayIso={dayIso} days={days} matches={dayMatches} selectedId={route.screen === 'partido' ? route.param : null} />
        <CenterColumn searchRef={searchRef} />
        <EmisionColumn />
      </div>
      <FullscreenPlayer />
      <SheetHost mode="web" />
      <Toasts />
    </div>
  );
}

/* ---------- cabecera ---------- */
function Header({ route }: { route: ReturnType<typeof useRoute> }) {
  const nowMs = useNow();
  const engine = useSim((s) => s.engine.status);
  const density = useUi((u) => u.density);
  const pane = useUi((u) => u.pane);
  const live = useLiveMatches();
  const tab = tabOf(route.screen);
  const nav: { id: 'agenda' | 'biblioteca' | 'buscar' | 'ajustes'; label: string }[] = [
    { id: 'agenda', label: 'Agenda' },
    { id: 'biblioteca', label: 'Canales' },
    { id: 'buscar', label: 'Buscar' },
    { id: 'ajustes', label: 'Ajustes' },
  ];
  return (
    <header className="pz-web-head">
      <div className="pz-wordmark">
        <b>Pizarra</b>
        <small>Ace Player Neo</small>
      </div>
      <nav className="pz-web-nav" aria-label="Secciones">
        {nav.map((n) => (
          <button key={n.id} type="button" className={tab === n.id ? 'is-on' : ''} onClick={() => navigate(n.id)} aria-current={tab === n.id ? 'page' : undefined}>
            {n.label}
          </button>
        ))}
      </nav>
      <div className="pz-ticker" aria-label="Marcadores en directo">
        {live.map((m) => (
          <Tick key={m.id} m={m} selected={route.screen === 'partido' && route.param === m.id} />
        ))}
        {!live.length && (
          <span className="pz-dim" style={{ fontSize: 12 }}>
            Nada en directo ahora mismo
          </span>
        )}
      </div>
      <div className="pz-web-tools">
        <span className="pz-web-clock" title="Hora">
          {hhmm(nowMs)}
        </span>
        <span className={`pz-led${engine === 'offline' || engine === 'unknown' ? ' is-off' : engine === 'restarting' ? ' is-restarting' : ''}`} title="Estado del motor" role="status">
          <i />
          {engine === 'online' ? 'Motor en línea' : engine === 'restarting' ? 'Reiniciando' : 'Motor apagado'}
        </span>
        <button type="button" className="pz-btn pz-btn--icon pz-btn--ghost" onClick={toggleDensity} aria-label={density === 'comodo' ? 'Pasar a Compacto' : 'Pasar a Cómodo'} title="D · densidad">
          {density === 'comodo' ? <IDensity size={18} /> : <IDensityLoose size={18} />}
        </button>
        <button type="button" className="pz-btn pz-btn--icon pz-btn--ghost pz-web-help" onClick={() => openSheet({ type: 'help' })} aria-label="Atajos de teclado" title="?">
          <IHelp size={18} />
        </button>
      </div>
      <div className="pz-web-panes">
        <Segmented value={pane} onChange={setPane} options={[{ id: 'agenda', label: 'Pizarra' }, { id: 'centro', label: 'Partido' }, { id: 'fuentes', label: 'Fuentes' }]} label="Panel" />
      </div>
    </header>
  );
}

function Tick({ m, selected }: { m: Match; selected: boolean }) {
  const s = useScore(m)!;
  const hidden = useScoreHidden(m.id);
  return (
    <button type="button" className={`pz-tick${selected ? ' is-selected' : ''}`} onClick={() => navigate('partido', m.id)} title={matchTitle(m)}>
      <span className="sc">
        <span className="t">{team(m.home).short}</span>
        {hidden ? (
          <span className="mask" aria-label="tapado">
            <i />
            <i />
          </span>
        ) : (
          <span>
            {s.home}
            <em>–</em>
            {s.away}
          </span>
        )}
        <span className="t">{team(m.away).short}</span>
      </span>
      <span className="min">{s.halftime ? 'DESC' : s.clock}</span>
    </button>
  );
}

/* ---------- columna izquierda: agenda ---------- */
function AgendaColumn({ dayIso, days, matches, selectedId }: { dayIso: string; days: ReturnType<typeof useDays>; matches: ReturnType<typeof useDayMatches>; selectedId: string | null }) {
  const nowMs = useNow();
  const filter = useUi((u) => u.filter);
  const focusId = useUi((u) => u.focusId);
  const prefs = useSim((s) => s.preferences);
  const hasPrefs = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length > 0;
  usePrewarm(matches.all);
  const groups = useMemo(() => groupByCompetition(matches.list, nowMs), [matches.list, nowMs]);
  const current = days.find((d) => d.iso === dayIso);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focusId) return;
    scrollRef.current?.querySelector<HTMLElement>(`[data-id="${focusId}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [focusId]);

  const goDay = (iso: string) => navigate('agenda', iso, null, { replace: currentScreen() === 'agenda' });

  return (
    <section className="pz-col pz-col-agenda" aria-label="Agenda">
      <div className="pz-col-top">
        <div className="pz-agenda-head">
          <h1>
            Agenda <small>{current?.rel === 'hoy' ? 'hoy' : current?.rel === 'ayer' ? 'ayer' : current?.rel === 'mañana' ? 'mañana' : current ? `${current.short} ${current.num}` : ''}</small>
          </h1>
          <span className="pz-livecount">
            <i className="pz-dot pz-dot--pulse pz-anim" />
            {matches.live.length} en directo
          </span>
        </div>
        <div className="pz-days" role="tablist" aria-label="Días">
          {days.map((d) => (
            <button key={d.iso} type="button" role="tab" aria-selected={d.iso === dayIso} className={`pz-day${d.iso === dayIso ? ' is-on' : ''}${d.rel === 'hoy' ? ' is-today' : ''}`} onClick={() => goDay(d.iso)} title={`${d.count} partidos`}>
              {d.live > 0 && <i className="pz-day-live" aria-label="con partidos en directo" />}
              <small>{d.rel === 'hoy' ? 'Hoy' : d.rel === 'ayer' ? 'Ayer' : d.rel === 'mañana' ? 'Mañ' : d.short}</small>
              <b>{d.num}</b>
            </button>
          ))}
        </div>
        <div className="pz-filterbar">
          <Segmented value={filter} onChange={setFilter} options={[{ id: 'para-ti', label: 'Para ti', count: matches.forYouCount }, { id: 'todos', label: 'Todos', count: matches.all.length }]} label="Filtro" />
          {!hasPrefs && (
            <button type="button" className="pz-btn pz-btn--sm pz-btn--ghost" onClick={() => navigate('gustos')}>
              Elegir gustos
            </button>
          )}
        </div>
      </div>
      <div className="pz-scroll" ref={scrollRef}>
        {!prefs.onboardingComplete && <FirstUseCard />}
        {groups.map((g) => (
          <div key={g.comp.id}>
            <div className="pz-sect">
              {g.comp.name}
              <span>{g.matches.length}</span>
            </div>
            {g.matches.map((m) => (
              <div key={m.id} data-id={m.id}>
                <MatchRow
                  match={m}
                  selected={selectedId === m.id}
                  focused={focusId === m.id && selectedId !== m.id}
                  onClick={() => {
                    setFocusId(m.id);
                    navigate('partido', m.id);
                  }}
                />
              </div>
            ))}
          </div>
        ))}
        {!groups.length &&
          (matches.all.length ? (
            <Empty
              title="Nada de lo tuyo este día"
              text={`Hay ${matches.all.length} partidos que no encajan con tus gustos.`}
              actions={
                <>
                  <button type="button" className="pz-btn pz-btn--sm" onClick={() => setFilter('todos')}>
                    Ver todos
                  </button>
                  <button type="button" className="pz-btn pz-btn--sm pz-btn--ghost" onClick={() => navigate('gustos')}>
                    Editar mis gustos
                  </button>
                </>
              }
            />
          ) : (
            <Empty
              title="Sin partidos anunciados"
              text="Este día no hay nada en el calendario."
              actions={
                <button
                  type="button"
                  className="pz-btn pz-btn--sm"
                  onClick={() => {
                    const i = days.findIndex((d) => d.iso === dayIso);
                    const n = days[i + 1];
                    if (n) goDay(n.iso);
                  }}
                >
                  Ver el día siguiente
                </button>
              }
            />
          ))}
      </div>
    </section>
  );
}

function FirstUseCard() {
  return (
    <div className="pz-firstuse">
      <b>Personaliza tu pizarra</b>
      <p>Dinos tus ligas y equipos y «Para ti» enseñará solo eso. Mientras tanto ves todos los partidos.</p>
      <div className="pz-firstuse-actions">
        <button type="button" className="pz-btn pz-btn--sm pz-btn--primary" onClick={() => navigate('gustos')}>
          Personalizar
        </button>
        <button type="button" className="pz-btn pz-btn--sm pz-btn--ghost" onClick={completeOnboarding}>
          Ahora no
        </button>
      </div>
    </div>
  );
}

/* ---------- columna central ---------- */
function CenterColumn({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const r = useRoute();
  return (
    <section className="pz-col pz-col-center" aria-label="Centro">
      {(r.screen === 'agenda' || r.screen === 'emparejar') && <BoardHome />}
      {r.screen === 'partido' && r.param && <MatchCenter id={r.param} key={r.param} />}
      {r.screen === 'canal' && r.param && <ChannelCenter id={r.param} title={r.sub} key={r.param} />}
      {r.screen === 'biblioteca' && <LibraryScreen tab={r.param as LibTab | null} />}
      {r.screen === 'buscar' && <SearchScreen inputRef={searchRef} />}
      {r.screen === 'ajustes' && <SettingsScreen section={(r.param as SettingsId | null) ?? 'dispositivos'} />}
      {r.screen === 'gustos' && <GustosScreen />}
    </section>
  );
}

function BoardHome() {
  const live = useLiveMatches();
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const featured = live[0];
  const next = useMemo(() => agenda.filter((m) => m.start > nowMs).sort((a, b) => a.start - b.start).slice(0, 4), [agenda, nowMs]);
  return (
    <>
      <div className="pz-center-head">
        <h1>
          En juego <small>{live.length ? `${live.length} partidos ahora` : 'nada ahora mismo'}</small>
        </h1>
      </div>
      <div className="pz-scroll pz-center-scroll">
        {featured ? (
          <>
            <Scoreboard match={featured} size="web" onClick={() => navigate('partido', featured.id)} />
            <div className="pz-cta-row">
              <button type="button" className="pz-btn pz-btn--primary pz-btn--lg" onClick={() => navigate('partido', featured.id)}>
                <IPlay size={16} /> Ver {matchTitle(featured)}
              </button>
              <span className="pz-dim" style={{ fontSize: 12 }}>
                O elige cualquier fila de la pizarra · ↑↓ e Intro
              </span>
            </div>
            {live.length > 1 && (
              <>
                <h2 className="pz-h2">También en directo</h2>
                <div className="pz-home-grid">
                  {live.slice(1).map((m) => (
                    <Scoreboard key={m.id} match={m} size="tile" timeline={false} compactMeta onClick={() => navigate('partido', m.id)} />
                  ))}
                </div>
              </>
            )}
          </>
        ) : (
          <div className="pz-prevideo" style={{ aspectRatio: 'auto', padding: 32 }}>
            <b>Nada en directo ahora mismo</b>
            <p>Cuando empiece un partido aparecerá aquí con su marcador y su señal.</p>
          </div>
        )}
        {next.length > 0 && (
          <>
            <h2 className="pz-h2">Luego</h2>
            <div className="pz-home-grid">
              {next.map((m) => (
                <Scoreboard key={m.id} match={m} size="tile" timeline={false} compactMeta onClick={() => navigate('partido', m.id)} />
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function MatchCenter({ id }: { id: string }) {
  const match = useMatch(id);
  const nowMs = useNow();
  const score = useScore(match);
  const isTarget = useSim((s) => s.player.target?.kind === 'match' && s.player.target.id === id);
  const conn = useSim((s) => s.player.conn);
  const live = score?.state === 'in';
  useEffect(() => {
    if (match && live) openTarget('match', id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, live]);
  if (!match || !score) {
    return (
      <div className="pz-scroll pz-center-scroll">
        <Empty
          title="Partido no encontrado"
          text="Puede que ya no esté en la agenda."
          actions={
            <button type="button" className="pz-btn pz-btn--sm" onClick={() => navigate('agenda')}>
              Volver a la agenda
            </button>
          }
        />
      </div>
    );
  }
  const comp = competition(match.competition);
  return (
    <>
      <div className="pz-center-head">
        <h1>
          <button type="button" className="pz-tap" style={{ minWidth: 32, minHeight: 32, marginLeft: -8 }} onClick={() => back('agenda')} aria-label="Volver">
            <IChevronLeft size={18} />
          </button>
          {matchTitle(match)}
          <small>
            {comp.name}
            {match.round ? ` · ${match.round}` : ''}
          </small>
        </h1>
        <div className="pz-actions">
          {isTarget && (
            <button type="button" className="pz-btn pz-btn--sm pz-btn--ghost" onClick={() => stop()}>
              <IStop size={14} /> Detener
            </button>
          )}
        </div>
      </div>
      <div className="pz-scroll pz-center-scroll">
        <Scoreboard match={match} size="web" />
        {isTarget ? (
          <PlayerBlock />
        ) : (
          <div className="pz-prevideo">
            <b>{live ? 'Preparando la señal…' : score.state === 'pre' ? `Empieza ${untilText(match.start, nowMs).toLowerCase()}` : 'El partido ha terminado'}</b>
            <p>{score.state === 'pre' ? 'Las fuentes se comprueban 45 minutos antes. Puedes ver ya el canal si lo prefieres.' : score.state === 'post' ? 'Puedes ver el canal que lo emitió.' : 'Comprobando las fuentes: arranca la primera que funcione.'}</p>
            <button type="button" className="pz-btn pz-btn--primary" onClick={() => openTarget('match', id)}>
              <IPlay size={16} /> Ver el canal ahora
            </button>
          </div>
        )}
        <div>
          <h2 className="pz-h2" style={{ marginBottom: 8 }}>
            Dónde se emite
          </h2>
          <div className="pz-where">
            {match.channels.map((c) => (
              <WhereChip key={c.id} name={c.name} />
            ))}
            {match.venue && (
              <span className="pz-dim" style={{ fontSize: 12, marginLeft: 'auto' }}>
                {match.venue}
              </span>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

function WhereChip({ name }: { name: string }) {
  const favs = useSim((s) => s.favorites);
  const item = useMemo(() => {
    const byTitle = (i: { title: string }) => i.title.toLowerCase() === name.toLowerCase();
    return favs.find(byTitle) ?? allChannels().find(byTitle) ?? null;
  }, [favs, name]);
  const inFav = !!favs.find((i) => i.title.toLowerCase() === name.toLowerCase());
  return (
    <button type="button" className="pz-chip" onClick={() => item && navigate('canal', item.id)} disabled={!item} title={inFav ? 'En tus favoritos · abrir el canal' : item ? 'En tus listas · abrir el canal' : 'No está en tu biblioteca: se buscará en el motor'}>
      <ChannelMark name={name} size={20} radius={4} />
      {name}
      {inFav && <IStar size={12} filled style={{ color: 'var(--pz-weak)' }} />}
    </button>
  );
}

function ChannelCenter({ id, title }: { id: string; title: string | null }) {
  const libItem = useSim((s) => s.favorites.find((i) => i.id === id) ?? s.history.find((i) => i.id === id) ?? null);
  const known = libItem ?? itemById(id) ?? null;
  const name = known?.title ?? title ?? 'Enlace pegado';
  const fav = useSim(() => isFavorite(id));
  const on = useMatchOnChannel(known ? known.title : null);
  const isTarget = useSim((s) => s.player.target?.kind === 'channel' && s.player.target.id === id);
  const conn = useSim((s) => s.player.conn);
  const signal = useSignal('channel', id);
  useEffect(() => {
    playChannel(id);
  }, [id]);
  return (
    <>
      <div className="pz-center-head">
        <h1>
          <button type="button" className="pz-tap" style={{ minWidth: 32, minHeight: 32, marginLeft: -8 }} onClick={() => back('biblioteca')} aria-label="Volver">
            <IChevronLeft size={18} />
          </button>
          Canal
        </h1>
        <div className="pz-actions">
          <button type="button" className={`pz-btn pz-btn--sm${fav ? ' is-on' : ''}`} onClick={() => toggleFavorite(id, name)}>
            <IStar size={14} filled={fav} /> {fav ? 'Favorito' : 'Guardar'}
          </button>
          {isTarget && (
            <button type="button" className="pz-btn pz-btn--sm pz-btn--ghost" onClick={() => stop()}>
              <IStop size={14} /> Detener
            </button>
          )}
        </div>
      </div>
      <div className="pz-scroll pz-center-scroll">
        <div className="pz-channel-head">
          <ChannelMark name={name} size={44} radius={8} />
          <div style={{ minWidth: 0 }}>
            <h1>{name}</h1>
            <p>
              {libItem ? (libItem.type === 'fav' ? 'En tus favoritos' : 'En tus recientes') : known ? 'De tus listas' : 'Fuera de tu biblioteca · solo en esta sesión'}
              {known?.category ? ` · ${known.category}` : ''}
            </p>
          </div>
          <Meter kind={signal.kind} word label={signal.text} />
        </div>
        {isTarget ? (
          <PlayerBlock />
        ) : (
          <div className="pz-prevideo">
            <b>Conectando…</b>
          </div>
        )}
        {on ? (
          <div>
            <h2 className="pz-h2" style={{ marginBottom: 8 }}>
              {on.live ? 'Ahora en este canal' : `A las ${hhmm(on.match.start)} en este canal`}
            </h2>
            <Scoreboard match={on.match} size="tile" timeline={on.live} compactMeta onClick={() => navigate('partido', on.match.id)} />
          </div>
        ) : (
          known && (
            <p className="pz-dim" style={{ margin: 0, fontSize: 12 }}>
              Sin partidos anunciados en este canal · zapping con ← → mientras suena
            </p>
          )
        )}
      </div>
    </>
  );
}

function LibraryScreen({ tab }: { tab: LibTab | null }) {
  const def = useDefaultLibTab();
  const t = tab && ['favoritos', 'recientes', 'listas'].includes(tab) ? tab : def;
  const selectedId = useSim((s) => (s.player.target?.kind === 'channel' ? s.player.target.id : null));
  return (
    <>
      <div className="pz-center-head">
        <h1>Canales</h1>
        <div className="pz-actions">
          <button type="button" className="pz-btn pz-btn--sm" onClick={() => navigate('ajustes', 'listas')}>
            Gestionar listas
          </button>
        </div>
      </div>
      <div className="pz-scroll">
        <Library mode="web" tab={t} onTab={(x) => navigate('biblioteca', x, null, { replace: true })} selectedId={selectedId} />
      </div>
    </>
  );
}

function SearchScreen({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const selectedId = useSim((s) => (s.player.target?.kind === 'channel' ? s.player.target.id : null));
  return (
    <>
      <div className="pz-center-head">
        <h1>Buscar</h1>
        <span className="pz-dim" style={{ fontSize: 12, display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <span className="pz-kbd">/</span> enfoca el campo
        </span>
      </div>
      <div className="pz-scroll">
        <Search mode="web" autoFocus inputRef={inputRef} selectedId={selectedId} />
      </div>
    </>
  );
}

function SettingsScreen({ section }: { section: SettingsId }) {
  const meta = SETTINGS_SECTIONS.find((s) => s.id === section) ?? SETTINGS_SECTIONS[0];
  return (
    <>
      <div className="pz-center-head">
        <h1>Ajustes</h1>
      </div>
      <div className="pz-settings">
        <div className="pz-settings-index pz-scroll">
          <SettingsIndex mode="web" current={meta.id} onSelect={(id) => navigate('ajustes', id, null, { replace: true })} />
        </div>
        <div className="pz-settings-body pz-scroll">
          <h2>{meta.label}</h2>
          <SettingsSection id={meta.id} mode="web" />
        </div>
      </div>
    </>
  );
}

function GustosScreen() {
  const first = useSim((s) => !s.preferences.onboardingComplete);
  return (
    <>
      <div className="pz-center-head">
        <h1>
          ¿Qué fútbol te mueve? <small>Tu fútbol</small>
        </h1>
      </div>
      <div className="pz-scroll">
        <Gustos mode="web" firstUse={first} onDone={() => navigate('agenda')} />
      </div>
    </>
  );
}

/* ---------- columna derecha: emisión ---------- */
function EmisionColumn() {
  const r = useRoute();
  const target = useSim((s) => s.player.target);
  const conn = useSim((s) => s.player.conn);
  const media = useSim((s) => s.player.media);
  const src = useActiveSource();
  const ctx: { kind: 'match' | 'channel'; id: string } | null = r.screen === 'partido' && r.param ? { kind: 'match', id: r.param } : r.screen === 'canal' && r.param ? { kind: 'channel', id: r.param } : target ? { kind: target.kind, id: target.id } : null;
  const inPlace = !!target && !!ctx && ctx.kind === target.kind && ctx.id === target.id && (r.screen === 'partido' || r.screen === 'canal');
  const showMini = !!target && !inPlace;
  const title = target?.title ?? '';
  const phase = conn === 'activa' ? (media === 'playing' ? 'En pantalla' : 'En pausa') : conn === 'reconectando' ? 'Reconectando' : conn === 'error' ? 'Sin señal' : conn === 'idle' ? 'Buscando señal' : 'Conectando';
  const goToTarget = () => target && navigate(target.kind === 'match' ? 'partido' : 'canal', target.id);
  return (
    <aside className="pz-col pz-col-emision" aria-label="Emisión">
      <div className="pz-col-top">
        {showMini && target ? (
          <>
            <div className="pz-mini">
              <button type="button" className="pz-mini-video" onClick={goToTarget} aria-label={`Abrir ${title}`}>
                <Video radius={0} badges={false} />
              </button>
              <div className="pz-mini-txt">
                <span className="pz-label">
                  <i className={`pz-dot${conn === 'activa' && media === 'playing' ? ' pz-dot--pulse pz-anim' : ''}`} style={{ color: conn === 'error' ? 'var(--pz-fail)' : conn === 'activa' ? 'var(--pz-ok)' : 'var(--pz-weak)' }} />
                  {phase}
                </span>
                <b>{title}</b>
                <small>{src ? `${src.matchedChannel} ${src.resolution} · ${src.listaName}` : target.subtitle}</small>
                <div className="pz-mini-ctl">
                  <button type="button" className="pz-tap" onClick={togglePlay} aria-label={media === 'playing' ? 'Pausa' : 'Reproducir'}>
                    {media === 'playing' && conn === 'activa' ? <IPause size={18} /> : <IPlay size={18} />}
                  </button>
                  <button type="button" className="pz-tap" onClick={() => stop()} aria-label="Detener">
                    <IStop size={16} />
                  </button>
                  <button type="button" className="pz-btn pz-btn--sm pz-btn--ghost" onClick={goToTarget}>
                    Abrir
                  </button>
                </div>
              </div>
            </div>
            <StatusLine />
          </>
        ) : (
          <div className="pz-rack-head" style={{ paddingBottom: 8 }}>
            <div className="pz-rack-title">Emisión</div>
            {inPlace && <span className="pz-tag pz-tag--accent">{phase}</span>}
          </div>
        )}
      </div>
      <div className="pz-scroll">
        {ctx ? (
          <SourceRack kind={ctx.kind} id={ctx.id} mode="web" />
        ) : (
          <div className="pz-emision-empty">
            <b>Aquí verás las fuentes</b>
            <span>Elige un partido de la pizarra: se comprueban sus señales y arranca la primera que funcione.</span>
          </div>
        )}
      </div>
    </aside>
  );
}
