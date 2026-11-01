/* Centro de partido = TEATRO (`?vista=partido/<id>` y `partido/canal/<hash>`;
   plan Palco fase 2, decisión W5; inventario §5, §6 y §7). El reproductor y
   la cápsula de estado los pone el armazón ENCIMA de esta vista
   (src/app/Shell.tsx); aquí va todo lo demás.

   - En el móvil (maqueta movil-ficha-partido.html, dirección B «Vídeo
     arriba»): bajo el vídeo, los dos equipos con el minuto y «Marcador»
     (tapado, regla 29), la competición, las píldoras de fuente, las
     pestañas con las fuentes en filas y, al final, «Ver juntos».
   - Desde 768, bajo el vídeo, la cabecera de escritorio y el panel con
     pestañas Fuentes · Partido · Datos técnicos. Desde 1024 px ese
     panel va en el lateral (MatchAside.tsx), plegable; plegado, vuelve aquí.
     Desde 1280 px el armazón añade además la columna de la agenda.
   - Modo teatro (pantalla completa, F, doble clic o el móvil en horizontal):
     el `data-immersive` del armazón deja solo el vídeo y sus cápsulas.

   La lógica de las fuentes vive fuera de React (src/features/sources/
   session.ts) para que siga funcionando con el reproductor en «mini». */

import '../agenda/demo.ts';
import '../sources/demo.ts';
import type { FootballMatch } from '@ace/shared';
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
  research,
  useSession,
} from '../sources/session.ts';
import { ChannelCenter } from './ChannelCenter.tsx';
import { findMatch } from './find.ts';
import { LiveJuntosButton } from '../juntos/LiveCreate.tsx';
import { DeskMatchHead, MobileMatchHead } from './MatchHead.tsx';
import { SourceChips } from './SourceChips.tsx';
import { SourcesSheet } from './SourcesSheet.tsx';
import { MatchTabs } from './TheaterTabs.tsx';
import './match-center.css';

export { findMatch } from './find.ts';

/** Las hojas del centro de partido: una sola vez, aunque las abra el panel lateral. */
function MatchSheets({ inMatch }: { inMatch: boolean }) {
  const pasteOpen = useSession((state) => state.pasteOpen);
  return (
    <>
      <SourcesSheet />
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

/** «Rebuscar fuentes» a la derecha de las pestañas (escritorio: la lista va sin cabecera). */
function ResearchButton() {
  const researching = useSession((state) => state.researching);
  return (
    <IconButton
      icon="refresh"
      label={researching ? 'Rebuscando…' : 'Rebuscar fuentes'}
      busy={researching}
      className="mc-tabs__research"
      onClick={() => void research()}
    />
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

  // Desde 768 la ficha lleva la cabecera de escritorio, las fuentes en filas
  // (también en la tableta) y el vídeo, los controles «1B». En el móvil, la
  // dirección B: también en filas.
  const desk = layout.kind !== 'mobile';
  const tabs = layout.asideVisible ? null : (
    <MatchTabs
      match={match}
      score={score}
      now={now}
      channels={channels}
      today={today}
      variant="line"
      className="mc-tabs--view"
      extra={
        layout.asideAvailable ? (
          <IconButton
            icon="panel"
            label="Mostrar el panel lateral"
            onClick={() => layout.setAsideOpen(true)}
          />
        ) : (
          <ResearchButton />
        )
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
      {/* El vídeo va limpio (rediseño): el marcador, tapado como siempre, va
          junto al titular. */}
      {desk ? (
        <DeskMatchHead key={match.id} match={match} score={score} now={now} active={active} />
      ) : (
        <>
          <MobileMatchHead key={match.id} match={match} score={score} now={now} active={active} />
          <SourceChips />
        </>
      )}
      {tabs}
      {desk ? null : (
        <div className="mc-together">
          {/* La sala del partido en directo (docs/ver-juntos.md §14). */}
          <LiveJuntosButton match={match} look={{ className: 'mc-together__btn', size: 'md' }} />
        </div>
      )}
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
