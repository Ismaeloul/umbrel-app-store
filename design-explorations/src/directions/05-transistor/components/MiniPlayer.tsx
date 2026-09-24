/* Mini-reproductor: la pantalla LCD del transistor, una banda de 56 pt con el
   marcador en segmentos (o la hora si es un canal), el título y una tecla.
   En el iPhone, deslizar hacia arriba abre el grande. */

import { motion, type PanInfo } from 'motion/react';
import { connect, matchById, stop, togglePlay, useNow, useSim } from '../../../core/store';
import { useSourceSession } from './hooks';
import { scoreAt } from '../../../core/score';
import { hhmm } from '../../../core/format';
import { team } from '../../../core/data/teams';
import { IconKey } from './Key';
import { LcdScore, LcdTime } from './Lcd';
import { IcPause, IcPlay, IcStop, IcChevronUp } from './icons';
import { displayTitle, phaseWord } from './text';
import { Wave } from './Wave';

export function MiniPlayer({ mode, onOpen, className }: { mode: 'web' | 'phone'; onOpen: () => void; className?: string }) {
  const player = useSim((s) => s.player);
  const revealed = useSim((s) => s.scoreRevealed);
  const now = useNow();
  const target = player.target;
  const session = useSourceSession(target?.kind ?? 'match', target?.id ?? null);
  if (!target) return null;
  const match = target.kind === 'match' ? matchById(target.id) : undefined;
  const source = session?.sources.find((x) => x.id === target.sourceId);
  const idx = source && session ? session.sources.indexOf(source) + 1 : 0;
  const s = match ? scoreAt(match, now) : null;
  const playing = player.conn === 'activa' && player.media === 'playing';
  const handoff = player.conn === 'idle' && !!player.handoff;
  const title = match ? `${team(match.home).name} – ${team(match.away).name}` : displayTitle(target.id, target.title);
  const sub = handoff ? `${player.handoff?.byDevice} se ha quedado el mando` : [phaseWord(player), source ? `Fuente ${idx} · ${source.listaName ?? 'Índice'}` : target.subtitle].join(' · ');

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y < -40 || info.velocity.y < -450) onOpen();
  };

  return (
    <motion.div
      className={`tr-mini is-${mode}${className ? ` ${className}` : ''}`}
      role="region"
      aria-label="Reproduciendo ahora"
      drag={mode === 'phone' ? 'y' : false}
      dragConstraints={{ top: 0, bottom: 0 }}
      dragElastic={{ top: 0.5, bottom: 0.05 }}
      onDragEnd={mode === 'phone' ? onDragEnd : undefined}
      initial={{ y: 24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 24, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 460, damping: 40 }}
    >
      <IconKey
        label={handoff ? 'Reproducir aquí' : playing ? 'Pausa' : 'Reproducir'}
        icon={handoff ? <IcPlay /> : playing ? <IcPause /> : <IcPlay />}
        size={44}
        variant={handoff ? 'orange' : 'paper'}
        onClick={() => {
          if (handoff && target.sourceId) connect(target.sourceId, 'manual');
          else togglePlay();
        }}
      />
      <button type="button" className="tr-mini-body" onClick={onOpen} aria-label={`Abrir ${title}`}>
        <span className="tr-mini-lcd">
          {match && s && s.state !== 'pre' ? (
            <LcdScore home={s.home} away={s.away} hidden={!revealed[match.id]} height={26} />
          ) : (
            <LcdTime text={match ? match.time : hhmm(now)} height={22} />
          )}
          {playing && <Wave size={10} className="tr-mini-wave" />}
        </span>
        <span className="tr-mini-text">
          <span className="tr-mini-title">{title}</span>
          <span className="tr-mini-sub">{sub}</span>
        </span>
        {mode === 'phone' && <IcChevronUp size={18} className="tr-mini-chev" />}
      </button>
      <IconKey label="Detener" icon={<IcStop />} size={44} variant="ghost" onClick={() => stop('usuario')} />
    </motion.div>
  );
}
