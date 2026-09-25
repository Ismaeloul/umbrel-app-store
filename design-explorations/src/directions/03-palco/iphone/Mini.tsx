/* Mini del iPhone: banda de 72 pt con la imagen viva (elemento compartido con
   el escenario), título, minuto y play. Arriba abre; abajo o × detiene con Deshacer.
   Al cruzar el umbral del gesto hay una respuesta háptica, como en Música. */

import { useRef } from 'react';
import { motion, type PanInfo } from 'motion/react';
import { navigate } from '../../../core/router';
import { stop, togglePlay, useSim } from '../../../core/store';
import { FakeVideo } from '../../../core/video/FakeVideo';
import { IconButton } from '../components/primitives';
import { handoffActive } from '../components/player';
import { phaseWord } from '../components/text';
import { useStageInfo } from '../components/stage';
import { useReducedMotion } from '../components/hooks';
import { haptic } from '../components/haptics';

const OPEN_AT = -36;
const STOP_AT = 44;

export function MiniIphone({ kind, id, bottom }: { kind: 'match' | 'channel'; id: string; bottom: number }) {
  const info = useStageInfo(kind, id);
  const player = useSim((s) => s.player);
  const line = useSim((s) => s.statusLine);
  const rm = useReducedMotion();
  const armed = useRef<'open' | 'stop' | null>(null);
  const open = () => {
    haptic('light');
    navigate(kind === 'match' ? 'partido' : 'canal', id);
  };
  const handoff = handoffActive(player);
  const sub = handoff ? `En ${player.handoff!.byDevice}` : info.score?.state === 'in' ? `${info.score.halftime ? 'Descanso' : info.score.clock} · ${line?.text ?? phaseWord(info.phase)}` : (line?.text ?? phaseWord(info.phase));
  const onDrag = (_: unknown, i: PanInfo) => {
    const want = i.offset.y < OPEN_AT ? 'open' : i.offset.y > STOP_AT ? 'stop' : null;
    if (want !== armed.current) {
      armed.current = want;
      if (want) haptic(want === 'stop' ? 'medium' : 'light');
    }
  };
  const onDragEnd = (_: unknown, i: PanInfo) => {
    armed.current = null;
    if (i.offset.y < OPEN_AT || i.velocity.y < -420) navigate(kind === 'match' ? 'partido' : 'canal', id);
    else if (i.offset.y > STOP_AT || i.velocity.y > 500) {
      haptic('rigid');
      stop('usuario');
    }
  };
  return (
    <motion.div className="pl-ip__mini" style={{ bottom }} initial={{ opacity: 0, y: rm ? 0 : 40 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: rm ? 0 : 40 }} transition={{ duration: rm ? 0.12 : 0.3, ease: [0.2, 0.7, 0.2, 1] }} drag="y" dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0.5, bottom: 0.35 }} dragMomentum={false} onDrag={onDrag} onDragEnd={onDragEnd} whileTap={{ scale: 0.985 }} data-testid="mini">
      <button type="button" className="pl-ip__minihit" onClick={open} aria-label={`Abrir ${info.title}`}>
        <motion.span className="pl-ip__minithumb" layoutId="pl-stage-video" transition={{ type: 'spring', stiffness: 400, damping: 40 }}>
          <FakeVideo playing={info.playing} quality={info.quality} home={info.home.primary} away={info.away.primary} kind={info.videoKind} radius={0} />
        </motion.span>
        <span className="pl-ip__minitext">
          <strong className="pl-ip__minititle">{info.title}</strong>
          <span className="pl-ip__minisub">
            {info.phase === 'reproduciendo' && <span className="pl-livedot" style={{ width: 6, height: 6 }} />}
            {sub}
          </span>
        </span>
      </button>
      <IconButton variant="ghost" size={44} icon={player.media === 'playing' && player.conn === 'activa' ? 'pause' : 'play'} label={player.media === 'playing' ? 'Pausa' : 'Reproducir'} onClick={() => { haptic('light'); togglePlay(); }} disabled={player.conn !== 'activa' && player.conn !== 'error'} />
      <IconButton variant="ghost" size={44} icon="x" label="Detener" onClick={() => { haptic('rigid'); stop('usuario'); }} />
    </motion.div>
  );
}
