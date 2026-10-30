/* «Ver juntos» en la ficha (docs/ver-juntos.md §7): pide el nombre, crea la
   sala con la película o el episodio y abre la sala. Si este navegador está
   en una sala, ofrece antes «Añadir a la sala»: va a su lista (§11). */

import type { PartyCreateBody } from '@ace/shared';
import { useState, type FormEvent } from 'react';
import { api, describeFailure, isApiError } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { TextField } from '../../ui/Field.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { forgetLastRoom, lastRoom, saveCredential, saveName, savedName } from './client.ts';
import { JUNTOS_TEXT } from './texts.ts';
import './juntos.css';

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
  /* Se mira al abrir: la sala pudo cambiar mientras la ficha estaba abierta. */
  const [current, setCurrent] = useState(lastRoom);

  const addToRoom = async () => {
    if (!current || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api('partyQueue', {
        params: { code: current.code },
        body: {
          token: current.credential.token,
          action: 'add',
          titleId: target.titleId,
          kind: target.kind,
          artId: target.artId,
          poster: target.poster,
          title: target.title,
          subtitle: target.subtitle,
        },
      });
      setOpen(false);
      notify(JUNTOS_TEXT.addedToRoom, { tone: 'ok' });
    } catch (failure) {
      /* La sala ya no existe o ya no estás: se olvida y queda «crear». */
      if (isApiError(failure) && ['party_not_found', 'party_forbidden'].includes(failure.code)) {
        forgetLastRoom();
        setCurrent(null);
      }
      setError(describeFailure(failure));
    } finally {
      setBusy(false);
    }
  };

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
        onClick={() => {
          setCurrent(lastRoom());
          setError(null);
          setOpen(true);
        }}
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
        {current ? (
          <div className="juntos-add">
            <Button variant="primary" icon="plus" busy={busy} onClick={() => void addToRoom()}>
              {JUNTOS_TEXT.addToRoom}
            </Button>
            <p className="juntos-add__hint">{JUNTOS_TEXT.addToRoomHint}</p>
            <p className="juntos-add__or">{JUNTOS_TEXT.orNewRoom}</p>
          </div>
        ) : null}
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
