/* La cortina: hoja inferior con tres posiciones (cerrada · media · entera)
   que se descorre sobre el escenario. En SwiftUI: sheet con presentationDetents
   + presentationBackgroundInteraction (o un cajón propio en el ZStack).

   Gestos, como en Mapas:
   - Desde el asa/cabecera se arrastra siempre.
   - A media altura, cualquier deslizamiento sobre el contenido mueve la cortina
     (subir la despliega entera; bajar la cierra).
   - Entera, el contenido hace scroll; solo si está arriba del todo y se desliza
     hacia abajo, la cortina baja con el dedo.
   - Un toque en el asa alterna media ↔ entera. */

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { animate, motion, useDragControls, type MotionValue, type PanInfo } from 'motion/react';
import { useReducedMotion } from '../components/hooks';
import { haptic } from '../components/haptics';

export type Detent = 'closed' | 'half' | 'full';

export function detentPositions(H: number, safeTop: number): Record<Detent, number> {
  return { closed: H, half: Math.round(H * 0.5), full: safeTop + 10 };
}

const SPRING = { type: 'spring' as const, stiffness: 380, damping: 42, mass: 0.9 };

export function Curtain({ y, detent, setDetent, H, safeTop, header, children, className, bodyRef }: { y: MotionValue<number>; detent: Detent; setDetent: (d: Detent) => void; H: number; safeTop: number; header: ReactNode; children: ReactNode; className?: string; bodyRef?: React.RefObject<HTMLDivElement | null> }) {
  const controls = useDragControls();
  const rm = useReducedMotion();
  const pos = detentPositions(H, safeTop);
  const posRef = useRef(pos);
  posRef.current = pos;
  const [scrolled, setScrolled] = useState(false);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const setBody = useCallback(
    (el: HTMLDivElement | null) => {
      innerRef.current = el;
      if (bodyRef) (bodyRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
    },
    [bodyRef],
  );
  // Gesto sobre el contenido cuando la cortina está entera: decidir si es scroll o arrastre.
  const pending = useRef<{ y: number; decided: boolean } | null>(null);
  // Si el dedo arrastró la cortina, el toque final no debe «hacer clic» en lo que hay debajo.
  const dragged = useRef(false);

  useEffect(() => {
    const target = pos[detent];
    const ctrl = animate(y, target, rm ? { duration: 0.12 } : SPRING);
    return () => ctrl.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detent, H, safeTop]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const p = posRef.current;
    const cur = y.get();
    const v = info.velocity.y;
    const order: Detent[] = ['full', 'half', 'closed'];
    let next: Detent;
    if (Math.abs(v) > 500) {
      const idx = order.indexOf(detent);
      // hacia abajo (v>0) → siguiente más cerrada; hacia arriba → más abierta
      const target = v > 0 ? order[Math.min(order.length - 1, idx + 1)] : order[Math.max(0, idx - 1)];
      next = cur > p.half + 40 && v > 0 ? 'closed' : target;
    } else {
      next = order.reduce((best, d) => (Math.abs(p[d] - cur) < Math.abs(p[best] - cur) ? d : best), 'half' as Detent);
    }
    if (next === detent) animate(y, p[next], rm ? { duration: 0.12 } : SPRING);
    else haptic(next === 'closed' ? 'medium' : 'light');
    setDetent(next);
  };

  const onBodyPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (detent !== 'full') {
      // A media altura el contenido no hace scroll: el dedo mueve la cortina.
      controls.start(e);
      return;
    }
    pending.current = { y: e.clientY, decided: false };
  };
  const onBodyPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = pending.current;
    if (!p || p.decided) return;
    const dy = e.clientY - p.y;
    if (Math.abs(dy) < 6) return;
    p.decided = true;
    const top = (innerRef.current?.scrollTop ?? 0) <= 0;
    if (dy > 0 && top) controls.start(e);
  };
  const onBodyPointerEnd = () => {
    pending.current = null;
  };

  return (
    <motion.div
      className={`pl-ip__curtain is-${detent}${scrolled ? ' is-scrolled' : ''} ${className ?? ''}`}
      style={{ y, height: H - pos.full }}
      drag="y"
      dragControls={controls}
      dragListener={false}
      dragConstraints={{ top: pos.full, bottom: pos.closed }}
      dragElastic={0.04}
      dragMomentum={false}
      onDragStart={() => {
        dragged.current = true;
      }}
      onDragEnd={onDragEnd}
      onPointerDownCapture={() => {
        dragged.current = false;
      }}
      onClickCapture={(e) => {
        if (dragged.current) {
          e.stopPropagation();
          e.preventDefault();
        }
      }}
    >
      <div
        className="pl-ip__grab"
        onPointerDown={(e) => controls.start(e)}
        onClick={(e) => {
          // Solo el asa (no los controles de la cabecera) alterna la posición.
          if ((e.target as HTMLElement).closest('button, input, [role="tab"]')) return;
          haptic('light');
          setDetent(detent === 'full' ? 'half' : 'full');
        }}
      >
        <span className="pl-ip__handle" aria-hidden="true" />
        {header}
      </div>
      <div
        ref={setBody}
        className={`pl-ip__curtainbody is-${detent}`}
        style={{ paddingBottom: pos.half - pos.full + 200 }}
        onPointerDown={onBodyPointerDown}
        onPointerMove={onBodyPointerMove}
        onPointerUp={onBodyPointerEnd}
        onPointerCancel={onBodyPointerEnd}
        onScroll={(e) => setScrolled((e.currentTarget.scrollTop ?? 0) > 4)}
      >
        {children}
      </div>
    </motion.div>
  );
}
