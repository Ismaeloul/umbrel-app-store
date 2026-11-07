/* «Ver juntos» (`?vista=juntos/<código>`, docs/ver-juntos.md §7): una sala
   para ver una película o un episodio a la vez, con chat. Sin código
   (`?vista=juntos`, el destino del menú lateral) es la portada: las salas
   abiertas, cómo se crea una sala y, si hay una, volver a la última. Al
   volver de proponer desde Pelis y series (§11), la sala se abre en
   Siguiente (`panel`) con lo propuesto resaltado (`nuevo`).

   Sin credencial guardada para esta sala, se pide el nombre (Join); con
   ella, la sala (Room). La vista solo vive mientras está a la vista: al irse
   a otra, se suelta el vídeo y se cierra el SSE (la persona sale como
   «desconectado»); al volver, se entra otra vez con la misma credencial.
   Join y Room no conocen el enrutador: la página del invitado
   (src/guest/) los usa igual, con sus propias salidas. */

import type { PartyCredential } from '@ace/shared';
import { useCallback, useState } from 'react';
import type { ViewProps } from '../../app/contracts.ts';
import { useNavigate } from '../../app/router.tsx';
import type { JuntosTab } from '../../app/routes.ts';
import { stop as stopHousePlayer } from '../../player/api.ts';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import type { IconName } from '../../ui/icons.ts';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { useLayoutKind } from '../../lib/media.ts';
import { forgetCredential, lastRoom, savedCredential } from './client.ts';
import { Join } from './Join.tsx';
import { OpenRooms } from './OpenRooms.tsx';
import { PROPOSE_TEXT } from './proposeTexts.ts';
import { Room } from './Room.tsx';
import { JUNTOS_TEXT } from './texts.ts';
import './demo.ts';
import './juntos.css';
import './open-rooms.css';

export default function Juntos({ route, active }: ViewProps) {
  if (route.vista !== 'juntos' || !active) return null;
  if (!route.code) return <JuntosHome />;
  return (
    <JuntosRoom
      key={route.code}
      code={route.code}
      tab={route.tab ?? null}
      nuevo={route.nuevo ?? null}
    />
  );
}

/**
 * La portada de «Ver juntos» (§15): primero las salas abiertas (en directo y de pelis y series)
 * y debajo las dos maneras de empezar una: una peli o serie (Pelis y series) o un partido (la
 * Agenda). Si este navegador estaba en una sala, «Volver a tu sala» arriba.
 */
function JuntosHome() {
  const navigate = useNavigate();
  const last = lastRoom();
  return (
    <div className="juntos-home">
      <ViewHeader title={JUNTOS_TEXT.open} />
      {last ? (
        <div className="juntos-home__back">
          <Button
            variant="primary"
            icon="personas"
            onClick={() => navigate({ vista: 'juntos', code: last.code })}
          >
            {JUNTOS_TEXT.backToRoom}
          </Button>
        </div>
      ) : null}
      <OpenRooms />
      <section className="juntos-start" aria-labelledby="juntos-start-title">
        <h2 id="juntos-start-title" className="juntos-kicker">
          {PROPOSE_TEXT.startTitle}
        </h2>
        <p className="juntos-start__lead">{JUNTOS_TEXT.homeTitle}</p>
        <div className="juntos-start__cards">
          <StartCard
            icon="cine"
            title={PROPOSE_TEXT.startVod}
            hint={PROPOSE_TEXT.startVodHint}
            onClick={() => navigate({ vista: 'cine', id: null, sala: null })}
          />
          <StartCard
            icon="agenda"
            title={PROPOSE_TEXT.startLive}
            hint={PROPOSE_TEXT.startLiveHint}
            onClick={() => navigate({ vista: 'agenda' })}
          />
        </div>
      </section>
    </div>
  );
}

function StartCard({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: IconName;
  title: string;
  hint: string;
  onClick(): void;
}) {
  return (
    <button type="button" className="juntos-start__card press" onClick={onClick}>
      <span className="juntos-start__icon" aria-hidden="true">
        <Icon name={icon} size={24} />
      </span>
      <span className="juntos-start__text">
        <span className="juntos-start__title">{title}</span>
        <span className="juntos-start__hint">{hint}</span>
      </span>
      <Icon name="chev-r" size={20} className="juntos-start__chev" />
    </button>
  );
}

function JuntosRoom({
  code,
  tab,
  nuevo,
}: {
  code: string;
  tab: JuntosTab | null;
  nuevo: string | null;
}) {
  const navigate = useNavigate();
  const [credential, setCredential] = useState<PartyCredential | null>(() => savedCredential(code));
  const forbidden = useCallback(() => {
    forgetCredential(code);
    setCredential(null);
  }, [code]);
  const toCine = useCallback(() => navigate({ vista: 'cine', id: null, sala: null }), [navigate]);
  /* «Proponer una peli o serie» (§11): a Pelis y series eligiendo PARA esta sala. */
  const propose = useCallback(
    () => navigate({ vista: 'cine', id: null, sala: code }),
    [navigate, code],
  );
  /* Al salir de una sala en directo, a la Agenda; de una de pelis y series, a Pelis y series. */
  const left = useCallback(
    (live: boolean) => (live ? navigate({ vista: 'agenda' }) : toCine()),
    [navigate, toCine],
  );
  /* Desde 768, la barra de la sección; en el móvil la sala sigue como estaba. */
  const desk = useLayoutKind() !== 'mobile';
  const exitAction = (
    <Button variant="primary" onClick={toCine}>
      {JUNTOS_TEXT.backToCine}
    </Button>
  );
  if (!credential) return <Join code={code} onJoined={setCredential} exitAction={exitAction} />;
  return (
    <Room
      code={code}
      credential={credential}
      onForbidden={forbidden}
      onLeft={left}
      onEnter={stopHousePlayer}
      onPropose={propose}
      initialTab={tab}
      highlightItemId={nuevo}
      header={desk ? <ViewHeader title={JUNTOS_TEXT.open} /> : undefined}
      liveTools
      exitAction={exitAction}
    />
  );
}
