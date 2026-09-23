/* «Datos técnicos» del centro de partido (inventario §11, maqueta A): en el
   móvil, plegado al final con un resumen («48 pares · 1,92 MB/s») y la
   tecla S lo abre; en el panel lateral de escritorio, abierto. Mientras esto
   está montado el reproductor no saca su propio panel sobre el vídeo (salvo
   a pantalla completa, donde la vista no se ve): `useHostNerdPanel`. */

import { useId } from 'react';
import { cx } from '../../lib/cx.ts';
import { setNerdOpen, useHostNerdPanel, usePlayerSelector } from '../../player/api.ts';
import { formatSpeed, PlayerNerdStats } from '../../player/NerdPanel.tsx';
import { Icon, Kbd } from '../../ui/index.ts';

export function NerdSection({ variant }: { variant: 'fold' | 'panel' }) {
  useHostNerdPanel(true);
  const open = usePlayerSelector((state) => state.nerdOpen);
  const summary = usePlayerSelector((state) =>
    state.stats ? `${state.stats.peers} pares · ${formatSpeed(state.stats.speedDown)}` : null,
  );
  const hasChannel = usePlayerSelector((state) => state.channel !== null);
  const headingId = useId();
  if (variant === 'panel') {
    return (
      <section className="mc-nerd mc-nerd--panel" aria-labelledby={headingId}>
        <h2 id={headingId} className="mc-nerd__title">
          <Icon name="nerd" size={20} />
          Datos técnicos
        </h2>
        {hasChannel ? (
          <PlayerNerdStats />
        ) : (
          <p className="mc-nerd__empty">Aparecen cuando suena una fuente.</p>
        )}
      </section>
    );
  }
  return (
    <details
      className={cx('mc-nerd', 'mc-nerd--fold')}
      open={open}
      onToggle={(event) => {
        const next = (event.currentTarget as HTMLDetailsElement).open;
        if (next !== open) setNerdOpen(next);
      }}
    >
      <summary className="mc-nerd__summary press">
        <Icon name="nerd" size={20} />
        <span className="mc-nerd__label">Datos técnicos</span>
        {summary ? <span className="mc-nerd__brief">{summary}</span> : null}
        <Kbd className="mc-nerd__kbd">S</Kbd>
        <Icon name={open ? 'chev-u' : 'chev-d'} size={18} />
      </summary>
      {hasChannel ? (
        <PlayerNerdStats />
      ) : (
        <p className="mc-nerd__empty">Aparecen cuando suena una fuente.</p>
      )}
    </details>
  );
}
