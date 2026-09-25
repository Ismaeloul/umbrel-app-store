/* Avisos: máximo dos, con «×n» y acción opcional (Deshacer, Reproducir aquí). */
import { AnimatePresence, motion } from 'motion/react';
import { dismissToast, useSim } from '../../../core/store';

export function Toasts({ bottom }: { bottom?: number | string }) {
  const toasts = useSim((s) => s.toasts);
  const reduced = useSim((s) => s.reducedMotion);
  return (
    <div className="pz-toasts" style={bottom !== undefined ? { bottom } : undefined} aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div
            key={t.id}
            className={`pz-toast tone-${t.tone}`}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={{ duration: reduced ? 0.1 : 0.18, ease: [0.2, 0.8, 0.2, 1] }}
            layout={!reduced}
          >
            <span className="txt">{t.text.replace(/^⚽\s*/, '')}</span>
            {t.count > 1 && <span className="cnt">×{t.count}</span>}
            {t.action && (
              <button
                type="button"
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
