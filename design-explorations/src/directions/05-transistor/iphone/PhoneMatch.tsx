/* Centro de partido (iPhone): el reproductor grande vive aquí. Cabecera LCD,
   vídeo con marco (deslizar abajo minimiza; a los lados cambia de fuente),
   teclas, teletexto con dos páginas y dónde se emite. */

import { motion, type PanInfo } from 'motion/react';
import { useEffect, useState } from 'react';
import { back, navigate } from '../../../core/router';
import { ensureSources, getState, isEngaged, nextSource, now as simNow, playMatch, revealScore, setExpanded, useSim } from '../../../core/store';
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
import { compShort, signalOf } from '../components/text';
import { IcChevronDown, IcPlay } from '../components/icons';
import { IconKey } from '../components/Key';
import { NavBar } from './NavBar';

export function PhoneMatch({ id, now }: { id: string; now: number }) {
  const match = useSim((s) => s.agenda.find((m) => m.id === id));
  const targetKey = useSim((s) => (s.player.target ? `${s.player.target.kind}:${s.player.target.id}` : null));
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

  const minimize = () => {
    setExpanded(false);
    back('agenda');
  };
  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) minimize();
  };

  if (!match) {
    return (
      <>
        <NavBar title="Partido" backLabel="Sintonía" />
        <div className="tr-ph-body">
          <Empty
            title="Este partido ya no está en la agenda"
            actions={
              <Key variant="orange" onClick={() => navigate('agenda')}>
                Volver a la sintonía
              </Key>
            }
          />
        </div>
      </>
    );
  }
  const s = scoreAt(match, now);
  const signal = signalOf(session, match, now);

  return (
    <div className="tr-ph-match">
      <NavBar title={`${compShort(match.competition)}${match.round ? ` · ${match.round}` : ''}`} backLabel="Sintonía" right={playingHere ? <IconKey label="Minimizar" icon={<IcChevronDown />} size={36} variant="ghost" onClick={minimize} /> : undefined} />
      <motion.div className="tr-ph-hero" drag={playingHere ? 'y' : false} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: 0.4 }} onDragEnd={playingHere ? onDragEnd : undefined}>
        <div className="tr-ph-lcdhead">
          <MatchHeader match={match} now={now} watching={playingHere && engaged} revealed={revealed} onReveal={(v) => revealScore(id, v)} size="md" goalSide={goal.matchId === id ? goal.side : null} meta={`${match.time}${match.venue ? ` · ${match.venue}` : ''}`} />
        </div>
        {playingHere ? (
          <Video match={match} now={now} revealed={revealed} onSwipe={(dir) => nextSource('match', id, dir)} />
        ) : (
          <div className="tr-idle">
            <SignalMeter signal={signal} size="md" />
            {s.state === 'in' ? <strong>En juego</strong> : s.state === 'pre' ? <strong>Empieza {untilText(match.start, now).toLowerCase()}</strong> : <strong>Terminado</strong>}
            <span>{s.state === 'pre' ? 'Las fuentes se comprueban 45 min antes.' : signal.detail || 'Se comprueban las fuentes al sintonizar.'}</span>
            <Key variant="orange" icon={<IcPlay size={16} />} onClick={() => playMatch(id)}>
              {targetKey ? 'Ver aquí' : 'Ver ahora'}
            </Key>
          </div>
        )}
      </motion.div>
      <div className="tr-ph-body">
        {playingHere && (
          <>
            <StatusLineView line={statusLine} fallback="" />
            <PlayerControls phone compact />
          </>
        )}
        <Teletext kind="match" id={id} match={match} now={now} mode="phone" pages={['fuentes', 'tecnico']} page={page} onPage={setPage} watchingId={targetKey?.startsWith('match:') ? targetKey.slice(6) : null} revealed={revealedAll} />
        <div className="tr-card-where">
          <span className="tr-card-where-k">Dónde se emite</span>
          <span className="tr-card-where-v">
            {match.channels.map((c) => (
              <Chip key={c.id}>{c.name}</Chip>
            ))}
          </span>
        </div>
      </div>
    </div>
  );
}
