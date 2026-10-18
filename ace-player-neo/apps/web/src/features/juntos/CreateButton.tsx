/* «Ver juntos» en la ficha (docs/ver-juntos.md §7): pide el nombre, crea la
   sala con la película o el episodio y abre la sala. */

import type { PartyCreateBody } from '@ace/shared';
import { useState, type FormEvent } from 'react';
import { api, describeFailure } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { Button } from '../../ui/Button.tsx';
import { TextField } from '../../ui/Field.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { saveCredential, saveName, savedName } from './client.ts';
import { JUNTOS_TEXT } from './texts.ts';

export type JuntosTarget = Omit<PartyCreateBody, 'name' | 'audio' | 'poster' | 'subtitle'> & {
  readonly poster: string | null;
  readonly subtitle: string | null;
};

export function JuntosButton({ target, disabled }: { target: JuntosTarget; disabled?: boolean }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(savedName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (event?: FormEvent) => {
    event?.preventDefault();
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const created = await api('partyCreate', {
        body: { ...target, name: clean, audio: null },
      });
      saveName(clean);
      saveCredential(created.room.code, created.member);
      setOpen(false);
      navigate({ vista: 'juntos', code: created.room.code });
    } catch (failure) {
      setError(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="quiet"
        size="sm"
        icon="link"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {JUNTOS_TEXT.open}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={JUNTOS_TEXT.createTitle}
        description={JUNTOS_TEXT.createDescription}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              {JUNTOS_TEXT.cancel}
            </Button>
            <Button
              variant="primary"
              busy={busy}
              disabled={!name.trim()}
              onClick={() => void create()}
            >
              {JUNTOS_TEXT.create}
            </Button>
          </>
        }
      >
        <form onSubmit={(event) => void create(event)}>
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
        </form>
      </Sheet>
    </>
  );
}
