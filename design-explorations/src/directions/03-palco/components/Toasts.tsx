/* Avisos del simulador (state.toasts) con acción («Deshacer») y contador ×n. */

import { AnimatePresence, motion } from 'motion/react';
import { dismissToast, useSim } from '../../../core/store';
import { Icon } from './icons';
import { useReducedMotion } from './hooks';

export function Toasts({ position = 'bottom', className }: { position?: 'top' | 'bottom'; className?: string }) {
  const toasts = useSim((s) => s.toasts);
  const rm = useReducedMotion();
  const dy = position === 'top' ? -12 : 12;
  return (
    <div className={`pl-toasts pl-toasts--${position} ${className ?? ''}`} aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.div key={t.id} layout className={`pl-toast pl-toast--${t.tone}`} initial={{ opacity: 0, y: rm ? 0 : dy, scale: rm ? 1 : 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: rm ? 0 : dy / 2, scale: rm ? 1 : 0.98 }} transition={{ duration: rm ? 0.1 : 0.24, ease: [0.2, 0.7, 0.2, 1] }}>
            <span className="pl-toast__dot" aria-hidden="true" />
            <span className="pl-toast__text">{t.text}</span>
            {t.count > 1 && <span className="pl-toast__count">×{t.count}</span>}
            {t.action && (
              <button
                type="button"
                className="pl-toast__action"
                onClick={() => {
                  t.action!.run();
                  dismissToast(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
            <button type="button" className="pl-toast__x" aria-label="Cerrar aviso" onClick={() => dismissToast(t.id)}>
              <Icon name="x" size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
