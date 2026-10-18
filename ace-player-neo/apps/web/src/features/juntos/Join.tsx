/* Entrar en una sala con el enlace (docs/ver-juntos.md §7): qué se va a ver,
   quién está ya y el nombre. Sin login ni nada más. */

import type { PartyCredential, PartyPreview } from '@ace/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { api, describeFailure, isApiError } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { Button } from '../../ui/Button.tsx';
import { EmptyState } from '../../ui/EmptyState.tsx';
import { TextField } from '../../ui/Field.tsx';
import { Art } from '../cine/Art.tsx';
import { saveCredential, saveName, savedName } from './client.ts';
import { JUNTOS_TEXT } from './texts.ts';

type Load =
  | { readonly state: 'loading' }
  | { readonly state: 'ok'; readonly preview: PartyPreview }
  | { readonly state: 'gone' }
  | { readonly state: 'error'; readonly message: string };

export function Join({
  code,
  onJoined,
}: {
  code: string;
  onJoined(credential: PartyCredential): void;
}) {
  const navigate = useNavigate();
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [name, setName] = useState(savedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api('partyPreview', { params: { code }, signal: controller.signal })
      .then((preview) => setLoad({ state: 'ok', preview }))
      .catch((failure: unknown) => {
        if (controller.signal.aborted) return;
        if (isApiError(failure) && failure.code === 'party_not_found') setLoad({ state: 'gone' });
        else setLoad({ state: 'error', message: describeFailure(failure) });
      });
    return () => controller.abort();
  }, [code]);

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
      setError(describeFailure(failure));
      setBusy(false);
    }
  };

  if (load.state === 'gone' || load.state === 'error') {
    return (
      <EmptyState
        tone="error"
        title={load.state === 'gone' ? JUNTOS_TEXT.gone : load.message}
        actions={
          <Button variant="primary" onClick={() => navigate({ vista: 'cine', id: null })}>
            {JUNTOS_TEXT.backToCine}
          </Button>
        }
      >
        {load.state === 'gone' ? JUNTOS_TEXT.goneHint : null}
      </EmptyState>
    );
  }

  const preview = load.state === 'ok' ? load.preview : null;
  return (
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
  );
}
