import { useEffect, useState, type ReactNode } from 'react';

/* Marco de iPhone (402×874 pt) con isla dinámica, barra de estado y home
   indicator cuando se ve desde el escritorio. Desde un iPhone real (táctil y
   estrecho) se pinta a pantalla completa y sin marco: la app rellena la
   ventana y usa las zonas seguras reales. */

export const IPHONE_W = 402;
export const IPHONE_H = 874;

export function useIsRealPhone(): boolean {
  const [real, setReal] = useState(() => detect());
  useEffect(() => {
    const on = () => setReal(detect());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return real;
}

function detect(): boolean {
  // Táctil y estrecho en su lado corto: también cuenta el iPhone girado en horizontal.
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return coarse && Math.min(window.innerWidth, window.innerHeight) <= 500;
}

export function DeviceFrame({ children, dark }: { children: ReactNode; dark: boolean }) {
  const real = useIsRealPhone();
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const on = () => {
      const s = Math.min(1, (window.innerHeight - 48) / (IPHONE_H + 28), (window.innerWidth - 32) / (IPHONE_W + 28));
      setScale(Math.max(0.5, s));
    };
    on();
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);

  if (real) {
    return (
      <div className="phone phone--real" data-real-phone="true" style={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
        {children}
      </div>
    );
  }
  return (
    <div className="phone-stage">
      <div className="phone-frame" style={{ width: IPHONE_W + 28, height: IPHONE_H + 28, transform: `scale(${scale})`, transformOrigin: 'top center' }}>
        <div className={`phone ${dark ? 'is-dark' : 'is-light'}`} style={{ width: IPHONE_W, height: IPHONE_H }}>
          <div className="phone-statusbar" aria-hidden="true">
            <span className="phone-time">21:12</span>
            <span className="phone-island" />
            <span className="phone-signals">
              <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="0.8" /><rect x="5" y="5.5" width="3" height="6.5" rx="0.8" /><rect x="10" y="3" width="3" height="9" rx="0.8" /><rect x="15" y="0" width="3" height="12" rx="0.8" /></svg>
              <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor"><path d="M8 9.5a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2Zm0-3.4c1.5 0 2.9.6 3.9 1.6l-1.3 1.3A3.7 3.7 0 0 0 8 8a3.7 3.7 0 0 0-2.6 1L4.1 7.7A5.5 5.5 0 0 1 8 6.1Zm0-3.3c2.4 0 4.6.9 6.2 2.5l-1.3 1.3A6.9 6.9 0 0 0 8 4.6a6.9 6.9 0 0 0-4.9 2L1.8 5.3A8.7 8.7 0 0 1 8 2.8Z" /></svg>
              <svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x="0.5" y="0.5" width="22" height="12" rx="3.5" stroke="currentColor" opacity="0.4" /><rect x="2" y="2" width="19" height="9" rx="2" fill="currentColor" /><path d="M24.5 4.5v4a2 2 0 0 0 0-4Z" fill="currentColor" opacity="0.4" /></svg>
            </span>
          </div>
          <div className="phone-screen">{children}</div>
          <div className="phone-home" aria-hidden="true" />
        </div>
      </div>
    </div>
  );
}
