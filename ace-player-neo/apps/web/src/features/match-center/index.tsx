/* Centro de partido (`?vista=partido/<id>` y `partido/canal/<hash>`),
   inventario §5, §6 y §7. El reproductor y la línea de estado los pone el
   armazón ENCIMA de esta vista (src/app/Shell.tsx); aquí va todo lo demás.

   Maquetación (diseño A, bento):
   - Móvil: marcador, fuentes (lista con frase humana y barra «Emitiendo»
     que se desliza), acciones, «Dónde se emite» y «Datos técnicos» plegado.
   - Escritorio: bajo el vídeo, marcador + «Dónde se emite»; las fuentes
     (rack), sus acciones y los datos técnicos, en el panel lateral
     (aside.tsx). Desde 1280 px el armazón añade la columna de la agenda:
     agenda + reproductor + panel a la vez. Con el panel plegado, las
     fuentes bajan aquí.

   La lógica de las fuentes vive fuera de React (src/features/sources/
   session.ts) para que siga funcionando con el reproductor en «mini». */

import '../agenda/demo.ts';
import '../sources/demo.ts';
import type { FootballMatch, FootballSchedule } from '@ace/shared';
import { useEffect, useEffectEvent, useMemo } from 'react';
import type { ViewProps } from '../../app/contracts.ts';
import { useLayout } from '../../app/layout.tsx';
import { useNavigate } from '../../app/router.tsx';
import { Button, EmptyState, IconButton, Skeleton, SkeletonRows } from '../../ui/index.ts';
import { useLibraryLookup, useNow, useSchedule, useScores } from '../agenda/data.ts';
import { channelInfo, madridClock } from '../agenda/domain.ts';
import { PasteHashSheet } from '../paste-hash/index.ts';
import { ReportSheet } from '../sources/ReportSheet.tsx';
import { ResolverSheet } from '../sources/ResolverSheet.tsx';
import {
  addManualSource,
  enterMatch,
  leaveSession,
  openPaste,
  useSession,
} from '../sources/session.ts';
import { SourcesPanel } from '../sources/SourcesPanel.tsx';
import { ChannelCenter } from './ChannelCenter.tsx';
import { NerdSection } from './NerdSection.tsx';
import { Scoreboard } from './Scoreboard.tsx';
import { WhereAired } from './WhereAired.tsx';
import './match-center.css';

export function findMatch(
  schedule: Pick<FootballSchedule, 'days'> | undefined,
  id: string | null,
): FootballMatch | null {
  if (!schedule || !id) return null;
  for (const day of schedule.days) {
    const match = day.matches.find((item) => item.id === id);
    if (match) return match;
  }
  return null;
}

/** Las hojas del centro de partido: una sola vez, aunque las abra el panel lateral. */
function MatchSheets({ inMatch }: { inMatch: boolean }) {
  const pasteOpen = useSession((state) => state.pasteOpen);
  return (
    <>
      <ResolverSheet />
      <ReportSheet />
      {inMatch ? (
        <PasteHashSheet
          open={pasteOpen}
          onClose={() => openPaste(false)}
          onSubmit={(hash) => void addManualSource(hash)}
        />
      ) : (
        // En un canal suelto, el hash pegado se abre como canal propio (sin
        // heredar el nombre del que sonaba: contradicción 11 de la 0.6.59).
        <PasteHashSheet open={pasteOpen} onClose={() => openPaste(false)} />
      )}
    </>
  );
}

function MatchSkeleton() {
  return (
    <div className="mc" aria-busy="true">
      <div className="mc-score mc-score--skeleton">
        <Skeleton width={180} height={16} radius="s" />
        <div className="mc-score__skeleton-row">
          <Skeleton width={72} height={72} radius="pill" />
          <Skeleton width={120} height={56} radius="m" />
          <Skeleton width={72} height={72} radius="pill" />
        </div>
      </div>
      <SkeletonRows rows={3} label="Cargando el partido…" />
    </div>
  );
}

function MatchView({ id, active }: { id: string; active: boolean }) {
  const navigate = useNavigate();
  const layout = useLayout();
  const schedule = useSchedule();
  const match = useMemo(() => findMatch(schedule.data, id), [schedule.data, id]);
  const now = useNow();
  const { scores } = useScores(match ? [match] : [], now, active);
  const score = match ? (scores[match.id] ?? null) : null;
  const lookup = useLibraryLookup();
  const channels = useMemo(() => (match ? channelInfo(match, lookup) : []), [match, lookup]);
  const hasSession = useSession((state) => state.key === `m:${id}`);
  const today = madridClock(now).date;

  // Entrar al partido: resolver, comprobar y arrancar la primera verificada.
  const enter = useEffectEvent((current: FootballMatch) => enterMatch(current));
  const matchId = match?.id ?? null;
  useEffect(() => {
    if (!active || !match) return;
    enter(match);
    return () => leaveSession();
    // Por id: la agenda se vuelve a pedir y el objeto cambia sin que cambie el partido.
  }, [active, matchId]);

  if (!match && schedule.isPending) return <MatchSkeleton />;

  const desktop = layout.kind === 'desktop' || layout.kind === 'wide';
  const sources = layout.asideVisible ? null : (
    <SourcesPanel
      variant={desktop ? 'rack' : 'list'}
      className="mc-sources"
      headerExtra={
        layout.asideAvailable ? (
          <IconButton icon="panel" label="Mostrar el panel lateral" onClick={() => layout.setAsideOpen(true)} />
        ) : null
      }
    />
  );

  if (!match) {
    return (
      <div className="mc">
        <h1 className="sr-only" tabIndex={-1}>
          Partido
        </h1>
        <EmptyState
          title={schedule.isError ? 'No se pudo cargar la agenda' : 'Este partido ya no está en la agenda'}
          tone={schedule.isError ? 'error' : 'empty'}
          actions={
            <>
              {schedule.isError ? (
                <Button variant="primary" icon="refresh" onClick={() => void schedule.refetch()}>
                  Reintentar
                </Button>
              ) : null}
              <Button icon="agenda" onClick={() => navigate({ vista: 'agenda' })}>
                Ir a la agenda
              </Button>
              <Button icon="paste" onClick={() => openPaste(true)}>
                Pegar hash
              </Button>
            </>
          }
        >
          {schedule.isError
            ? 'Sin la agenda no sabemos qué canales emiten el partido. Puedes pegar un Content ID.'
            : 'Puede que la agenda se haya actualizado. Búscalo de nuevo o pega un Content ID.'}
        </EmptyState>
        {hasSession ? sources : null}
        <MatchSheets inMatch />
      </div>
    );
  }

  const channelNames = channels.map((channel) => channel.name);
  return (
    <div className="mc" data-layout={layout.kind} data-aside={layout.asideVisible ? 'true' : 'false'}>
      <Scoreboard match={match} score={score} now={now} channels={channelNames} />
      {sources}
      <WhereAired match={match} channels={channels} today={today} />
      {layout.asideVisible ? null : <NerdSection variant="fold" />}
      <MatchSheets inMatch />
    </div>
  );
}

export default function MatchCenter({ route, active }: ViewProps) {
  if (route.vista !== 'partido') return null;
  // `.mc-host` es el contenedor de las consultas de tamaño: el bento se
  // decide por el ancho real de la vista, no por el de la pantalla.
  if (route.canal)
    return (
      <div className="mc-host">
        <ChannelCenter hash={route.canal} active={active} />
        <MatchSheets inMatch={false} />
      </div>
    );
  if (!route.id) return null;
  return (
    <div className="mc-host">
      <MatchView id={route.id} active={active} />
    </div>
  );
}
