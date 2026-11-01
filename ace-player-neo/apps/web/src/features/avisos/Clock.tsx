/* El reloj de los avisos («Te aviso»). Va en el armazón (Shell), siempre
   montado y fuera de las vistas: así avisa también viendo una película o un
   episodio (la sala no tiene barra de sección), en el partido por debajo de
   1024 px o con la vista de la campana oculta por Activity. No pinta nada.

   Además dice qué hacer al pulsar la notificación: la ficha del partido o,
   si no lo es, la Guía. */

import { useEffect } from 'react';
import { useNavigate } from '../../app/router.tsx';
import { setAvisoOpener, useAvisosClock } from './store.ts';

export function AvisosClock() {
  useAvisosClock();
  const navigate = useNavigate();
  useEffect(() => {
    setAvisoOpener((aviso) =>
      navigate(
        aviso.match ? { vista: 'partido', id: aviso.match, canal: null } : { vista: 'guia' },
      ),
    );
    return () => setAvisoOpener(null);
  }, [navigate]);
  return null;
}
