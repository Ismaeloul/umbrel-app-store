/* Las pestañas de la sala en directo para quien controla (docs/ver-juntos.md
   §14), como la maqueta ver-juntos.html:

   - Fuentes: «Cambio automático si se cae» arriba y las conexiones del
     partido por canal, cada una con su calidad, IPTV o AceStream y «Poner»
     (o «En la sala», la que suena).
   - Partidos: los de hoy en directo y los de más tarde, con «Poner» (su
     mejor fuente) o «En la sala»; y «Poner un canal», tus favoritos.

   Los invitados no las ven: solo Chat y Gente. Desde fuera de casa no hay
   agenda ni fuentes (son rutas de casa): se dice y ya. */

import type { FootballMatch, PartyLiveChoice, PartyRoom } from '@ace/shared';
import { useMemo, useState } from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Switch } from '../../ui/Field.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { matchStatus, matchTitle } from '../agenda/domain.ts';
import { useLibraryQuery, useNow, useSchedule } from '../agenda/data.ts';
import type { PartyClient } from './client.ts';
import { bestSourceOf, groupSources, useLiveSources } from './live.ts';
import { JUNTOS_TEXT } from './texts.ts';

const HASH_RE = /^[a-f0-9]{40}$/;

function put(client: PartyClient, live: PartyLiveChoice): Promise<void> {
  return client.control({ action: 'live', live }).catch((error: unknown) => {
    notify(describeFailure(error), { tone: 'err' });
  });
}

function Origin({ source }: { source: PartyLiveChoice['source'] }) {
  return (
    <span className={cx('juntos-live__origin', source === 'iptv' && 'juntos-live__origin--iptv')}>
      {source === 'iptv' ? 'IPTV' : 'AceStream'}
    </span>
  );
}

/** El partido de la sala en la agenda de hoy (o null: un canal suelto, o ya no está). */
export function useRoomMatch(room: PartyRoom): FootballMatch | null {
  const schedule = useSchedule();
  const matchId = room.live?.matchId ?? null;
  return useMemo(() => {
    if (!matchId) return null;
    for (const day of schedule.data?.days ?? []) {
      const found = day.matches.find((match) => match.id === matchId);
      if (found) return found;
    }
    return null;
  }, [schedule.data, matchId]);
}

export function LiveSources({
  room,
  client,
  match,
}: {
  room: PartyRoom;
  client: PartyClient;
  match: FootballMatch | null;
}) {
  const live = room.live;
  const sources = useLiveSources(match, true);
  const [busy, setBusy] = useState<string | null>(null);
  const groups = useMemo(() => groupSources(sources.data ?? []), [sources.data]);
  if (!live) return null;
  let number = 0;
  return (
    <div className="juntos-live">
      <Switch
        label={JUNTOS_TEXT.liveAuto}
        description={JUNTOS_TEXT.liveAutoHint}
        checked={live.auto}
        onChange={(auto) =>
          void client
            .settings({ auto })
            .catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }))
        }
        className="juntos-live__auto"
      />
      {!match ? (
        <p className="juntos-live__empty">{JUNTOS_TEXT.liveNoMatch}</p>
      ) : sources.isPending ? (
        <p className="juntos-live__empty">{JUNTOS_TEXT.liveSearching}</p>
      ) : sources.isError ? (
        <p className="juntos-live__empty">{JUNTOS_TEXT.liveSourcesFailed}</p>
      ) : groups.length === 0 ? (
        <p className="juntos-live__empty">{JUNTOS_TEXT.liveNoSources}</p>
      ) : (
        groups.map((group) => (
          <section key={group.name} className="juntos-live__group" aria-label={group.name}>
            <h3 className="juntos-kicker">{group.name}</h3>
            <ul className="juntos-live__list">
              {group.sources.map((source) => {
                number += 1;
                const here = source.choice.hash === live.hash;
                return (
                  <li
                    key={source.choice.hash}
                    className="juntos-live__row"
                    data-here={here ? 'true' : undefined}
                  >
                    <span className="juntos-live__num">{number}</span>
                    <span className="juntos-live__text">
                      <span className="juntos-live__name">{source.choice.channel}</span>
                      <Origin source={source.choice.source} />
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
                        busy={busy === source.choice.hash}
                        onClick={() => {
                          setBusy(source.choice.hash);
                          void put(client, source.choice).finally(() => setBusy(null));
                        }}
                      >
                        {JUNTOS_TEXT.livePut}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}

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
      else await put(client, choice);
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
        <p className="juntos-live__empty">{JUNTOS_TEXT.liveSourcesFailed}</p>
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
