/* Centro de partido (web): cabecera LCD, la pantalla con marco, línea de
   estado, teclas y la página de teletexto a la derecha. */

import { useEffect, useState } from 'react';
import { back, navigate } from '../../../core/router';
import { ensureSources, getState, isEngaged, now as simNow, playMatch, revealScore, useSim } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { untilText } from '../../../core/format';
import { MatchHeader } from '../components/MatchHeader';
import { Video } from '../components/Video';
import { PlayerControls } from '../components/PlayerControls';
import { StatusLineView } from '../components/Toasts';
import { Teletext, type TtPage } from '../components/Teletext';
import { Chip, Empty, Key } from '../components/Key';
import { SignalMeter } from '../components/SignalMeter';
import { useGoalPulse, useSourceSession } from '../components/hooks';
import { compName, signalOf } from '../components/text';
import { IcChevronLeft, IcPlay } from '../components/icons';

export function WebMatch({ id, now }: { id: string; now: number }) {
  const match = useSim((s) => s.agenda.find((m) => m.id === id));
  const targetKey = useSim((s) => (s.player.target ? `${s.player.target.kind}:${s.player.target.id}` : null));
  const conn = useSim((s) => s.player.conn);
  const engaged = useSim((s) => isEngaged(s.player));
  const statusLine = useSim((s) => s.statusLine);
  const revealed = useSim((s) => !!s.scoreRevealed[id]);
  const revealedAll = useSim((s) => s.scoreRevealed);
  const session = useSourceSession('match', id);
  const goal = useGoalPulse();
  const [page, setPage] = useState<TtPage>('fuentes');
  const playingHere = targetKey === `match:${id}`;

  useEffect(() => {
    if (!match) return;
    ensureSources('match', id);
    const p = getState().player;
    const s = scoreAt(match, simNow());
    const soon = s.state === 'in' || (s.state === 'pre' && s.untilKickoffMs <= 45 * 60_000);
    if (soon && p.conn === 'idle' && !p.target) playMatch(id);
  }, [id, match]);

  if (!match) {
    return (
      <Empty
        title="Este partido ya no está en la agenda"
        actions={
          <Key variant="orange" onClick={() => navigate('agenda')}>
            Volver a la sintonía
          </Key>
        }
      />
    );
  }
  const s = scoreAt(match, now);
  const signal = signalOf(session, match, now);

  return (
    <div className="tr-match">
      <div className="tr-match-bar">
        <Key variant="ghost" size="sm" icon={<IcChevronLeft size={16} />} onClick={() => back('agenda')}>
          Sintonía
        </Key>
        <span className="tr-match-bar-title">
          {compName(match.competition)}
          {match.round ? ` · ${match.round}` : ''}
          {` · ${match.time}`}
          {match.venue ? ` · ${match.venue}` : ''}
        </span>
        <span className="tr-match-where">
          <span className="tr-card-where-k">Dónde se emite</span>
          {match.channels.map((c) => (
            <Chip key={c.id}>{c.name}</Chip>
          ))}
        </span>
      </div>
      <div className="tr-match-grid">
        <div className="tr-match-main">
          <div className="tr-match-lcdhead">
            <MatchHeader match={match} now={now} watching={playingHere && engaged} revealed={revealed} onReveal={(v) => revealScore(id, v)} size="lg" goalSide={goal.matchId === id ? goal.side : null} bare />
          </div>
          {playingHere ? (
            <>
              <Video match={match} now={now} revealed={revealed} />
              <StatusLineView line={statusLine} fallback={conn === 'idle' ? 'Elige una fuente en el teletexto o pulsa Ver ahora.' : ''} />
              <PlayerControls />
            </>
          ) : (
            <div className="tr-idle">
              <SignalMeter signal={signal} size="lg" />
              {s.state === 'in' ? (
                <>
                  <strong>El partido está en juego</strong>
                  <span>{signal.detail || 'Se comprueban las fuentes al sintonizar.'}</span>
                </>
              ) : s.state === 'pre' ? (
                <>
                  <strong>Empieza {untilText(match.start, now).toLowerCase()}</strong>
                  <span>Las fuentes se comprueban 45 minutos antes. Puedes sintonizar ya y esperar en la previa.</span>
                </>
              ) : (
                <>
                  <strong>El partido ha terminado</strong>
                  <span>Puedes sintonizar el canal igualmente para ver lo que emite ahora.</span>
                </>
              )}
              <Key
                variant="orange"
                size="lg"
                icon={<IcPlay size={18} />}
                onClick={() => {
                  playMatch(id);
                }}
              >
                {targetKey ? 'Ver aquí en vez de lo que suena' : 'Ver ahora'}
              </Key>
            </div>
          )}
        </div>
        <Teletext kind="match" id={id} match={match} now={now} mode="web" pages={['fuentes', 'marcadores', 'tecnico']} page={page} onPage={setPage} watchingId={targetKey?.startsWith('match:') ? targetKey.slice(6) : null} revealed={revealedAll} className="tr-match-tt" />
      </div>
    </div>
  );
}
