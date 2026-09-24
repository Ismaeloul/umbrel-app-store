/* Propuesta 5 · Transistor — web de escritorio (1440×900, adaptable a 390).
   Un receptor de sobremesa: placa frontal con teclas, dial a lo ancho, la
   pantalla con marco y la página de teletexto a la derecha. */

import './fonts';
import './tokens.css';
import './transistor.css';
import './web.css';

import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';
import { navigate, useRoute } from '../../core/router';
import { getState, setExpanded, setFullscreen, useNow, useSim } from '../../core/store';
import { useWebShortcuts, type KeyHandlers } from '../../core/keys';
import { MiniPlayer } from './components/MiniPlayer';
import { Toasts } from './components/Toasts';
import { ShortcutsSheet } from './components/Shortcuts';
import { closeTop, useGoalPulse } from './components/hooks';
import { Faceplate } from './web/Faceplate';
import { WebAgenda } from './web/WebAgenda';
import { WebMatch } from './web/WebMatch';
import { WebChannel } from './web/WebChannel';
import { WebLibrary } from './web/WebLibrary';
import { WebSearch } from './web/WebSearch';
import { WebSettings } from './web/WebSettings';
import { WebPrefs } from './web/WebPrefs';
import { Fullscreen } from './web/Fullscreen';

export default function Web() {
  const route = useRoute();
  const now = useNow();
  const targetKey = useSim((s) => (s.player.target ? `${s.player.target.kind}:${s.player.target.id}` : null));
  const fullscreen = useSim((s) => s.player.fullscreen);
  const reducedMotion = useSim((s) => s.reducedMotion);
  const [help, setHelp] = useState(false);
  const goal = useGoalPulse();

  const onTargetScreen = (route.screen === 'partido' && targetKey === `match:${route.param}`) || (route.screen === 'canal' && targetKey === `channel:${route.param}`);
  const miniVisible = !!targetKey && !onTargetScreen && !fullscreen;

  useEffect(() => {
    setExpanded(onTargetScreen);
  }, [onTargetScreen, targetKey]);

  const handlers = useMemo<KeyHandlers>(
    () => ({
      onSearch: () => {
        navigate('buscar');
        requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('tr-focus-search')));
      },
      onHelp: () => setHelp(true),
      onEscape: () => {
        if (closeTop()) return true;
        if (getState().player.fullscreen) {
          setFullscreen(false);
          return true;
        }
        return false;
      },
      onArrowIdle: (dir) => window.dispatchEvent(new CustomEvent('tr-dial', { detail: dir })),
    }),
    [],
  );
  useWebShortcuts(handlers);

  const openTarget = () => {
    const t = getState().player.target;
    if (!t) return;
    navigate(t.kind === 'match' ? 'partido' : 'canal', t.id);
  };

  const screenKey = `${route.screen}/${route.param ?? ''}`;

  return (
    <MotionConfig reducedMotion={reducedMotion ? 'always' : 'user'}>
      <div className="tr-root tr-web" data-goal={goal.on ? 'on' : undefined}>
        <Faceplate screen={route.screen} now={now} onHelp={() => setHelp(true)} />
        <main className="tr-web-main" id="tr-main">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={screenKey} className="tr-screen" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}>
              {route.screen === 'agenda' && <WebAgenda now={now} />}
              {route.screen === 'partido' && route.param && <WebMatch id={route.param} now={now} />}
              {route.screen === 'canal' && route.param && <WebChannel id={route.param} now={now} />}
              {route.screen === 'biblioteca' && <WebLibrary tab={route.param} now={now} />}
              {route.screen === 'buscar' && <WebSearch now={now} />}
              {route.screen === 'ajustes' && <WebSettings section={route.param} />}
              {route.screen === 'gustos' && <WebPrefs />}
              {route.screen === 'emparejar' && <WebAgenda now={now} />}
            </motion.div>
          </AnimatePresence>
        </main>
        <AnimatePresence>{miniVisible && <MiniPlayer key="mini" mode="web" onOpen={openTarget} />}</AnimatePresence>
        <Toasts />
        <ShortcutsSheet open={help} onClose={() => setHelp(false)} />
        {fullscreen && <Fullscreen now={now} />}
      </div>
    </MotionConfig>
  );
}
