/* Avisos (`state.toasts`) como tiras de papel con marco de tinta, y la línea
   de estado (`state.statusLine`) como una línea de teletexto bajo el vídeo. */

import { AnimatePresence, motion } from 'motion/react';
import { dismissToast, useSim, type StatusLine } from '../../../core/store';
import type { Tone } from './text';

function toneOf(t: 'info' | 'ok' | 'warn' | 'err'): Tone {
  return t === 'ok' ? 'green' : t === 'warn' ? 'yellow' : t === 'err' ? 'red' : 'cyan';
}

export function Toasts({ className }: { className?: string }) {
  const toasts = useSim((s) => s.toasts);
  return (
    <div className={`tr-toasts${className ? ` ${className}` : ''}`} aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`tr-toast tr-tone-${toneOf(t.tone)}`}
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
            layout="position"
          >
            <i className="tr-dot" aria-hidden="true" />
            <span className="tr-toast-tx">
              {t.text}
              {t.count > 1 && <b className="tr-toast-n">×{t.count}</b>}
            </span>
            {t.action ? (
              <button
                type="button"
                className="tr-toast-act"
                onClick={() => {
                  t.action?.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : (
              <button type="button" className="tr-toast-x" aria-label="Cerrar aviso" onClick={() => dismissToast(t.id)}>
                ×
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function StatusLineView({ line, className, fallback }: { line: StatusLine | null; className?: string; fallback?: string }) {
  const tone: Tone = line ? toneOf(line.tone) : 'muted';
  return (
    <div className={`tr-status tr-tone-${tone}${className ? ` ${className}` : ''}`} aria-live="polite">
      <i className="tr-dot" aria-hidden="true" />
      <span className="tr-status-tx">{line ? line.text : fallback ?? ''}</span>
      {line?.meta && <span className="tr-status-meta">{line.meta}</span>}
    </div>
  );
}
