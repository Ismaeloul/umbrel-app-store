/* Partidos, la pestaña de la sala en directo para quien puede cambiar la fuente
   (docs/ver-juntos.md §14): la misma lista que la Agenda (DeskList, con sus
   días, «En directo» y ligas) y, pegada abajo, una barra con el partido
   elegido y «Poner en la sala» (su mejor fuente). Un toque elige la fila;
   doble clic o Intro la ponen directamente. Si es el que suena, «En la sala»
   y sin botón. Debajo, «Poner un canal», tus favoritos.

   - La lista lleva su propio día, chip y estado (`uiScope="sala"`): mirar
     partidos en la sala no mueve la Agenda.
   - El resaltado de lo que suena es el partido de la sala (`watchingId`), no
     el del reproductor de casa.
   - Tira de la agenda de casa: solo en casa (`liveTools`), y Room.tsx la baja
     al abrirla (`lazy`): la página del invitado no baja la agenda. */

import type { FootballMatch, PartyRoom } from '@ace/shared';
import { useMemo, useState } from 'react';
import { describeFailure } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { useLibraryQuery, useSchedule } from '../agenda/data.ts';
import { DeskList } from '../agenda/DeskList.tsx';
import { matchTitle } from '../agenda/domain.ts';
import type { PartyClient } from './client.ts';
import { bestSourceOf } from './live.ts';
import { put } from './LivePanels.tsx';
import { LIVE_TEXT } from './liveTexts.ts';
import { JUNTOS_TEXT } from './texts.ts';
import '../sources/demo.ts';
import './live.css';

const HASH_RE = /^[a-f0-9]{40}$/;

/** Lo que enseña la barra de abajo: el partido elegido, el que suena o nada. */
export interface PutbarState {
  /** El partido de la barra, o null (canal suelto y nada elegido). */
  readonly match: FootballMatch | null;
  /** El título que se lee: el del partido o, si la agenda no lo trae, el de la sala. */
  readonly title: string | null;
  /** ¿Es el que ya suena en la sala? */
  readonly here: boolean;
}

/** La barra de Partidos: lo elegido manda; si no, el partido que suena. */
export function putbarState(
  chosen: FootballMatch | null,
  live: { matchId: string | null; match: string | null },
  matches: readonly FootballMatch[],
): PutbarState {
  if (chosen) {
    return { match: chosen, title: matchTitle(chosen), here: chosen.id === live.matchId };
  }
  if (live.matchId === null) return { match: null, title: null, here: false };
  const playing = matches.find((match) => match.id === live.matchId) ?? null;
  return {
    match: playing,
    title: playing ? matchTitle(playing) : live.match,
    here: true,
  };
}

export function LiveMatches({ room, client }: { room: PartyRoom; client: PartyClient }) {
  const schedule = useSchedule();
  const library = useLibraryQuery();
  const [busy, setBusy] = useState<string | null>(null);
  const [chosen, setChosen] = useState<FootballMatch | null>(null);
  const [channels, setChannels] = useState(false);
  const live = room.live;
  const matches = useMemo(
    () => schedule.data?.days.flatMap((day) => day.matches) ?? [],
    [schedule.data],
  );

  if (!live) return null;

  const putMatch = async (match: FootballMatch) => {
    if (match.id === live.matchId || busy !== null) return;
    setBusy(match.id);
    try {
      const choice = await bestSourceOf(match);
      if (!choice) notify(JUNTOS_TEXT.liveNoSourcesFor(matchTitle(match)), { tone: 'warn' });
      else await put(client, choice, live.hash);
    } catch (error) {
      notify(describeFailure(error), { tone: 'err' });
    } finally {
      setBusy(null);
    }
  };

  const bar = putbarState(chosen, live, matches);
  const favorites = (library.data?.favorites ?? []).filter((item) => HASH_RE.test(item.id));

  return (
    <div className="juntos-live juntos-live--matches">
      <DeskList
        selectedId={chosen?.id ?? live.matchId}
        active
        onSelect={setChosen}
        onOpen={(match) => void putMatch(match)}
        watchingId={live.matchId}
        uiScope="sala"
        className="juntos-agenda"
      />
      <div className="juntos-live__putbar" role="group" aria-label={LIVE_TEXT.putbarLabel}>
        <span className="juntos-live__putbar-text">
          <span className="juntos-live__putbar-kicker">
            {bar.title === null
              ? LIVE_TEXT.putbarPickHint
              : bar.here
                ? LIVE_TEXT.putbarHere
                : LIVE_TEXT.putbarChosen}
          </span>
          <span className="juntos-live__putbar-title" title={bar.title ?? undefined}>
            {bar.title ?? LIVE_TEXT.putbarPick}
          </span>
        </span>
        {bar.here ? (
          <Button size="sm" variant="quiet" disabled>
            {LIVE_TEXT.putbarHereButton}
          </Button>
        ) : (
          <Button
            size="sm"
            variant="primary"
            icon="tv"
            busy={bar.match !== null && busy === bar.match.id}
            disabled={bar.match === null || (busy !== null && busy !== bar.match.id)}
            aria-label={bar.title ? LIVE_TEXT.putbarPutWhat(bar.title) : undefined}
            title={LIVE_TEXT.putbarHint}
            onClick={() => {
              if (bar.match) void putMatch(bar.match);
            }}
          >
            {LIVE_TEXT.putbarPut}
          </Button>
        )}
      </div>
      <button
        type="button"
        className="juntos-propose juntos-live__more"
        aria-expanded={channels}
        onClick={() => setChannels((open) => !open)}
      >
        <Icon name="tv" size={18} />
        {JUNTOS_TEXT.livePutChannel}
      </button>
      {channels ? (
        favorites.length === 0 ? (
          <p className="juntos-live__empty">{JUNTOS_TEXT.liveNoFavorites}</p>
        ) : (
          <ul className="juntos-live__list">
            {favorites.map((item) => {
              const here = item.id === live.hash;
              const name = item.title || item.id.slice(0, 8);
              return (
                <li
                  key={item.id}
                  className="juntos-live__row"
                  data-here={here ? 'true' : undefined}
                >
                  <span className="juntos-live__text">
                    <span className="juntos-live__name">{name}</span>
                  </span>
                  {here ? (
                    <span className="juntos-live__here">{JUNTOS_TEXT.liveHere}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="primary"
                      className="juntos-live__put"
                      busy={busy === item.id}
                      disabled={busy !== null && busy !== item.id}
                      aria-label={LIVE_TEXT.putWhat(name)}
                      onClick={() => {
                        setBusy(item.id);
                        void put(client, {
                          hash: item.id,
                          channel: (item.title || 'Canal').slice(0, 120),
                          /* Lo corrige la concesión del vídeo si es de la IPTV. */
                          source: 'engine',
                          matchId: null,
                          match: null,
                        }).finally(() => setBusy(null));
                      }}
                    >
                      {JUNTOS_TEXT.livePut}
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </div>
  );
}
