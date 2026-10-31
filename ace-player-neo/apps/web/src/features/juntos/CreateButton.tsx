/* «Ver juntos» en la ficha (docs/ver-juntos.md §7 y §13): crea la sala con la
   película o el episodio y la abre. Como en la maqueta: quién entra (solo
   «Con enlace»: no hay amigos ni salas públicas), quién controla (Solo yo /
   Yo y co-líderes / Todos), «Votar lo siguiente» y «Crear sala e invitar»,
   que además copia el enlace. Sin chat de voz (fase 2). Si este navegador
   está en una sala, ofrece antes «Proponer en la sala»: va a su Siguiente. */

import type { PartyCreateVodBody } from '@ace/shared';
import { useState, type FormEvent } from 'react';
import { api, describeFailure, isApiError } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { notify } from '../../notices/index.ts';
import { copyText } from '../../player/clipboard.ts';
import { Button } from '../../ui/Button.tsx';
import { Switch, TextField } from '../../ui/Field.tsx';
import { Icon } from '../../ui/Icon.tsx';
import type { IconName } from '../../ui/icons.ts';
import { Sheet } from '../../ui/Sheet.tsx';
import { Art } from '../cine/Art.tsx';
import {
  forgetLastRoom,
  inviteUrl,
  lastRoom,
  saveCredential,
  saveName,
  savedName,
} from './client.ts';
import { ControlTiles, controlSettings, type ControlValue } from './Panels.tsx';
import { JUNTOS_TEXT } from './texts.ts';
import './juntos.css';

export type JuntosTarget = Omit<
  PartyCreateVodBody,
  'name' | 'audio' | 'poster' | 'subtitle' | 'control' | 'coleaders' | 'queueMode'
> & {
  readonly poster: string | null;
  readonly subtitle: string | null;
};

/** El aspecto del botón (el escaparate y la ficha de escritorio lo pintan a su manera). */
export interface JuntosLook {
  className?: string;
  icon?: IconName;
  size?: 'md' | 'sm';
}

export function JuntosButton({
  target,
  disabled,
  look,
}: {
  target: JuntosTarget;
  disabled?: boolean;
  look?: JuntosLook;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(savedName);
  const [control, setControl] = useState<ControlValue>('leaders');
  const [vote, setVote] = useState(true);
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
        body: {
          ...target,
          name: clean,
          audio: null,
          ...controlSettings(control),
          queueMode: vote ? 'vote' : 'autoplay',
        },
      });
      saveName(clean);
      saveCredential(created.room.code, created.member);
      setOpen(false);
      /* «Crear sala e invitar»: el enlace ya va en el portapapeles (si el navegador deja). */
      if (await copyText(inviteUrl(created.room.code, created.room.inviteUrl))) {
        notify(JUNTOS_TEXT.linkCopied, { tone: 'ok' });
      }
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
        size={look?.size ?? 'sm'}
        icon={look?.icon ?? 'personas'}
        className={look?.className}
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
        hideTitle
        className="juntos-sheet"
        size="sm"
        footer={
          <Button
            variant="primary"
            icon="link"
            busy={busy}
            disabled={!name.trim()}
            className="juntos-create__submit"
            onClick={() => void create()}
          >
            {JUNTOS_TEXT.createSubmit}
          </Button>
        }
      >
        <div className="juntos-create">
          {/* Como la maqueta: el cartel pequeño junto a «Ver juntos» y el título
              (el título de la hoja queda para el lector de pantalla). */}
          <div className="juntos-create__head">
            <Art
              id={target.artId}
              art="poster"
              v={target.poster}
              title={target.title}
              className="juntos-poster juntos-create__poster"
            />
            <p className="juntos-create__heading">
              <b aria-hidden="true">{JUNTOS_TEXT.createTitle}</b>
              <span>{target.subtitle ? `${target.title} · ${target.subtitle}` : target.title}</span>
            </p>
          </div>
          {current ? (
            <div className="juntos-add">
              <Button variant="quiet" icon="plus" busy={busy} onClick={() => void addToRoom()}>
                {JUNTOS_TEXT.addToRoom}
              </Button>
              <p className="juntos-add__hint">{JUNTOS_TEXT.addToRoomHint}</p>
              <p className="juntos-add__or">{JUNTOS_TEXT.orNewRoom}</p>
            </div>
          ) : null}
          <form className="juntos-create__form" onSubmit={(event) => void create(event)}>
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
          <div className="juntos-create__group">
            <p className="juntos-kicker">{JUNTOS_TEXT.createWho}</p>
            <p className="juntos-create__only">
              <Icon name="candado" size={20} />
              <span>
                <b>{JUNTOS_TEXT.createWithLink}</b>
                <span className="juntos-create__hint">{JUNTOS_TEXT.createWithLinkHint}</span>
              </span>
            </p>
          </div>
          <div className="juntos-create__group">
            <p className="juntos-kicker">{JUNTOS_TEXT.settingsControl}</p>
            <ControlTiles value={control} onChange={setControl} />
          </div>
          <Switch
            label={JUNTOS_TEXT.createVote}
            description={JUNTOS_TEXT.createVoteHint}
            checked={vote}
            onChange={setVote}
            className="juntos-create__switch"
          />
        </div>
      </Sheet>
    </>
  );
}
