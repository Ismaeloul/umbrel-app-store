import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useMotionValue } from 'motion/react';
import './tokens.css';
import './tribuna.css';
import { back, navigate, tabOf, useRoute } from '../../core/router';
import { claimPairing, derivePhase, isEngaged, setExpanded, stop, togglePlay, useSim } from '../../core/store';
import { FakeVideo } from '../../core/video/FakeVideo';
import { I } from './shared/icons';
import { useAgenda } from './shared/useAgenda';
import { MatchRow } from './shared/MatchRow';
import { ChannelCenter, MatchCenter } from './shared/MatchCenter';
import { ChannelRow, DirectoryPicker, OnAirStrip, useLibraryLists, type LibTab } from './shared/Library';
import { SearchResults } from './shared/Search';
import { AboutSection, AppearanceSection, Cell, DevicesSection, DirectoriesSection, Group, HealthSection, PlaybackSection, Segmented, WherePlayingSection } from './shared/settings';
import { PrefsSheet } from './shared/Sheets';
import { Toasts } from './shared/Toasts';
import { phaseWord, useVideoProps, VideoStage, StatusLineView } from './shared/Player';
import { hhmm, longDate } from '../../core/format';

/* Propuesta 1 · Tribuna · iPhone. TabView de 3 pestañas + búsqueda, mini como
   accesorio de la tab bar, reproductor grande como cubierta a pantalla completa. */

type Tab = 'agenda' | 'biblioteca' | 'buscar' | 'ajustes';
const TABS: { id: Tab; label: string; icon: (p: { filled?: boolean; size?: number }) => ReactNode }[] = [
  { id: 'agenda', label: 'Partidos', icon: (p) => <I.Calendar {...p} /> },
  { id: 'biblioteca', label: 'Canales', icon: (p) => <I.Tv {...p} /> },
  { id: 'ajustes', label: 'Ajustes', icon: (p) => <I.Gear {...p} /> },
];

export default function Iphone() {
  const route = useRoute();
  const paired = useSim((s) => s.paired);
  const firstUse = useSim((s) => s.firstUse);
  const onboarding = useSim((s) => s.preferences.onboardingComplete);
  const player = useSim((s) => s.player);
  const [minimized, setMinimized] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const tab = tabOf(route.screen);
  const pushed = route.screen === 'partido' || route.screen === 'canal' || (route.screen === 'ajustes' && !!route.param) || route.screen === 'gustos';
  const engaged = isEngaged(player);
  const showMini = engaged && !player.expanded;

  useEffect(() => {
    if (!paired && route.screen !== 'emparejar') navigate('emparejar', null, null, { replace: true });
    if (paired && route.screen === 'emparejar') navigate('agenda', null, null, { replace: true });
  }, [paired, route.screen]);

  useEffect(() => {
    if (paired && firstUse && !onboarding) setPrefs(true);
  }, [paired, firstUse, onboarding]);

  if (!paired || route.screen === 'emparejar') return <PairingScreen />;

  return (
    <div className="tb-phone" data-minimized={minimized}>
      <div className="tb-phone__screens">
        <AnimatePresence initial={false} custom={route.direction} mode="popLayout">
          <motion.div
            key={`${route.screen}/${route.param ?? ''}`}
            className="tb-screen-anim"
            custom={route.direction}
            variants={screenVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ type: 'spring', duration: 0.42, bounce: 0 }}
            drag={pushed ? 'x' : false}
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={{ left: 0, right: 0.35 }}
            dragDirectionLock
            onDragEnd={(_, info) => {
              if (pushed && (info.offset.x > 90 || info.velocity.x > 500)) back();
            }}
          >
            <ScreenSwitch onScrollDir={setMinimized} onPrefs={() => setPrefs(true)} />
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="tb-tabwrap" style={{ ['--mini' as string]: showMini ? 1 : 0 }}>
        {showMini && <MiniAccessory minimized={minimized} />}
        <nav className={`tb-tabbar${minimized ? ' is-min' : ''}`} aria-label="Pestañas">
          <div className="tb-tabbar__pill">
            {TABS.map((t) => {
              const on = tab === t.id;
              if (minimized && !on) return null;
              return (
                <button key={t.id} type="button" className={`tb-tab${on ? ' is-on' : ''}`} onClick={() => { navigate(t.id === 'agenda' ? 'agenda' : t.id === 'biblioteca' ? 'biblioteca' : 'ajustes'); setMinimized(false); }} aria-current={on ? 'page' : undefined}>
                  {t.icon({ filled: on, size: 24 })}
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>
          <button type="button" className={`tb-tabbar__search${tab === 'buscar' ? ' is-on' : ''}`} onClick={() => navigate('buscar')} aria-label="Buscar" aria-current={tab === 'buscar' ? 'page' : undefined}>
            <I.Search size={22} />
          </button>
        </nav>
      </div>

      <AnimatePresence>{player.expanded && engaged && <BigPlayer key="big" />}</AnimatePresence>
      <PrefsSheet open={prefs} onClose={() => setPrefs(false)} firstUse={!onboarding} />
      <Toasts bottom="calc(var(--safe-bottom) + 84px + var(--mini, 0) * 60px)" />
    </div>
  );
}

const screenVariants = {
  enter: (d: string) => ({ x: d === 'forward' ? '100%' : d === 'back' ? '-24%' : 0, opacity: d === 'back' ? 0.6 : 1 }),
  center: { x: 0, opacity: 1 },
  exit: (d: string) => ({ x: d === 'forward' ? '-24%' : d === 'back' ? '100%' : 0, opacity: d === 'forward' ? 0.6 : 1 }),
};

function ScreenSwitch({ onScrollDir, onPrefs }: { onScrollDir: (min: boolean) => void; onPrefs: () => void }) {
  const route = useRoute();
  switch (route.screen) {
    case 'partido':
      return <Push title=""><MatchCenter matchId={route.param!} layout="phone" /></Push>;
    case 'canal':
      return <Push title=""><ChannelCenter channelId={route.param!} layout="phone" /></Push>;
    case 'biblioteca':
      return <LibraryScreen onScrollDir={onScrollDir} />;
    case 'buscar':
      return <SearchScreen />;
    case 'ajustes':
      return route.param ? <SettingsSub section={route.param} /> : <SettingsScreen onPrefs={onPrefs} />;
    default:
      return <AgendaScreen onScrollDir={onScrollDir} onPrefs={onPrefs} />;
  }
}

/** Contenedor con scroll que avisa de la dirección para recoger la tab bar. */
function Scroll({ children, onScrollDir, className = '' }: { children: ReactNode; onScrollDir?: (min: boolean) => void; className?: string }) {
  const last = useRef(0);
  return (
    <div
      className={`tb-scroll ${className}`}
      onScroll={(e) => {
        if (!onScrollDir) return;
        const y = e.currentTarget.scrollTop;
        if (y < 24) onScrollDir(false);
        else if (y > last.current + 6) onScrollDir(true);
        else if (y < last.current - 6) onScrollDir(false);
        last.current = y;
      }}
    >
      {children}
    </div>
  );
}

function LargeTitle({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <header className="tb-largetitle">
      <div>
        {sub && <span className="tb-largetitle__sub">{sub}</span>}
        <h1>{title}</h1>
      </div>
      {right}
    </header>
  );
}

function Push({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="tb-push">
      <header className="tb-navbar">
        <button type="button" className="tb-navbar__back" onClick={() => back()} aria-label="Atrás">
          <I.Chevron dir="l" size={22} />
          <span>Atrás</span>
        </button>
        <span className="tb-navbar__title">{title}</span>
        <span className="tb-navbar__right">{right}</span>
      </header>
      <Scroll className="tb-scroll--push">{children}</Scroll>
    </div>
  );
}

// ---------------------------------------------------------------- Partidos

function AgendaScreen({ onScrollDir, onPrefs }: { onScrollDir: (m: boolean) => void; onPrefs: () => void }) {
  const a = useAgenda();
  const onboarding = useSim((s) => s.preferences.onboardingComplete);
  const day = a.days.find((d) => d.key === a.dayKey)!;
  const sub = day.rel === 'hoy' ? longDate(day.ms) : day.rel === 'mañana' ? `Mañana, ${longDate(day.ms)}` : longDate(day.ms);
  return (
    <Scroll onScrollDir={onScrollDir}>
      <LargeTitle title="Partidos" sub={sub.charAt(0).toUpperCase() + sub.slice(1)} right={a.hasPrefs ? <ScopeMenu a={a} /> : undefined} />
      <div className="tb-days" role="tablist" aria-label="Día">
        {a.days.map((d) => (
          <button key={d.key} type="button" role="tab" aria-selected={d.key === a.dayKey} className={`tb-day${d.key === a.dayKey ? ' is-on' : ''}${d.rel === 'hoy' ? ' is-today' : ''}`} onClick={() => a.setDayKey(d.key)}>
            <span className="tb-day__name">{d.rel === 'hoy' ? 'Hoy' : d.rel === 'ayer' ? 'Ayer' : d.short}</span>
            <span className="tb-day__num">{d.num}</span>
            {d.live > 0 && <i className="tb-day__live" aria-label={`${d.live} en directo`} />}
          </button>
        ))}
      </div>
      {!onboarding && (
        <div className="tb-firstuse">
          <I.Heart size={22} />
          <div>
            <strong>Tu fútbol, primero</strong>
            <span>Elige tus ligas y equipos y «Para ti» enseñará solo eso.</span>
          </div>
          <button type="button" className="tb-btn tb-btn--primary tb-btn--sm" onClick={onPrefs}>
            Elegir
          </button>
        </div>
      )}
      <AgendaGroups a={a} onPrefs={onPrefs} />
      <p className="tb-foot">Horario peninsular · actualizado a las {hhmm(a.now)}</p>
    </Scroll>
  );
}

function ScopeMenu({ a }: { a: ReturnType<typeof useAgenda> }) {
  return <Segmented<'mine' | 'all'> value={a.scope} onChange={a.setScope} label="Qué partidos ver" items={[{ value: 'mine', label: 'Para ti' }, { value: 'all', label: 'Todos' }]} />;
}

export function AgendaGroups({ a, onPrefs, compact = false, selected }: { a: ReturnType<typeof useAgenda>; onPrefs: () => void; compact?: boolean; selected?: string | null }) {
  if (a.groups.length === 0) {
    const forYou = a.scope === 'mine';
    return (
      <div className="tb-empty">
        <I.Calendar size={28} />
        <strong>{forYou ? 'Nada de lo tuyo este día' : 'Sin partidos anunciados'}</strong>
        <span>{forYou ? 'No hay partidos de tus ligas, equipos o selecciones.' : 'Prueba con otro día.'}</span>
        {forYou && (
          <div className="tb-sheet__actions">
            <button type="button" className="tb-btn tb-btn--tint" onClick={onPrefs}>Editar mis gustos</button>
            <button type="button" className="tb-btn tb-btn--primary" onClick={() => a.setScope('all')}>Ver todos</button>
          </div>
        )}
      </div>
    );
  }
  return (
    <>
      {a.groups.map((g) => (
        <section key={g.id} className="tb-group">
          <h3 className="tb-group__title">{g.name} <span>{g.country}</span></h3>
          <div className="tb-cells tb-cells--rows">
            {g.matches.map((vm) => (
              <MatchRow key={vm.match.id} vm={vm} compact={compact} selected={selected === vm.match.id} onOpen={() => navigate('partido', vm.match.id)} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

// ---------------------------------------------------------------- Canales

function LibraryScreen({ onScrollDir }: { onScrollDir: (m: boolean) => void }) {
  const route = useRoute();
  const lib = useLibraryLists();
  const initial: LibTab = (route.param as LibTab) || (lib.favorites.length ? 'favoritos' : lib.history.length ? 'recientes' : 'listas');
  const [tab, setTab] = useState<LibTab>(initial);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <Scroll onScrollDir={onScrollDir}>
      <LargeTitle title="Canales" />
      <div className="tb-pad">
        <Segmented<LibTab> value={tab} onChange={setTab} label="Sección" items={[{ value: 'favoritos', label: 'Favoritos' }, { value: 'recientes', label: 'Recientes' }, { value: 'listas', label: 'Listas' }]} />
      </div>
      <OnAirStrip />
      {tab === 'favoritos' && (
        <section className="tb-group">
          {lib.favorites.length === 0 ? (
            <div className="tb-empty">
              <I.Star size={28} />
              <strong>Aún no tienes favoritos</strong>
              <span>Guarda un canal con la estrella y aparecerá aquí.</span>
              <button type="button" className="tb-btn tb-btn--primary" onClick={() => setTab('listas')}>Ver las listas</button>
            </div>
          ) : (
            <ul className="tb-list" role="list">
              {lib.favorites.map((it) => <ChannelRow key={it.id} item={it} context="favoritos" />)}
            </ul>
          )}
        </section>
      )}
      {tab === 'recientes' &&
        (lib.recentsGrouped.length === 0 ? (
          <div className="tb-empty">
            <I.Clock size={28} />
            <strong>Aún no has visto nada</strong>
            <span>Lo que reproduzcas irá quedando aquí.</span>
            <button type="button" className="tb-btn tb-btn--primary" onClick={() => navigate('agenda')}>Ir a los partidos</button>
          </div>
        ) : (
          lib.recentsGrouped.map((g) => (
            <section key={g.label} className="tb-group">
              <h3 className="tb-group__title">{g.label}</h3>
              <ul className="tb-list" role="list">
                {g.items.map((it) => <ChannelRow key={it.id} item={it} context="recientes" />)}
              </ul>
            </section>
          ))
        ))}
      {tab === 'listas' && (
        <>
          <div className="tb-pad"><DirectoryPicker /></div>
          {lib.byCategory.map((g, gi) => {
            const isOpen = open[g.label] ?? gi < 2;
            return (
              <section key={g.label} className="tb-group tb-group--cat">
                <button type="button" className="tb-cat" onClick={() => setOpen((o) => ({ ...o, [g.label]: !isOpen }))} aria-expanded={isOpen}>
                  <span>{g.label}</span>
                  <span className="tb-cat__count">{g.items.length}</span>
                  <I.Chevron dir={isOpen ? 'u' : 'd'} size={16} />
                </button>
                {isOpen && (
                  <ul className="tb-list" role="list">
                    {g.items.map((it) => <ChannelRow key={it.id} item={it} context="listas" />)}
                  </ul>
                )}
              </section>
            );
          })}
        </>
      )}
      <p className="tb-foot">{lib.favorites.length} favoritos · {lib.history.length} recientes · {lib.listas.length} canales en la lista</p>
    </Scroll>
  );
}

// ---------------------------------------------------------------- Buscar

function SearchScreen() {
  const [q, setQ] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => ref.current?.focus(), 380);
    return () => clearTimeout(t);
  }, []);
  return (
    <Scroll>
      <LargeTitle title="Buscar" />
      <div className="tb-pad">
        <label className="tb-searchfield">
          <I.Search size={18} />
          <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Canal, partido o Content ID" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="Borrar">
              <I.X size={14} />
            </button>
          )}
        </label>
      </div>
      <SearchResults q={q} />
    </Scroll>
  );
}

// ---------------------------------------------------------------- Ajustes

function SettingsScreen({ onPrefs }: { onPrefs: () => void }) {
  const prefs = useSim((s) => s.preferences);
  const mode = useSim((s) => s.playbackMode);
  const engine = useSim((s) => s.engine.status);
  const sessions = useSim((s) => s.sessions.length + (s.player.target ? 1 : 0));
  const dirs = useSim((s) => s.directories);
  const summary = [prefs.leagues.length ? `${prefs.leagues.length} ligas` : null, prefs.teams.length ? `${prefs.teams.length} equipos` : null].filter(Boolean).join(' · ') || 'Sin elegir';
  return (
    <Scroll>
      <LargeTitle title="Ajustes" />
      <Group title="Reproducción">
        <Cell icon={<I.Play size={20} />} label="Modo" value={mode === 'low' ? 'Baja latencia' : mode === 'stable' ? 'Estable' : 'Equilibrado'} onClick={() => navigate('ajustes', 'reproduccion')} chevron />
        <Cell icon={<I.Heart size={20} />} label="Tu fútbol" value={summary} onClick={onPrefs} chevron />
      </Group>
      <Group title="Dispositivos">
        <Cell icon={<I.Phone size={20} />} label="Dispositivos" onClick={() => navigate('ajustes', 'dispositivos')} chevron />
        <Cell icon={<I.Tv size={20} />} label="Dónde se está reproduciendo" value={sessions ? <span className="tb-pill is-ok">{sessions}</span> : undefined} onClick={() => navigate('ajustes', 'donde')} chevron />
      </Group>
      <Group title="Sistema">
        <Cell icon={<I.Tv size={20} />} label="Listas" value={`${dirs.length}`} onClick={() => navigate('ajustes', 'listas')} chevron />
        <Cell icon={<I.Bolt size={20} />} label="Salud" value={<span className={`tb-pill ${engine === 'online' ? 'is-ok' : engine === 'restarting' ? 'is-weak' : 'is-fail'}`}>{engine === 'online' ? 'Todo bien' : engine === 'restarting' ? 'Reiniciando' : 'Motor parado'}</span>} onClick={() => navigate('ajustes', 'salud')} chevron />
        <Cell icon={<I.Sun size={20} />} label="Apariencia" onClick={() => navigate('ajustes', 'apariencia')} chevron />
        <Cell icon={<I.Info size={20} />} label="Acerca de" onClick={() => navigate('ajustes', 'acerca')} chevron />
      </Group>
    </Scroll>
  );
}

function SettingsSub({ section }: { section: string }) {
  const titles: Record<string, string> = { reproduccion: 'Reproducción', dispositivos: 'Dispositivos', donde: 'Dónde se está reproduciendo', listas: 'Listas', salud: 'Salud', apariencia: 'Apariencia', acerca: 'Acerca de' };
  return (
    <Push title={titles[section] ?? 'Ajustes'}>
      {section === 'reproduccion' && <PlaybackSection />}
      {section === 'dispositivos' && <DevicesSection />}
      {section === 'donde' && <WherePlayingSection />}
      {section === 'listas' && <DirectoriesSection />}
      {section === 'salud' && <HealthSection />}
      {section === 'apariencia' && <AppearanceSection />}
      {section === 'acerca' && <AboutSection />}
    </Push>
  );
}

// ---------------------------------------------------------------- Mini y grande

function MiniAccessory({ minimized }: { minimized: boolean }) {
  const player = useSim((s) => s.player);
  const v = useVideoProps();
  const phase = derivePhase(player);
  const y = useMotionValue(0);
  if (!player.target) return null;
  return (
    <motion.div
      className={`tb-mini${minimized ? ' is-inline' : ''} is-${phase}`}
      layout
      style={{ y }}
      drag="y"
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.5, bottom: 0.1 }}
      onDragEnd={(_, info) => {
        if (info.offset.y < -40 || info.velocity.y < -400) setExpanded(true);
      }}
      onClick={() => setExpanded(true)}
      role="button"
      aria-label={`Abrir el reproductor: ${player.target?.title}`}
      transition={{ type: 'spring', duration: 0.4, bounce: 0 }}
    >
      <motion.div className="tb-mini__thumb" layoutId="tb-video">
        <FakeVideo playing={v.playing} quality={v.quality} home={v.home} away={v.away} kind={v.kind} radius={8} />
      </motion.div>
      {!minimized && (
        <span className="tb-mini__body">
          <span className="tb-mini__title">{player.target?.title}</span>
          <span className={`tb-mini__state is-${phase}`}>{phaseWord(phase, player.sharedWith)}</span>
        </span>
      )}
      <button type="button" className="tb-mini__play" onClick={(e) => { e.stopPropagation(); togglePlay(); }} aria-label={phase === 'reproduciendo' ? 'Pausar' : 'Reproducir'}>
        {phase === 'reproduciendo' ? <I.Pause size={22} /> : <I.Play size={22} />}
      </button>
      {!minimized && (
        <button type="button" className="tb-mini__stop" onClick={(e) => { e.stopPropagation(); stop('usuario'); }} aria-label="Detener">
          <I.X size={18} />
        </button>
      )}
    </motion.div>
  );
}

function BigPlayer() {
  const player = useSim((s) => s.player);
  const reduced = useSim((s) => s.reducedMotion);
  const y = useMotionValue(0);
  const t = player.target;
  if (!t) return null;
  return (
    <motion.div
      className={`tb-big${player.fullscreen ? ' is-full' : ''}`}
      initial={{ y: '100%' }}
      animate={{ y: 0 }}
      exit={{ y: '100%' }}
      transition={reduced ? { duration: 0.14 } : { type: 'spring', duration: 0.46, bounce: 0 }}
      style={{ y }}
      drag={player.fullscreen ? false : 'y'}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0, bottom: 0.7 }}
      dragDirectionLock
      onDragEnd={(_, info) => {
        if (info.offset.y > 110 || info.velocity.y > 600) setExpanded(false);
      }}
      role="dialog"
      aria-label="Reproductor"
    >
      <div className="tb-big__grab" aria-hidden="true"><span /></div>
      <div className="tb-big__stage">
        <motion.div layoutId="tb-video" className="tb-big__video">
          <VideoStage variant={player.fullscreen ? 'full' : 'phone'} onMinimize={() => setExpanded(false)} showTitle={player.fullscreen} radius={player.fullscreen ? 0 : 14} />
        </motion.div>
      </div>
      {!player.fullscreen && (
        <div className="tb-big__body">
          <StatusLineView />
          {t.kind !== 'match' && (
            <div className="tb-big__title">
              <h2>{t.title}</h2>
              <span>{t.subtitle}</span>
            </div>
          )}
          {t.kind === 'match' ? <MatchCenter matchId={t.id} layout="phone" onMinimize={() => setExpanded(false)} /> : <ChannelCenter channelId={t.id} layout="phone" onMinimize={() => setExpanded(false)} />}
        </div>
      )}
    </motion.div>
  );
}

// ---------------------------------------------------------------- Emparejar (primer uso)

function PairingScreen() {
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [scanning, setScanning] = useState(false);
  useEffect(() => {
    if (!scanning) return;
    const t = setTimeout(() => {
      claimPairing('482913');
      setScanning(false);
    }, 2200);
    return () => clearTimeout(t);
  }, [scanning]);
  return (
    <div className="tb-phone tb-pairing">
      <div className="tb-pairing__body">
        <div className="tb-pairing__mark" aria-hidden="true"><I.Play size={30} /></div>
        <h1>Ace Neo</h1>
        <p>Empareja este iPhone con tu Ace Player Neo. En la web: Ajustes › Dispositivos › Emparejar.</p>
        <button type="button" className="tb-btn tb-btn--primary tb-btn--lg tb-btn--block" onClick={() => setScanning(true)} disabled={scanning}>
          <I.Qr size={20} /> {scanning ? 'Buscando el código…' : 'Escanear el código QR'}
        </button>
        <div className="tb-pairing__or"><span>o escribe el código</span></div>
        <input className="tb-pairing__code" value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setErr(''); }} inputMode="numeric" placeholder="000 000" aria-label="Código de 6 dígitos" autoComplete="one-time-code" />
        {err && <p className="tb-pairing__err"><I.Warn size={14} /> {err}</p>}
        <button type="button" className="tb-btn tb-btn--tint tb-btn--block" disabled={code.length !== 6} onClick={() => { if (claimPairing(code) === 'invalid') setErr('El código no es correcto. Revísalo en la web.'); }}>
          Emparejar
        </button>
        <p className="tb-pairing__note">El código dura 5 minutos y solo sirve una vez. La app usa la dirección de casa o la de Tailscale según dónde estés.</p>
      </div>
      {scanning && (
        <div className="tb-scanner" role="dialog" aria-label="Escanear">
          <div className="tb-scanner__frame" />
          <span>Apunta al código QR que enseña la web</span>
        </div>
      )}
      <Toasts bottom="calc(var(--safe-bottom) + 16px)" />
    </div>
  );
}
