import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import './tokens.css';
import './tribuna.css';
import { navigate, useRoute, tabOf } from '../../core/router';
import { derivePhase, isEngaged, matchById, playMatch, setExpanded, stop, togglePlay, useNow, useSim } from '../../core/store';
import { useWebShortcuts } from '../../core/keys';
import { team, competition } from '../../core/data/teams';
import { hhmm, longDate, untilText } from '../../core/format';
import { Crest } from '../../core/ui/Crest';
import { FakeVideo } from '../../core/video/FakeVideo';
import { I } from './shared/icons';
import { useAgenda } from './shared/useAgenda';
import Iphone, { AgendaGroups } from './iphone';
import { ChannelCenter, MatchCenter } from './shared/MatchCenter';
import { ChannelRow, DirectoryPicker, OnAirStrip, useLibraryLists, type LibTab } from './shared/Library';
import { SearchResults } from './shared/Search';
import { AboutSection, AppearanceSection, Cell, DevicesSection, DirectoriesSection, Group, HealthSection, PlaybackSection, Segmented, WherePlayingSection } from './shared/settings';
import { HelpSheet, PrefsSheet } from './shared/Sheets';
import { Toasts } from './shared/Toasts';
import { phaseWord, useVideoProps, VideoStage } from './shared/Player';
import { ScoreView, MinuteBadge } from './shared/Score';
import { useMatchSignal, SignalBadge } from './shared/Signal';

/* Propuesta 1 · Tribuna · Web. Barra lateral + página editorial; en pantallas
   estrechas se usa la versión iPhone (misma jerarquía, tab bar). */

function useWidth() {
  const [w, setW] = useState(window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

export default function Web() {
  const w = useWidth();
  if (w < 760) return <div className="tb-web-narrow"><Iphone /></div>;
  return <Desktop />;
}

function Desktop() {
  const route = useRoute();
  const player = useSim((s) => s.player);
  const [help, setHelp] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const tab = tabOf(route.screen);
  useWebShortcuts(
    useMemo(
      () => ({
        onSearch: () => {
          navigate('buscar');
          setTimeout(() => searchRef.current?.focus(), 50);
        },
        onHelp: () => setHelp((h) => !h),
        onEscape: () => {
          if (help) setHelp(false);
          else if (player.fullscreen) setExpanded(false);
        },
      }),
      [help, player.fullscreen],
    ),
  );
  const engaged = isEngaged(player);
  const inCenter = route.screen === 'partido' || route.screen === 'canal';
  const showMini = engaged && !inCenter && !player.fullscreen;

  return (
    <div className={`tb-web${player.fullscreen ? ' is-full' : ''}`}>
      <aside className="tb-side">
        <div className="tb-side__brand">
          <span className="tb-side__logo" aria-hidden="true"><I.Play size={16} /></span>
          <span>Ace Player Neo</span>
        </div>
        <nav className="tb-side__nav" aria-label="Secciones">
          {[
            { id: 'agenda', label: 'Partidos', icon: <I.Calendar size={20} /> },
            { id: 'biblioteca', label: 'Canales', icon: <I.Tv size={20} /> },
            { id: 'buscar', label: 'Buscar', icon: <I.Search size={20} />, kbd: '/' },
            { id: 'ajustes', label: 'Ajustes', icon: <I.Gear size={20} /> },
          ].map((it) => (
            <button key={it.id} type="button" className={`tb-side__item${tab === it.id ? ' is-on' : ''}`} onClick={() => navigate(it.id as 'agenda')} aria-current={tab === it.id ? 'page' : undefined}>
              {it.icon}
              <span>{it.label}</span>
              {it.kbd && <kbd>{it.kbd}</kbd>}
            </button>
          ))}
        </nav>
        <div className="tb-side__foot">
          <AnimatePresence>{showMini && <WebMini key="mini" />}</AnimatePresence>
          <button type="button" className="tb-side__help" onClick={() => setHelp(true)}>
            <I.Keyboard size={16} /> Atajos <kbd>?</kbd>
          </button>
        </div>
      </aside>
      <main className="tb-main">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={`${route.screen}/${route.param ?? ''}`} className="tb-main__page" initial={{ opacity: 0, y: route.direction === 'back' ? -8 : 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}>
            <PageSwitch onPrefs={() => setPrefs(true)} onHelp={() => setHelp(true)} searchRef={searchRef} />
          </motion.div>
        </AnimatePresence>
      </main>
      {player.fullscreen && engaged && (
        <div className="tb-fullscreen">
          <VideoStage variant="full" showTitle onMinimize={() => setExpanded(false)} radius={0} />
        </div>
      )}
      <HelpSheet open={help} onClose={() => setHelp(false)} />
      <PrefsSheet open={prefs} onClose={() => setPrefs(false)} />
      <Toasts bottom={24} />
    </div>
  );
}

function PageSwitch({ onPrefs, onHelp, searchRef }: { onPrefs: () => void; onHelp: () => void; searchRef: React.RefObject<HTMLInputElement | null> }) {
  const route = useRoute();
  switch (route.screen) {
    case 'partido':
      return <MatchPage id={route.param!} />;
    case 'canal':
      return (
        <Page title="Canal" back>
          <ChannelCenter channelId={route.param!} layout="web" />
        </Page>
      );
    case 'biblioteca':
      return <LibraryPage />;
    case 'buscar':
      return <SearchPage searchRef={searchRef} />;
    case 'ajustes':
      return <SettingsPage onPrefs={onPrefs} onHelp={onHelp} />;
    default:
      return <AgendaPage onPrefs={onPrefs} />;
  }
}

function Page({ title, sub, children, right, back = false, wide = false }: { title: string; sub?: string; children: ReactNode; right?: ReactNode; back?: boolean; wide?: boolean }) {
  return (
    <div className={`tb-page${wide ? ' is-wide' : ''}`}>
      <header className="tb-page__head">
        {back && (
          <button type="button" className="tb-page__back" onClick={() => history.back()} aria-label="Atrás">
            <I.Chevron dir="l" size={18} /> Atrás
          </button>
        )}
        <div className="tb-page__title">
          {sub && <span className="tb-page__sub">{sub}</span>}
          <h1>{title}</h1>
        </div>
        {right && <div className="tb-page__right">{right}</div>}
      </header>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Partidos

function AgendaPage({ onPrefs }: { onPrefs: () => void }) {
  const a = useAgenda();
  const onboarding = useSim((s) => s.preferences.onboardingComplete);
  const day = a.days.find((d) => d.key === a.dayKey)!;
  const featured = a.vms.find((v) => v.phase === 'live' && v.mine) ?? a.vms.find((v) => v.phase === 'live') ?? a.vms.find((v) => v.phase === 'upcoming') ?? a.vms[0];
  const sub = day.rel === 'hoy' ? `Hoy, ${longDate(day.ms)}` : longDate(day.ms);
  useArrowDays(a);
  return (
    <Page title="Partidos" sub={sub.charAt(0).toUpperCase() + sub.slice(1)} right={a.hasPrefs ? <Segmented<'mine' | 'all'> value={a.scope} onChange={a.setScope} label="Qué partidos ver" items={[{ value: 'mine', label: 'Para ti' }, { value: 'all', label: 'Todos' }]} /> : undefined}>
      <div className="tb-days tb-days--web" role="tablist" aria-label="Día">
        {a.days.map((d) => (
          <button key={d.key} type="button" role="tab" aria-selected={d.key === a.dayKey} className={`tb-day${d.key === a.dayKey ? ' is-on' : ''}${d.rel === 'hoy' ? ' is-today' : ''}`} onClick={() => a.setDayKey(d.key)}>
            <span className="tb-day__name">{d.rel === 'hoy' ? 'Hoy' : d.rel === 'mañana' ? 'Mañana' : d.rel === 'ayer' ? 'Ayer' : d.short}</span>
            <span className="tb-day__num">{d.num}</span>
            <span className="tb-day__count">{d.count ? `${d.count} partidos` : '—'}</span>
            {d.live > 0 && <i className="tb-day__live" />}
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
          <button type="button" className="tb-btn tb-btn--primary tb-btn--sm" onClick={onPrefs}>Elegir</button>
        </div>
      )}
      {featured && <Cover vm={featured} />}
      <AgendaGroups a={a} onPrefs={onPrefs} />
      <p className="tb-foot">Horario peninsular · actualizado a las {hhmm(a.now)}</p>
    </Page>
  );
}

/** ← → cambian de día mientras no hay nada sonando (con algo sonando, zapean). */
function useArrowDays(a: ReturnType<typeof useAgenda>) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('input,textarea')) return;
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (document.querySelector('.tb-webmini, .tb-stage')) return;
      const idx = a.days.findIndex((d) => d.key === a.dayKey);
      const next = a.days[idx + (e.key === 'ArrowRight' ? 1 : -1)];
      if (next) a.setDayKey(next.key);
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [a]);
}

/** Portada del partido destacado: escudos grandes, luz de ambiente, «Ver ahora». */
function Cover({ vm }: { vm: ReturnType<typeof useAgenda>['vms'][number] }) {
  const { match, score, phase } = vm;
  const home = team(match.home);
  const away = team(match.away);
  const comp = competition(match.competition);
  const signal = useMatchSignal(match.id, phase, score.untilKickoffMs);
  const now = useNow();
  return (
    <section className={`tb-cover is-${phase}`} style={{ ['--h' as string]: home.primary, ['--a' as string]: away.primary }} aria-label="Partido destacado">
      <div className="tb-cover__ambient" aria-hidden="true" />
      <div className="tb-cover__meta">
        <span className="tb-cover__comp">{comp.name}{match.round ? ` · ${match.round}` : ''}</span>
        {phase === 'live' ? <MinuteBadge score={score} size="md" /> : phase === 'upcoming' ? <span className="tb-cover__when">{untilText(match.start, now)}</span> : <span className="tb-cover__when">Final</span>}
      </div>
      <div className="tb-cover__teams">
        <div className="tb-cover__team"><Crest team={home} size={104} /><span>{home.name}</span></div>
        <div className="tb-cover__center">
          {phase === 'upcoming' ? <span className="tb-cover__time">{hhmm(match.start)}</span> : <ScoreView matchId={match.id} score={score} size="hero" />}
          {signal.kind !== 'none' && <span className={`tb-cover__signal is-${signal.kind}`}><SignalBadge kind={signal.kind} word={false} size={14} />{signal.text}</span>}
        </div>
        <div className="tb-cover__team"><Crest team={away} size={104} /><span>{away.name}</span></div>
      </div>
      <div className="tb-cover__actions">
        <button type="button" className="tb-btn tb-btn--primary tb-btn--lg" onClick={() => { navigate('partido', match.id); playMatch(match.id); }}>
          <I.Play size={18} /> Ver ahora
        </button>
        <button type="button" className="tb-btn tb-btn--tint tb-btn--lg" onClick={() => navigate('partido', match.id)}>
          Detalles
        </button>
        <span className="tb-cover__channels">{match.channels.map((c) => c.name).join(' · ')}</span>
      </div>
    </section>
  );
}

function MatchPage({ id }: { id: string }) {
  const m = matchById(id);
  const a = useAgenda();
  const title = m ? `${team(m.home).name} – ${team(m.away).name}` : 'Partido';
  useEffect(() => {
    if (m) a.setDayKey(m.date);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const day = a.days.find((d) => d.key === a.dayKey);
  return (
    <div className="tb-page is-wide tb-page--match">
      <header className="tb-page__head">
        <button type="button" className="tb-page__back" onClick={() => history.back()} aria-label="Atrás">
          <I.Chevron dir="l" size={18} /> Partidos
        </button>
        <div className="tb-page__title"><h1 className="tb-page__h1-sm">{title}</h1></div>
      </header>
      <div className="tb-match-layout">
        <MatchCenter matchId={id} layout="web" />
        <aside className="tb-match-layout__agenda">
          <h3 className="tb-h3">{day?.rel === 'hoy' ? 'Hoy' : day ? longDate(day.ms) : ''}</h3>
          <AgendaGroups a={a} onPrefs={() => undefined} compact selected={id} />
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- Canales

function LibraryPage() {
  const route = useRoute();
  const lib = useLibraryLists();
  const [tab, setTab] = useState<LibTab>((route.param as LibTab) || (lib.favorites.length ? 'favoritos' : 'listas'));
  const [q, setQ] = useState('');
  const filter = (items: typeof lib.favorites) => (q ? items.filter((i) => i.title.toLowerCase().includes(q.toLowerCase()) || i.category.toLowerCase().includes(q.toLowerCase())) : items);
  return (
    <Page title="Canales" right={<Segmented<LibTab> value={tab} onChange={setTab} label="Sección" items={[{ value: 'favoritos', label: `Favoritos · ${lib.favorites.length}` }, { value: 'recientes', label: `Recientes · ${lib.history.length}` }, { value: 'listas', label: `Listas · ${lib.listas.length}` }]} />}>
      <label className="tb-searchfield tb-searchfield--web">
        <I.Search size={18} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar canales" />
      </label>
      {!q && <OnAirStrip />}
      {tab === 'favoritos' && (
        <section className="tb-group">
          {filter(lib.favorites).length === 0 ? (
            <div className="tb-empty"><I.Star size={28} /><strong>Aún no tienes favoritos</strong><span>Guarda un canal con la estrella y aparecerá aquí.</span><button type="button" className="tb-btn tb-btn--primary" onClick={() => setTab('listas')}>Ver las listas</button></div>
          ) : (
            <ul className="tb-list tb-list--grid" role="list">{filter(lib.favorites).map((it) => <ChannelRow key={it.id} item={it} context="favoritos" />)}</ul>
          )}
        </section>
      )}
      {tab === 'recientes' &&
        lib.recentsGrouped.map((g) => (
          <section key={g.label} className="tb-group">
            <h3 className="tb-group__title">{g.label}</h3>
            <ul className="tb-list tb-list--grid" role="list">{filter(g.items).map((it) => <ChannelRow key={it.id} item={it} context="recientes" />)}</ul>
          </section>
        ))}
      {tab === 'listas' && (
        <>
          <DirectoryPicker />
          {lib.byCategory.map((g) => {
            const items = filter(g.items);
            if (!items.length) return null;
            return (
              <section key={g.label} className="tb-group">
                <h3 className="tb-group__title">{g.label} <span>{items.length}</span></h3>
                <ul className="tb-list tb-list--grid" role="list">{items.map((it) => <ChannelRow key={it.id} item={it} context="listas" />)}</ul>
              </section>
            );
          })}
        </>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- Buscar

function SearchPage({ searchRef }: { searchRef: React.RefObject<HTMLInputElement | null> }) {
  const route = useRoute();
  const [q, setQ] = useState(route.param ?? '');
  useEffect(() => {
    searchRef.current?.focus();
  }, [searchRef]);
  return (
    <Page title="Buscar">
      <label className="tb-searchfield tb-searchfield--web tb-searchfield--lg">
        <I.Search size={20} />
        <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Canal, partido o Content ID" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
        <kbd>/</kbd>
      </label>
      <SearchResults q={q} />
    </Page>
  );
}

// ---------------------------------------------------------------- Ajustes

const SECTIONS = [
  { id: 'reproduccion', label: 'Reproducción', icon: <I.Play size={18} /> },
  { id: 'futbol', label: 'Tu fútbol', icon: <I.Heart size={18} /> },
  { id: 'dispositivos', label: 'Dispositivos', icon: <I.Phone size={18} /> },
  { id: 'donde', label: 'Dónde se está reproduciendo', icon: <I.Tv size={18} /> },
  { id: 'listas', label: 'Listas', icon: <I.Tv size={18} /> },
  { id: 'salud', label: 'Salud', icon: <I.Bolt size={18} /> },
  { id: 'apariencia', label: 'Apariencia', icon: <I.Sun size={18} /> },
  { id: 'acerca', label: 'Acerca de', icon: <I.Info size={18} /> },
];

function SettingsPage({ onPrefs, onHelp }: { onPrefs: () => void; onHelp: () => void }) {
  const route = useRoute();
  const section = route.param ?? 'reproduccion';
  const prefs = useSim((s) => s.preferences);
  const engine = useSim((s) => s.engine.status);
  const sessions = useSim((s) => s.sessions.length + (s.player.target ? 1 : 0));
  return (
    <Page title="Ajustes" wide>
      <div className="tb-settings">
        <nav className="tb-settings__index" aria-label="Secciones de ajustes">
          {SECTIONS.map((s) => (
            <button key={s.id} type="button" className={`tb-settings__item${section === s.id ? ' is-on' : ''}`} onClick={() => navigate('ajustes', s.id, null, { replace: true })} aria-current={section === s.id ? 'location' : undefined}>
              {s.icon}
              <span>{s.label}</span>
              {s.id === 'salud' && <i className={`tb-dot is-${engine === 'online' ? 'ok' : engine === 'restarting' ? 'weak' : 'fail'}`} />}
              {s.id === 'donde' && sessions > 0 && <i className="tb-dot is-ok" />}
            </button>
          ))}
        </nav>
        <div className="tb-settings__panel">
          <h2 className="tb-settings__h2">{SECTIONS.find((s) => s.id === section)?.label}</h2>
          {section === 'reproduccion' && <PlaybackSection />}
          {section === 'futbol' && (
            <Group title="Para ti" foot="Los gustos se guardan en tu Ace Player Neo: la web y el iPhone usan los mismos.">
              <Cell icon={<I.Heart size={20} />} label="Ligas, equipos y selecciones" sub={prefs.leagues.concat(prefs.teams, prefs.nationalities).join(', ') || 'Sin elegir: se enseñan todos los partidos.'} onClick={onPrefs} chevron />
            </Group>
          )}
          {section === 'dispositivos' && <DevicesSection />}
          {section === 'donde' && <WherePlayingSection />}
          {section === 'listas' && <DirectoriesSection />}
          {section === 'salud' && <HealthSection />}
          {section === 'apariencia' && <AppearanceSection />}
          {section === 'acerca' && <AboutSection onHelp={onHelp} />}
        </div>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- Mini (web)

function WebMini() {
  const player = useSim((s) => s.player);
  const v = useVideoProps();
  const phase = derivePhase(player);
  const t = player.target;
  if (!t) return null;
  return (
    <motion.div className={`tb-webmini is-${phase}`} title={t.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} transition={{ type: 'spring', duration: 0.4, bounce: 0 }}>
      <button type="button" className="tb-webmini__thumb" onClick={() => navigate(t.kind === 'match' ? 'partido' : 'canal', t.id)} aria-label="Volver al vídeo">
        <FakeVideo playing={v.playing} quality={v.quality} home={v.home} away={v.away} kind={v.kind} radius={10} />
      </button>
      <div className="tb-webmini__body">
        <span className="tb-webmini__title">{t.title}</span>
        <span className={`tb-webmini__state is-${phase}`}>{phaseWord(phase, player.sharedWith)}</span>
      </div>
      <div className="tb-webmini__actions">
        <button type="button" className="tb-iconbtn" onClick={togglePlay} aria-label={phase === 'reproduciendo' ? 'Pausar' : 'Reproducir'}>
          {phase === 'reproduciendo' ? <I.Pause size={20} /> : <I.Play size={20} />}
        </button>
        <button type="button" className="tb-iconbtn" onClick={() => stop('usuario')} aria-label="Detener">
          <I.X size={18} />
        </button>
      </div>
    </motion.div>
  );
}
