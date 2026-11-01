/* Partidos, la pestaña de la sala en directo para quien puede cambiar la fuente
   (docs/ver-juntos.md §14), como la maqueta ver-juntos.html: los de hoy en
   directo y los de más tarde, con «Poner» (su mejor fuente) o «En la sala»; y
   «Poner un canal», tus favoritos. Tira de la agenda de casa: solo en casa
   (`liveTools`), y Room.tsx la baja al abrirla (`lazy`): la página del
   invitado no baja la agenda. */

import type { FootballMatch, PartyRoom } from '@ace/shared';
import { useMemo, useState } from 'react';
import { describeFailure } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { matchStatus, matchTitle } from '../agenda/domain.ts';
import { useLibraryQuery, useNow, useSchedule } from '../agenda/data.ts';
import type { PartyClient } from './client.ts';
import { bestSourceOf } from './live.ts';
import { put } from './LivePanels.tsx';
import { LIVE_TEXT } from './liveTexts.ts';
import { JUNTOS_TEXT } from './texts.ts';
import './live.css';

const HASH_RE = /^[a-f0-9]{40}$/;

export function LiveMatches({ room, client }: { room: PartyRoom; client: PartyClient }) {
  const schedule = useSchedule();
  const library = useLibraryQuery();
  const now = useNow();
  const [busy, setBusy] = useState<string | null>(null);
  const [channels, setChannels] = useState(false);
  const live = room.live;

  const { onNow, later } = useMemo(() => {
    const today = schedule.data?.days.flatMap((day) => day.matches) ?? [];
    const onNow: FootballMatch[] = [];
    const later: FootballMatch[] = [];
    for (const match of today) {
      const status = matchStatus(match, now);
      if (status?.phase === 'live') onNow.push(match);
      else if (status?.phase === 'soon' || status?.phase === 'next') later.push(match);
    }
    return { onNow, later: later.slice(0, 12) };
  }, [schedule.data, now]);

  if (!live) return null;

  const putMatch = async (match: FootballMatch) => {
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

  const row = (match: FootballMatch, when: string) => {
    const here = match.id === live.matchId;
    return (
      <li key={match.id} className="juntos-live__row" data-here={here ? 'true' : undefined}>
        <span className="juntos-live__text">
          <span className="juntos-live__name">{matchTitle(match)}</span>
          <span className="juntos-live__meta">
            {when} · {match.competition}
          </span>
        </span>
        {here ? (
          <span className="juntos-live__here">
            <span className="juntos-chip__dot" aria-hidden="true" />
            {JUNTOS_TEXT.liveHere}
          </span>
        ) : (
          <Button
            size="sm"
            variant="quiet"
            busy={busy === match.id}
            disabled={busy !== null && busy !== match.id}
            aria-label={LIVE_TEXT.putWhat(matchTitle(match))}
            onClick={() => void putMatch(match)}
          >
            {JUNTOS_TEXT.livePut}
          </Button>
        )}
      </li>
    );
  };

  const favorites = (library.data?.favorites ?? []).filter((item) => HASH_RE.test(item.id));

  return (
    <div className="juntos-live">
      {schedule.isError ? (
        <p className="juntos-live__empty">{LIVE_TEXT.matchesFailed}</p>
      ) : schedule.isPending ? (
        <p className="juntos-live__empty">{LIVE_TEXT.matchesLoading}</p>
      ) : null}
      {onNow.length ? (
        <section className="juntos-live__group" aria-label={JUNTOS_TEXT.liveOnNow}>
          <h3 className="juntos-kicker">{JUNTOS_TEXT.liveOnNow}</h3>
          <ul className="juntos-live__list">
            {onNow.map((match) => row(match, JUNTOS_TEXT.liveNowShort))}
          </ul>
        </section>
      ) : null}
      {later.length ? (
        <section className="juntos-live__group" aria-label={JUNTOS_TEXT.liveLater}>
          <h3 className="juntos-kicker">{JUNTOS_TEXT.liveLater}</h3>
          <ul className="juntos-live__list">{later.map((match) => row(match, match.time))}</ul>
        </section>
      ) : null}
      {!schedule.isPending && !onNow.length && !later.length && !schedule.isError ? (
        <p className="juntos-live__empty">{JUNTOS_TEXT.liveNoMatches}</p>
      ) : null}
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
              return (
                <li
                  key={item.id}
                  className="juntos-live__row"
                  data-here={here ? 'true' : undefined}
                >
                  <span className="juntos-live__text">
                    <span className="juntos-live__name">{item.title || item.id.slice(0, 8)}</span>
                  </span>
                  {here ? (
                    <span className="juntos-live__here">{JUNTOS_TEXT.liveHere}</span>
                  ) : (
                    <Button
                      size="sm"
                      variant="quiet"
                      busy={busy === item.id}
                      disabled={busy !== null && busy !== item.id}
                      aria-label={LIVE_TEXT.putWhat(item.title || item.id.slice(0, 8))}
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
