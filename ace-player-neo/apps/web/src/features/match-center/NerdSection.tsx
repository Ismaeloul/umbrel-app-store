/* «Datos técnicos» del teatro (inventario §11; en Palco, la tercera pestaña
   del panel, decisión W5). Mientras esto está montado el reproductor no saca
   su propio panel sobre el vídeo (salvo a pantalla completa o en modo
   teatro, donde la vista no se ve): `useHostNerdPanel`. La tecla S (o «Datos
   técnicos» en «Más opciones») abre esta pestaña (TheaterTabs.tsx). */

import { useId } from 'react';
import { useHostNerdPanel, usePlayerSelector } from '../../player/api.ts';
import { formatSpeed, PlayerNerdStats } from '../../player/NerdPanel.tsx';
import { Icon, Kbd } from '../../ui/index.ts';

export function NerdSection() {
  useHostNerdPanel(true);
  const summary = usePlayerSelector((state) =>
    state.stats ? `${state.stats.peers} pares · ${formatSpeed(state.stats.speedDown)}` : null,
  );
  const hasChannel = usePlayerSelector((state) => state.channel !== null);
  const headingId = useId();
  return (
    <section className="mc-nerd" aria-labelledby={headingId}>
      <div className="mc-nerd__head">
        <h2 id={headingId} className="mc-nerd__title">
          <Icon name="nerd" size={20} />
          Datos técnicos
        </h2>
        {summary ? <span className="mc-nerd__brief">{summary}</span> : null}
        <Kbd className="mc-nerd__kbd">S</Kbd>
      </div>
      {hasChannel ? (
        <PlayerNerdStats />
      ) : (
        <p className="mc-nerd__empty">Aparecen cuando suena una fuente.</p>
      )}
    </section>
  );
}
