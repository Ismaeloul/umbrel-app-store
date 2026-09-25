import { useEffect } from 'react';
import { getState, goLive, nextSource, seekBack, setExpanded, setFullscreen, setMuted, togglePlay, zap, selectSource, ensureSources } from './store';

/* Atajos de teclado estándar de la web (todas las propuestas los comparten).
   No actúan en campos de texto ni con Ctrl/Cmd/Alt. */

export interface KeyHandlers {
  /** «/» enfoca el buscador (o abre la paleta). */
  onSearch?: () => void;
  /** «?» abre la ayuda. */
  onHelp?: () => void;
  /** Esc: cierra lo que haya abierto; devuelve true si ha hecho algo. */
  onEscape?: () => boolean | void;
  /** ← → cuando NO hay nada sonando (p. ej. cambiar de día). */
  onArrowIdle?: (dir: -1 | 1) => void;
}

export function useWebShortcuts(h: KeyHandlers = {}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.isContentEditable)) {
        if (e.key === 'Escape') {
          (t as HTMLElement).blur();
          h.onEscape?.();
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          h.onSearch?.();
        }
        return;
      }
      const s = getState();
      const p = s.player;
      const engaged = p.conn !== 'idle' && p.conn !== 'error';
      switch (e.key) {
        case '/':
          e.preventDefault();
          h.onSearch?.();
          break;
        case '?':
          e.preventDefault();
          h.onHelp?.();
          break;
        case 'Escape':
          h.onEscape?.();
          break;
        case ' ':
        case 'k':
        case 'K':
          if (engaged) {
            e.preventDefault();
            togglePlay();
          }
          break;
        case 'j':
        case 'J':
          if (engaged) seekBack(30);
          break;
        case 'l':
        case 'L':
          if (engaged) goLive();
          break;
        case 'm':
        case 'M':
          if (engaged) setMuted(!p.muted);
          break;
        case 'f':
        case 'F':
          if (engaged) setFullscreen(!p.fullscreen);
          break;
        case 'n':
        case 'N':
          if (p.target) nextSource(p.target.kind, p.target.id, 1);
          break;
        case 'ArrowLeft':
        case 'ArrowRight': {
          const dir = e.key === 'ArrowLeft' ? -1 : 1;
          if (engaged && p.target) {
            e.preventDefault();
            zap(dir);
          } else h.onArrowIdle?.(dir);
          break;
        }
        default:
          if (/^[1-9]$/.test(e.key) && p.target) {
            const list = ensureSources(p.target.kind, p.target.id).sources.filter((x) => x.state !== 'failed');
            const src = list[Number(e.key) - 1];
            if (src) selectSource(p.target.kind, p.target.id, src.id);
          }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [h]);
}

export const SHORTCUT_TABLE: { keys: string; label: string; group: string }[] = [
  { keys: '← →', label: 'Zapear (solo con algo sonando)', group: 'Reproductor' },
  { keys: 'Espacio · K', label: 'Pausa y reanuda', group: 'Reproductor' },
  { keys: 'J', label: 'Retrocede 30 s', group: 'Reproductor' },
  { keys: 'L', label: 'Ir al directo', group: 'Reproductor' },
  { keys: 'M', label: 'Silencio', group: 'Reproductor' },
  { keys: 'F', label: 'Pantalla completa', group: 'Reproductor' },
  { keys: 'N', label: 'Siguiente fuente', group: 'Fuentes' },
  { keys: '1 – 9', label: 'Elegir la fuente con ese número', group: 'Fuentes' },
  { keys: '/', label: 'Buscar', group: 'General' },
  { keys: '?', label: 'Esta ayuda', group: 'General' },
  { keys: 'Esc', label: 'Cierra hojas y menús', group: 'General' },
  { keys: 'Mayús + D', label: 'Panel de depuración', group: 'General' },
];

export { setExpanded };
