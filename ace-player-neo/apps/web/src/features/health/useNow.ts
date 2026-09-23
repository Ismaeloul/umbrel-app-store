/* Reloj para los «hace 5 min»: se mueve cada `everyMs` mientras el componente
   está montado y visible (Activity desmonta los efectos al ocultar la vista,
   así que oculta no hay ningún temporizador vivo). Al volver a enseñarse se
   pone en hora al momento. */

import { useEffect, useState } from 'react';

export function useNow(everyMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
