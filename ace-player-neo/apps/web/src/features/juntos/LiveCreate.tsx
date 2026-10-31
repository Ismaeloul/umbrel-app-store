/* «Ver juntos» en la ficha de un partido (docs/ver-juntos.md §14): crea la
   sala en directo y la abre. Como la de pelis y series, pero sin «Votar lo
   siguiente» (en directo no hay lista): tu nombre, «Con enlace» y quién
   controla.

   La fuente: la que suena en casa si es este partido (lo que estás viendo
   pasa a la sala); si no, la mejor que da el servidor. */

import type { FootballMatch, PartyLiveChoice } from '@ace/shared';
import { useState, type FormEvent } from 'react';
import { api, describeFailure } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { notify } from '../../notices/index.ts';
import { copyText } from '../../player/clipboard.ts';
import { isIptvPlayback, playerStore } from '../../player/api.ts';
import { Button } from '../../ui/Button.tsx';
import { TextField } from '../../ui/Field.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Sheet } from '../../ui/Sheet.tsx';
import { matchTitle } from '../agenda/domain.ts';
import { inviteUrl, saveCredential, saveName, savedName } from './client.ts';
import type { JuntosLook } from './CreateButton.tsx';
import { bestSourceOf } from './live.ts';
import { ControlTiles, controlSettings, type ControlValue } from './Panels.tsx';
import { JUNTOS_TEXT } from './texts.ts';
import './juntos.css';

const HASH_RE = /^[a-f0-9]{40}$/;

/** Lo que suena en casa, si es este partido. */
function playingChoice(match: FootballMatch): PartyLiveChoice | null {
  const state = playerStore.get();
  const channel = state.channel;
  const route = state.route;
  if (!channel || route?.vista !== 'partido' || route.id !== match.id) return null;
  const hash = channel.hash.toLowerCase();
  if (!HASH_RE.test(hash)) return null;
  return {
    hash,
    channel: (channel.title || 'Canal').slice(0, 120),
    source: isIptvPlayback(state) ? 'iptv' : 'engine',
    matchId: match.id,
    match: matchTitle(match).slice(0, 200),
  };
}

export function LiveJuntosButton({ match, look }: { match: FootballMatch; look?: JuntosLook }) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(savedName);
  const [control, setControl] = useState<ControlValue>('leaders');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (event?: FormEvent) => {
    event?.preventDefault();
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    setError(null);
    try {
      const live = playingChoice(match) ?? (await bestSourceOf(match));
      if (!live) {
        setError(JUNTOS_TEXT.liveCreateNoSource);
        return;
      }
      const settings = controlSettings(control);
      const created = await api('partyCreate', {
        body: { live, name: clean, control: settings.control, coleaders: settings.coleaders },
      });
      saveName(clean);
      saveCredential(created.room.code, created.member);
      setOpen(false);
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
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
      >
        {JUNTOS_TEXT.open}
      </Button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={JUNTOS_TEXT.liveCreateTitle}
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
          <div className="juntos-create__head">
            <span className="juntos-info__live" aria-hidden="true">
              <Icon name="tv" size={24} />
            </span>
            <p className="juntos-create__heading">
              <b aria-hidden="true">{JUNTOS_TEXT.liveCreateTitle}</b>
              <span>{matchTitle(match)}</span>
            </p>
          </div>
          <p className="juntos-create__hint">{JUNTOS_TEXT.liveCreateHint}</p>
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
        </div>
      </Sheet>
    </>
  );
}
