import { useState } from 'react';
import { isFavorite, matchById, playMatch, openTarget, revealScore, toggleFavorite, useNow, useSim, itemById, playChannel, derivePhase } from '../../../core/store';
import { team, competition } from '../../../core/data/teams';
import { scoreAt } from '../../../core/score';
import { hhmm, longDate, untilText } from '../../../core/format';
import { Crest } from '../../../core/ui/Crest';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import type { Source } from '../../../core/types';
import { I } from './icons';
import { RollingNumber, useScoreHidden } from './Score';
import { SourceList, TechDetails, useSourceSession } from './Sources';
import { PasteSheet, ReportSheet } from './Sheets';
import { StatusLineView, VideoStage } from './Player';

/* Centro de partido: cabecera con los equipos, vídeo cuando suena, señal
   (fuentes), dónde se emite, detalles. Compartido por web e iPhone. */

export function MatchHeader({ matchId, size = 'phone' }: { matchId: string; size?: 'phone' | 'web' }) {
  const m = matchById(matchId)!;
  const now = useNow();
  const s = scoreAt(m, now);
  const home = team(m.home);
  const away = team(m.away);
  const comp = competition(m.competition);
  const hidden = useScoreHidden(matchId);
  const lastGoal = useSim((st) => st.lastGoal);
  const goalSide = lastGoal && lastGoal.matchId === matchId && Date.now() - lastGoal.at < 1400 ? lastGoal.side : null;
  const status = s.state === 'in' ? (s.halftime ? 'Descanso' : `${s.clock} · ${s.detail}`) : s.state === 'post' ? 'Final' : untilText(m.start, now);
  return (
    <header className={`tb-mh tb-mh--${size}${goalSide ? ` is-goal-${goalSide}` : ''}`} style={{ ['--h' as string]: home.primary, ['--a' as string]: away.primary }}>
      <div className="tb-mh__ambient" aria-hidden="true" />
      <div className="tb-mh__meta">
        <span className="tb-mh__comp">{comp.name}{m.round ? ` · ${m.round}` : ''}</span>
        <span className="tb-mh__when">{s.state === 'pre' ? `${longDate(m.start)}, ${hhmm(m.start)}` : m.venue ?? longDate(m.start)}</span>
      </div>
      <div className="tb-mh__teams">
        <div className="tb-mh__team">
          <Crest team={home} size={size === 'web' ? 72 : 60} />
          <span className="tb-mh__name">{home.name}</span>
        </div>
        <div className="tb-mh__center">
          {s.state === 'pre' ? (
            <span className="tb-mh__time">{hhmm(m.start)}</span>
          ) : hidden ? (
            <button type="button" className="tb-mh__score is-hidden" onClick={() => revealScore(matchId, true)} title="Tu emisión va por detrás del directo">
              <span className="tb-mh__mask" aria-hidden="true"><i /><i /></span>
              <span className="tb-mh__reveal"><I.Eye size={14} /> Ver marcador</span>
            </button>
          ) : (
            <span className="tb-mh__score">
              <RollingNumber value={s.home} />
              <span className="tb-mh__sep">–</span>
              <RollingNumber value={s.away} />
              {s.state !== 'post' && (
                <button type="button" className="tb-mh__hide" onClick={() => revealScore(matchId, false)} aria-label="Tapar el marcador">
                  <I.EyeOff size={14} />
                </button>
              )}
            </span>
          )}
          <span className={`tb-mh__status${s.state === 'in' ? ' is-live' : ''}`}>
            {s.state === 'in' && <i className="tb-minute__dot" aria-hidden="true" />}
            {status}
          </span>
        </div>
        <div className="tb-mh__team">
          <Crest team={away} size={size === 'web' ? 72 : 60} />
          <span className="tb-mh__name">{away.name}</span>
        </div>
      </div>
      {s.state !== 'pre' && (
        <div className="tb-mh__progress" aria-hidden="true">
          <i style={{ transform: `scaleX(${s.progress})` }} />
          {!hidden && s.goals.map((g, i) => <b key={i} className={`is-${g.side}`} style={{ left: `${Math.min(100, (g.minute / 94) * 100)}%` }} title={`${g.scorer} ${g.minute}'`} />)}
        </div>
      )}
      {!hidden && s.goals.length > 0 && (
        <ul className="tb-mh__goals" aria-label="Goles">
          {s.goals.map((g, i) => (
            <li key={i} className={`is-${g.side}`}>
              <span>{g.scorer}{g.kind === 'pen' ? ' (p.)' : ''}</span> <b>{g.minute}'</b>
            </li>
          ))}
        </ul>
      )}
    </header>
  );
}

export function WhereAired({ matchId }: { matchId: string }) {
  const m = matchById(matchId)!;
  return (
    <section className="tb-group">
      <h3 className="tb-h3">Dónde se emite</h3>
      <div className="tb-where">
        {m.channels.map((c) => {
          const known = c.name;
          return (
            <span key={c.id} className="tb-where__chip">
              <ChannelMark name={known} size={28} radius={7} />
              {known}
            </span>
          );
        })}
      </div>
    </section>
  );
}

/** Bloque completo: cabecera + vídeo/«Ver ahora» + fuentes + dónde + detalles. */
export function MatchCenter({ matchId, layout = 'phone', onMinimize }: { matchId: string; layout?: 'phone' | 'web'; onMinimize?: () => void }) {
  const m = matchById(matchId);
  const player = useSim((s) => s.player);
  const here = player.target?.kind === 'match' && player.target.id === matchId;
  const [report, setReport] = useState<Source | null>(null);
  const [paste, setPaste] = useState(false);
  const fav = useSim((s) => s.favorites.some((f) => f.id === (player.target?.sourceId ?? '')));
  useSourceSession('match', matchId);
  if (!m) {
    return (
      <div className="tb-empty">
        <strong>Este partido ya no está en la agenda</strong>
        <span>Puede que se haya movido de día o de hora.</span>
      </div>
    );
  }
  const phase = derivePhase(player);
  return (
    <div className={`tb-mc tb-mc--${layout}`}>
      {layout === 'phone' && (
        <>
          {here ? (
            <div className="tb-mc__stage">
              <VideoStage variant="phone" onMinimize={onMinimize} showTitle={false} radius={12} />
              <StatusLineView />
            </div>
          ) : null}
          <MatchHeader matchId={matchId} size="phone" />
          {!here && (
            <div className="tb-mc__cta">
              <button type="button" className="tb-btn tb-btn--primary tb-btn--lg tb-btn--block" onClick={() => playMatch(matchId)}>
                <I.Play size={18} /> Ver ahora
              </button>
            </div>
          )}
        </>
      )}
      {layout === 'web' && (
        <div className="tb-mc__web">
          <div className="tb-mc__main">
            <div className="tb-mc__stage">
              {here ? (
                <VideoStage variant="inline" radius={16} />
              ) : (
                <button type="button" className="tb-mc__poster" onClick={() => openTarget('match', matchId)} style={{ ['--h' as string]: team(m.home).primary, ['--a' as string]: team(m.away).primary }}>
                  <span className="tb-mc__poster-crests">
                    <Crest team={team(m.home)} size={96} />
                    <Crest team={team(m.away)} size={96} />
                  </span>
                  <span className="tb-btn tb-btn--primary tb-btn--lg"><I.Play size={18} /> Ver ahora</span>
                </button>
              )}
              {here && <StatusLineView />}
            </div>
            <MatchHeader matchId={matchId} size="web" />
          </div>
          <aside className="tb-mc__side">
            <SideContent matchId={matchId} onReport={setReport} onPaste={() => setPaste(true)} fav={fav} phase={phase} />
          </aside>
        </div>
      )}
      {layout === 'phone' && <SideContent matchId={matchId} onReport={setReport} onPaste={() => setPaste(true)} fav={fav} phase={phase} />}
      <ReportSheet source={report} kind="match" id={matchId} onClose={() => setReport(null)} />
      <PasteSheet open={paste} kind="match" id={matchId} onClose={() => setPaste(false)} />
    </div>
  );
}

function SideContent({ matchId, onReport, onPaste, fav, phase }: { matchId: string; onReport: (s: Source) => void; onPaste: () => void; fav: boolean; phase: ReturnType<typeof derivePhase> }) {
  const player = useSim((s) => s.player);
  const here = player.target?.kind === 'match' && player.target.id === matchId;
  return (
    <>
      <section className="tb-group">
        <div className="tb-h3 tb-h3--row">
          <span>Señal</span>
          {here && player.target?.sourceId && (
            <button type="button" className="tb-iconbtn" aria-label={fav ? 'Quitar de favoritos' : 'Guardar la señal en favoritos'} onClick={() => toggleFavorite(player.target!.sourceId!, player.target!.title)} aria-pressed={fav}>
              <I.Star size={18} filled={fav} />
            </button>
          )}
        </div>
        <SourceList kind="match" id={matchId} onReport={onReport} onPaste={onPaste} />
        {phase === 'error' && !here && null}
      </section>
      <WhereAired matchId={matchId} />
      <section className="tb-group">
        <TechDetails kind="match" id={matchId} />
      </section>
    </>
  );
}

/** Canal suelto (desde la biblioteca): cabecera de canal + fuentes hermanas. */
export function ChannelCenter({ channelId, layout = 'phone', onMinimize }: { channelId: string; layout?: 'phone' | 'web'; onMinimize?: () => void }) {
  const item = itemById(channelId);
  const player = useSim((s) => s.player);
  const here = player.target?.kind === 'channel' && player.target.id === channelId;
  const fav = useSim((s) => s.favorites.some((f) => f.id === channelId));
  const [report, setReport] = useState<Source | null>(null);
  const [paste, setPaste] = useState(false);
  useSourceSession('channel', channelId);
  const title = item?.title ?? player.target?.title ?? `Canal ${channelId.slice(0, 6)}`;
  return (
    <div className={`tb-mc tb-mc--${layout} tb-mc--channel`}>
      {here ? (
        <div className="tb-mc__stage">
          <VideoStage variant={layout === 'phone' ? 'phone' : 'inline'} onMinimize={onMinimize} showTitle={layout === 'web'} radius={layout === 'phone' ? 12 : 16} />
          <StatusLineView />
        </div>
      ) : (
        <div className="tb-mc__cta">
          <button type="button" className="tb-btn tb-btn--primary tb-btn--lg tb-btn--block" onClick={() => playChannel(channelId)}>
            <I.Play size={18} /> Ver {title}
          </button>
        </div>
      )}
      <header className="tb-ch">
        <ChannelMark name={title} size={56} radius={14} />
        <div className="tb-ch__body">
          <h2>{title}</h2>
          <span>{item?.category ?? 'Canal'}{fav ? ' · En tus favoritos' : ''}</span>
        </div>
        <button type="button" className="tb-iconbtn" aria-label={fav ? 'Quitar de favoritos' : 'Añadir a favoritos'} onClick={() => toggleFavorite(channelId, title)} aria-pressed={fav}>
          <I.Star size={20} filled={fav} />
        </button>
      </header>
      <section className="tb-group">
        <h3 className="tb-h3">Señales de este canal</h3>
        <SourceList kind="channel" id={channelId} onReport={setReport} onPaste={() => setPaste(true)} />
      </section>
      <section className="tb-group">
        <TechDetails kind="channel" id={channelId} />
      </section>
      <ReportSheet source={report} kind="channel" id={channelId} onClose={() => setReport(null)} />
      <PasteSheet open={paste} kind="channel" id={channelId} onClose={() => setPaste(false)} />
    </div>
  );
}

export { isFavorite };
