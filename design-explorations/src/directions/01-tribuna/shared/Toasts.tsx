import { AnimatePresence, motion } from 'motion/react';
import { dismissToast, useSim } from '../../../core/store';
import { I } from './icons';

export function Toasts({ bottom = 0 }: { bottom?: number | string }) {
  const toasts = useSim((s) => s.toasts);
  const reduced = useSim((s) => s.reducedMotion);
  return (
    <div className="tb-toasts" style={{ bottom }} aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className={`tb-toast is-${t.tone}`} initial={{ opacity: 0, y: 12, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={reduced ? { duration: 0.1 } : { type: 'spring', duration: 0.4, bounce: 0.1 }}>
            <span className="tb-toast__icon" aria-hidden="true">
              {t.tone === 'ok' ? <I.Check size={16} /> : t.tone === 'err' ? <I.Warn size={16} /> : t.tone === 'warn' ? <I.Warn size={16} /> : <I.Info size={16} />}
            </span>
            <span className="tb-toast__text">
              {t.text}
              {t.count > 1 && <span className="tb-toast__count">×{t.count}</span>}
            </span>
            {t.action && (
              <button
                type="button"
                className="tb-toast__action"
                onClick={() => {
                  t.action?.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
