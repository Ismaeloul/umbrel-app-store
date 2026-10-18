/* La página de invitado de «Ver juntos» (docs/ver-juntos.md §9): la sala
   del enlace `/s/<código>` con los mismos Join y Room que la vista de casa,
   con sus propias salidas: salir vuelve a la entrada de la sala. */

import type { PartyCredential } from '@ace/shared';
import { useCallback, useState } from 'react';
import { forgetCredential, savedCredential } from '../features/juntos/client.ts';
import { Join } from '../features/juntos/Join.tsx';
import { Room } from '../features/juntos/Room.tsx';
import { Toaster } from '../notices/Toaster.tsx';
import { EmptyState } from '../ui/EmptyState.tsx';
import { GUEST_TEXT } from './texts.ts';

/** `/s/<código>` → el código (16 caracteres base64url), o null. */
export function codeFromPath(pathname: string): string | null {
  return /^\/s\/([A-Za-z0-9_-]{16})\/?$/.exec(pathname)?.[1] ?? null;
}

function GuestRoom({ code }: { code: string }) {
  const [credential, setCredential] = useState<PartyCredential | null>(() => savedCredential(code));
  const reset = useCallback(() => {
    forgetCredential(code);
    setCredential(null);
  }, [code]);
  if (!credential) return <Join code={code} onJoined={setCredential} exitAction={null} />;
  return (
    <Room
      code={code}
      credential={credential}
      onForbidden={reset}
      onLeft={reset}
      exitAction={null}
    />
  );
}

export function GuestApp({ pathname }: { pathname: string }) {
  const code = codeFromPath(pathname);
  return (
    <>
      <header className="guest__bar">
        <img src="/icon.svg" alt="" width={24} height={24} />
        <span>{GUEST_TEXT.brand}</span>
      </header>
      <main className="guest__main">
        {code ? (
          <GuestRoom code={code} />
        ) : (
          <EmptyState tone="error" title={GUEST_TEXT.badLink} actions={null}>
            {GUEST_TEXT.badLinkHint}
          </EmptyState>
        )}
      </main>
      <Toaster />
    </>
  );
}
