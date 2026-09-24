/* Pizarra · app de iPhone (402×874 pt; se pinta dentro de DeviceFrame).
   Tab bar de 5: Directo · Agenda · Canales · Buscar · Ajustes. «Directo» es la
   pantalla de arranque (agenda sin parámetro). Mini de 56 pt sobre la barra;
   deslizarlo arriba abre el grande, deslizar el grande abajo lo minimiza.
   Todo lo que hay aquí se puede hacer en SwiftUI puro (ver DESIGN.md). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useDragControls, useMotionValue } from 'motion/react';
import './fonts';
import './tokens.css';
import './components/shared.css';
import './iphone/iphone.css';
import { back, navigate, useRoute, type Route } from '../../core/router';
import { claimPairing, isFavorite, itemById, openTarget, playChannel, setExpanded, stop, toggleFavorite, togglePlay, useNow, useSim, zap } from '../../core/store';
import { competition, team } from '../../core/data/teams';
import { scoreAt } from '../../core/score';
import { ChannelMark } from '../../core/ui/ChannelMark';
import { hhmm, untilText } from '../../core/format';
import type { Match } from '../../core/types';
import { Empty, Meter, Segmented } from './components/atoms';
import { groupByCompetition, matchShort, matchTitle, resolveDay, sourceKind, useDayMatches, useDays, useLiveMatches, useMatch, useMatchOnChannel, usePlayerSampler, usePrewarm, useScore, useScoreHidden, useSignal } from './components/data';
import { MatchRow } from './components/MatchRow';
import { Scoreboard } from './components/Scoreboard';
import { SourceRack } from './components/SourceRack';
import { Controls, FullscreenPlayer, StatusLine, Video, useActiveSource } from './components/Player';
import { SheetHost } from './components/Sheets';
import { Toasts } from './components/Toasts';
import { Library, useDefaultLibTab, type LibTab } from './components/Library';
import { Search } from './components/Search';
import { Gustos, HealthTiles, SettingsIndex, SettingsSection, SETTINGS_SECTIONS, type SettingsId } from './components/Settings';
import { ICalendar, IChannels, IChevronDown, IChevronLeft, IDensity, IDensityLoose, IGear, ILive, IMore, IPause, IPlay, IQr, ISearch, IStar, IStop } from './components/icons';
import { openSheet, setFilter, toggleDensity, useUi } from './components/prefs';

type Tab = 'directo' | 'agenda' | 'canales' | 'buscar' | 'ajustes';

function tabOfRoute(r: Route): Tab {
  switch (r.screen) {
    case 'agenda':
      return r.param ? 'agenda' : 'directo';
    case 'biblioteca':
    case 'canal':
      return 'canales';
    case 'buscar':
      return 'buscar';
    case 'ajustes':
    case 'gustos':
      return 'ajustes';
    default:
      return 'directo';
  }
}

function screenKey(r: Route): string {
  if (r.screen === 'agenda') return r.param ? 'agenda' : 'directo';
  if (r.screen === 'ajustes') return `ajustes/${r.param ?? ''}`;
  if (r.screen === 'biblioteca' || r.screen === 'buscar') return r.screen;
  return `${r.screen}/${r.param ?? ''}`;
}

function isRoot(r: Route): boolean {
  return (r.screen === 'agenda' || r.screen === 'biblioteca' || r.screen === 'buscar' || (r.screen === 'ajustes' && !r.param)) as boolean;
}

export default function Iphone() {
  const route = useRoute();
  const density = useUi((u) => u.density);
  const paired = useSim((s) => s.paired);
  const onboarding = useSim((s) => s.preferences.onboardingComplete);
  const target = useSim((s) => s.player.target);
  const expanded = useSim((s) => s.player.expanded);
  const reduced = useSim((s) => s.reducedMotion);
  usePlayerSampler();

  const key = screenKey(route);
  const prevRef = useRef<{ key: string; root: boolean }>({ key, root: isRoot(route) });
  const anim = useMemo(() => {
    const prev = prevRef.current;
    const root = isRoot(route);
    const kind: 'forward' | 'back' | 'fade' = prev.key === key ? 'fade' : prev.root && root ? 'fade' : route.direction === 'back' ? 'back' : 'forward';
    prevRef.current = { key, root };
    return { kind, reduced };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, route.seq]);

  const firstUse = !paired || route.screen === 'emparejar' ? 'pair' : !onboarding ? 'gustos' : null;
  // El mini solo aparece cuando el reproductor integrado no está a la vista (otra pantalla u otro partido).
  const inPlace = !!target && ((route.screen === 'partido' && target.kind === 'match') || (route.screen === 'canal' && target.kind === 'channel')) && route.param === target.id;
  const showMini = !!target && !expanded && !firstUse && !inPlace;

  return (
    <div className={`pz-root pz-ip${showMini ? ' has-mini' : ''}${expanded && target ? ' is-big' : ''}`} data-density={density}>
      <div className="pz-ip-stage">
        {firstUse === 'pair' && <PairScreen />}
        {firstUse === 'gustos' && <GustosScreen first />}
        {!firstUse && (
          <AnimatePresence initial={false} custom={anim}>
            <motion.div key={key} className="pz-ip-screen" custom={anim} variants={SCREEN_VARIANTS} initial="enter" animate="center" exit="exit" transition={{ duration: reduced ? 0.1 : 0.2, ease: [0.2, 0.8, 0.2, 1] }}>
              <ScreenSwitch route={route} />
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      {!firstUse && !isRoot(route) && <EdgeBack />}
      {showMini && <Mini />}
      {!firstUse && <TabBar route={route} />}
      <AnimatePresence>{expanded && target && !firstUse && <BigPlayer key="big" reduced={reduced} />}</AnimatePresence>
      <FullscreenPlayer />
      <SheetHost mode="phone" />
      <Toasts />
    </div>
  );
}

const SCREEN_VARIANTS = {
  enter: (a: { kind: 'forward' | 'back' | 'fade'; reduced: boolean }) => (a.kind === 'fade' || a.reduced ? { opacity: 0, x: 0 } : { x: a.kind === 'forward' ? 72 : -48, opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (a: { kind: 'forward' | 'back' | 'fade'; reduced: boolean }) => (a.kind === 'fade' || a.reduced ? { opacity: 0, x: 0 } : { x: a.kind === 'forward' ? -48 : 72, opacity: 0 }),
};

function ScreenSwitch({ route }: { route: Route }) {
  switch (route.screen) {
    case 'agenda':
      return route.param ? <AgendaScreen param={route.param} /> : <DirectoScreen />;
    case 'partido':
      return route.param ? <MatchScreen id={route.param} /> : <DirectoScreen />;
    case 'canal':
      return route.param ? <ChannelScreen id={route.param} title={route.sub} /> : <CanalesScreen tab={null} />;
    case 'biblioteca':
      return <CanalesScreen tab={route.param as LibTab | null} />;
    case 'buscar':
      return <BuscarScreen />;
    case 'ajustes':
      return <AjustesScreen section={route.param as SettingsId | null} />;
    case 'gustos':
      return <GustosScreen />;
    default:
      return <DirectoScreen />;
  }
}

/* ---------- barras de navegación ---------- */
function LargeNav({ title, sub, right, children }: { title: string; sub?: string; right?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="pz-ip-nav">
      <div className="pz-ip-nav-row">
        <h1>
          {title}
          {sub && <small>{sub}</small>}
        </h1>
        <div style={{ display: 'flex', gap: 2 }}>{right}</div>
      </div>
      {children}
    </div>
  );
}

function InlineNav({ title, sub, right, fallback = 'agenda' }: { title: string; sub?: string; right?: React.ReactNode; fallback?: 'agenda' | 'biblioteca' | 'ajustes' }) {
  return (
    <div className="pz-ip-nav pz-ip-nav--inline">
      <div className="pz-ip-nav-row">
        <button type="button" className="pz-ip-back" onClick={() => back(fallback)} aria-label="Atrás">
          <IChevronLeft size={22} />
        </button>
        <h1>
          <span className="pz-ellipsis">{title}</span>
          {sub && <small className="pz-ellipsis">{sub}</small>}
        </h1>
        <span style={{ justifySelf: 'end' }}>{right}</span>
      </div>
    </div>
  );
}

function DensityButton() {
  const density = useUi((u) => u.density);
  return (
    <button type="button" className="pz-tap" onClick={toggleDensity} aria-label={density === 'comodo' ? 'Pasar a Compacto' : 'Pasar a Cómodo'}>
      {density === 'comodo' ? <IDensity size={20} /> : <IDensityLoose size={20} />}
    </button>
  );
}

/* ---------- Directo ---------- */
function DirectoScreen() {
  const live = useLiveMatches();
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const today = new Date(nowMs).toDateString();
  const todays = useMemo(() => agenda.filter((m) => new Date(m.start).toDateString() === today), [agenda, today]);
  usePrewarm(live);
  const upcoming = todays.filter((m) => scoreAt(m, nowMs).state === 'pre').sort((a, b) => a.start - b.start);
  const finished = todays.filter((m) => scoreAt(m, nowMs).state === 'post').sort((a, b) => b.start - a.start);
  return (
    <>
      <LargeNav title="Directo" sub={live.length ? `${live.length} en juego` : hhmm(nowMs)} right={<DensityButton />} />
      <div className="pz-scroll">
        {live.length ? (
          <div className="pz-ip-directo">
            {live.map((m) => (
              <Scoreboard key={m.id} match={m} size="tile" timeline compactMeta onClick={() => navigate('partido', m.id)} />
            ))}
          </div>
        ) : (
          <Empty
            title="Nada en directo ahora mismo"
            text={upcoming[0] ? `El siguiente empieza ${untilText(upcoming[0].start, nowMs).toLowerCase()}: ${matchTitle(upcoming[0])}.` : 'Hoy ya no queda nada por empezar.'}
            center
            icon={<ILive size={20} />}
            actions={
              <button type="button" className="pz-btn" onClick={() => navigate('agenda', 'hoy')}>
                Ver la agenda
              </button>
            }
          />
        )}
        {upcoming.length > 0 && (
          <div className="pz-ip-directo-sub">
            <div className="pz-sect" style={{ position: 'static' }}>
              Próximos hoy <span>{upcoming.length}</span>
            </div>
            {upcoming.map((m) => (
              <MatchRow key={m.id} match={m} onClick={() => navigate('partido', m.id)} wide />
            ))}
          </div>
        )}
        {finished.length > 0 && (
          <div className="pz-ip-directo-sub">
            <div className="pz-sect" style={{ position: 'static' }}>
              Terminados hoy <span>{finished.length}</span>
            </div>
            {finished.map((m) => (
              <MatchRow key={m.id} match={m} onClick={() => navigate('partido', m.id)} wide />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* ---------- Agenda ---------- */
function AgendaScreen({ param }: { param: string }) {
  const nowMs = useNow();
  const filter = useUi((u) => u.filter);
  const days = useDays();
  const dayIso = resolveDay(param, nowMs);
  const matches = useDayMatches(dayIso, filter);
  const prefs = useSim((s) => s.preferences);
  const hasPrefs = prefs.leagues.length + prefs.teams.length + prefs.nationalities.length > 0;
  usePrewarm(matches.all);
  const groups = useMemo(() => groupByCompetition(matches.list, nowMs), [matches.list, nowMs]);
  const current = days.find((d) => d.iso === dayIso);
  const goDay = (iso: string) => navigate('agenda', iso, null, { replace: true });
  return (
    <>
      <LargeNav title="Agenda" sub={current?.rel === 'hoy' ? 'hoy' : current ? `${current.short} ${current.num}` : undefined} right={<DensityButton />}>
        <div className="pz-days" role="tablist" aria-label="Días">
          {days.map((d) => (
            <button key={d.iso} type="button" role="tab" aria-selected={d.iso === dayIso} className={`pz-day${d.iso === dayIso ? ' is-on' : ''}${d.rel === 'hoy' ? ' is-today' : ''}`} onClick={() => goDay(d.iso)}>
              {d.live > 0 && <i className="pz-day-live" />}
              <small>{d.rel === 'hoy' ? 'Hoy' : d.rel === 'ayer' ? 'Ayer' : d.rel === 'mañana' ? 'Mañ' : d.short}</small>
              <b>{d.num}</b>
            </button>
          ))}
        </div>
        <div className="pz-filterbar">
          <Segmented value={filter} onChange={setFilter} options={[{ id: 'para-ti', label: 'Para ti', count: matches.forYouCount }, { id: 'todos', label: 'Todos', count: matches.all.length }]} label="Filtro" />
          <span className="pz-livecount">
            <i className="pz-dot pz-dot--pulse pz-anim" />
            {matches.live.length} en directo
          </span>
        </div>
      </LargeNav>
      <div className="pz-scroll">
        {!hasPrefs && (
          <div className="pz-firstuse">
            <b>Personaliza tu pizarra</b>
            <p>Dinos tus ligas y equipos y «Para ti» enseñará solo eso.</p>
            <div className="pz-firstuse-actions">
              <button type="button" className="pz-btn pz-btn--sm pz-btn--primary" onClick={() => navigate('gustos')}>
                Personalizar
              </button>
            </div>
          </div>
        )}
        {groups.map((g) => (
          <div key={g.comp.id}>
            <div className="pz-sect">
              {g.comp.name}
              <span>{g.matches.length}</span>
            </div>
            {g.matches.map((m) => (
              <MatchRow key={m.id} match={m} onClick={() => navigate('partido', m.id)} wide />
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
    </>
  );
}

/* ---------- Centro de partido ---------- */
function MatchScreen({ id }: { id: string }) {
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
      <>
        <InlineNav title="Partido" />
        <div className="pz-scroll">
          <Empty title="Partido no encontrado" text="Puede que ya no esté en la agenda." />
        </div>
      </>
    );
  }
  const comp = competition(match.competition);
  return (
    <>
      <InlineNav
        title={matchShort(match)}
        sub={`${comp.name}${match.round ? ` · ${match.round}` : ''}`}
        right={
          <button type="button" className="pz-tap" aria-label="Más" onClick={() => openSheet({ type: 'match-actions', kind: 'match', id })}>
            <IMore size={20} />
          </button>
        }
      />
      <div className="pz-scroll">
        <div className="pz-ip-match">
          <Scoreboard match={match} size="phone" />
          {isTarget ? (
            <div className="pz-player">
              <Video onTap={() => setExpanded(true)} />
              <Controls variant="phone" />
              <StatusLine />
            </div>
          ) : (
            <div className="pz-prevideo" style={{ aspectRatio: 'auto', padding: '14px 16px' }}>
              <b>{live ? 'Preparando la señal…' : score.state === 'pre' ? `Empieza ${untilText(match.start, nowMs).toLowerCase()}` : 'El partido ha terminado'}</b>
              <p>{score.state === 'pre' ? 'Las fuentes se comprueban 45 minutos antes.' : 'Puedes ver el canal igualmente.'}</p>
              <button type="button" className="pz-btn pz-btn--primary pz-btn--lg" onClick={() => openTarget('match', id)}>
                <IPlay size={16} /> Ver el canal ahora
              </button>
            </div>
          )}
          <SourceRack kind="match" id={id} mode="phone" />
          <div className="pz-ip-where">
            <h2 className="pz-h2" style={{ margin: 0, fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--pz-ink-3)' }}>
              Dónde se emite
            </h2>
            <div className="pz-where">
              {match.channels.map((c) => (
                <span key={c.id} className="pz-chip">
                  <ChannelMark name={c.name} size={20} radius={4} />
                  {c.name}
                </span>
              ))}
              {match.venue && (
                <span className="pz-dim" style={{ fontSize: 12 }}>
                  {match.venue}
                </span>
              )}
            </div>
          </div>
          {isTarget && (
            <button type="button" className="pz-btn pz-btn--lg pz-btn--block" onClick={() => stop()}>
              <IStop size={16} /> Detener
            </button>
          )}
        </div>
      </div>
    </>
  );
}

/* ---------- Canal suelto ---------- */
function ChannelScreen({ id, title }: { id: string; title: string | null }) {
  const libItem = useSim((s) => s.favorites.find((i) => i.id === id) ?? s.history.find((i) => i.id === id) ?? null);
  const known = libItem ?? itemById(id) ?? null;
  const name = known?.title ?? title ?? 'Enlace pegado';
  const fav = useSim(() => isFavorite(id));
  const on = useMatchOnChannel(known ? known.title : null);
  const isTarget = useSim((s) => s.player.target?.kind === 'channel' && s.player.target.id === id);
  const signal = useSignal('channel', id);
  useEffect(() => {
    playChannel(id);
  }, [id]);
  return (
    <>
      <InlineNav
        title={name}
        sub={libItem ? (libItem.type === 'fav' ? 'En tus favoritos' : 'En tus recientes') : known ? 'De tus listas' : 'Fuera de tu biblioteca'}
        fallback="biblioteca"
        right={
          <button type="button" className={`pz-tap${fav ? ' pz-tone-weak' : ''}`} aria-label={fav ? 'Quitar de favoritos' : 'Guardar en favoritos'} onClick={() => toggleFavorite(id, name)}>
            <IStar size={20} filled={fav} />
          </button>
        }
      />
      <div className="pz-scroll">
        <div className="pz-ip-match">
          <div className="pz-channel-head" style={{ display: 'grid', gridTemplateColumns: '44px minmax(0,1fr) auto', gap: 12, alignItems: 'center' }}>
            <ChannelMark name={name} size={44} radius={8} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: '-0.01em' }} className="pz-ellipsis">
                {name}
              </div>
              <div className="pz-dim" style={{ fontSize: 12 }}>
                {known?.category ?? (title ? 'Solo en esta sesión' : 'Canal')}
              </div>
            </div>
            <Meter kind={signal.kind} word label={signal.text} />
          </div>
          {isTarget ? (
            <div className="pz-player">
              <Video onTap={() => setExpanded(true)} />
              <Controls variant="phone" />
              <StatusLine />
            </div>
          ) : (
            <div className="pz-prevideo">
              <b>Conectando…</b>
            </div>
          )}
          {on && (
            <div style={{ display: 'grid', gap: 8 }}>
              <div className="pz-label">{on.live ? 'Ahora en este canal' : `A las ${hhmm(on.match.start)} en este canal`}</div>
              <Scoreboard match={on.match} size="tile" timeline={on.live} compactMeta onClick={() => navigate('partido', on.match.id)} />
            </div>
          )}
          <SourceRack kind="channel" id={id} mode="phone" title="Fuentes del canal" />
        </div>
      </div>
    </>
  );
}

/* ---------- Canales (biblioteca) ---------- */
function CanalesScreen({ tab }: { tab: LibTab | null }) {
  const def = useDefaultLibTab();
  const t = tab && ['favoritos', 'recientes', 'listas'].includes(tab) ? tab : def;
  const selectedId = useSim((s) => (s.player.target?.kind === 'channel' ? s.player.target.id : null));
  return (
    <>
      <LargeNav
        title="Canales"
        right={
          <button type="button" className="pz-tap" aria-label="Gestionar listas" onClick={() => navigate('ajustes', 'listas')}>
            <IGear size={20} />
          </button>
        }
      />
      <div className="pz-scroll">
        <Library mode="phone" tab={t} onTab={(x) => navigate('biblioteca', x, null, { replace: true })} selectedId={selectedId} />
      </div>
    </>
  );
}

/* ---------- Buscar ---------- */
function BuscarScreen() {
  const selectedId = useSim((s) => (s.player.target?.kind === 'channel' ? s.player.target.id : null));
  return (
    <>
      <LargeNav title="Buscar" />
      <div className="pz-scroll">
        <Search mode="phone" selectedId={selectedId} />
      </div>
    </>
  );
}

/* ---------- Ajustes ---------- */
function AjustesScreen({ section }: { section: SettingsId | null }) {
  const meta = section ? SETTINGS_SECTIONS.find((s) => s.id === section) : undefined;
  if (meta) {
    return (
      <>
        <InlineNav title={meta.label} fallback="ajustes" />
        <div className="pz-scroll pz-ip-settings" style={{ paddingTop: 12 }}>
          <SettingsSection id={meta.id} mode="phone" />
        </div>
      </>
    );
  }
  return (
    <>
      <LargeNav title="Ajustes" />
      <div className="pz-scroll pz-ip-settings">
        <HealthTiles onOpen={() => navigate('ajustes', 'salud')} />
        <SettingsIndex mode="phone" current={null} onSelect={(id) => navigate('ajustes', id)} />
        <p className="pz-dim" style={{ margin: '0 24px', fontSize: 12, lineHeight: 1.4 }}>
          Ace Player Neo · Pizarra · Todo es una simulación: no hay servidor.
        </p>
      </div>
    </>
  );
}

function GustosScreen({ first }: { first?: boolean }) {
  return (
    <div className={`pz-ip-screen${first ? ' pz-ip-screen--full' : ''}`}>
      {first ? <LargeNav title="¿Qué fútbol te mueve?" sub="Paso 2 de 2" /> : <InlineNav title="Tu fútbol" fallback="ajustes" />}
      <div className="pz-scroll">
        <Gustos mode="phone" firstUse={first} onDone={() => (first ? navigate('agenda', null, null, { replace: true }) : back('ajustes'))} />
      </div>
    </div>
  );
}

/* ---------- Emparejar (primer uso) ---------- */
function PairScreen() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submit = () => {
    const r = claimPairing(code);
    if (r === 'invalid') setErr('El código son 6 cifras. Míralo en la web: Ajustes › Dispositivos.');
  };
  const press = (k: string) => {
    setErr(null);
    if (k === 'del') setCode((c) => c.slice(0, -1));
    else if (code.length < 6) setCode((c) => c + k);
  };
  return (
    <div className="pz-ip-screen pz-ip-screen--full">
      <LargeNav title="Emparejar" sub="Paso 1 de 2" />
      <div className="pz-scroll">
        <div className="pz-ip-pair">
          <div className="pz-ip-pair-mark" aria-hidden="true">
            PZ
          </div>
          <h2>Empareja este iPhone</h2>
          <p>En la web de Ace Player Neo abre Ajustes › Dispositivos y crea un código. Caduca a los 5 minutos y solo sirve una vez.</p>
          <button type="button" className="pz-btn pz-btn--primary pz-btn--lg pz-btn--block" onClick={() => openSheet({ type: 'scan' })}>
            <IQr size={18} /> Escanear el código QR
          </button>
          <div className="pz-label">o escribe el código</div>
          <div className="pz-codeinput" role="group" aria-label="Código de 6 cifras" onClick={() => inputRef.current?.focus()}>
            {Array.from({ length: 6 }).map((_, i) => (
              <span key={i} className={code.length === i ? 'is-cursor' : ''}>
                {code[i] ?? ''}
              </span>
            ))}
          </div>
          <input
            ref={inputRef}
            className="pz-codeinput-hidden"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => {
              setErr(null);
              setCode(e.target.value.replace(/\D/g, '').slice(0, 6));
            }}
            aria-label="Código de emparejamiento"
          />
          <div className="pz-keypad" aria-hidden="true">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'].map((k, i) =>
              k === '' ? (
                <span key={`hueco-${i}`} />
              ) : (
                <button key={`tecla-${k}`} type="button" tabIndex={-1} onClick={() => press(k)}>
                  {k === 'del' ? '⌫' : k}
                </button>
              ),
            )}
          </div>
          {err && <span className="pz-hint is-err">{err}</span>}
          <button type="button" className="pz-btn pz-btn--lg pz-btn--block" onClick={submit} disabled={code.length !== 6}>
            Emparejar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- tab bar ---------- */
function TabBar({ route }: { route: Route }) {
  const tab = tabOfRoute(route);
  const live = useLiveMatches().length;
  const tabs: { id: Tab; label: string; Icon: (p: { size?: number }) => React.ReactNode; go: () => void }[] = [
    { id: 'directo', label: 'Directo', Icon: ILive, go: () => navigate('agenda') },
    { id: 'agenda', label: 'Agenda', Icon: ICalendar, go: () => navigate('agenda', 'hoy') },
    { id: 'canales', label: 'Canales', Icon: IChannels, go: () => navigate('biblioteca') },
    { id: 'buscar', label: 'Buscar', Icon: ISearch, go: () => navigate('buscar') },
    { id: 'ajustes', label: 'Ajustes', Icon: IGear, go: () => navigate('ajustes') },
  ];
  return (
    <nav className="pz-ip-tabbar" aria-label="Pestañas">
      <div className="pz-ip-tabs">
        {tabs.map((t) => (
          <button key={t.id} type="button" className={`pz-ip-tab${tab === t.id ? ' is-on' : ''}`} onClick={t.go} aria-current={tab === t.id ? 'page' : undefined}>
            {t.id === 'directo' && live > 0 && <i className="pz-ip-tab-live" aria-hidden="true" />}
            <t.Icon size={22} />
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

/* ---------- borde izquierdo: volver ---------- */
function EdgeBack() {
  const x = useMotionValue(0);
  return <motion.div className="pz-ip-edge" style={{ x }} drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.5} dragSnapToOrigin onDragEnd={(_, info) => { if (info.offset.x > 70 || info.velocity.x > 500) back(); }} aria-hidden="true" />;
}

/* ---------- mini reproductor ---------- */
function Mini() {
  const p = useSim((s) => s.player);
  const src = useActiveSource();
  const match = useSim((s) => (s.player.target?.kind === 'match' ? s.agenda.find((m) => m.id === s.player.target!.id) : undefined));
  const nowMs = useNow();
  const hidden = useScoreHidden(match?.id ?? null);
  const y = useMotionValue(0);
  const dragged = useRef(false);
  const s = match ? scoreAt(match, nowMs) : null;
  const phase = p.conn === 'activa' ? (p.media === 'playing' ? 'Sonando' : 'En pausa') : p.conn === 'reconectando' ? 'Reconectando' : p.conn === 'error' ? 'Sin señal' : p.conn === 'idle' ? 'Buscando señal' : 'Conectando';
  return (
    <motion.div
      className="pz-ip-mini"
      style={{ y }}
      drag="y"
      dragConstraints={{ top: -48, bottom: 0 }}
      dragElastic={0.15}
      dragSnapToOrigin
      onDragStart={() => {
        dragged.current = true;
      }}
      onDragEnd={(_, info) => {
        if (info.offset.y < -36 || info.velocity.y < -300) setExpanded(true);
        setTimeout(() => {
          dragged.current = false;
        }, 60);
      }}
      onClick={() => {
        if (!dragged.current) setExpanded(true);
      }}
      role="button"
      tabIndex={0}
      aria-label={`Abrir el reproductor · ${p.target?.title ?? ''}`}
      onKeyDown={(e) => e.key === 'Enter' && setExpanded(true)}
    >
      <div className="pz-ip-mini-thumb">
        <Video badges={false} />
      </div>
      <div className="pz-ip-mini-txt">
        <b>
          {match && s ? (
            <>
              <span className="pz-cond">
                {team(match.home).short} {hidden || s.state === 'pre' ? '–' : `${s.home}–${s.away}`} {team(match.away).short}
              </span>
              {s.state === 'in' && <span className="min">{s.halftime ? 'DESC' : s.clock}</span>}
            </>
          ) : (
            <span className="pz-ellipsis">{p.target?.title}</span>
          )}
        </b>
        <small>
          {phase}
          {src ? ` · ${src.matchedChannel} ${src.resolution}` : ''}
        </small>
      </div>
      {src && <Meter kind={sourceKind(src)} />}
      <button
        type="button"
        className="pz-tap"
        onClick={(e) => {
          e.stopPropagation();
          togglePlay();
        }}
        aria-label={p.media === 'playing' ? 'Pausa' : 'Reproducir'}
      >
        {p.conn === 'activa' && p.media === 'playing' ? <IPause size={22} /> : <IPlay size={22} />}
      </button>
    </motion.div>
  );
}

/* ---------- reproductor grande ---------- */
function BigPlayer({ reduced }: { reduced: boolean }) {
  const p = useSim((s) => s.player);
  const src = useActiveSource();
  const match = useSim((s) => (s.player.target?.kind === 'match' ? s.agenda.find((m) => m.id === s.player.target!.id) : undefined));
  const controls = useDragControls();
  const y = useMotionValue(0);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const kind = p.target?.kind ?? 'channel';
  const id = p.target?.id ?? '';
  const idx = useSim((s) => {
    const t = s.player.target;
    if (!t?.sourceId) return 0;
    const list = s.sourceSessions[`${t.kind}:${t.id}`]?.sources.filter((x) => x.state !== 'failed') ?? [];
    return list.findIndex((x) => x.id === t.sourceId) + 1;
  });
  const close = () => setExpanded(false);
  return (
    <motion.div
      className="pz-ip-big"
      style={{ y }}
      initial={reduced ? { opacity: 0 } : { y: '100%' }}
      animate={reduced ? { opacity: 1 } : { y: 0 }}
      exit={reduced ? { opacity: 0 } : { y: '100%' }}
      transition={{ duration: reduced ? 0.1 : 0.24, ease: [0.2, 0.8, 0.2, 1] }}
      drag="y"
      dragListener={false}
      dragControls={controls}
      dragConstraints={{ top: 0 }}
      dragElastic={0.04}
      dragSnapToOrigin
      onDragEnd={(_, info) => {
        if (info.offset.y > 120 || info.velocity.y > 500) close();
        else animate(y, 0, { duration: 0.18 });
      }}
      role="dialog"
      aria-label="Reproductor"
    >
      <div className="pz-ip-big-head" onPointerDown={(e) => controls.start(e)}>
        <div className="pz-sheet-handle" aria-hidden="true">
          <i />
        </div>
        <button type="button" className="pz-tap" onClick={close} aria-label="Minimizar" onPointerDown={(e) => e.stopPropagation()}>
          <IChevronDown size={22} />
        </button>
        <div className="pz-ip-big-title">
          <span className="pz-label">
            <i className={`pz-dot${p.conn === 'activa' && p.media === 'playing' ? ' pz-dot--pulse pz-anim' : ''}`} style={{ color: p.conn === 'error' ? 'var(--pz-fail)' : p.conn === 'activa' ? 'var(--pz-ok)' : 'var(--pz-weak)' }} />
            {p.conn === 'activa' ? 'En pantalla' : p.conn === 'reconectando' ? 'Reconectando' : p.conn === 'error' ? 'Sin señal' : p.conn === 'idle' ? 'Buscando señal' : 'Conectando'}
            {idx ? ` · Fuente ${idx}` : ''}
            {src ? ` · ${src.listaName}` : ''}
          </span>
          <b>{p.target?.title}</b>
        </div>
        <button type="button" className="pz-tap" onClick={() => openSheet({ type: 'match-actions', kind, id })} aria-label="Más" onPointerDown={(e) => e.stopPropagation()}>
          <IMore size={20} />
        </button>
      </div>
      <div
        className="pz-ip-big-video"
        onPointerDown={(e) => {
          swipe.current = { x: e.clientX, y: e.clientY };
          controls.start(e);
        }}
        onPointerUp={(e) => {
          const st = swipe.current;
          swipe.current = null;
          if (!st) return;
          const dx = e.clientX - st.x;
          const dy = e.clientY - st.y;
          if (Math.abs(dx) > 70 && Math.abs(dy) < 40 && p.conn === 'activa') zap(dx < 0 ? 1 : -1);
        }}
      >
        <Video onTap={togglePlay} />
      </div>
      <div className="pz-ip-big-body">
        <div>
          <Controls variant="phone" />
          <StatusLine />
        </div>
        {match && (
          <div style={{ padding: '0 12px' }}>
            <Scoreboard match={match} size="phone" meta={false} />
          </div>
        )}
        {p.target && <SourceRack kind={kind} id={id} mode="phone" compact />}
        <button
          type="button"
          className="pz-btn pz-btn--lg pz-ip-stop"
          onClick={() => {
            stop();
            close();
          }}
        >
          <IStop size={16} /> Detener
        </button>
      </div>
    </motion.div>
  );
}

export function useMatchTitle(m: Match | undefined) {
  return m ? matchTitle(m) : '';
}
