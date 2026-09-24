/* Consola · vista completa (partido/:id y canal/:id): reproductor grande y
   limpio en la columna central, inspector con propiedades a la derecha. */

import { useEffect } from 'react';
import { back, navigate } from '../../../core/router';
import { getState, itemById, matchById, openTarget, playChannel, revealScore, setFullscreen, useNow, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { hhmm, untilText } from '../../../core/format';
import type { Match } from '../../../core/types';
import { Crest } from '../../../core/ui/Crest';
import { ChannelMark } from '../../../core/ui/ChannelMark';
import { Icon } from '../components/icons';
import { Bar, Button, Dot, IconButton, Keys } from '../components/ui';
import { VideoSurface } from '../components/video';
import { channelNow, compLabel, idLabel, matchTitle, usePulse, useScoreHidden } from '../components/lib';
import { Controls, StatusLine } from './Player';
import { Inspector } from './Inspector';
import { openMatch } from './Agenda';

export function Full({ kind, id }: { kind: 'match' | 'channel'; id: string }) {
  const fullscreen = useSim((s) => s.player.fullscreen);
  const match = kind === 'match' ? matchById(id) : undefined;
  const item = kind === 'channel' ? itemById(id) : undefined;
  const title = match ? matchTitle(match) : item?.title ?? `Canal ${idLabel(id)}`;

  useEffect(() => {
    const t = getState().player.target;
    if (t?.kind === kind && t.id === id) return;
    if (kind === 'match') openTarget('match', id);
    else playChannel(id);
  }, [kind, id]);

  if (kind === 'match' && !match) {
    return (
      <div className="co-screen">
        <div className="co-empty">
          <strong>Este partido ya no está en la agenda</strong>
          <Button onClick={() => navigate('agenda')}>Volver a Partidos</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="co-full">
      <div className="co-full-main">
        <header className="co-full-top">
          <button type="button" className="co-backbtn" onClick={() => back(kind === 'match' ? 'agenda' : 'biblioteca')}>
            <Icon name="arrow-left" size={15} />
            <span>{kind === 'match' ? 'Partidos' : 'Canales'}</span>
            <Keys keys="Esc" />
          </button>
          <span className="co-full-crumb co-truncate">
            <span className="co-ink-3">/</span>
            <span className="co-full-title co-truncate">{title}</span>
            {match && <span className="co-label co-truncate">· {compLabel(match)}</span>}
            {item && <span className="co-label co-truncate">· {item.category}</span>}
          </span>
          <span className="co-grow" />
          <IconButton icon="fullscreen" label="Pantalla completa (F)" onClick={() => setFullscreen(true)} />
        </header>

        <div className="co-full-video">
          <VideoSurface radius={8} onDoubleClick={() => setFullscreen(!fullscreen)} idleText={match ? 'Preparando el partido' : 'Preparando el canal'} />
        </div>
        <Controls />
        <StatusLine />

        {match ? <Scoreboard m={match} /> : <ChannelStrip id={id} title={title} />}
      </div>
      <aside className="co-inspector-col co-inspector-col--full" aria-label="Inspector">
        <Inspector variant="full" />
      </aside>
    </div>
  );
}

function Scoreboard({ m }: { m: Match }) {
  const nowMs = useNow();
  const sc = scoreAt(m, nowMs);
  const hidden = useScoreHidden(m.id);
  const pulse = usePulse(sc.home + sc.away);
  const home = team(m.home);
  const away = team(m.away);
  const goals = hidden ? [] : sc.goals;
  return (
    <section className="co-board" aria-label="Marcador">
      <div className="co-board-row">
        <div className="co-board-team">
          <Crest team={home} size={40} variant="flat" />
          <span className="co-board-name co-truncate">{home.name}</span>
        </div>
        <div className={`co-board-score co-num ${pulse ? 'is-goal' : ''}`}>
          {sc.state === 'pre' ? (
            <span className="co-board-pre">
              <span className="co-mono">{hhmm(m.start)}</span>
              <span className="co-label">{untilText(m.start, nowMs)}</span>
            </span>
          ) : hidden ? (
            <button type="button" className="co-board-hidden" onClick={() => revealScore(m.id, true)} title="Ver marcador">
              <span>•</span>
              <span className="co-ink-3">–</span>
              <span>•</span>
            </button>
          ) : (
            <>
              <span>{sc.home}</span>
              <span className="co-ink-3">–</span>
              <span>{sc.away}</span>
            </>
          )}
        </div>
        <div className="co-board-team is-away">
          <span className="co-board-name co-truncate">{away.name}</span>
          <Crest team={away} size={40} variant="flat" />
        </div>
      </div>
      {sc.state !== 'pre' && (
        <div className="co-board-clock">
          <span className={`co-mono ${sc.state === 'in' ? 'is-live' : ''}`}>
            {sc.state === 'in' && <Dot tone="live" size="sm" pulse={pulse} />} {sc.state === 'post' ? 'Final' : sc.halftime ? 'Descanso' : `${sc.clock} · ${sc.detail}`}
          </span>
          <Bar value={sc.progress} live={sc.state === 'in'} className="co-grow" />
          {hidden ? (
            <button type="button" className="co-linkbtn" onClick={() => revealScore(m.id, true)}>
              <Icon name="eye" size={12} /> Ver marcador
            </button>
          ) : (
            <button type="button" className="co-linkbtn" onClick={() => revealScore(m.id, false)}>
              <Icon name="eye-off" size={12} /> Tapar
            </button>
          )}
        </div>
      )}
      {hidden && sc.state !== 'pre' && <p className="co-board-note co-label">El marcador va tapado mientras ves el partido: tu emisión va unos segundos por detrás del directo.</p>}
      {goals.length > 0 && (
        <ol className="co-goals">
          {goals.map((g, i) => (
            <li key={i} className={`co-goal ${g.side}`}>
              <span className="co-mono co-goal-min">{g.minute}'</span>
              <span className="co-goal-dot" style={{ background: g.side === 'home' ? home.primary : away.primary }} />
              <span className="co-truncate">
                {g.scorer}
                {g.kind === 'pen' && <span className="co-label"> (p.)</span>}
                {g.kind === 'og' && <span className="co-label"> (p.p.)</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ChannelStrip({ id, title }: { id: string; title: string }) {
  const nowMs = useNow();
  const agenda = useSim((s) => s.agenda);
  const item = itemById(id);
  const now = item ? channelNow(item, agenda, nowMs) : null;
  return (
    <section className="co-board co-board--channel" aria-label="Canal">
      <div className="co-board-row" style={{ gridTemplateColumns: 'auto 1fr auto' }}>
        <ChannelMark name={title} size={40} radius={10} />
        <div className="co-grow" style={{ minWidth: 0 }}>
          <div className="co-board-name co-truncate">{title}</div>
          {now ? (
            <button type="button" className="co-linkbtn" onClick={() => openMatch(now.match.id)}>
              {now.live && <Dot tone="live" size="sm" />}
              {now.live ? 'Ahora' : 'Después'}: {matchTitle(now.match)} · <span className="co-mono">{now.live ? scoreAt(now.match, nowMs).clock : hhmm(now.match.start)}</span>
            </button>
          ) : (
            <span className="co-label">Sin partido anunciado en este canal</span>
          )}
        </div>
        <span className="co-label">{item?.category ?? 'Canal suelto'}</span>
      </div>
    </section>
  );
}
