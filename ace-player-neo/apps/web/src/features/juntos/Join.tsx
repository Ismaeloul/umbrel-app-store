/* Entrar en una sala con el enlace (docs/ver-juntos.md §7): qué se va a ver,
   quién está ya y el nombre. Sin login ni nada más.

   - El cartel va por la ruta de la sala (`partyArt`), no por `vodArt`: el
     invitado de fuera no tiene el catálogo (§9) y salía el relleno morado.
   - Sin red o con el servidor caído (5xx), se vuelve a probar solo a los 2,
     5 y 10 s; y siempre queda «Reintentar». */

import type { PartyCredential, PartyPreview, VodArtKind } from '@ace/shared';
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { api, describeFailure, isApiError } from '../../api/index.ts';
import { isDemo } from '../../api/mode.ts';
import { routeUrl } from '../../api/routes.ts';
import { Button } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { TextField } from '../../ui/Field.tsx';
import { Art, ArtSrcContext, type ArtSrcResolver } from '../cine/Art.tsx';
import { demoArtSrc } from '../cine/demo-art.ts';
import { saveCredential, saveName, savedName } from './client.ts';
import { JUNTOS_TEXT } from './texts.ts';

/** Esperas de los reintentos solos de la entrada (sin red o con el servidor caído). */
export const JOIN_RETRY_DELAYS_MS = [2_000, 5_000, 10_000] as const;

/**
 * Las imágenes de una sala: el cartel por `partyArt`, con el código de la sala y sin el catálogo
 * (también en casa: un solo camino). Lo que no es un cartel se queda en el relleno; en la demo,
 * los carteles SVG de siempre.
 */
export function partyArtSrc(code: string): ArtSrcResolver {
  return (id: string, art: VodArtKind, v: string, title: string) => {
    if (isDemo()) return demoArtSrc(id, art, v, title);
    if (art !== 'poster') return null;
    return routeUrl('partyArt', { code, artId: id }, { v });
  };
}

/** `partyArtSrc` para todo lo que va dentro (la sala o su entrada). */
export function PartyArt({ code, children }: { code: string; children: ReactNode }) {
  const resolve = useMemo(() => partyArtSrc(code), [code]);
  return <ArtSrcContext.Provider value={resolve}>{children}</ArtSrcContext.Provider>;
}

/** ¿Merece la pena volver a probar solo? Sin red, plazo agotado o el servidor caído. */
function transient(failure: unknown): boolean {
  return isApiError(failure) && failure.code !== 'party_not_found' && failure.retryable;
}

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'ok'; readonly preview: PartyPreview }
  | { readonly state: 'gone' }
  | { readonly state: 'error'; readonly message: string };

export function Join({
  code,
  onJoined,
  exitAction,
  networkText,
}: {
  code: string;
  onJoined(credential: PartyCredential): void;
  /** El botón para irse si la sala no existe (null en la página del invitado). */
  exitAction: ReactNode;
  /** El texto sin red (al invitado de fuera, «el Umbrel» no le dice nada). */
  networkText?: string;
}) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [name, setName] = useState(savedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /* Cada intento de leer la sala: `auto` cuenta los solos (vuelve a 0 con «Reintentar»). */
  const [attempt, setAttempt] = useState({ count: 0, auto: 0 });

  const describe = useCallback(
    (failure: unknown) =>
      networkText && isApiError(failure) && failure.code === 'network'
        ? networkText
        : describeFailure(failure),
    [networkText],
  );

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    api('partyPreview', { params: { code }, signal: controller.signal })
      .then((preview) => setLoad({ state: 'ok', preview }))
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (isApiError(failure) && failure.code === 'party_not_found') {
          setLoad({ state: 'gone' });
          return;
        }
        setLoad({ state: 'error', message: describe(failure) });
        const wait = JOIN_RETRY_DELAYS_MS[attempt.auto];
        if (transient(failure) && wait !== undefined) {
          timer = setTimeout(
            () => setAttempt((now) => ({ count: now.count + 1, auto: now.auto + 1 })),
            wait,
          );
        }
      });
    return () => {
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [code, attempt, describe]);

  /* «Reintentar»: ya, y con los reintentos solos otra vez desde el principio. */
  const retry = () => {
    setLoad({ state: 'loading' });
    setAttempt((now) => ({ count: now.count + 1, auto: 0 }));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const joined = await api('partyJoin', { params: { code }, body: { name: clean } });
      saveName(clean);
      saveCredential(code, joined.member);
      onJoined(joined.member);
    } catch (failure) {
      setError(describe(failure));
      setBusy(false);
    }
  };

  if (load.state === 'gone' || load.state === 'error') {
    return (
      <EmptyState
        tone="error"
        title={load.state === 'gone' ? JUNTOS_TEXT.gone : load.message}
        actions={
          load.state === 'error' ? (
            <>
              <Button variant="primary" icon="refresh" onClick={retry}>
                {JUNTOS_TEXT.retry}
              </Button>
              {exitAction}
            </>
          ) : (
            exitAction
          )
        }
      >
        {load.state === 'gone' ? JUNTOS_TEXT.goneHint : null}
      </EmptyState>
    );
  }

  const preview = load.state === 'ok' ? load.preview : null;
  return (
    <PartyArt code={code}>
      <form className="juntos-join" onSubmit={(event) => void submit(event)} aria-busy={!preview}>
        {preview ? (
          <Art
            id={preview.title.artId}
            art="poster"
            v={preview.title.poster}
            title={preview.title.title}
            className="juntos-join__poster"
            eager
          />
        ) : (
          <span className="juntos-join__poster" />
        )}
        <div className="juntos-join__body">
          <p className="juntos-join__kicker">{JUNTOS_TEXT.joinTitle}</p>
          <h1 className="juntos-join__title">{preview?.title.title ?? '…'}</h1>
          {preview?.title.subtitle ? (
            <p className="juntos-join__sub">{preview.title.subtitle}</p>
          ) : null}
          {preview && preview.members.length ? (
            <p className="juntos-join__sub">{JUNTOS_TEXT.alreadyIn(preview.members.join(', '))}</p>
          ) : null}
          {preview?.full ? (
            <p className="juntos-join__error" role="alert">
              {JUNTOS_TEXT.full}
            </p>
          ) : (
            <>
              <TextField
                label={JUNTOS_TEXT.nameLabel}
                hint={JUNTOS_TEXT.nameHint}
                value={name}
                maxLength={24}
                autoComplete="nickname"
                enterKeyHint="go"
                error={error}
                onChange={(event) => setName(event.target.value)}
              />
              <Button
                type="submit"
                variant="primary"
                icon="play"
                busy={busy}
                disabled={!preview || !name.trim()}
              >
                {JUNTOS_TEXT.join}
              </Button>
            </>
          )}
        </div>
      </form>
    </PartyArt>
  );
}
