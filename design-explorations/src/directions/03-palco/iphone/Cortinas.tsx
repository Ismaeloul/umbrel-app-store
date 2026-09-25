/* Contenido de las tres cortinas del iPhone: Agenda, Canales (con Buscar) y
   Ajustes. Cada una devuelve su cabecera (va en la zona de arrastre) y su cuerpo. */

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Item } from '../../../core/types';
import { back, navigate, useRoute } from '../../../core/router';
import { activateDirectory, channelsOf, completeOnboarding, isFavorite, isMine, playChannel, playMatch, removeRecent, renameItem, revealScore, toggleFavorite, useNow, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { longDate, plural } from '../../../core/format';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Button, Capsule, Empty, IconButton, ListRow, RowHeader, Segmented, TextField } from '../components/primitives';
import { Icon, Spinner } from '../components/icons';
import { ChannelPoster, MatchPoster } from '../components/posters';
import { ActionMenu, RenameSheet, openInItems, type MenuItem } from '../components/sheets';
import { DayStrip, FirstUseCard, useAgendaDay, useDayCounts, useFeatured, useForYouCount, useWarmSources, type Scored } from '../components/agenda';
import { useDays, useMemoryState, useReducedMotion, sameDay } from '../components/hooks';
import { ChannelRow, availabilityTone, emittingNow, groupByCategory, groupRecents, nowLine, searchEngine, searchLibrary, uniqueByTitle } from '../components/library';
import { SETTINGS_SECTIONS, SettingsBody, type SettingsSectionId } from '../components/settings';
import { ENGINE_TITLES, engineHash } from '../components/stage';
import { cap, detectContentId } from '../components/text';

export interface CurtainParts {
  header: ReactNode;
  body: ReactNode;
}

// ---------------------------------------------------------------- Agenda

export function useAgendaCurtain(day: number, setDay: (d: number) => void, onFull: () => void): CurtainParts {
  const now = useNow();
  const days = useDays(now);
  const prefs = useSim((s) => s.preferences);
  const agenda = useSim((s) => s.agenda);
  const player = useSim((s) => s.player);
  const sessions = useSim((s) => s.sourceSessions);
  const revealed = useSim((s) => s.scoreRevealed);
  const [filter, setFilter] = useMemoryState<'foryou' | 'all'>('pl-ip-filter', 'foryou');
  const hasPrefs = prefs.onboardingComplete && (prefs.leagues.length || prefs.teams.length || prefs.nationalities.length) > 0;
  const eff: 'foryou' | 'all' = hasPrefs ? filter : 'all';
  const data = useAgendaDay(day, eff);
  const counts = useDayCounts(days, eff);
  const fy = useForYouCount(day);
  const todays = useMemo(() => agenda.filter((m) => sameDay(m.start, now)), [agenda, Math.floor(now / 3600_000)]);
  useWarmSources(todays);
  const watchingId = player.target?.kind === 'match' ? player.target.id : null;
  const featuredId = useFeatured().match?.id ?? null;

  const open = (x: Scored) => {
    if (x.score.state === 'in') playMatch(x.match.id);
    navigate('partido', x.match.id);
  };
  const poster = (x: Scored) => <MatchPoster key={x.match.id} match={x.match} score={x.score} nowMs={now} session={sessions[`match:${x.match.id}`]} size="lg" mine={isMine(x.match, prefs)} watching={watchingId === x.match.id} featured={featuredId === x.match.id} covered={watchingId === x.match.id && !revealed[x.match.id]} onReveal={() => revealScore(x.match.id, true)} onClick={() => open(x)} />;

  const header = (
    <div className="pl-ip__chead">
      <div className="pl-ip__cheadrow">
        <h2 className="pl-ip__ctitle">Agenda</h2>
        <Segmented<'foryou' | 'all'> label="Filtro" size="sm" value={eff} onChange={setFilter} options={[{ id: 'foryou', label: 'Para ti', count: fy.foryou, disabled: !hasPrefs }, { id: 'all', label: 'Todos', count: fy.all }]} />
      </div>
      <DayStrip days={days} selected={day} onSelect={(d) => { setDay(d); }} counts={counts} nowMs={now} compact />
    </div>
  );

  const body = (
    <div className="pl-ip__agenda">
      <p className="pl-ip__daylabel">{cap(longDate(day))}</p>
      {!prefs.onboardingComplete && <FirstUseCard compact onPersonalize={() => navigate('gustos')} onLater={completeOnboarding} />}
      {data.total === 0 ? (
        eff === 'foryou' && data.totalAll > 0 ? (
          <Empty compact icon="ball" title="Nada de lo tuyo este día" text={`Hay ${plural(data.totalAll, 'partido', 'partidos')} de otras ligas.`} action={{ label: 'Ver todos', run: () => setFilter('all') }} secondary={{ label: 'Mis gustos', run: () => navigate('gustos') }} />
        ) : (
          <Empty compact icon="calendar" title="Sin partidos anunciados" text="Este día no hay nada en la agenda." action={days.some((d) => d > day) ? { label: 'Ver el día siguiente', run: () => setDay(days.find((d) => d > day)!) } : undefined} />
        )
      ) : (
        <>
          {data.live.length > 0 && (
            <section className="pl-ip__group">
              <RowHeader as="h3" title="En directo" count={data.live.length} live />
              <div className="pl-ip__stack">{data.live.map(poster)}</div>
            </section>
          )}
          {data.upcoming.length > 0 && (
            <section className="pl-ip__group">
              <RowHeader as="h3" title="Próximos" count={data.upcoming.length} />
              <div className="pl-ip__stack">{data.upcoming.map(poster)}</div>
            </section>
          )}
          {data.finished.length > 0 && (
            <section className="pl-ip__group">
              <RowHeader as="h3" title="Terminados" count={data.finished.length} />
              <div className="pl-ip__stack">{data.finished.map(poster)}</div>
            </section>
          )}
        </>
      )}
      <button type="button" className="pl-ip__more-link" onClick={onFull} aria-hidden="true" tabIndex={-1} />
    </div>
  );
  return { header, body };
}

// ---------------------------------------------------------------- Canales (+ Buscar)

export function useCanalesCurtain(searchMode: boolean, onFull: () => void, onPaste: () => void): CurtainParts & { sheets: ReactNode } {
  const now = useNow();
  const agenda = useSim((s) => s.agenda);
  const favorites = useSim((s) => s.favorites);
  const history = useSim((s) => s.history);
  const directories = useSim((s) => s.directories);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const player = useSim((s) => s.player);
  const engine = useSim((s) => s.engine.status);
  const route = useRoute();
  const [q, setQ] = useState(route.screen === 'buscar' ? (route.param ?? '') : '');
  const [dir, setDir] = useMemoryState<string>('pl-ip-dir', activeDir);
  const [open, setOpen] = useMemoryState<Record<string, boolean>>('pl-ip-cats', {});
  const [menu, setMenu] = useState<{ item: Item; items: MenuItem[] } | null>(null);
  const [rename, setRename] = useState<Item | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (searchMode) setTimeout(() => inputRef.current?.focus(), 250);
  }, [searchMode]);

  const dirItems = channelsOf(directories.some((d) => d.id === dir) ? dir : activeDir);
  const libraryChannels = useMemo(() => uniqueByTitle([...favorites, ...channelsOf(activeDir)]), [favorites, activeDir]);
  const emitting = useMemo(() => emittingNow(libraryChannels, agenda, now), [libraryChannels, agenda, now]);
  const recents = useMemo(() => groupRecents(history, Date.now()), [history]);
  const cats = useMemo(() => groupByCategory(dirItems), [dirItems]);
  const all = useMemo(() => [...favorites, ...history, ...channelsOf('principal'), ...channelsOf('elcano'), ...channelsOf('nueva-era')], [favorites, history]);
  const watchingId = player.target?.kind === 'channel' ? player.target.id : null;
  const cid = detectContentId(q);
  const lib = useMemo(() => (cid ? [] : searchLibrary(q, all).slice(0, 10)), [q, all, cid]);
  const eng = useMemo(() => (cid || q.trim().length < 2 ? [] : searchEngine(q)), [q, cid]);
  useEffect(() => {
    if (cid || q.trim().length < 2) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      setLoading(false);
      setDone(q);
    }, 650);
    return () => clearTimeout(t);
  }, [q, cid]);

  const play = (it: Item) => {
    playChannel(it.id);
    navigate('canal', it.id);
  };
  const itemsFor = (it: Item, inRecents: boolean): MenuItem[] => [
    { id: 'ver', label: 'Ver canal', icon: 'play', run: () => play(it) },
    { id: 'fav', label: isFavorite(it.id) ? 'Quitar de favoritos' : 'Guardar en favoritos', icon: isFavorite(it.id) ? 'star' : 'starFill', run: () => toggleFavorite(it.id, it.title) },
    { id: 'ren', label: 'Renombrar', icon: 'pencil', run: () => setRename(it) },
    ...(inRecents ? [{ id: 'rm', label: 'Quitar de recientes', icon: 'trash' as const, danger: true, run: () => removeRecent(it.id) }] : []),
    ...openInItems({ id: it.id } as never),
  ];
  const playEngine = (title: string) => {
    const h = engineHash(title);
    ENGINE_TITLES.set(h, title);
    playChannel(h);
    navigate('canal', h);
  };

  const header = (
    <div className="pl-ip__chead">
      <div className="pl-ip__cheadrow">
        <h2 className="pl-ip__ctitle">{q ? 'Buscar' : 'Canales'}</h2>
        <IconButton variant="solid" size={36} icon="paste" label="Pegar Content ID" onClick={onPaste} />
      </div>
      <div onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        <TextField ref={inputRef} icon="search" placeholder="Canal, o pega un enlace…" value={q} onChange={(e) => setQ(e.target.value)} onFocus={onFull} autoComplete="off" spellCheck={false} trailing={q ? <button type="button" className="pl-field__clear" aria-label="Borrar" onClick={() => setQ('')}><Icon name="x" size={14} /></button> : undefined} />
      </div>
    </div>
  );

  const searchBody = (
    <div className="pl-ip__search">
      {cid && (
        <div className="pl-search__link">
          <Capsule tone="ok" icon="link">
            Enlace detectado
          </Capsule>
          <span className="pl-search__linktext">Se reproduce como fuente externa, sin guardarlo.</span>
          <Button variant="gold" block icon="play" onClick={() => { ENGINE_TITLES.set(cid, 'Enlace pegado'); playChannel(cid); navigate('canal', cid); }}>
            Reproducir
          </Button>
        </div>
      )}
      {!cid && (
        <>
          <section className="pl-ip__group">
            <RowHeader as="h3" title="En tu biblioteca" count={lib.length} />
            {lib.length === 0 ? <p className="pl-search__none">Nada con «{q}».</p> : <div className="pl-ip__list">{lib.map((it) => <ChannelRow key={it.id} item={it} now={nowLine(it.title, agenda, now)} favorite={isFavorite(it.id)} watching={watchingId === it.id} onPlay={() => play(it)} onMore={() => setMenu({ item: it, items: itemsFor(it, false) })} dense />)}</div>}
          </section>
          <section className="pl-ip__group">
            <RowHeader as="h3" title="En el motor" count={!loading && q.trim().length >= 2 ? eng.length : undefined} />
            {engine !== 'online' ? (
              <p className="pl-search__none">
                <Icon name="warning" size={14} /> El motor no responde ahora mismo.
              </p>
            ) : q.trim().length < 2 ? (
              <p className="pl-search__none">Escribe al menos dos letras.</p>
            ) : loading || done !== q ? (
              <p className="pl-search__none">
                <Spinner size={16} /> Buscando «{q}»…
              </p>
            ) : eng.length === 0 ? (
              <p className="pl-search__none">El motor no encuentra nada con «{q}».</p>
            ) : (
              <ul className="pl-search__eng">
                {eng.map((r) => (
                  <li key={r.title}>
                    <button type="button" className="pl-search__engrow" onClick={() => playEngine(r.title)}>
                      <ChannelMark name={r.title} size={40} radius={10} />
                      <span className="pl-search__engtext">
                        <span className="pl-search__engtitle">{r.title}</span>
                        <span className="pl-search__engsub">{r.category}</span>
                      </span>
                      <Capsule tone={availabilityTone(r.availability)} size="sm" dot>
                        {Math.round(r.availability * 100)} %
                      </Capsule>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );

  const dirMeta = directories.find((d) => d.id === dir) ?? directories[0];
  const libraryBody = (
    <div className="pl-ip__canales">
      {emitting.length > 0 && (
        <section className="pl-ip__group">
          <RowHeader as="h3" title="Emitiendo ahora" count={emitting.length} live />
          <div className="pl-ip__hscroll">
            {emitting.map((e) => (
              <ChannelPoster key={e.item.id} item={e.item} now={nowLine(e.item.title, agenda, now)} size="sm" favorite={isFavorite(e.item.id)} watching={watchingId === e.item.id} onClick={() => play(e.item)} fixedWidth={220} />
            ))}
          </div>
        </section>
      )}
      <section className="pl-ip__group">
        <RowHeader as="h3" title="Favoritos" count={favorites.length} />
        {favorites.length === 0 ? (
          <Empty compact icon="star" title="Aún no tienes favoritos" text="Marca un canal con la estrella." action={{ label: 'Ver las listas', run: () => document.getElementById('pl-ip-listas')?.scrollIntoView({ behavior: 'smooth' }) }} />
        ) : (
          <div className="pl-ip__hscroll">
            {favorites.map((f) => (
              <ChannelPoster key={f.id} item={f} now={nowLine(f.title, agenda, now)} size="sm" favorite watching={watchingId === f.id} onClick={() => play(f)} fixedWidth={200} />
            ))}
          </div>
        )}
      </section>
      <section className="pl-ip__group">
        <RowHeader as="h3" title="Recientes" count={history.length} />
        {recents.length === 0 ? (
          <Empty compact icon="clock" title="Aún no has visto nada" text="Lo que veas irá quedando aquí." action={{ label: 'Ver la agenda', run: () => navigate('agenda') }} />
        ) : (
          recents.map((g) => (
            <div key={g.label} className="pl-ip__recgroup">
              <h4 className="pl-recents__label">{g.label}</h4>
              <div className="pl-ip__list">
                {g.items.map((it) => (
                  <ChannelRow key={it.id} item={it} now={nowLine(it.title, agenda, now)} favorite={isFavorite(it.id)} watching={watchingId === it.id} onPlay={() => play(it)} onMore={() => setMenu({ item: it, items: itemsFor(it, true) })} dense />
                ))}
              </div>
            </div>
          ))
        )}
      </section>
      <section className="pl-ip__group" id="pl-ip-listas">
        <RowHeader as="h3" title="Listas" count={directories.length} action={{ label: 'Gestionar', run: () => navigate('ajustes', 'listas'), icon: 'chevronRight' }} />
        <div className="pl-ip__dirbar">
          <Segmented label="Lista" size="sm" value={dirMeta?.id ?? ''} onChange={setDir} options={directories.map((d) => ({ id: d.id, label: d.name }))} />
          {dirMeta && dirMeta.id !== activeDir ? (
            <Button variant="quiet" size="sm" onClick={() => activateDirectory(dirMeta.id)}>
              Usar
            </Button>
          ) : (
            <Capsule tone="ok" size="sm" icon="check">
              En uso
            </Capsule>
          )}
        </div>
        {cats.length === 0 ? (
          <Empty compact icon="list" title="Lista vacía" text="Actualízala o añade otra en Ajustes › Listas." action={{ label: 'Ir a Listas', run: () => navigate('ajustes', 'listas') }} />
        ) : (
          <div className="pl-cats">
            {cats.map((c, i) => {
              const isOpen = open[`${dir}:${c.category}`] ?? i < 1;
              return (
                <div key={c.category} className={`pl-cat${isOpen ? ' is-open' : ''}`}>
                  <button type="button" className="pl-cat__head" onClick={() => setOpen({ ...open, [`${dir}:${c.category}`]: !isOpen })} aria-expanded={isOpen}>
                    <span className="pl-cat__title">{c.category}</span>
                    <span className="pl-cat__count">{c.items.length}</span>
                    <Icon name="chevronDown" size={16} className="pl-cat__chev" />
                  </button>
                  {isOpen && (
                    <div className="pl-ip__list pl-cat__list">
                      {c.items.map((it) => (
                        <ChannelRow key={it.id} item={it} now={nowLine(it.title, agenda, now)} favorite={isFavorite(it.id)} watching={watchingId === it.id} onPlay={() => play(it)} onStar={() => toggleFavorite(it.id, it.title)} onMore={() => setMenu({ item: it, items: itemsFor(it, false) })} dense />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );

  const sheets = (
    <>
      <ActionMenu open={!!menu} onClose={() => setMenu(null)} mode="iphone" title={menu?.item.title} items={menu?.items ?? []} />
      <RenameSheet open={!!rename} onClose={() => setRename(null)} mode="iphone" title={rename?.title ?? ''} onSave={(t) => rename && renameItem(rename.id, t)} />
    </>
  );

  return { header, body: q ? searchBody : libraryBody, sheets };
}

// ---------------------------------------------------------------- Ajustes

export function useAjustesCurtain(sub: string | null): CurtainParts {
  const rm = useReducedMotion();
  const engine = useSim((s) => s.engine.status);
  const sessions = useSim((s) => s.sessions);
  const id = SETTINGS_SECTIONS.find((s) => s.id === sub)?.id ?? null;
  const current = id ? SETTINGS_SECTIONS.find((s) => s.id === id)! : null;

  const header = (
    <div className="pl-ip__chead">
      <div className="pl-ip__cheadrow">
        {current ? (
          <>
            <IconButton variant="solid" size={36} icon="chevronLeft" label="Ajustes" onClick={() => back('ajustes')} />
            <h2 className="pl-ip__ctitle pl-ip__ctitle--sub">{current.label}</h2>
          </>
        ) : (
          <h2 className="pl-ip__ctitle">Ajustes</h2>
        )}
      </div>
    </div>
  );

  const body = (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={id ?? 'index'} initial={{ opacity: 0, x: rm ? 0 : id ? 40 : -40 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: rm ? 0 : id ? 40 : -40 }} transition={{ duration: rm ? 0.12 : 0.24, ease: [0.2, 0.7, 0.2, 1] }} className="pl-ip__ajustes">
        {id ? (
          <SettingsBody id={id as SettingsSectionId} onOpenAgenda={() => navigate('agenda')} onEditPrefs={() => navigate('gustos')} />
        ) : (
          <>
            <div className="pl-ip__setlist">
              {SETTINGS_SECTIONS.map((s) => (
                <ListRow key={s.id} icon={s.icon} title={s.label} sub={s.hint} onClick={() => navigate('ajustes', s.id)} trailing={s.id === 'salud' && engine !== 'online' ? <span className="pl-settings__badge is-warn" style={{ position: 'static', transform: 'none' }} /> : s.id === 'donde' && sessions.length > 0 ? <span className="pl-settings__badge is-live" style={{ position: 'static', transform: 'none' }} /> : undefined} />
              ))}
            </div>
            <p className="pl-ip__version">Ace Player Neo 0.7.1 · exploración «Palco»</p>
          </>
        )}
      </motion.div>
    </AnimatePresence>
  );
  return { header, body };
}

export function todaysScoreState(agenda: { start: number }[], nowMs: number) {
  return agenda.filter((m) => sameDay(m.start, nowMs)).length;
}

export { scoreAt };
