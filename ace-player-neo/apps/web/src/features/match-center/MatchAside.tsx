/* Panel lateral del centro de partido en escritorio (≥ 1024 px, plegable):
   el rack de fuentes (B2) con su progreso y sus acciones, y «Datos
   técnicos» abierto (maqueta A). Plegarlo devuelve el ancho al vídeo; las
   fuentes bajan entonces a la vista. */

import type { ViewProps } from '../../app/contracts.ts';
import { useLayout } from '../../app/layout.tsx';
import { IconButton } from '../../ui/index.ts';
import { useSession } from '../sources/session.ts';
import { SourcesPanel } from '../sources/SourcesPanel.tsx';
import { useChannelContext } from './ChannelCenter.tsx';
import { NerdSection } from './NerdSection.tsx';
import './match-center.css';

function ChannelFallback({ hash }: { hash: string }) {
  const context = useChannelContext(hash);
  return <SourcesPanel variant="rack" channelFallback={context.target} headerExtra={<Fold />} />;
}

function Fold() {
  const layout = useLayout();
  return (
    <IconButton
      icon="panel"
      label="Plegar el panel lateral"
      onClick={() => layout.setAsideOpen(false)}
    />
  );
}

export default function MatchAside({ route }: ViewProps) {
  const lonelyChannel = useSession(
    (state) => state.kind === 'channel' && state.entries.length === 0,
  );
  const hash = route.vista === 'partido' ? route.canal : null;
  /* Con un partido, el panel se llena cuando su sesión ya existe (la abre la
     vista al entrar). Antes pintaba primero el panel vacío con «Datos
     técnicos» arriba del todo y, al llegar las fuentes, lo empujaba 400 px
     hacia abajo (CLS en escritorio; revisión de rendimiento de la Fase 2). */
  const matchId = route.vista === 'partido' && !hash ? route.id : null;
  const waiting = useSession((state) => matchId !== null && state.key !== `m:${matchId}`);
  if (waiting) return <div className="mc-aside" />;
  return (
    <div className="mc-aside">
      {lonelyChannel ? (
        // Un canal sin hermanas no tiene selector (§7.1): el panel se queda con sus acciones.
        <div className="mc-aside__bar">
          <h2 className="mc-aside__title">Canal</h2>
          <Fold />
        </div>
      ) : null}
      {hash ? (
        <ChannelFallback hash={hash} />
      ) : (
        <SourcesPanel variant="rack" headerExtra={<Fold />} />
      )}
      <NerdSection variant="panel" />
    </div>
  );
}
