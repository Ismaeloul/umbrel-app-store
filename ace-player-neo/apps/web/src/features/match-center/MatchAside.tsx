/* Panel lateral del teatro en escritorio (≥ 1024 px, plegable; plan Palco
   fase 2, decisión W5): las mismas pestañas que bajo el vídeo en el móvil
   (Fuentes · Partido · Datos técnicos, o Fuentes · Canal · Datos técnicos en
   un canal suelto) con el botón de plegarlo al lado. Plegarlo devuelve el
   ancho al vídeo; las pestañas bajan entonces a la vista. */

import { useMemo } from 'react';
import type { ViewProps } from '../../app/contracts.ts';
import { useLayout } from '../../app/layout.tsx';
import { IconButton } from '../../ui/index.ts';
import { useLibraryLookup, useNow, useSchedule, useScores } from '../agenda/data.ts';
import { channelInfo, madridClock } from '../agenda/domain.ts';
import { useSession } from '../sources/session.ts';
import { ChannelTabs, useChannelContext } from './ChannelCenter.tsx';
import { findMatch } from './find.ts';
import { MatchTabs } from './TheaterTabs.tsx';
import './match-center.css';

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

function ChannelAside({ hash }: { hash: string }) {
  const context = useChannelContext(hash);
  return (
    <ChannelTabs
      hash={hash}
      context={context}
      variant="rack"
      className="mc-tabs--aside"
      extra={<Fold />}
    />
  );
}

function MatchAsideTabs({ id }: { id: string }) {
  const schedule = useSchedule();
  const match = useMemo(() => findMatch(schedule.data, id), [schedule.data, id]);
  const now = useNow();
  const { scores } = useScores(match ? [match] : [], now);
  const score = match ? (scores[match.id] ?? null) : null;
  const lookup = useLibraryLookup();
  const channels = useMemo(() => (match ? channelInfo(match, lookup) : []), [match, lookup]);
  return (
    <MatchTabs
      match={match}
      score={score}
      now={now}
      channels={channels}
      today={madridClock(now).date}
      variant="rack"
      className="mc-tabs--aside"
      extra={<Fold />}
    />
  );
}

export default function MatchAside({ route }: ViewProps) {
  const hash = route.vista === 'partido' ? route.canal : null;
  /* Con un partido, el panel se llena cuando su sesión ya existe (la abre la
     vista al entrar). Antes pintaba primero el panel vacío con «Datos
     técnicos» arriba del todo y, al llegar las fuentes, lo empujaba 400 px
     hacia abajo (CLS en escritorio; revisión de rendimiento de la Fase 2). */
  const matchId = route.vista === 'partido' && !hash ? route.id : null;
  const waiting = useSession((state) =>
    hash ? state.key !== `c:${hash}` : matchId !== null && state.key !== `m:${matchId}`,
  );
  if (waiting) return <div className="mc-aside" />;
  return (
    <div className="mc-aside">
      {hash ? <ChannelAside hash={hash} /> : matchId ? <MatchAsideTabs id={matchId} /> : null}
    </div>
  );
}
