/* Palco · iPhone (402×874 pt dentro de DeviceFrame; a pantalla completa en un
   iPhone real). ZStack: escenario al fondo, cortinas (Agenda · Canales ·
   Ajustes) con tres posiciones, mini y barra flotante de tres botones. */

import '@fontsource-variable/bricolage-grotesque';
import '@fontsource-variable/inter';
import '@fontsource-variable/jetbrains-mono';
import './tokens.css';
import './palco.css';
import './iphone.css';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, LayoutGroup, animate, motion, useMotionValue, type PanInfo } from 'motion/react';
import { back, navigate, tabOf, useRoute, type Screen } from '../../core/router';
import { addManualSource, getState, now as simNow, playChannel, setExpanded, useSim } from '../../core/store';
import { Icon, type IconName } from './components/icons';
import { Toasts } from './components/Toasts';
import { HAPTIC_LABEL, haptic, type HapticKind } from './components/haptics';
import { useIsRealPhone } from '../../core/frame/DeviceFrame';
import { PasteSheet, Sheet } from './components/sheets';
import { PrefsForm } from './components/prefs';
import { useMemoryState, useSize } from './components/hooks';
import { ENGINE_TITLES } from './components/stage';
import { Curtain, detentPositions, type Detent } from './iphone/Curtain';
import { Portada } from './iphone/Portada';
import { Player } from './iphone/Player';
import { MiniIphone } from './iphone/Mini';
import { Pairing } from './iphone/Pairing';
import { useAgendaCurtain, useAjustesCurtain, useCanalesCurtain } from './iphone/Cortinas';

type Tab = 'agenda' | 'canales' | 'ajustes';
const TABS: { id: Tab; label: string; icon: IconName; screen: Screen }[] = [
  { id: 'agenda', label: 'Agenda', icon: 'calendar', screen: 'agenda' },
  { id: 'canales', label: 'Canales', icon: 'tv', screen: 'biblioteca' },
  { id: 'ajustes', label: 'Ajustes', icon: 'gear', screen: 'ajustes' },
];

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Solo en el prototipo de escritorio: un aviso mínimo cada vez que la app «vibraría». */
function HapticPip() {
  const [pip, setPip] = useState<{ kind: HapticKind; n: number } | null>(null);
  useEffect(() => {
    let n = 0;
    let t: ReturnType<typeof setTimeout> | null = null;
    const on = (e: Event) => {
      n += 1;
      setPip({ kind: (e as CustomEvent<HapticKind>).detail, n });
      if (t) clearTimeout(t);
      t = setTimeout(() => setPip(null), 700);
    };
    window.addEventListener('aceneo:haptic', on);
    return () => {
      window.removeEventListener('aceneo:haptic', on);
      if (t) clearTimeout(t);
    };
  }, []);
  return (
    <AnimatePresence>
      {pip && (
        <motion.div key={pip.n} className={`pl-ip__haptic is-${pip.kind}`} initial={{ opacity: 0, scale: 0.9, y: 4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.16 }} aria-hidden="true">
          <span className="pl-ip__hapticwave" />
          {HAPTIC_LABEL[pip.kind]}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default function Iphone() {
  const route = useRoute();
  const paired = useSim((s) => s.paired);
  if (!paired) {
    return (
      <div className="pl-root pl-ip">
        <Pairing />
        <Toasts position="top" />
      </div>
    );
  }
  return <Shell key="shell" screen={route.screen} param={route.param} />;
}

function Shell({ screen, param }: { screen: Screen; param: string | null }) {
  const player = useSim((s) => s.player);
  const onboarding = useSim((s) => s.preferences.onboardingComplete);
  const [rootRef, size] = useSize<HTMLDivElement>();
  const [probeRef, probe] = useSize<HTMLDivElement>();
  const [probeBRef, probeB] = useSize<HTMLDivElement>();
  const H = size.h || 874;
  const W = size.w || 402;
  const safeTop = probe.h || 62;
  const safeBottom = probeB.h || 34;
  const inStage = screen === 'partido' || screen === 'canal';
  const tabRoot = tabOf(screen);
  const tab: Tab = tabRoot === 'agenda' ? 'agenda' : tabRoot === 'ajustes' ? 'ajustes' : 'canales';
  const curtainKind: Tab | null = inStage || screen === 'gustos' || screen === 'emparejar' ? null : tab;
  const [detent, setDetent] = useMemoryState<Detent>('pl-ip-detent', 'half');
  const real = useIsRealPhone();
  const rmTab = useSim((s) => s.reducedMotion);
  const [day, setDay] = useMemoryState('pl-ip-day', startOfDay(simNow()));
  const [paste, setPaste] = useState(false);
  const y = useMotionValue(detentPositions(H, safeTop).half);
  const bodyRef = useRef<HTMLDivElement>(null);
  const prevKind = useRef<Tab | null>(curtainKind);

  useEffect(() => {
    setExpanded(inStage);
  }, [inStage]);

  // La ruta sigue a lo que suena mientras estás en el escenario (zapping, «Ver aquí»…).
  const targetKey = player.target ? `${player.target.kind}:${player.target.id}` : null;
  useEffect(() => {
    if (!inStage || !player.target) return;
    const want: Screen = player.target.kind === 'match' ? 'partido' : 'canal';
    if (screen !== want || param !== player.target.id) navigate(want, player.target.id, null, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  // Al cambiar de cortina: Ajustes y Buscar se abren enteras; el resto a media.
  useEffect(() => {
    if (!curtainKind) return;
    if (screen === 'buscar' || curtainKind === 'ajustes') setDetent('full');
    else if (prevKind.current !== curtainKind || detent === 'closed') setDetent('half');
    prevKind.current = curtainKind;
    bodyRef.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curtainKind, screen, param]);

  // Si el escenario se cierra desde fuera (deja de sonar), no hay cortina cerrada.
  useEffect(() => {
    if (!inStage && curtainKind && detent === 'closed' && !player.target) setDetent('half');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.target]);

  const agenda = useAgendaCurtain(day, setDay, () => setDetent('full'));
  const canales = useCanalesCurtain(screen === 'buscar', () => setDetent('full'), () => setPaste(true));
  const ajustes = useAjustesCurtain(screen === 'ajustes' ? param : null);
  const parts = curtainKind === 'agenda' ? agenda : curtainKind === 'ajustes' ? ajustes : canales;

  const onTab = (t: Tab) => {
    const def = TABS.find((x) => x.id === t)!;
    haptic('selection');
    if (!inStage && curtainKind === t) {
      setDetent(detent === 'closed' ? 'half' : detent === 'half' ? 'closed' : 'half');
      return;
    }
    navigate(def.screen);
  };

  const onPasteAnywhere = (hash: string) => {
    const t = getState().player.target;
    if (t && inStage) addManualSource(t.kind, t.id, hash);
    else {
      ENGINE_TITLES.set(hash, 'Enlace pegado');
      playChannel(hash);
      navigate('canal', hash);
    }
  };

  const showMini = !!player.target && !inStage && screen !== 'gustos';
  const barBottom = safeBottom + 8;
  const miniBottom = barBottom + 64 + 8;
  const canGoBack = inStage || screen === 'gustos' || (screen === 'ajustes' && !!param);
  // iPhone real girado: el escenario pasa a pantalla completa sin simular el giro.
  const landscape = W > H && W <= 1100;
  // Deslizar desde el borde izquierdo: el escenario sigue al dedo y vuelve al soltar.
  const edgeX = useMotionValue(0);
  const onEdgeDrag = (_: unknown, i: PanInfo) => {
    if (inStage) edgeX.set(Math.max(0, i.offset.x));
  };
  const onEdge = (_: unknown, i: PanInfo) => {
    if (i.offset.x > 70 || i.velocity.x > 500) {
      if (inStage) animate(edgeX, W, { duration: 0.22, ease: [0.2, 0.7, 0.2, 1] });
      back();
    } else animate(edgeX, 0, { type: 'spring', stiffness: 420, damping: 40 });
  };
  useEffect(() => {
    if (!inStage) edgeX.set(0);
  }, [inStage, edgeX]);

  return (
    <LayoutGroup>
      <div ref={rootRef} className={`pl-root pl-ip${inStage ? ' is-stage' : ''}${player.fullscreen || (landscape && inStage) ? ' is-fullscreen' : ''}${landscape ? ' is-landscape' : ''}`}>
        <div ref={probeRef} className="pl-ip__probe pl-ip__probe--top" aria-hidden="true" />
        <div ref={probeBRef} className="pl-ip__probe pl-ip__probe--bottom" aria-hidden="true" />

        <AnimatePresence initial={false}>{inStage && param ? <Player key={`${screen}:${param}`} kind={screen === 'partido' ? 'match' : 'channel'} id={param} W={W} H={H} landscape={landscape} edgeX={edgeX} /> : <Portada key="portada" curtainY={y} H={H} />}</AnimatePresence>

        {curtainKind && (
          <Curtain y={y} detent={detent} setDetent={setDetent} H={H} safeTop={safeTop} header={parts.header} bodyRef={bodyRef}>
            {parts.body}
          </Curtain>
        )}
        {canales.sheets}

        <div className={`pl-ip__barscrim${showMini ? ' has-mini' : ''}`} aria-hidden="true" />
        <AnimatePresence>{showMini && player.target && <MiniIphone key="mini" kind={player.target.kind} id={player.target.id} bottom={miniBottom} />}</AnimatePresence>

        {!player.fullscreen && !(landscape && inStage) && (
          <nav className="pl-ip__bar" style={{ bottom: barBottom }} aria-label="Principal">
            {TABS.map((t) => {
              const on = !inStage && curtainKind === t.id;
              return (
                <button key={t.id} type="button" className={`pl-ip__tab${on ? ' is-on' : ''}`} onClick={() => onTab(t.id)} aria-current={on ? 'page' : undefined}>
                  {on && <motion.span className="pl-ip__tabpill" layoutId="pl-ip-tabpill" transition={rmTab ? { duration: 0.1 } : { type: 'spring', stiffness: 520, damping: 42 }} aria-hidden="true" />}
                  <span className="pl-ip__tabin">
                    <Icon name={t.icon} size={22} strokeWidth={on ? 2.2 : 1.9} />
                    <span>{t.label}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        )}
        {!real && <HapticPip />}

        {canGoBack && !player.fullscreen && !(landscape && inStage) && <motion.div className="pl-ip__edge" drag="x" dragConstraints={{ left: 0, right: 0 }} dragElastic={{ left: 0, right: 0.5 }} dragMomentum={false} onDrag={onEdgeDrag} onDragEnd={onEdge} aria-hidden="true" />}

        <Toasts position="top" />
        <Sheet open={screen === 'gustos'} onClose={() => (onboarding ? back() : navigate('agenda', null, null, { replace: true }))} mode="iphone" size="full" bare>
          <PrefsForm compact stickyFooter firstUse={!onboarding} onDone={() => (onboarding ? back() : navigate('agenda', null, null, { replace: true }))} onCancel={() => (onboarding ? back() : navigate('agenda', null, null, { replace: true }))} />
        </Sheet>
        {!inStage && <PasteSheet open={paste} onClose={() => setPaste(false)} mode="iphone" onPlay={onPasteAnywhere} />}
      </div>
    </LayoutGroup>
  );
}
