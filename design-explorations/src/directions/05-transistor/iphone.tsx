/* Propuesta 5 · Transistor — app de iPhone (402×874 pt dentro de DeviceFrame).
   Tab bar de 4 + búsqueda, mini LCD sobre la barra, pantallas con transición
   real (AnimatePresence + route.direction), gesto de borde para volver. */

import './fonts';
import './tokens.css';
import './transistor.css';
import './iphone.css';

import { AnimatePresence, MotionConfig, motion, type PanInfo } from 'motion/react';
import { useEffect, useRef } from 'react';
import { back, navigate, useRoute, type Route, type Screen } from '../../core/router';
import { getState, setExpanded, useNow, useSim } from '../../core/store';
import { MiniPlayer } from './components/MiniPlayer';
import { Toasts } from './components/Toasts';
import { useGoalPulse } from './components/hooks';
import { IcCalendar, IcDial, IcPreset, IcSearch, IcSettings } from './components/icons';
import { PhoneSintonia } from './iphone/PhoneSintonia';
import { PhoneProgramacion } from './iphone/PhoneProgramacion';
import { PhoneMatch } from './iphone/PhoneMatch';
import { PhoneChannel } from './iphone/PhoneChannel';
import { PhoneCanales } from './iphone/PhoneCanales';
import { PhoneBuscar } from './iphone/PhoneBuscar';
import { PhoneAjustes, PhoneAjustesSection } from './iphone/PhoneAjustes';
import { PhoneGustos } from './iphone/PhoneGustos';
import { PhonePairing } from './iphone/PhonePairing';
import { PhoneFullscreen } from './iphone/PhoneFullscreen';

type Tab = 'sintonia' | 'programacion' | 'canales' | 'ajustes' | 'buscar';

function tabOfRoute(r: Route): Tab {
  switch (r.screen) {
    case 'agenda':
      return r.param === 'semana' ? 'programacion' : 'sintonia';
    case 'biblioteca':
    case 'canal':
      return 'canales';
    case 'buscar':
      return 'buscar';
    case 'ajustes':
    case 'gustos':
      return 'ajustes';
    default:
      return 'sintonia';
  }
}

function isRoot(r: Route): boolean {
  return (r.screen === 'agenda' && (r.param === null || r.param === 'semana')) || (r.screen === 'biblioteca') || r.screen === 'buscar' || (r.screen === 'ajustes' && r.param === null);
}

const TABS: { id: Tab; label: string; Icon: typeof IcDial; go: () => void }[] = [
  { id: 'sintonia', label: 'Sintonía', Icon: IcDial, go: () => navigate('agenda') },
  { id: 'programacion', label: 'Programación', Icon: IcCalendar, go: () => navigate('agenda', 'semana') },
  { id: 'canales', label: 'Canales', Icon: IcPreset, go: () => navigate('biblioteca') },
  { id: 'ajustes', label: 'Ajustes', Icon: IcSettings, go: () => navigate('ajustes') },
];

const variants = {
  enter: (d: Route['direction']) => ({ x: d === 'forward' ? '28%' : d === 'back' ? '-22%' : 0, opacity: d === 'none' ? 0 : 0.5 }),
  center: { x: 0, opacity: 1 },
  exit: (d: Route['direction']) => ({ x: d === 'forward' ? '-22%' : d === 'back' ? '28%' : 0, opacity: d === 'none' ? 0 : 0.5 }),
};

export default function Iphone() {
  const route = useRoute();
  const now = useNow();
  const paired = useSim((s) => s.paired);
  const targetKey = useSim((s) => (s.player.target ? `${s.player.target.kind}:${s.player.target.id}` : null));
  const fullscreen = useSim((s) => s.player.fullscreen);
  const reducedMotion = useSim((s) => s.reducedMotion);
  const goal = useGoalPulse();
  const prev = useRef(route);

  const onTargetScreen = (route.screen === 'partido' && targetKey === `match:${route.param}`) || (route.screen === 'canal' && targetKey === `channel:${route.param}`);
  const miniVisible = !!targetKey && !onTargetScreen && !fullscreen;
  const tab = tabOfRoute(route);
  const root = isRoot(route);

  useEffect(() => {
    setExpanded(onTargetScreen);
  }, [onTargetScreen, targetKey]);

  // Cambio de pestaña = fundido; empujar/volver = desplazamiento.
  const direction: Route['direction'] = isRoot(prev.current) && root && prev.current.seq !== route.seq ? 'none' : route.direction;
  useEffect(() => {
    prev.current = route;
  }, [route]);

  const openTarget = () => {
    const t = getState().player.target;
    if (!t) return;
    navigate(t.kind === 'match' ? 'partido' : 'canal', t.id);
    setExpanded(true);
  };

  const onEdgeEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.x > 70 || info.velocity.x > 500) back(fallbackFor(route.screen));
  };

  if (!paired) {
    return (
      <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>
        <div className="tr-root tr-phone">
          <PhonePairing />
          <Toasts />
        </div>
      </MotionConfig>
    );
  }

  const key = `${route.screen}/${route.param ?? ''}`;

  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>
      <div className={`tr-root tr-phone${miniVisible ? ' has-mini' : ''}`} data-goal={goal.on ? 'on' : undefined}>
        <div className="tr-phone-screen">
          <AnimatePresence mode="popLayout" initial={false} custom={direction}>
            <motion.div key={key} className="tr-phone-page" custom={direction} variants={variants} initial="enter" animate="center" exit="exit" transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}>
              {route.screen === 'agenda' && route.param !== 'semana' && <PhoneSintonia now={now} />}
              {route.screen === 'agenda' && route.param === 'semana' && <PhoneProgramacion now={now} day={route.sub} />}
              {route.screen === 'partido' && route.param && <PhoneMatch id={route.param} now={now} />}
              {route.screen === 'canal' && route.param && <PhoneChannel id={route.param} now={now} />}
              {route.screen === 'biblioteca' && <PhoneCanales tab={route.param} now={now} />}
              {route.screen === 'buscar' && <PhoneBuscar now={now} />}
              {route.screen === 'ajustes' && !route.param && <PhoneAjustes />}
              {route.screen === 'ajustes' && route.param && <PhoneAjustesSection section={route.param} />}
              {route.screen === 'gustos' && <PhoneGustos />}
              {route.screen === 'emparejar' && <PhoneSintonia now={now} />}
            </motion.div>
          </AnimatePresence>
        </div>
        {!root && <motion.div className="tr-edge" drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={0.2} onDragEnd={onEdgeEnd} aria-hidden="true" />}
        <div className="tr-phone-bottom">
          <AnimatePresence>{miniVisible && <MiniPlayer key="mini" mode="phone" onOpen={openTarget} />}</AnimatePresence>
          <nav className="tr-tabbar" aria-label="Pestañas">
            {TABS.map(({ id, label, Icon, go }) => (
              <button key={id} type="button" className={`tr-tab${tab === id ? ' is-on' : ''}`} onClick={go} aria-current={tab === id ? 'page' : undefined}>
                <Icon size={24} />
                <span>{label}</span>
              </button>
            ))}
            <button type="button" className={`tr-tab tr-tab--search${tab === 'buscar' ? ' is-on' : ''}`} onClick={() => navigate('buscar')} aria-label="Buscar" aria-current={tab === 'buscar' ? 'page' : undefined}>
              <IcSearch size={24} />
            </button>
          </nav>
        </div>
        <Toasts />
        {fullscreen && <PhoneFullscreen now={now} />}
      </div>
    </MotionConfig>
  );
}

function fallbackFor(screen: Screen): Screen {
  switch (screen) {
    case 'canal':
      return 'biblioteca';
    case 'gustos':
      return 'ajustes';
    default:
      return 'agenda';
  }
}
