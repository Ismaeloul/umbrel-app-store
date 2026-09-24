/* Portada web: la señal del partido destacado a pantalla completa, y debajo
   las filas (En directo · Agenda por día · Emitiendo ahora · Favoritos · Recientes). */

import { useMemo, type ReactNode } from 'react';
import { navigate } from '../../../core/router';
import { channelsOf, completeOnboarding, isMine, playChannel, playMatch, revealScore, useNow, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { Crest } from '../../../core/ui/Crest';
import { hhmm, longDate, plural, untilText } from '../../../core/format';
import { Button, Capsule, Empty, RowHeader, Segmented } from '../components/primitives';
import { Icon } from '../components/icons';
import { MatchPoster, ChannelPoster, SignalCapsule } from '../components/posters';
import { ScoreCapsule } from '../components/player';
import { Ambient, CoverVideo } from '../components/video';
import { DayStrip, FirstUseCard, useAgendaDay, useDayCounts, useFeatured, useForYouCount, useWarmSources, type Scored } from '../components/agenda';
import { useDays, useGoalFlash, useMemoryState, sameDay } from '../components/hooks';
import { emittingNow, groupRecents, nowLine, uniqueByTitle } from '../components/library';
import { cap, compName, compShort, whenText } from '../components/text';

export function Home({ day, setDay }: { day: number; setDay: (d: number) => void }) {
  const now = useNow();
  const days = useDays(now);
  const prefs = useSim((s) => s.preferences);
  const agenda = useSim((s) => s.agenda);
  const player = useSim((s) => s.player);
  const engine = useSim((s) => s.engine.status);
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const sessions = useSim((s) => s.sourceSessions);
  const revealed = useSim((s) => s.scoreRevealed);
  const [filter, setFilter] = useMemoryState<'foryou' | 'all'>('pl-web-filter', 'foryou');
  const effFilter: 'foryou' | 'all' = prefs.onboardingComplete && (prefs.leagues.length || prefs.teams.length || prefs.nationalities.length) ? filter : 'all';
  const featured = useFeatured();
  const dayData = useAgendaDay(day, effFilter);
  const counts = useDayCounts(days, effFilter);
  const fy = useForYouCount(day);
  const flash = useGoalFlash(featured.match?.id);
  const todays = useMemo(() => agenda.filter((m) => sameDay(m.start, now)), [agenda, Math.floor(now / 3600_000)]);
  useWarmSources(todays);

  const liveNow: Scored[] = useMemo(() => agenda.map((m) => ({ match: m, score: scoreAt(m, now) })).filter((x) => x.score.state === 'in'), [agenda, now]);
  const libraryChannels = useMemo(() => uniqueByTitle([...favorites, ...channelsOf(activeDir)]), [favorites, activeDir]);
  const emitting = useMemo(() => emittingNow(libraryChannels, agenda, now), [libraryChannels, agenda, now]);
  const recents = useMemo(() => groupRecents(history, Date.now()), [history]);

  const openMatch = (m: Scored) => {
    if (m.score.state === 'in') playMatch(m.match.id);
    navigate('partido', m.match.id);
  };
  const openChannel = (id: string) => {
    playChannel(id);
    navigate('canal', id);
  };
  const watchingId = player.target?.kind === 'match' ? player.target.id : null;

  const poster = (x: Scored, size: 'sm' | 'md' = 'md') => (
    <MatchPoster key={x.match.id} match={x.match} score={x.score} nowMs={now} session={sessions[`match:${x.match.id}`]} size={size} mine={isMine(x.match, prefs)} watching={watchingId === x.match.id} covered={watchingId === x.match.id && !revealed[x.match.id]} onReveal={() => revealScore(x.match.id, true)} onClick={() => openMatch(x)} fixedWidth={size === 'md' ? 300 : 240} />
  );

  return (
    <div className="pl-home">
      <Hero featured={featured} flash={flash} now={now} liveNow={liveNow} onOpen={openMatch} watchingId={watchingId} />

      <div className="pl-rows">
        {engine !== 'online' && (
          <div className="pl-banner">
            <Icon name="warning" size={18} />
            <span>{engine === 'restarting' ? 'El motor se está reiniciando: las señales volverán solas en unos segundos.' : 'El motor no responde: ninguna señal arrancará hasta que vuelva.'}</span>
            <Button variant="quiet" size="sm" onClick={() => navigate('ajustes', 'salud')}>
              Ver salud
            </Button>
          </div>
        )}

        {liveNow.length > 0 && !sameDay(day, now) && (
          <HRow title="En directo ahora" count={liveNow.length} live>
            {liveNow.map((x) => poster(x))}
          </HRow>
        )}

        <section className="pl-agenda" id="agenda">
          <div className="pl-agenda__head">
            <div>
              <h2 className="pl-agenda__title">Agenda</h2>
              <p className="pl-agenda__sub">{cap(longDate(day))}</p>
            </div>
            <div className="pl-agenda__tools">
              <Segmented<'foryou' | 'all'>
                label="Filtro"
                value={effFilter}
                onChange={setFilter}
                options={[
                  { id: 'foryou', label: 'Para ti', count: fy.foryou, disabled: !prefs.onboardingComplete },
                  { id: 'all', label: 'Todos', count: fy.all },
                ]}
              />
              <Button variant="quiet" size="sm" icon="pencil" onClick={() => navigate('gustos')}>
                Mis gustos
              </Button>
            </div>
          </div>
          <DayStrip days={days} selected={day} onSelect={setDay} counts={counts} nowMs={now} />
          {!prefs.onboardingComplete && <FirstUseCard onPersonalize={() => navigate('gustos')} onLater={completeOnboarding} />}

          {dayData.total === 0 ? (
            effFilter === 'foryou' && dayData.totalAll > 0 ? (
              <Empty icon="ball" title="Nada de lo tuyo este día" text={`Hay ${plural(dayData.totalAll, 'partido', 'partidos')} de otras ligas.`} action={{ label: 'Ver todos', run: () => setFilter('all') }} secondary={{ label: 'Editar mis gustos', run: () => navigate('gustos') }} />
            ) : (
              <Empty icon="calendar" title="Sin partidos anunciados" text="Este día no hay nada en la agenda todavía." action={days.some((d) => d > day) ? { label: 'Ver el día siguiente', run: () => setDay(days.find((d) => d > day)!) } : undefined} />
            )
          ) : (
            <div className="pl-agenda__groups">
              {dayData.live.length > 0 && (
                <HRow title="En directo" count={dayData.live.length} live as="h3">
                  {dayData.live.map((x) => poster(x))}
                </HRow>
              )}
              {dayData.upcoming.length > 0 && (
                <HRow title="Próximos" count={dayData.upcoming.length} as="h3">
                  {dayData.upcoming.map((x) => poster(x))}
                </HRow>
              )}
              {dayData.finished.length > 0 && (
                <HRow title="Terminados" count={dayData.finished.length} as="h3">
                  {dayData.finished.map((x) => poster(x, 'sm'))}
                </HRow>
              )}
            </div>
          )}
        </section>

        {emitting.length > 0 && (
          <HRow title="Emitiendo ahora" sub="Canales de tu biblioteca con partido en juego" live>
            {emitting.map((e) => (
              <ChannelPoster key={e.item.id} item={e.item} now={nowLine(e.item.title, agenda, now)} size="md" favorite={favorites.some((f) => f.id === e.item.id)} watching={player.target?.kind === 'channel' && player.target.id === e.item.id} onClick={() => openChannel(e.item.id)} fixedWidth={260} />
            ))}
          </HRow>
        )}

        <HRow title="Favoritos" count={favorites.length} action={{ label: 'Todos los canales', run: () => navigate('biblioteca'), icon: 'chevronRight' }}>
          {favorites.length === 0 ? (
            <Empty compact icon="star" title="Aún no tienes favoritos" text="Marca un canal con la estrella y aparecerá aquí." action={{ label: 'Ver los canales', run: () => navigate('biblioteca') }} />
          ) : (
            favorites.map((f) => <ChannelPoster key={f.id} item={f} now={nowLine(f.title, agenda, now)} size="sm" favorite watching={player.target?.kind === 'channel' && player.target.id === f.id} onClick={() => openChannel(f.id)} fixedWidth={220} />)
          )}
        </HRow>

        {recents.length > 0 && (
          <HRow title="Recientes" sub={recents[0].label} action={{ label: 'Ver todos', run: () => navigate('biblioteca'), icon: 'chevronRight' }}>
            {recents
              .flatMap((g) => g.items)
              .slice(0, 8)
              .map((f) => (
                <ChannelPoster key={f.id} item={f} now={nowLine(f.title, agenda, now)} size="sm" favorite={favorites.some((x) => x.id === f.id)} onClick={() => openChannel(f.id)} fixedWidth={220} />
              ))}
          </HRow>
        )}

        <footer className="pl-foot">Datos de muestra · horario peninsular · {hhmm(now)}</footer>
      </div>
    </div>
  );
}

function Hero({ featured, flash, now, liveNow, onOpen, watchingId }: { featured: ReturnType<typeof useFeatured>; flash: 'home' | 'away' | null; now: number; liveNow: Scored[]; onOpen: (m: Scored) => void; watchingId: string | null }) {
  const sessions = useSim((s) => s.sourceSessions);
  const m = featured.match;
  const sc = featured.score;
  const home = m ? team(m.home) : team('esp-nt');
  const away = m ? team(m.away) : team('fra-nt');
  const others = liveNow.filter((x) => x.match.id !== m?.id).slice(0, 3);
  const watchingThis = !!m && watchingId === m.id;
  return (
    <section className="pl-hero">
      <div className="pl-hero__media" aria-hidden="true">
        <CoverVideo playing quality="ok" home={home.primary} away={away.primary} kind={featured.kind === 'live' ? 'broadcast' : 'studio'} zoom={1.02} focusY={0.42} />
        <Ambient home={home.primary} away={away.primary} flash={flash} strength={0.3} />
        <div className="pl-hero__veil" />
      </div>
      <div className="pl-hero__content">
        {m && sc && featured.kind === 'live' && (
          <>
            <div className="pl-hero__eyebrow">
              <span className="pl-livedot" /> En directo · {compName(m.competition)}
              {m.round && <span className="pl-hero__round"> · {m.round}</span>}
            </div>
            <h1 className="pl-hero__title">
              <span className="pl-hero__team">
                <Crest team={home} size={44} />
                {home.name}
              </span>
              <span className="pl-hero__team">
                <Crest team={away} size={44} />
                {away.name}
              </span>
            </h1>
            <div className="pl-hero__meta">
              <SignalCapsule match={m} score={sc} session={sessions[`match:${m.id}`]} nowMs={now} />
              <span className="pl-hero__clock">
                {sc.halftime ? 'Descanso' : `${sc.clock} · ${sc.detail}`}
              </span>
              {m.venue && <span className="pl-hero__venue">{m.venue}</span>}
            </div>
            <div className="pl-hero__cta">
              <Button variant="gold" size="lg" icon="play" onClick={() => onOpen({ match: m, score: sc })}>
                {watchingThis ? 'Seguir viendo' : 'Ver ahora'}
              </Button>
              <ScoreCapsule match={m} score={sc} size="lg" className="pl-hero__score" watching={watchingThis} />
              <span className="pl-hero__where">
                <Icon name="tv" size={14} /> {m.channels.map((c) => c.name).join(' · ')}
              </span>
            </div>
          </>
        )}
        {m && sc && featured.kind === 'next' && (
          <>
            <div className="pl-hero__eyebrow">
              <Icon name="clock" size={13} /> Próximo · {compName(m.competition)}
              {m.round && <span className="pl-hero__round"> · {m.round}</span>}
            </div>
            <h1 className="pl-hero__title">
              <span className="pl-hero__team">
                <Crest team={home} size={44} />
                {home.name}
              </span>
              <span className="pl-hero__team">
                <Crest team={away} size={44} />
                {away.name}
              </span>
            </h1>
            <div className="pl-hero__meta">
              <span className="pl-hero__bighour">{hhmm(m.start)}</span>
              <span className="pl-hero__clock">{untilText(m.start, now)}</span>
              {m.venue && <span className="pl-hero__venue">{m.venue}</span>}
            </div>
            <div className="pl-hero__cta">
              <Button variant="gold" size="lg" icon="calendar" onClick={() => onOpen({ match: m, score: sc })}>
                Ver el partido
              </Button>
              <span className="pl-hero__where">
                <Icon name="tv" size={14} /> {m.channels.map((c) => c.name).join(' · ')}
              </span>
            </div>
          </>
        )}
        {featured.kind === 'none' && (
          <>
            <div className="pl-hero__eyebrow">Ace Player Neo</div>
            <h1 className="pl-hero__title">
              <span>Sin partidos anunciados</span>
            </h1>
            <div className="pl-hero__cta">
              <Button variant="gold" size="lg" icon="tv" onClick={() => navigate('biblioteca')}>
                Ver los canales
              </Button>
            </div>
          </>
        )}
      </div>
      {others.length > 0 && (
        <aside className="pl-hero__side">
          <span className="pl-hero__sidetitle">También ahora</span>
          {others.map((x) => (
            <button key={x.match.id} type="button" className="pl-hero__mini" onClick={() => onOpen(x)}>
              <span className="pl-hero__minicrests">
                <Crest team={team(x.match.home)} size={22} />
                <Crest team={team(x.match.away)} size={22} />
              </span>
              <span className="pl-hero__minitext">
                <span>
                  {team(x.match.home).short} – {team(x.match.away).short}
                </span>
                <span className="pl-hero__minisub">
                  {compShort(x.match.competition)} · {whenText(x.match, x.score, now)}
                </span>
              </span>
              <Capsule tone="neutral" size="sm" glass>
                {x.score.home}–{x.score.away}
              </Capsule>
            </button>
          ))}
        </aside>
      )}
    </section>
  );
}

/** Fila horizontal con cabecera. */
export function HRow({ title, count, sub, live, action, as, children, className }: { title: string; count?: number; sub?: string; live?: boolean; action?: { label: string; run: () => void; icon?: 'chevronRight' }; as?: 'h2' | 'h3'; children: ReactNode; className?: string }) {
  return (
    <section className={`pl-hrow ${className ?? ''}`}>
      <RowHeader title={title} count={count} sub={sub} live={live} action={action} as={as} />
      <div className="pl-hrow__track">{children}</div>
    </section>
  );
}
