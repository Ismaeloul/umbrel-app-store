/* Centro de partido = TEATRO (`?vista=partido/<id>` y `partido/canal/<hash>`;
   plan Palco fase 2, decisión W5; inventario §5, §6 y §7). El reproductor y
   la cápsula de estado los pone el armazón ENCIMA de esta vista
   (src/app/Shell.tsx); aquí va todo lo demás.

   - Sobre el vídeo, arriba a la izquierda, la cápsula del marcador (tapada
     por defecto): la vista la proyecta con un portal en el hueco que publica
     el reproductor (player/stage-slot.ts). Sin reproductor (cargándose, o en
     los tests) va en su sitio, arriba de la vista.
   - Bajo el vídeo, la cabecera (competición, estado y los dos equipos) y el
     panel con pestañas Fuentes · Partido · Datos técnicos. Desde 1024 px ese
     panel va en el lateral (MatchAside.tsx), plegable; plegado, vuelve aquí.
     Desde 1280 px el armazón añade además la columna de la agenda.
   - Modo teatro (pantalla completa, F, doble clic o el móvil en horizontal):
     el `data-immersive` del armazón deja solo el vídeo y sus cápsulas.

   La lógica de las fuentes vive fuera de React (src/features/sources/
   session.ts) para que siga funcionando con el reproductor en «mini». */

import '../agenda/demo.ts';
import '../sources/demo.ts';
import type { FootballMatch } from '@ace/shared';
import { useEffect, useEffectEvent, useMemo, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ViewProps } from '../../app/contracts.ts';
import { useLayout } from '../../app/layout.tsx';
import { useNavigate } from '../../app/router.tsx';
import { useStageSlot } from '../../player/stage-slot.ts';
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
import { ChannelCenter } from './ChannelCenter.tsx';
import { findMatch } from './find.ts';
import { MatchHead } from './MatchHead.tsx';
import { Scoreboard } from './Scoreboard.tsx';
import { MatchTabs } from './TheaterTabs.tsx';
import './match-center.css';

export { findMatch } from './find.ts';

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

/** Esqueleto del teatro mientras llega la agenda (el vídeo ya lo guarda el armazón). */
function MatchSkeleton() {
  return (
    <div className="mc mc--theater" aria-busy="true">
      <div className="mc-head mc-head--skeleton">
        <Skeleton width={160} height={14} radius="s" />
        <div className="mc-head__skeleton-row">
          <Skeleton width={36} height={36} radius="circle" />
          <Skeleton width="min(60%, 320px)" height={28} radius="m" />
          <Skeleton width={36} height={36} radius="circle" />
        </div>
      </div>
      <Skeleton width="100%" height={48} radius="pill" />
      <SkeletonRows rows={3} label="Cargando el partido…" />
    </div>
  );
}

/** La cápsula del marcador: sobre el vídeo si hay escenario; si no, arriba de la vista. */
function ScoreCapsuleSlot({ children }: { children: ReactNode }) {
  const slot = useStageSlot();
  if (slot) return createPortal(children, slot);
  return <div className="mc-scap-inline">{children}</div>;
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
  const tabs = layout.asideVisible ? null : (
    <MatchTabs
      match={match}
      score={score}
      now={now}
      channels={channels}
      today={today}
      variant={desktop ? 'rack' : 'list'}
      className="mc-tabs--view"
      extra={
        layout.asideAvailable ? (
          <IconButton
            icon="panel"
            label="Mostrar el panel lateral"
            onClick={() => layout.setAsideOpen(true)}
          />
        ) : null
      }
    />
  );

  if (!match) {
    return (
      <div className="mc mc--theater">
        <h1 className="sr-only" tabIndex={-1}>
          Partido
        </h1>
        <EmptyState
          title={
            schedule.isError
              ? 'No se pudo cargar la agenda'
              : 'Este partido ya no está en la agenda'
          }
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
        {hasSession ? tabs : null}
        <MatchSheets inMatch />
      </div>
    );
  }

  return (
    <div
      className="mc mc--theater"
      data-layout={layout.kind}
      data-aside={layout.asideVisible ? 'true' : 'false'}
    >
      {active ? (
        <ScoreCapsuleSlot>
          <Scoreboard key={match.id} match={match} score={score} now={now} />
        </ScoreCapsuleSlot>
      ) : null}
      <MatchHead match={match} score={score} now={now} />
      {tabs}
      <MatchSheets inMatch />
    </div>
  );
}

export default function MatchCenter({ route, active }: ViewProps) {
  if (route.vista !== 'partido') return null;
  // `.mc-host` es el contenedor de las consultas de tamaño: el teatro se
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
