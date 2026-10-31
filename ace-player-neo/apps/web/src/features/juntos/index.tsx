/* «Ver juntos» (`?vista=juntos/<código>`, docs/ver-juntos.md §7): una sala
   para ver una película o un episodio a la vez, con chat. Sin código
   (`?vista=juntos`, el destino del menú lateral) es la portada: cómo se crea
   una sala y, si hay una, volver a la última.

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
import { stop as stopHousePlayer } from '../../player/api.ts';
import { Button } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { ViewHeader } from '../../app/ViewHeader.tsx';
import { useLayoutKind } from '../../lib/media.ts';
import { forgetCredential, lastRoom, savedCredential } from './client.ts';
import { Join } from './Join.tsx';
import { Room } from './Room.tsx';
import { JUNTOS_TEXT } from './texts.ts';
import './juntos.css';

export default function Juntos({ route, active }: ViewProps) {
  if (route.vista !== 'juntos' || !active) return null;
  if (!route.code) return <JuntosHome />;
  return <JuntosRoom key={route.code} code={route.code} />;
}

function JuntosHome() {
  const navigate = useNavigate();
  const last = lastRoom();
  return (
    <>
      <ViewHeader title={JUNTOS_TEXT.open} />
      <EmptyState
        title={JUNTOS_TEXT.homeTitle}
        actions={
          <>
            {last ? (
              <Button
                variant="primary"
                icon="personas"
                onClick={() => navigate({ vista: 'juntos', code: last.code })}
              >
                {JUNTOS_TEXT.backToRoom}
              </Button>
            ) : null}
            <Button
              variant={last ? 'quiet' : 'primary'}
              icon="cine"
              onClick={() => navigate({ vista: 'cine', id: null })}
            >
              {JUNTOS_TEXT.backToCine}
            </Button>
          </>
        }
      >
        {JUNTOS_TEXT.homeHint}
      </EmptyState>
    </>
  );
}

function JuntosRoom({ code }: { code: string }) {
  const navigate = useNavigate();
  const [credential, setCredential] = useState<PartyCredential | null>(() => savedCredential(code));
  const forbidden = useCallback(() => {
    forgetCredential(code);
    setCredential(null);
  }, [code]);
  const toCine = useCallback(() => navigate({ vista: 'cine', id: null }), [navigate]);
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
      onLeft={toCine}
      onEnter={stopHousePlayer}
      onPropose={toCine}
      header={desk ? <ViewHeader title={JUNTOS_TEXT.open} /> : undefined}
      exitAction={exitAction}
    />
  );
}
