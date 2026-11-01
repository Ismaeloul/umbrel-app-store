/* «Recuperar el mando» de la sala en directo (docs/ver-juntos.md §14), junto a quién controla.
   Aparte de Fuentes y Partidos (LivePanels.tsx, LiveMatches.tsx): la sala lo pinta siempre y
   aquellos se bajan al abrirlos. */

import type { PartyRoom } from '@ace/shared';
import { useState } from 'react';
import { describeFailure } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import type { PartyClient } from './client.ts';
import { LIVE_TEXT } from './liveTexts.ts';

/**
 * «Recuperar el mando» (directo §14): quien creó la sala y no es el líder (la corona pasó a otro
 * mientras no estaba) la recupera de un toque. Sin nada si ya es el líder.
 */
export function LiveReclaim({
  room,
  client,
  selfId,
}: {
  room: PartyRoom | null;
  client: PartyClient;
  selfId: string;
}) {
  const [busy, setBusy] = useState(false);
  if (!room?.live || room.hostId !== selfId || room.leaderId === selfId) return null;
  return (
    <Button
      size="sm"
      variant="quiet"
      icon="corona"
      busy={busy}
      className="juntos-live__reclaim"
      onClick={() => {
        setBusy(true);
        void client
          .member(selfId, 'lead')
          .then(() => notify(LIVE_TEXT.reclaimDone, { tone: 'ok' }))
          .catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }))
          .finally(() => setBusy(false));
      }}
    >
      {LIVE_TEXT.reclaim}
    </Button>
  );
}
