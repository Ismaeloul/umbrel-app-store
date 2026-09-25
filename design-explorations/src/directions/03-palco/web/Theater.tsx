/* Modo teatro (web): vídeo al ancho útil, luz de ambiente, capsulas debajo y
   panel lateral con Fuentes / Marcador / Más. Sirve para partido y canal. */

import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Source } from '../../../core/types';
import { back, navigate } from '../../../core/router';
import { channelsOf, connect, isMine, markCorrect, playChannel, playMatch, research, revealScore, selectSource, setFullscreen, togglePlay, useNow, useSim, now as simNow } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { Crest } from '../../../core/ui/Crest';
import { hhmm, plural, untilText } from '../../../core/format';
import { Button, Capsule, IconButton, Progress, Segmented } from '../components/primitives';
import { Icon } from '../components/icons';
import { MatchPoster, SourcePoster } from '../components/posters';
import { CenterState, ControlBar, PlayerNotices, ScoreCapsule, StatusCapsule, TechData, simulate } from '../components/player';
import { Ambient, CoverVideo } from '../components/video';
import { ActionMenu, PasteSheet, ReportSheet, type MenuItem } from '../components/sheets';
import { doPaste, doReport, moreItems, openChannelByName, sourceItems, useStageInfo } from '../components/stage';
import { useAutoHide, useGoalFlash, useMemoryState, useSources } from '../components/hooks';
import { compName, sessionSummary, sourceWord } from '../components/text';
import { HRow } from './Home';

type PanelTab = 'fuentes' | 'marcador' | 'mas';

export function Theater({ kind, id, panelOpen, setPanelOpen, pasteOpen, setPasteOpen }: { kind: 'match' | 'channel'; id: string; panelOpen: boolean; setPanelOpen: (v: boolean) => void; pasteOpen: boolean; setPasteOpen: (v: boolean) => void }) {
  const info = useStageInfo(kind, id);
  const session = useSources(kind, id);
  const player = useSim((s) => s.player);
  const line = useSim((s) => s.statusLine);
  const prefs = useSim((s) => s.preferences);
  const agenda = useSim((s) => s.agenda);
  const favorites = useSim((s) => s.favorites);
  const activeDir = useSim((s) => s.activeDirectoryId);
  const sessions = useSim((s) => s.sourceSessions);
  const revealed = useSim((s) => s.scoreRevealed);
  const now = useNow();
  const flash = useGoalFlash(info.match?.id);
  const [tab, setTab] = useMemoryState<PanelTab>('pl-web-panel-tab', 'fuentes');
  const [tech, setTech] = useState(false);
  const [report, setReport] = useState<Source | null>(null);
  const [menu, setMenu] = useState<{ title?: string; items: MenuItem[] } | null>(null);
  const [visible, poke, hold] = useAutoHide(info.engaged && player.media === 'playing', 3000);

  // Entrar en la ruta: arranca el partido en directo o el canal si no suena ya.
  useEffect(() => {
    const p = player;
    const isTarget = p.target?.kind === kind && p.target.id === id;
    if (isTarget) return;
    if (kind === 'channel') playChannel(id);
    else {
      const m = agenda.find((x) => x.id === id);
      if (m && scoreAt(m, simNow()).state !== 'pre') playMatch(id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, id]);

  const sources = session?.sources ?? [];
  const summary = sessionSummary(session);
  const m = info.match;
  const sc = info.score;
  const isPre = kind === 'match' && sc?.state === 'pre';
  const otherPlaying = !!player.target && !info.isTarget;
  const libraryChannels = useMemo(() => [...favorites, ...channelsOf(activeDir)], [favorites, activeDir]);
  const alsoLive = useMemo(() => agenda.map((x) => ({ match: x, score: scoreAt(x, now) })).filter((x) => x.score.state === 'in' && x.match.id !== m?.id), [agenda, now, m?.id]);

  const onSelect = (s: Source) => selectSource(kind, id, s.id);
  const openIn = (items: MenuItem[]) => setMenu({ title: 'Abrir en…', items });
  const more = () =>
    setMenu({
      items: moreItems(info, {
        onPaste: () => setPasteOpen(true),
        onReport: setReport,
        onTech: () => {
          setPanelOpen(true);
          setTab('mas');
          setTech(true);
        },
        onOpenIn: openIn,
        onSessions: () => navigate('ajustes', 'donde'),
      }),
    });

  const stageClick = () => {
    if (!visible) {
      poke();
      return;
    }
    if (info.engaged && player.conn === 'activa') {
      // clic = pausa/reanuda (como la app)
      togglePlay();
    }
  };

  const stage = (
    <div className={`pl-th__stage${player.fullscreen ? ' is-full' : ''}${!visible ? ' is-quiet' : ''}`} onMouseMove={poke} onMouseLeave={() => info.engaged && poke()} onDoubleClick={() => info.engaged && setFullscreen(!player.fullscreen)}>
      <div className="pl-th__video" onClick={stageClick} role="presentation">
        <CoverVideo fit="contain" playing={info.playing} quality={info.quality} home={info.home.primary} away={info.away.primary} channel={info.channelLabel} kind={info.videoKind} />
      </div>
      {!info.engaged && (
        <div className="pl-th__idle">
          {isPre && m && sc ? (
            <div className="pl-th__pre">
              <span className="pl-th__prehour">{hhmm(m.start)}</span>
              <span className="pl-th__presub">{untilText(m.start, now)} · las fuentes se comprueban 45 min antes</span>
              <Button variant="gold" size="lg" icon="tv" onClick={() => playMatch(id)}>
                Ver el canal ahora
              </Button>
            </div>
          ) : otherPlaying ? (
            <div className="pl-th__pre">
              <span className="pl-th__presub">Ahora suena «{player.target!.title}»</span>
              <Button variant="gold" size="lg" icon="play" onClick={() => (kind === 'match' ? playMatch(id) : playChannel(id))}>
                Ver esto aquí
              </Button>
            </div>
          ) : (
            <div className="pl-th__pre">
              <span className="pl-th__presub">Reproducción detenida</span>
              <Button variant="gold" size="lg" icon="play" onClick={() => (kind === 'match' ? playMatch(id) : playChannel(id))}>
                Volver a ver
              </Button>
            </div>
          )}
        </div>
      )}
      {info.engaged && (
        <>
          <div className="pl-th__center">
            <CenterState player={player} big onResumeHere={() => player.target?.sourceId && connect(player.target.sourceId, 'manual')} />
          </div>
          <AnimatePresence initial={false}>
            {visible && (
              <motion.div className="pl-th__overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} onMouseEnter={hold} onMouseLeave={poke}>
                <div className="pl-th__top">
                  <span className="pl-th__srccap">
                    {info.active ? (
                      <>
                        <span className={`pl-sp__dot pl-tone--${info.active.state === 'working' ? 'ok' : info.active.state === 'weak' ? 'weak' : 'fail'}`} style={{ background: 'currentColor' }} />
                        Fuente {info.activeIndex} · {info.active.listaName} · {sourceWord(info.active)}
                      </>
                    ) : (
                      'Buscando señal…'
                    )}
                  </span>
                  <span className="pl-th__topbtns">
                    {session && session.automatic && (
                      <Capsule tone="neutral" size="sm" glass icon="auto" title="Si esta fuente se cae, se pasa sola a la siguiente verificada">
                        Automático
                      </Capsule>
                    )}
                    <IconButton variant="video" icon={panelOpen ? 'chevronRight' : 'list'} label={panelOpen ? 'Ocultar el panel' : 'Fuentes y marcador'} onClick={() => setPanelOpen(!panelOpen)} />
                  </span>
                </div>
                <div className="pl-th__bottom">
                  <ControlBar player={player} showVolume onFullscreen={() => setFullscreen(!player.fullscreen)} onPip={() => simulate('pip')} onMore={more} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          {player.fullscreen && (
            <div className="pl-th__fsstatus">
              <StatusCapsule line={line} />
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className={`pl-th${panelOpen ? ' has-panel' : ''}`}>
      <div className="pl-th__ambient" aria-hidden="true">
        <Ambient home={info.home.primary} away={info.away.primary} flash={flash} strength={0.26} />
      </div>
      <div className="pl-th__main">
        <div className="pl-th__stagewrap">{stage}</div>

        <div className="pl-th__under">
          <div className="pl-th__head">
            <div className="pl-th__headtext">
              <span className="pl-eyebrow pl-th__eyebrow">
                {m ? (
                  <>
                    {sc?.state === 'in' && <span className="pl-livedot" />}
                    {compName(m.competition)}
                    {m.round && ` · ${m.round}`}
                    {m.venue && ` · ${m.venue}`}
                  </>
                ) : (
                  info.subtitle
                )}
              </span>
              <h1 className="pl-th__title">
                {m ? (
                  <>
                    <Crest team={info.home} size={32} /> {info.home.name} <span className="pl-th__vs">–</span> {info.away.name} <Crest team={info.away} size={32} />
                  </>
                ) : (
                  info.title
                )}
              </h1>
            </div>
            <div className="pl-th__caps">
              {m && sc && sc.state !== 'pre' && <ScoreCapsule match={m} score={sc} size="lg" watching={info.isTarget} />}
              <Capsule
                tone={summary.tone === 'neutral' ? 'checking' : summary.tone}
                dot={summary.tone === 'ok'}
                icon={summary.tone === 'fail' ? 'warning' : undefined}
                onClick={() => {
                  setPanelOpen(true);
                  setTab('fuentes');
                }}
                title={summary.detail}
              >
                {summary.label || 'Fuentes'} · {plural(sources.length, 'fuente', 'fuentes')}
              </Capsule>
              {m && (
                <span className="pl-th__where">
                  <Icon name="tv" size={14} />
                  {m.channels.map((c) => (
                    <button key={c.id} type="button" className={`pl-th__chan${libraryChannels.some((x) => x.title === c.name) ? '' : ' is-missing'}`} onClick={() => openChannelByName(c.name, libraryChannels)} title={libraryChannels.some((x) => x.title === c.name) ? `Ver ${c.name}` : `${c.name}: no está en tu biblioteca, se buscará`}>
                      {c.name}
                    </button>
                  ))}
                </span>
              )}
              <IconButton variant="solid" size={40} icon="more" label="Más acciones" onClick={more} />
            </div>
          </div>

          {!player.fullscreen && (
            <div className="pl-th__status">
              <StatusCapsule line={line} inline />
              <PlayerNotices player={player} sources={sources} />
            </div>
          )}

          {!panelOpen && sources.length > 0 && (
            <HRow title="Fuentes" count={sources.length} sub={summary.detail} action={{ label: 'Rebuscar', run: () => research(kind, id) }} as="h3" className="pl-th__srcrow">
              {sources.map((s, i) => (
                <SourcePoster key={s.id} source={s} index={i + 1} active={player.target?.sourceId === s.id && info.isTarget} home={info.home.primary} away={info.away.primary} channel={s.matchedChannel} onSelect={() => onSelect(s)} onMore={() => setMenu({ title: `Fuente ${i + 1} · ${s.title}`, items: sourceItems(info, s, { onReport: setReport, onOpenIn: openIn, onSelect: () => onSelect(s) }) })} disabled={s.state === 'failed' && !s.reason.startsWith('reported')} />
              ))}
            </HRow>
          )}

          {alsoLive.length > 0 && (
            <HRow title="También en directo" count={alsoLive.length} live as="h3">
              {alsoLive.map((x) => (
                <MatchPoster key={x.match.id} match={x.match} score={x.score} nowMs={now} session={sessions[`match:${x.match.id}`]} size="sm" mine={isMine(x.match, prefs)} covered={player.target?.id === x.match.id && !revealed[x.match.id]} onReveal={() => revealScore(x.match.id, true)} onClick={() => { playMatch(x.match.id); navigate('partido', x.match.id, null, { replace: true }); }} fixedWidth={240} />
              ))}
            </HRow>
          )}
          <div className="pl-th__back">
            <Button variant="quiet" size="sm" icon="arrowLeft" onClick={() => back()}>
              Volver
            </Button>
          </div>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {panelOpen && (
          <motion.aside className="pl-th__panel" initial={{ x: 40, opacity: 0 }} animate={{ x: 0, opacity: 1 }} exit={{ x: 40, opacity: 0 }} transition={{ duration: 0.26, ease: [0.2, 0.7, 0.2, 1] }} aria-label="Panel del partido">
            <div className="pl-th__paneltabs">
              <Segmented<PanelTab> label="Panel" size="sm" value={tab} onChange={setTab} options={[{ id: 'fuentes', label: 'Fuentes', count: sources.length }, { id: 'marcador', label: 'Marcador' }, { id: 'mas', label: 'Más' }]} />
              <IconButton variant="ghost" size={36} icon="x" label="Cerrar el panel" onClick={() => setPanelOpen(false)} />
            </div>
            <div className="pl-th__panelbody">
              {tab === 'fuentes' && (
                <div className="pl-th__sources">
                  <div className="pl-th__sourceshead">
                    <span className={`pl-th__sum pl-tone--${summary.tone === 'neutral' ? 'checking' : summary.tone}`}>{summary.detail || 'Reuniendo señales…'}</span>
                    <Button variant="quiet" size="sm" icon="refresh" onClick={() => research(kind, id)} disabled={session?.research}>
                      {session?.research ? 'Rebuscando…' : 'Rebuscar'}
                    </Button>
                  </div>
                  <div className="pl-th__grid">
                    {sources.map((s, i) => (
                      <SourcePoster key={s.id} source={s} index={i + 1} active={player.target?.sourceId === s.id && info.isTarget} home={info.home.primary} away={info.away.primary} channel={s.matchedChannel} onSelect={() => onSelect(s)} className="pl-sp--fluid" onMore={() => setMenu({ title: `Fuente ${i + 1} · ${s.title}`, items: sourceItems(info, s, { onReport: setReport, onOpenIn: openIn, onSelect: () => onSelect(s) }) })} />
                    ))}
                  </div>
                  <div className="pl-th__panelfoot">
                    <Button variant="quiet" size="sm" icon="paste" onClick={() => setPasteOpen(true)}>
                      Pegar un Content ID
                    </Button>
                    <span className="pl-th__kbdhint">N siguiente · 1–9 elige</span>
                  </div>
                </div>
              )}
              {tab === 'marcador' && (
                <div className="pl-th__scorepanel">
                  {m && sc ? (
                    <>
                      <div className="pl-th__scoreteams">
                        <Crest team={info.home} size={64} />
                        <div className="pl-th__scorecenter">
                          {sc.state === 'pre' ? <span className="pl-th__scorehour">{hhmm(m.start)}</span> : <ScoreCapsule match={m} score={sc} size="lg" watching={info.isTarget} />}
                          <span className="pl-th__scoredetail">{sc.state === 'pre' ? untilText(m.start, now) : sc.detail}</span>
                        </div>
                        <Crest team={info.away} size={64} />
                      </div>
                      <div className="pl-th__scorenames">
                        <span>{info.home.name}</span>
                        <span>{info.away.name}</span>
                      </div>
                      {sc.state !== 'pre' && <Progress value={sc.progress} tone={sc.state === 'in' ? 'live' : 'neutral'} className="pl-th__scorebar" />}
                      {(revealed[m.id] || sc.state === 'post' || !info.isTarget) && sc.goals.length > 0 && (
                        <ul className="pl-th__goals">
                          {sc.goals.map((g, i) => (
                            <li key={i} className={g.side === 'away' ? 'is-away' : ''}>
                              <span className="pl-th__goalmin">{g.minute}'</span>
                              <span className="pl-th__goalwho">
                                {g.scorer}
                                {g.kind === 'pen' ? ' (p.)' : ''}
                              </span>
                              <Crest team={g.side === 'home' ? info.home : info.away} size={18} />
                            </li>
                          ))}
                        </ul>
                      )}
                      {info.isTarget && !revealed[m.id] && sc.state === 'in' && <p className="pl-th__spoiler">El marcador va tapado mientras lo ves: tu señal va unos segundos por detrás del directo.</p>}
                    </>
                  ) : (
                    <p className="pl-th__spoiler">Este canal no tiene ningún partido en la agenda ahora mismo.</p>
                  )}
                </div>
              )}
              {tab === 'mas' && (
                <div className="pl-th__more">
                  {m && (
                    <div className="pl-th__block">
                      <span className="pl-eyebrow">Dónde se emite</span>
                      <div className="pl-th__chans">
                        {m.channels.map((c) => (
                          <button key={c.id} type="button" className={`pl-th__chan pl-th__chan--big${libraryChannels.some((x) => x.title === c.name) ? '' : ' is-missing'}`} onClick={() => openChannelByName(c.name, libraryChannels)}>
                            <Icon name="tv" size={16} /> {c.name}
                            <span>{libraryChannels.some((x) => x.title === c.name) ? 'En tu biblioteca' : 'Se buscará'}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="pl-th__block">
                    <span className="pl-eyebrow">Acciones</span>
                    <div className="pl-th__actions">
                      <Button variant="quiet" size="sm" icon="refresh" onClick={() => research(kind, id)}>
                        Rebuscar
                      </Button>
                      <Button variant="quiet" size="sm" icon="paste" onClick={() => setPasteOpen(true)}>
                        Pegar Content ID
                      </Button>
                      {info.active && (
                        <>
                          <Button variant="quiet" size="sm" icon="check" onClick={() => markCorrect(kind, id, info.active!.id, true)}>
                            Es el canal correcto
                          </Button>
                          <Button variant="quiet" size="sm" icon="flag" onClick={() => setReport(info.active!)}>
                            Reportar
                          </Button>
                          <Button variant="quiet" size="sm" icon="external" onClick={() => openIn(sourceItems(info, info.active!, { onReport: setReport, onOpenIn: openIn, onSelect: () => onSelect(info.active!) }).slice(4))}>
                            Abrir en…
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                  <TechData player={player} source={info.active} open={tech} onToggle={() => setTech((v) => !v)} />
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <ReportSheet open={!!report} onClose={() => setReport(null)} mode="web" source={report} onReport={(r) => report && doReport(info, report, r)} />
      <PasteSheet open={pasteOpen} onClose={() => setPasteOpen(false)} mode="web" onPlay={(h) => doPaste(info, h)} />
      <ActionMenu open={!!menu} onClose={() => setMenu(null)} mode="web" title={menu?.title} items={menu?.items ?? []} />
    </div>
  );
}
