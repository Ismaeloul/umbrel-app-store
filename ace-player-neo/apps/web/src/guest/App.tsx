/* La página de invitado de «Ver juntos» (docs/ver-juntos.md §9): la sala
   del enlace `/s/<código>` con los mismos Join y Room que la vista de casa,
   con sus propias salidas: salir vuelve a la entrada de la sala. Solo desde
   aquí el reproductor pide las dos calidades (`guest`, §17): la web de casa
   nunca manda `abr=1`.

   - Ya dentro (con credencial), la raíz lleva `guest--room`: en el móvil la
     sala va a la altura de lo que se ve, con el chat hasta abajo (guest.css).
   - Sin red, el texto no habla del Umbrel (quien entra de fuera no lo
     conoce). Con la sala cerrada o sin contestar, «Volver a la entrada». */

import type { PartyCredential } from '@ace/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { createQueryClient } from '../api/query.ts';
import { cx } from '../lib/cx.ts';
import { forgetCredential, savedCredential } from '../features/juntos/client.ts';
import { Join } from '../features/juntos/Join.tsx';
import { Room } from '../features/juntos/Room.tsx';
import { Toaster } from '../notices/Toaster.tsx';
import { Button } from '../ui/Button.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { GUEST_TEXT } from './texts.ts';

/** `/s/<código>` → el código (16 caracteres base64url), o null. */
export function codeFromPath(pathname: string): string | null {
  return /^\/s\/([A-Za-z0-9_-]{16})\/?$/.exec(pathname)?.[1] ?? null;
}

function GuestRoom({
  code,
  credential,
  onCredential,
}: {
  code: string;
  credential: PartyCredential | null;
  onCredential(credential: PartyCredential | null): void;
}) {
  const reset = useCallback(() => {
    forgetCredential(code);
    onCredential(null);
  }, [code, onCredential]);
  if (!credential) {
    return (
      <Join
        code={code}
        onJoined={onCredential}
        exitAction={null}
        networkText={GUEST_TEXT.network}
      />
    );
  }
  return (
    <Room
      code={code}
      credential={credential}
      onForbidden={reset}
      onLeft={reset}
      exitAction={
        <Button variant="quiet" icon="back" onClick={reset}>
          {GUEST_TEXT.backToEntry}
        </Button>
      }
      guest
    />
  );
}

export function GuestApp({ pathname }: { pathname: string }) {
  const code = codeFromPath(pathname);
  const [credential, setCredential] = useState<PartyCredential | null>(() =>
    code ? savedCredential(code) : null,
  );
  /* Fuentes del directo (useRoomSources) usa TanStack Query: sin esto, abrirla tiraba la sala. */
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <div className={cx('guest', !!code && !!credential && 'guest--room')}>
        <header className="guest__bar">
          <img src="/icon.svg" alt="" width={24} height={24} />
          <span>{GUEST_TEXT.brand}</span>
        </header>
        <main className="guest__main">
          {code ? (
            <GuestRoom code={code} credential={credential} onCredential={setCredential} />
          ) : (
            <EmptyState tone="error" title={GUEST_TEXT.badLink} actions={null}>
              {GUEST_TEXT.badLinkHint}
            </EmptyState>
          )}
        </main>
        <Toaster />
      </div>
    </QueryClientProvider>
  );
}
