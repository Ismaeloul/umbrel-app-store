/* Contenedor de toasts con aria-live. Abajo y centrado en el móvil (por
   encima de la barra y del mini-reproductor, respetando la zona segura) y
   abajo a la derecha en escritorio: nunca sobre el vídeo. Con el vídeo a
   pantalla completa no se pinta ninguno (siguen leyéndose). */

import type { CSSProperties } from 'react';
import { useStore } from '../lib/store.ts';
import { ToastView } from '../ui/Toast.tsx';
import { useNoticeFlags } from './notify.ts';
import { dismissToast, toastStore } from './toasts.ts';
import './notices.css';

export interface ToasterProps {
  /** Espacio que dejar abajo (barra inferior, mini-reproductor...). */
  bottomOffset?: string;
}

export function Toaster({ bottomOffset = '0px' }: ToasterProps) {
  const toasts = useStore(toastStore);
  const { immersive } = useNoticeFlags();
  return (
    <section
      className="toaster"
      aria-label="Avisos"
      data-immersive={immersive ? 'true' : 'false'}
      style={{ '--toast-bottom': bottomOffset } as CSSProperties}
    >
      <div className="toaster__list" role="status" aria-live="polite">
        {toasts.map((item) => (
          <ToastView
            key={item.id}
            text={item.text}
            tone={item.tone}
            icon={item.icon}
            count={item.count}
            action={item.action}
            state={item.leaving ? 'leaving' : 'in'}
            onDismiss={item.action ? () => dismissToast(item.id) : undefined}
          />
        ))}
      </div>
    </section>
  );
}
