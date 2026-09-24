/* Centro de partido del iPhone: el escenario en directo arriba y las cápsulas
   debajo (Marcador · Señal · Dónde se emite · Más). Deslizar el vídeo hacia
   abajo encoge la pantalla y la minimiza al soltar. Las fuentes son carteles
   con anillo de calidad. Pantalla completa: giro simulado dentro del marco, o
   la orientación real cuando el iPhone está girado. */

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, animate, motion, useMotionValue, useTransform, type MotionValue, type PanInfo } from 'motion/react';
import type { Source } from '../../../core/types';
import { back, navigate } from '../../../core/router';
import { channelsOf, connect, derivePhase, isMine, nextSource, playChannel, playMatch, research, revealScore, selectSource, setFullscreen, togglePlay, useNow, useSim, now as simNow } from '../../../core/store';
import { haptic } from '../components/haptics';
import { scoreAt } from '../../../core/score';
import { Crest } from '../../../core/ui/Crest';
import { hhmm, plural, untilText } from '../../../core/format';
import { Button, Capsule, IconButton, RowHeader } from '../components/primitives';
import { Icon } from '../components/icons';
import { MatchPoster, SourcePoster } from '../components/posters';
import { CenterState, ControlBar, PlayerNotices, ScoreCapsule, StatusCapsule, TechData, handoffActive, simulate } from '../components/player';
import { Ambient, CoverVideo } from '../components/video';
import { ActionMenu, PasteSheet, ReportSheet, Sheet, type MenuItem } from '../components/sheets';
import { doPaste, doReport, moreItems, openChannelByName, sourceItems, useStageInfo, type StageInfo } from '../components/stage';
import { useAutoHide, useGoalFlash, useReducedMotion, useSources } from '../components/hooks';
import { compName, sessionSummary, sourceWord } from '../components/text';

/** Rótulo de la esquina del vídeo: qué fuente suena o qué pasa con ella. */
function sourceCaption(info: StageInfo, phase: ReturnType<typeof derivePhase>, handoff: boolean): string {
  if (handoff) return 'En otro dispositivo';
  if (phase === 'error') return 'Sin señal';
  if (phase === 'reconectando') return `Reconectando · fuente ${info.activeIndex || '?'}`;
  if (info.active) return `Fuente ${info.activeIndex} · ${sourceWord(info.active)}`;
  return 'Buscando señal…';
}

export function Player({ kind, id, W, H, landscape = false, edgeX }: { kind: 'match' | 'channel'; id: string; W: number; H: number; landscape?: boolean; edgeX?: MotionValue<number> }) {
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
  const rm = useReducedMotion();
  const flash = useGoalFlash(info.match?.id);
  const [report, setReport] = useState<Source | null>(null);
  const [menu, setMenu] = useState<{ title?: string; items: MenuItem[] } | null>(null);
  const [srcOpen, setSrcOpen] = useState(false);
  const [paste, setPaste] = useState(false);
  const [tech, setTech] = useState(false);
  const [visible, poke, , hide] = useAutoHide(info.engaged && player.media === 'playing', 3200);
  const sc = info.score;

  // Arrastre del vídeo hacia abajo: toda la pantalla encoge y se apaga; al soltar, minimiza.
  const pull = useMotionValue(0);
  const stageScale = useTransform(pull, [0, 320], [1, 0.92]);
  const stageRadius = useTransform(pull, [0, 60], [0, 34]);
  const bodyOpacity = useTransform(pull, [0, 200], [1, 0.25]);
  const fallbackX = useMotionValue(0);
  const x = edgeX ?? fallbackX;
  // Deslizar el vídeo a los lados: siguiente / anterior fuente (con un corte a negro).
  const swipeX = useMotionValue(0);
  const hintPrev = useTransform(swipeX, [0, 90], [0, 1]);
  const hintNext = useTransform(swipeX, [-90, 0], [1, 0]);
  const armed = useRef<-1 | 0 | 1>(0);
  const lastTap = useRef(0);
  const [cut, setCut] = useState(0);
  const prevSource = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const cur = player.target?.sourceId ?? null;
    if (prevSource.current !== undefined && prevSource.current !== cur && cur) setCut((c) => c + 1);
    prevSource.current = cur;
  }, [player.target?.sourceId]);
  // Gol: rebote del marcador y sensación de éxito.
  const goalTotal = sc ? sc.home + sc.away : -1;
  const prevGoals = useRef(goalTotal);
  useEffect(() => {
    if (prevGoals.current >= 0 && goalTotal > prevGoals.current) haptic('success');
    prevGoals.current = goalTotal;
  }, [goalTotal]);

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
  const isPre = kind === 'match' && sc?.state === 'pre';
  const otherPlaying = !!player.target && !info.isTarget;
  const handoff = handoffActive(player);
  const phase = derivePhase(player);
  const libraryChannels = useMemo(() => [...favorites, ...channelsOf(activeDir)], [favorites, activeDir]);
  const alsoLive = useMemo(() => agenda.map((x) => ({ match: x, score: scoreAt(x, now) })).filter((x) => x.score.state === 'in' && x.match.id !== m?.id), [agenda, now, m?.id]);
  const goalsVisible = !!m && !!sc && sc.goals.length > 0 && (!info.isTarget || !!revealed[m.id] || sc.state === 'post');

  const onSelect = (s: Source) => {
    haptic('rigid');
    selectSource(kind, id, s.id);
  };
  const openIn = (items: MenuItem[]) => setMenu({ title: 'Abrir en…', items });
  const more = () =>
    setMenu({
      items: moreItems(info, {
        onPaste: () => setPaste(true),
        onReport: setReport,
        onTech: () => setTech(true),
        onOpenIn: openIn,
        onSessions: () => navigate('ajustes', 'donde'),
      }),
    });
  const where = () =>
    m &&
    setMenu({
      title: 'Dónde se emite',
      items: m.channels.map((c) => ({
        id: c.id,
        label: c.name,
        icon: 'tv' as const,
        hint: libraryChannels.some((x) => x.title === c.name) ? 'En tu biblioteca' : 'No está en tu biblioteca: se buscará',
        run: () => openChannelByName(c.name, libraryChannels),
      })),
    });

  const canZap = info.engaged && sources.filter((s) => s.state !== 'failed').length > 1;
  const onVideoDrag = (_: unknown, i: PanInfo) => {
    const horizontal = Math.abs(i.offset.x) > Math.abs(i.offset.y);
    if (horizontal && canZap) {
      swipeX.set(i.offset.x);
      const want: -1 | 0 | 1 = i.offset.x > 80 ? -1 : i.offset.x < -80 ? 1 : 0;
      if (want !== armed.current) {
        armed.current = want;
        if (want !== 0) haptic('light');
      }
      return;
    }
    const dy = Math.max(0, i.offset.y);
    if (dy > 110 && pull.get() <= 110) haptic('medium');
    pull.set(dy);
  };
  const onVideoDragEnd = (_: unknown, i: PanInfo) => {
    const horizontal = Math.abs(i.offset.x) > Math.abs(i.offset.y);
    if (horizontal && canZap) {
      const dir: 1 | -1 | 0 = i.offset.x < -80 || i.velocity.x < -500 ? 1 : i.offset.x > 80 || i.velocity.x > 500 ? -1 : 0;
      animate(swipeX, 0, rm ? { duration: 0.12 } : { type: 'spring', stiffness: 420, damping: 40 });
      armed.current = 0;
      if (dir !== 0) {
        haptic('rigid');
        nextSource(kind, id, dir);
      }
      return;
    }
    if (i.offset.y > 110 || i.velocity.y > 600) back();
    else animate(pull, 0, rm ? { duration: 0.12 } : { type: 'spring', stiffness: 420, damping: 40 });
  };
  const onVideoTap = (e: { target: EventTarget | null }) => {
    if (!info.engaged) return;
    if ((e.target as HTMLElement | null)?.closest('button')) return;
    const t = performance.now();
    if (t - lastTap.current < 280) {
      // doble toque: pantalla completa
      lastTap.current = 0;
      haptic('medium');
      setFullscreen(!player.fullscreen);
      return;
    }
    lastTap.current = t;
    // un toque: enseña o esconde los controles (la pausa vive en su botón)
    if (visible) hide();
    else poke();
  };
  const entrance = (i: number) => ({ initial: { opacity: 0, y: rm ? 0 : 14 }, animate: { opacity: 1, y: 0 }, transition: { duration: rm ? 0.12 : 0.36, delay: rm ? 0 : 0.06 + i * 0.05, ease: [0.2, 0.7, 0.2, 1] as const } });

  const videoH = Math.round((W * 9) / 16);
  const fsActive = player.fullscreen || landscape;
  const resumeHere = () => player.target?.sourceId && connect(player.target.sourceId, 'manual');

  const overlay = (
    <>
      <div className="pl-ip__center">
        <CenterState player={player} onResumeHere={resumeHere} />
      </div>
      <AnimatePresence initial={false}>
        {visible && info.engaged && (
          <motion.div className="pl-ip__overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            <div className="pl-ip__ovtop">
              <span className={`pl-th__srccap${phase === 'error' ? ' is-err' : ''}`}>{sourceCaption(info, phase, handoff)}</span>
              {session?.automatic && info.active && (
                <Capsule tone="neutral" size="sm" glass icon="auto" title="Si esta fuente se cae, se pasa sola a la siguiente verificada">
                  Auto
                </Capsule>
              )}
            </div>
            <ControlBar player={player} compact onFullscreen={() => setFullscreen(!player.fullscreen)} onPip={() => simulate('pip')} onAirplay={() => simulate('airplay')} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  return (
    <motion.div className="pl-ip__player" style={{ x, scale: stageScale, borderRadius: stageRadius }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: rm ? 0.12 : 0.42 }}>
      <Ambient home={info.home.primary} away={info.away.primary} flash={flash} strength={0.24} />
      <header className="pl-ip__phead">
        <IconButton variant="ghost" icon="chevronDown" label="Minimizar" onClick={() => { haptic('light'); back(); }} />
        <span className="pl-ip__pheadtext">
          {m && kind === 'match' ? (
            <>
              {sc?.state === 'in' && <span className="pl-livedot" style={{ width: 6, height: 6 }} />}
              {compName(m.competition)}
              {m.round ? ` · ${m.round}` : ''}
            </>
          ) : (
            <>
              {info.engaged && phase === 'reproduciendo' && <span className="pl-livedot" style={{ width: 6, height: 6 }} />}
              {info.title}
              {info.subtitle && info.subtitle !== info.title ? ` · ${info.subtitle}` : ''}
            </>
          )}
        </span>
        <IconButton variant="ghost" icon="more" label="Más" onClick={more} />
      </header>

      <motion.div
        className="pl-ip__video"
        layoutId="pl-stage-video"
        style={{ height: videoH }}
        drag={canZap ? true : 'y'}
        dragDirectionLock
        dragConstraints={{ top: 0, bottom: 0, left: 0, right: 0 }}
        dragElastic={{ top: 0, bottom: 0.45, left: canZap ? 0.35 : 0, right: canZap ? 0.35 : 0 }}
        dragMomentum={false}
        onDrag={onVideoDrag}
        onDragEnd={onVideoDragEnd}
        onTap={onVideoTap}
        transition={{ type: 'spring', stiffness: 400, damping: 40 }}
      >
        <CoverVideo fit="contain" playing={info.playing} quality={info.quality} home={info.home.primary} away={info.away.primary} channel={info.channelLabel} kind={info.videoKind} />
        {/* Corte a negro al cambiar de fuente, como un cambio de canal real */}
        <AnimatePresence>{cut > 0 && info.engaged && <motion.div key={cut} className="pl-ip__cut" initial={{ opacity: 1 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }} transition={{ duration: rm ? 0.1 : 0.55, ease: 'easeOut' }} aria-hidden="true" />}</AnimatePresence>
        {canZap && (
          <>
            <motion.span className="pl-ip__zaphint is-prev" style={{ opacity: hintPrev }} aria-hidden="true">
              <Icon name="chevronLeft" size={18} /> Fuente anterior
            </motion.span>
            <motion.span className="pl-ip__zaphint is-next" style={{ opacity: hintNext }} aria-hidden="true">
              Siguiente fuente <Icon name="chevronRight" size={18} />
            </motion.span>
          </>
        )}
        {info.engaged ? (
          overlay
        ) : (
          <div className="pl-ip__idle">
            {isPre && m && sc ? (
              <>
                <span className="pl-ip__idlehour">{hhmm(m.start)}</span>
                <span className="pl-ip__idlesub">{untilText(m.start, now)}</span>
                <Button variant="gold" size="sm" icon="tv" onClick={() => playMatch(id)}>
                  Ver el canal ahora
                </Button>
              </>
            ) : otherPlaying ? (
              <>
                <span className="pl-ip__idlesub">Ahora suena «{player.target!.title}»</span>
                <Button variant="gold" size="sm" icon="play" onClick={() => (kind === 'match' ? playMatch(id) : playChannel(id))}>
                  Ver esto aquí
                </Button>
              </>
            ) : (
              <>
                <span className="pl-ip__idlesub">Reproducción detenida</span>
                <Button variant="gold" size="sm" icon="play" onClick={() => (kind === 'match' ? playMatch(id) : playChannel(id))}>
                  Volver a ver
                </Button>
              </>
            )}
          </div>
        )}
      </motion.div>

      <motion.div className="pl-ip__pbody" style={{ opacity: bodyOpacity }}>
        <motion.div className="pl-ip__ptitle" {...entrance(0)}>
          <h1 className="pl-ip__h1">
            {m ? (
              <>
                <span>
                  <Crest team={info.home} size={26} /> {info.home.name}
                </span>
                <span>
                  <Crest team={info.away} size={26} /> {info.away.name}
                </span>
              </>
            ) : (
              <span>{info.title}</span>
            )}
          </h1>
          {m && sc && sc.state !== 'pre' && <ScoreCapsule match={m} score={sc} size="lg" watching={info.isTarget} />}
        </motion.div>

        {goalsVisible && m && sc && (
          <motion.ul className="pl-ip__goals" aria-label="Goles" initial={{ opacity: 0, y: rm ? 0 : 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: rm ? 0.1 : 0.3 }}>
            {sc.goals.map((g, i) => (
              <li key={i} className={`pl-ip__goal${g.side === 'away' ? ' is-away' : ''}`}>
                <Crest team={g.side === 'home' ? info.home : info.away} size={16} />
                <span className="pl-ip__goalmin">{g.minute}'</span>
                <span className="pl-ip__goalwho">
                  {g.scorer}
                  {g.kind === 'pen' ? ' (p.)' : g.kind === 'og' ? ' (p.p.)' : ''}
                </span>
              </li>
            ))}
          </motion.ul>
        )}

        <motion.div className="pl-ip__caps" {...entrance(1)}>
          <Capsule tone={summary.tone === 'neutral' ? 'checking' : summary.tone} dot={summary.tone === 'ok'} icon={summary.tone === 'fail' ? 'warning' : undefined} onClick={() => { haptic('selection'); setSrcOpen(true); }}>
            {summary.label || 'Señal'} · {sources.length}
          </Capsule>
          {m && (
            <Capsule tone="neutral" icon="tv" onClick={() => { haptic('selection'); where(); }}>
              Dónde se emite
            </Capsule>
          )}
          <Capsule tone="neutral" icon="more" onClick={() => { haptic('selection'); more(); }}>
            Más
          </Capsule>
        </motion.div>

        <div className="pl-ip__pstatus">
          <StatusCapsule line={line} inline />
          <PlayerNotices player={player} sources={sources} />
        </div>

        {sources.length > 0 && (
          <motion.section className="pl-ip__section" {...entrance(2)}>
            <RowHeader as="h3" title="Fuentes" count={sources.length} sub={summary.detail} action={{ label: session?.research ? 'Rebuscando…' : 'Rebuscar', run: () => { haptic('light'); research(kind, id); }, icon: 'refresh' }} className={session?.research ? 'is-busy' : ''} />
            <div className="pl-ip__hscroll">
              {sources.map((s, i) => (
                <SourcePoster key={s.id} source={s} index={i + 1} active={player.target?.sourceId === s.id && info.isTarget} home={info.home.primary} away={info.away.primary} channel={s.matchedChannel} size="sm" onSelect={() => onSelect(s)} onMore={() => setMenu({ title: `Fuente ${i + 1} · ${s.title}`, items: sourceItems(info, s, { onReport: setReport, onOpenIn: openIn, onSelect: () => onSelect(s) }) })} />
              ))}
              <button type="button" className="pl-ip__srcall" onClick={() => { haptic('selection'); setSrcOpen(true); }} aria-label="Ver todas las fuentes">
                <Icon name="chevronRight" size={20} />
                <span>Todas</span>
              </button>
            </div>
          </motion.section>
        )}

        {alsoLive.length > 0 && (
          <motion.section className="pl-ip__section" {...entrance(3)}>
            <RowHeader as="h3" title="También en directo" count={alsoLive.length} live />
            <div className="pl-ip__hscroll">
              {alsoLive.map((x) => (
                <MatchPoster key={x.match.id} match={x.match} score={x.score} nowMs={now} session={sessions[`match:${x.match.id}`]} size="sm" mine={isMine(x.match, prefs)} covered={player.target?.id === x.match.id && !revealed[x.match.id]} onReveal={() => revealScore(x.match.id, true)} onClick={() => { haptic('light'); playMatch(x.match.id); navigate('partido', x.match.id, null, { replace: true }); }} fixedWidth={220} />
              ))}
            </div>
          </motion.section>
        )}

        <motion.div {...entrance(4)}>
          <TechData player={player} source={info.active} open={tech} onToggle={() => setTech((v) => !v)} />
        </motion.div>
      </motion.div>

      {fsActive && (
        <div className={`pl-ip__fs${landscape ? ' is-landscape' : ''}`} role="dialog" aria-label="Pantalla completa">
          <div
            className="pl-ip__fsinner"
            style={landscape ? { width: W, height: H, transform: 'none', left: 0, top: 0 } : { width: H, height: W }}
            onClick={(e) => {
              if ((e.target as HTMLElement | null)?.closest('button, input')) return;
              if (!visible) poke();
              else if (info.engaged && player.conn === 'activa') {
                haptic('light');
                togglePlay();
              }
            }}
            role="presentation"
          >
            <CoverVideo fit="contain" playing={info.playing} quality={info.quality} home={info.home.primary} away={info.away.primary} channel={info.channelLabel} kind={info.videoKind} />
            <div className="pl-ip__center">
              <CenterState player={player} big onResumeHere={resumeHere} />
            </div>
            <AnimatePresence initial={false}>
              {(visible || !info.engaged) && (
                <motion.div className="pl-ip__overlay is-fs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
                  <div className="pl-ip__ovtop">
                    <span className="pl-ip__fstitle">
                      <span className={`pl-th__srccap${phase === 'error' ? ' is-err' : ''}`}>{sourceCaption(info, phase, handoff)}</span>
                      <strong>{info.title}</strong>
                    </span>
                    {landscape ? <IconButton variant="video" icon="chevronDown" label="Minimizar" onClick={() => back()} /> : <IconButton variant="video" icon="x" label="Salir de pantalla completa" onClick={() => setFullscreen(false)} />}
                  </div>
                  <div className="pl-ip__fsbottom">
                    <StatusCapsule line={line} />
                    <ControlBar player={player} onFullscreen={landscape ? undefined : () => setFullscreen(false)} onPip={() => simulate('pip')} onAirplay={() => simulate('airplay')} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      )}

      <Sheet open={srcOpen} onClose={() => setSrcOpen(false)} mode="iphone" size="full" title={`Fuentes · ${sources.length}`} eyebrow={summary.detail || 'Reuniendo señales…'} footer={<div className="pl-ip__srcfoot"><Button variant="quiet" icon="refresh" onClick={() => research(kind, id)} disabled={session?.research}>{session?.research ? 'Rebuscando…' : 'Rebuscar'}</Button><Button variant="gold" icon="paste" onClick={() => { setSrcOpen(false); setPaste(true); }}>Pegar Content ID</Button></div>}>
        <div className="pl-ip__srcgrid">
          {sources.map((s, i) => (
            <SourcePoster key={s.id} source={s} index={i + 1} active={player.target?.sourceId === s.id && info.isTarget} home={info.home.primary} away={info.away.primary} channel={s.matchedChannel} size="sm" className="pl-sp--fluid" onSelect={() => { onSelect(s); setSrcOpen(false); }} onMore={() => setMenu({ title: `Fuente ${i + 1} · ${s.title}`, items: sourceItems(info, s, { onReport: setReport, onOpenIn: openIn, onSelect: () => onSelect(s) }) })} />
          ))}
        </div>
        {sources.length === 0 && <p className="pl-sheet__note">Todavía no hay fuentes para este partido. Se reúnen 45 minutos antes del inicio.</p>}
        <p className="pl-sheet__note">{plural(sources.filter((s) => s.state === 'working').length, 'verificada', 'verificadas')} · el anillo dorado marca la que está en pantalla.</p>
      </Sheet>
      <ReportSheet open={!!report} onClose={() => setReport(null)} mode="iphone" source={report} onReport={(r) => report && doReport(info, report, r)} />
      <PasteSheet open={paste} onClose={() => setPaste(false)} mode="iphone" onPlay={(h) => doPaste(info, h)} />
      <ActionMenu open={!!menu} onClose={() => setMenu(null)} mode="iphone" title={menu?.title} items={menu?.items ?? []} />
    </motion.div>
  );
}

export { Icon };
