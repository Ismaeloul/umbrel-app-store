/* Mini persistente (web): tarjeta flotante abajo a la derecha con la imagen
   viva, el título y tres controles. Clic → vuelve al teatro. */

import { motion } from 'motion/react';
import { navigate } from '../../../core/router';
import { stop, togglePlay, useSim } from '../../../core/store';
import { FakeVideo } from '../../../core/video/FakeVideo';
import { IconButton } from '../components/primitives';
import { LiveButton, handoffActive } from '../components/player';
import { phaseWord } from '../components/text';
import { useStageInfo } from '../components/stage';
import { QualityRing } from '../components/video';
import { sourceTone } from '../components/text';
import { useReducedMotion } from '../components/hooks';

export function MiniWeb() {
  const target = useSim((s) => s.player.target);
  if (!target) return null;
  return <MiniInner kind={target.kind} id={target.id} />;
}

function MiniInner({ kind, id }: { kind: 'match' | 'channel'; id: string }) {
  const info = useStageInfo(kind, id);
  const player = useSim((s) => s.player);
  const rm = useReducedMotion();
  const line = useSim((s) => s.statusLine);
  const handoff = handoffActive(player);
  const sub = handoff ? `En ${player.handoff!.byDevice}` : (line?.text ?? phaseWord(info.phase));
  return (
    <motion.div className="pl-mini" initial={{ opacity: 0, y: rm ? 0 : 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: rm ? 0 : 16 }} transition={{ duration: rm ? 0.12 : 0.3, ease: [0.2, 0.7, 0.2, 1] }}>
      <button type="button" className="pl-mini__hit" onClick={() => navigate(kind === 'match' ? 'partido' : 'canal', id)} aria-label={`Volver a ${info.title}`}>
        <span className="pl-mini__thumb">
          <FakeVideo playing={info.playing} quality={info.quality} home={info.home.primary} away={info.away.primary} kind={info.videoKind} radius={0} />
          {info.active && <QualityRing tone={sourceTone(info.active)} radius={8} />}
        </span>
        <span className="pl-mini__text">
          <span className="pl-mini__eyebrow">
            {info.phase === 'reproduciendo' && <span className="pl-livedot" style={{ width: 6, height: 6 }} />}
            {phaseWord(info.phase)}
          </span>
          <strong className="pl-mini__title">{info.title}</strong>
          <span className="pl-mini__sub">{sub}</span>
        </span>
      </button>
      <span className="pl-mini__ctl">
        <IconButton variant="ghost" size={40} icon={player.media === 'playing' && player.conn === 'activa' ? 'pause' : 'play'} label={player.media === 'playing' ? 'Pausa' : 'Reproducir'} onClick={togglePlay} disabled={player.conn !== 'activa' && player.conn !== 'error'} />
        <LiveButton player={player} compact className="pl-mini__live" />
        <IconButton variant="ghost" size={40} icon="x" label="Detener" onClick={() => stop('usuario')} />
      </span>
    </motion.div>
  );
}
