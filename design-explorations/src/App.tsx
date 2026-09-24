import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRoute } from './core/router';
import { useSim } from './core/store';
import { directionById } from './directions/registry';
import { Gallery } from './gallery/Gallery';
import { DeviceFrame } from './core/frame/DeviceFrame';
import { DebugPanel } from './core/debug/DebugPanel';

function useSystemDark(): boolean {
  const [dark, setDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return dark;
}

export function useResolvedDark(): boolean {
  const theme = useSim((s) => s.theme);
  const sys = useSystemDark();
  return theme === 'sistema' ? sys : theme === 'oscuro';
}

export default function App() {
  const route = useRoute();
  const dark = useResolvedDark();
  const rt = useSim((s) => s.reducedTransparency);
  const rm = useSim((s) => s.reducedMotion);
  const fullscreen = useSim((s) => s.player.fullscreen);
  const dir = useMemo(() => directionById(route.dir), [route.dir]);

  useEffect(() => {
    document.documentElement.dataset.scheme = dark ? 'dark' : 'light';
    document.documentElement.dataset.transparency = rt ? 'reduced' : 'normal';
    document.documentElement.dataset.motion = rm ? 'reduced' : 'normal';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#0d0f14' : '#f5f4f0');
  }, [dark, rt, rm]);

  // En pantalla completa el botón del panel de depuración se aparta (tapaba los controles).
  useEffect(() => {
    document.documentElement.dataset.fullscreen = fullscreen ? '1' : '0';
  }, [fullscreen]);

  useEffect(() => {
    document.title = dir ? `${dir.name} · ${route.mode === 'iphone' ? 'iPhone' : 'Web'} · Ace Player Neo` : 'Ace Player Neo · exploraciones de diseño';
  }, [dir, route.mode]);

  if (!dir) {
    return (
      <>
        <Gallery />
        <DebugPanel />
      </>
    );
  }

  const fallback = <div style={{ position: 'fixed', inset: 0, display: 'grid', placeItems: 'center', color: '#8f9bad', fontSize: 14 }}>Cargando la propuesta…</div>;

  return (
    <div data-dir={dir.slug} data-mode={route.mode} className={dark ? 'is-dark' : 'is-light'} style={{ height: '100%' }}>
      {route.mode === 'iphone' ? (
        <DeviceFrame dark={dark}>
          <Suspense fallback={fallback}>
            <dir.Iphone />
          </Suspense>
        </DeviceFrame>
      ) : (
        <div className="web-stage">
          <Suspense fallback={fallback}>
            <dir.Web />
          </Suspense>
        </div>
      )}
      <DebugPanel />
    </div>
  );
}
