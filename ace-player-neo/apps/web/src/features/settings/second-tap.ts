/* «Segundo toque» en vez de confirm() nativo (regla 31): el primer toque arma
   el botón («¿Borrar?», «¿Seguro? Pulsa otra vez…») durante unos segundos y
   el segundo ejecuta. Si pasa el tiempo, el botón vuelve solo a su estado.
   Lo usan borrar una lista (5 s) y reiniciar el motor (6 s).

     const confirm = useSecondTap(5000);
     onClick={() => confirm.tap(source.id, () => borrar(source.id))}
     confirm.armed === source.id  // ¿está armado este? */

import { useCallback, useEffect, useRef, useState } from 'react';

export interface SecondTap {
  /** Clave armada ahora mismo, o null. */
  armed: string | null;
  /** Primer toque: arma. Segundo toque sobre la misma clave: ejecuta. */
  tap(key: string, run: () => void): void;
  disarm(): void;
}

export function useSecondTap(ms: number): SecondTap {
  const [armed, setArmed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // Sin temporizadores vivos al desmontarse o al ocultarse la vista (Activity
  // conserva el estado): al volver, el botón está desarmado, nunca armado
  // para siempre.
  useEffect(
    () => () => {
      clear();
      setArmed(null);
    },
    [],
  );

  const disarm = useCallback(() => {
    clear();
    setArmed(null);
  }, []);

  const tap = (key: string, run: () => void) => {
    if (armed === key) {
      disarm();
      run();
      return;
    }
    clear();
    setArmed(key);
    timer.current = setTimeout(() => {
      timer.current = null;
      setArmed(null);
    }, ms);
  };

  return { armed, tap, disarm };
}
