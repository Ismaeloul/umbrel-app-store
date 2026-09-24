import { useEffect, useState } from 'react';
import { runScenario, setClockOffsetTo, setReducedMotion, setReducedTransparency, setTheme, useNow, useSim, type Scenario } from '../store';
import { go, useRoute } from '../router';
import { hhmm } from '../format';

/* Panel de depuración discreto: un botón flotante «⚙︎» que abre una hoja
   con los escenarios simulables. Es igual en las 5 direcciones. */

const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: 'gol', label: 'Gol entrando', hint: 'Mete un gol ahora en el partido en directo destacado' },
  { id: 'fuente-cae', label: 'Fuente cayéndose', hint: 'La fuente en pantalla muere → 3 reconexiones → cambio automático' },
  { id: 'reconectando', label: 'Reconectando', hint: 'Un corte breve que se recupera solo' },
  { id: 'sin-senal', label: 'Sin señal', hint: 'Todas las fuentes del partido abierto fallan' },
  { id: 'directorio', label: 'Directorio actualizándose', hint: 'La lista «Principal» se sincroniza' },
  { id: 'segundo-dispositivo', label: 'Segundo dispositivo', hint: 'El iPhone de Isma reproduce «M+ LaLiga» (alterna)' },
  { id: 'traspaso', label: 'Traspaso del mando', hint: 'El iPhone da al play con otro canal: aquí se para' },
  { id: 'sin-motor', label: 'Motor apagado', hint: 'El motor deja de responder y se reinicia solo (alterna)' },
  { id: 'primer-uso', label: 'Primer uso', hint: 'Sin gustos, sin favoritos, iPhone sin emparejar' },
  { id: 'reset', label: 'Restaurar datos', hint: 'Vuelve a los datos de muestra' },
];

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const theme = useSim((s) => s.theme);
  const rt = useSim((s) => s.reducedTransparency);
  const rm = useSim((s) => s.reducedMotion);
  const scenario = useSim((s) => s.scenario);
  const engine = useSim((s) => s.engine.status);
  const second = useSim((s) => s.secondDevice);
  const now = useNow();
  const route = useRoute();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'D' && e.shiftKey && !(e.target as HTMLElement)?.closest('input,textarea')) setOpen((o) => !o);
      if (e.key === 'Escape' && open) setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={`dbg-fab${open ? ' is-open' : ''}`}
        aria-label={open ? 'Cerrar el panel de depuración' : 'Abrir el panel de depuración'}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="Panel de depuración (Mayús+D)"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /><circle cx="12" cy="12" r="4" /></svg>
      </button>
      {open && (
        <div className="dbg-sheet" role="dialog" aria-label="Panel de depuración">
          <header className="dbg-head">
            <strong>Simular estados</strong>
            <span className="dbg-clock" title="Reloj simulado">
              {hhmm(now)}
              <button type="button" onClick={() => setClockOffsetTo(20, 40)}>20:40</button>
              <button type="button" onClick={() => setClockOffsetTo(21, 12)}>21:12</button>
              <button type="button" onClick={() => setClockOffsetTo(22, 5)}>22:05</button>
              <button type="button" onClick={() => setClockOffsetTo(23, 30)}>23:30</button>
            </span>
          </header>
          <div className="dbg-grid">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                className={`dbg-btn${scenario === s.id ? ' is-active' : ''}${(s.id === 'segundo-dispositivo' && second) || (s.id === 'sin-motor' && engine !== 'online') ? ' is-on' : ''}`}
                onClick={() => runScenario(s.id)}
                title={s.hint}
              >
                <span>{s.label}</span>
                <small>{s.hint}</small>
              </button>
            ))}
          </div>
          <div className="dbg-row">
            <label>
              Tema
              <select value={theme} onChange={(e) => setTheme(e.target.value as 'sistema' | 'claro' | 'oscuro')}>
                <option value="sistema">Sistema</option>
                <option value="claro">Claro</option>
                <option value="oscuro">Oscuro</option>
              </select>
            </label>
            <label>
              <input type="checkbox" checked={rt} onChange={(e) => setReducedTransparency(e.target.checked)} /> Transparencia reducida
            </label>
            <label>
              <input type="checkbox" checked={rm} onChange={(e) => setReducedMotion(e.target.checked)} /> Movimiento reducido
            </label>
          </div>
          <div className="dbg-row">
            <label>
              Propuesta
              <select value={route.dir ?? ''} onChange={(e) => go(e.target.value ? Number(e.target.value) : null, route.mode, 'agenda')}>
                <option value="">Galería</option>
                <option value="1">1 · Editorial Apple</option>
                <option value="2">2 · Centro de datos</option>
                <option value="3">3 · Cinemático</option>
                <option value="4">4 · Herramienta pro</option>
                <option value="5">5 · Carta libre</option>
              </select>
            </label>
            {route.dir && (
              <label>
                Modo
                <select value={route.mode} onChange={(e) => go(route.dir, e.target.value as 'web' | 'iphone', 'agenda')}>
                  <option value="web">Web escritorio</option>
                  <option value="iphone">iPhone</option>
                </select>
              </label>
            )}
          </div>
          <p className="dbg-foot">Mayús+D abre y cierra este panel. Todo es simulado: no hay servidor.</p>
        </div>
      )}
    </>
  );
}
