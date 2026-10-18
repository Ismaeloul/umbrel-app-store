/* «Ver juntos» (`?vista=juntos/<código>`, docs/ver-juntos.md §7): una sala
   para ver una película o un episodio a la vez, con chat.

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
import { forgetCredential, savedCredential } from './client.ts';
import { Join } from './Join.tsx';
import { Room } from './Room.tsx';
import { JUNTOS_TEXT } from './texts.ts';
import './juntos.css';

export default function Juntos({ route, active }: ViewProps) {
  if (route.vista !== 'juntos' || !active) return null;
  return <JuntosRoom key={route.code} code={route.code} />;
}

function JuntosRoom({ code }: { code: string }) {
  const navigate = useNavigate();
  const [credential, setCredential] = useState<PartyCredential | null>(() => savedCredential(code));
  const forbidden = useCallback(() => {
    forgetCredential(code);
    setCredential(null);
  }, [code]);
  const toCine = useCallback(() => navigate({ vista: 'cine', id: null }), [navigate]);
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
      exitAction={exitAction}
    />
  );
}
