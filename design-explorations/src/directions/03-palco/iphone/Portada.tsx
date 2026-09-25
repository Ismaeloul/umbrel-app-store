/* Portada del iPhone: la señal del partido destacado a pantalla completa con
   la cabecera montada sobre el borde de la cortina. Sin directo: el próximo
   partido con la hora en grande sobre un plató en movimiento. */

import { useEffect, useRef } from 'react';
import { motion, useTransform, type MotionValue } from 'motion/react';
import { navigate } from '../../../core/router';
import { playMatch, useNow, useSim } from '../../../core/store';
import { team } from '../../../core/data/teams';
import { Crest } from '../../../core/ui/Crest';
import { hhmm, untilText } from '../../../core/format';
import { Button } from '../components/primitives';
import { Icon } from '../components/icons';
import { SignalCapsule } from '../components/posters';
import { ScoreCapsule } from '../components/player';
import { Ambient, CoverVideo } from '../components/video';
import { useFeatured } from '../components/agenda';
import { useGoalFlash, useReducedMotion, useSize } from '../components/hooks';
import { compName } from '../components/text';
import { haptic } from '../components/haptics';

const BAR_ZONE = 118;

export function Portada({ curtainY, H }: { curtainY: MotionValue<number>; H: number }) {
  const featured = useFeatured();
  const now = useNow();
  const player = useSim((s) => s.player);
  const sessions = useSim((s) => s.sourceSessions);
  const flash = useGoalFlash(featured.match?.id);
  const [infoRef, infoSize] = useSize<HTMLDivElement>();
  const latest = useRef({ H, infoH: infoSize.h });
  latest.current = { H, infoH: infoSize.h };
  // La cabecera monta sobre el borde de la cortina y se funde cuando esta sube del todo.
  const infoY = useTransform(curtainY, (y) => Math.max(latest.current.H * 0.28, Math.min(y, latest.current.H - BAR_ZONE) - latest.current.infoH - 14));
  const infoOpacity = useTransform(curtainY, (y) => Math.max(0, Math.min(1, (y - latest.current.H * 0.34) / (latest.current.H * 0.12))));
  useEffect(() => {
    curtainY.set(curtainY.get());
  }, [H, infoSize.h, curtainY]);

  const m = featured.match;
  const sc = featured.score;
  const home = m ? team(m.home) : team('esp-nt');
  const away = m ? team(m.away) : team('fra-nt');
  const watchingThis = !!m && player.target?.kind === 'match' && player.target.id === m.id;
  const rm = useReducedMotion();

  const open = () => {
    if (!m) return;
    haptic('medium');
    if (featured.kind === 'live') playMatch(m.id);
    navigate('partido', m.id);
  };

  return (
    <motion.div className="pl-ip__portada" initial={{ opacity: 0, scale: rm ? 1 : 1.03 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: rm ? 1 : 1.04 }} transition={{ duration: rm ? 0.12 : 0.42, ease: [0.2, 0.7, 0.2, 1] }}>
      <Ambient home={home.primary} away={away.primary} flash={flash} strength={0.3} />
      <div className="pl-ip__cover" style={{ height: Math.round(H * 0.68) }} aria-hidden="true">
        <CoverVideo playing quality="ok" home={home.primary} away={away.primary} kind={featured.kind === 'live' ? 'broadcast' : 'studio'} zoom={1.05} focusY={0.5} />
        <div className="pl-ip__coverveil" />
      </div>
      <motion.div className="pl-ip__brand" style={{ opacity: infoOpacity }}>
        <span className="pl-topbar__mark" aria-hidden="true" />
        <span>Ace Player Neo</span>
      </motion.div>
      <motion.div ref={infoRef} className="pl-ip__info" style={{ y: infoY, opacity: infoOpacity }}>
        {m && sc && featured.kind === 'live' && (
          <>
            <span className="pl-ip__eyebrow">
              <span className="pl-livedot" /> En directo · {compName(m.competition)}
            </span>
            <h1 className="pl-ip__title">
              <span>
                <Crest team={home} size={30} /> {home.name}
              </span>
              <span>
                <Crest team={away} size={30} /> {away.name}
              </span>
            </h1>
            <div className="pl-ip__meta">
              <SignalCapsule match={m} score={sc} session={sessions[`match:${m.id}`]} nowMs={now} glass />
              <span>{sc.halftime ? 'Descanso' : `${sc.clock} · ${sc.detail}`}</span>
            </div>
            <div className="pl-ip__cta">
              <Button variant="gold" size="lg" icon="play" onClick={open}>
                {watchingThis ? 'Seguir viendo' : 'Ver ahora'}
              </Button>
              <ScoreCapsule match={m} score={sc} size="lg" className="pl-ip__score" watching={watchingThis} />
            </div>
          </>
        )}
        {m && sc && featured.kind === 'next' && (
          <>
            <span className="pl-ip__eyebrow">
              <Icon name="clock" size={12} /> Próximo · {compName(m.competition)}
            </span>
            <h1 className="pl-ip__title">
              <span>
                <Crest team={home} size={30} /> {home.name}
              </span>
              <span>
                <Crest team={away} size={30} /> {away.name}
              </span>
            </h1>
            <div className="pl-ip__meta">
              <span className="pl-ip__bighour">{hhmm(m.start)}</span>
              <span>{untilText(m.start, now)}</span>
            </div>
            <div className="pl-ip__cta">
              <Button variant="gold" size="lg" icon="calendar" onClick={open}>
                Ver el partido
              </Button>
              <span className="pl-ip__where">
                <Icon name="tv" size={13} /> {m.channels.map((c) => c.name).join(' · ')}
              </span>
            </div>
          </>
        )}
        {featured.kind === 'none' && (
          <>
            <span className="pl-ip__eyebrow">Agenda</span>
            <h1 className="pl-ip__title">
              <span>Sin partidos anunciados</span>
            </h1>
            <div className="pl-ip__cta">
              <Button variant="gold" size="lg" icon="tv" onClick={() => navigate('biblioteca')}>
                Ver los canales
              </Button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}
