/* Las pestañas de la sala en directo para quien puede cambiar la fuente
   (docs/ver-juntos.md §14), como la maqueta ver-juntos.html:

   - Fuentes: «Cambio automático si se cae» arriba y las conexiones del
     partido por canal con la lógica de la ficha (liveSources.ts): las IPTV,
     la que suena y las AceStream verificadas, con su señal; las flojas y el
     resto, plegadas. Es una ruta de la sala: también por el enlace.
   - Partidos: los de hoy en directo y los de más tarde, con «Poner» (su
     mejor fuente) o «En la sala»; y «Poner un canal», tus favoritos. Tira de
     la agenda de casa: solo en casa.

   Los invitados no las ven: solo Chat y Gente. */

import type { FootballMatch, PartyLiveChoice, PartyRoom } from '@ace/shared';
import { useMemo, useState } from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Switch } from '../../ui/Field.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { SignalBadge } from '../../ui/SignalBadge.tsx';
import { matchStatus, matchTitle } from '../agenda/domain.ts';
import { useLibraryQuery, useNow, useSchedule } from '../agenda/data.ts';
import type { PartyClient } from './client.ts';
import { bestSourceOf } from './live.ts';
import type { RoomSourceRow } from './liveSources.ts';
import { LIVE_TEXT } from './liveTexts.ts';
import { JUNTOS_TEXT } from './texts.ts';
import { useRoomSources } from './useRoomSources.ts';
import './live.css';

const HASH_RE = /^[a-f0-9]{40}$/;

/**
 * «Poner» para todos. Con `from` (lo que suena según esta pantalla): si otro ya la ha cambiado,
 * el servidor ignora este cambio (gana el primero, sin dos saltos seguidos).
 */
function put(client: PartyClient, live: PartyLiveChoice, from?: string): Promise<void> {
  return client
    .control({ action: 'live', live, ...(from ? { from } : {}) })
    .catch((error: unknown) => {
      notify(describeFailure(error), { tone: 'err' });
    });
}

function Origin({ source }: { source: PartyLiveChoice['source'] }) {
  return (
    <span className={cx('juntos-live__origin', source === 'iptv' && 'juntos-live__origin--iptv')}>
      {source === 'iptv' ? LIVE_TEXT.iptv : LIVE_TEXT.engine}
    </span>
  );
}

/** Una fila de Fuentes: número estable, nombre, calidad, señal y «Poner» (o «En la sala»). */
function SourceRowView({
  item,
  busy,
  onPut,
}: {
  item: RoomSourceRow;
  busy: string | null;
  onPut(item: RoomSourceRow): void;
}) {
  const hash = item.choice.hash;
  return (
    <li className="juntos-live__row" data-here={item.here ? 'true' : undefined}>
      <span className="juntos-live__num">{item.row.number}</span>
      {/* Como la maqueta: en negrita la calidad; debajo, el origen y de dónde sale (o los pares). */}
      <span className="juntos-live__text">
        <span className="juntos-live__name">{item.name}</span>
        <span className="juntos-live__meta">
          <Origin source={item.choice.source} />
          {item.meta ? ` ${item.meta}` : null}
        </span>
      </span>
      {item.here ? null : (
        <SignalBadge
          state={item.row.signal.state}
          label={item.row.signal.word}
          size="sm"
          className="juntos-live__sig"
        />
      )}
      {item.here ? (
        <span className="juntos-live__here">
          <span className="juntos-chip__dot" aria-hidden="true" />
          {JUNTOS_TEXT.liveHere}
        </span>
      ) : (
        <Button
          size="sm"
          variant="quiet"
          busy={busy === hash}
          disabled={busy !== null && busy !== hash}
          aria-label={LIVE_TEXT.putSource(
            item.row.number,
            item.choice.channel,
            item.choice.source === 'iptv' ? LIVE_TEXT.iptv : LIVE_TEXT.engine,
            item.meta,
          )}
          onClick={() => onPut(item)}
        >
          {JUNTOS_TEXT.livePut}
        </Button>
      )}
    </li>
  );
}

function SourceFold({
  summary,
  items,
  busy,
  onPut,
}: {
  summary: string;
  items: readonly RoomSourceRow[];
  busy: string | null;
  onPut(item: RoomSourceRow): void;
}) {
  if (!items.length || !summary) return null;
  return (
    <details className="juntos-live__fold">
      <summary>{summary}</summary>
      <ul className="juntos-live__list">
        {items.map((item) => (
          <SourceRowView key={item.choice.hash} item={item} busy={busy} onPut={onPut} />
        ))}
      </ul>
    </details>
  );
}

/**
 * Fuentes (directo §14): las IPTV, la que suena y las AceStream verificadas, con la lógica de la
 * ficha del partido; las flojas y el resto, plegadas. Para el líder, los co-líderes y el
 * anfitrión, también por el enlace de invitado (la ruta es de la sala).
 */
export function LiveSources({ room, client }: { room: PartyRoom; client: PartyClient }) {
  const live = room.live;
  const sources = useRoomSources(room, client);
  const [busy, setBusy] = useState<string | null>(null);
  if (!live) return null;
  const model = sources.model;
  const onPut = (item: RoomSourceRow) => {
    setBusy(item.choice.hash);
    void put(client, item.choice, live.hash).finally(() => setBusy(null));
  };
  const searchMore = (
    <button
      type="button"
      className="juntos-propose juntos-live__more"
      disabled={sources.researching}
      onClick={() =>
        void sources
          .research()
          .catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }))
      }
    >
      <Icon name="buscar" size={18} />
      {sources.researching ? LIVE_TEXT.searching : LIVE_TEXT.searchMore}
    </button>
  );
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
      {live.matchId === null ? (
        <p className="juntos-live__empty">{LIVE_TEXT.looseChannel}</p>
      ) : null}
      {sources.isPending ? (
        <p className="juntos-live__empty">{LIVE_TEXT.searching}</p>
      ) : sources.isError || !model ? (
        <div className="juntos-live__status">
          <span>{LIVE_TEXT.sourcesFailed}</span>
          <Button size="sm" variant="quiet" onClick={sources.retry}>
            {LIVE_TEXT.retry}
          </Button>
        </div>
      ) : (
        <>
          {model.groups.map((group) => (
            <section key={group.name} className="juntos-live__group" aria-label={group.name}>
              <div className="juntos-live__group-head">
                <h3 className="juntos-kicker">{group.name}</h3>
                <span className="juntos-live__count">
                  {LIVE_TEXT.groupCount(group.total, group.live)}
                </span>
              </div>
              <ul className="juntos-live__list">
                {group.rows.map((item) => (
                  <SourceRowView key={item.choice.hash} item={item} busy={busy} onPut={onPut} />
                ))}
              </ul>
            </section>
          ))}
          {model.groups.length === 0 ? (
            <p className="juntos-live__empty">{LIVE_TEXT.noSources}</p>
          ) : null}
          {sources.scanning ? <p className="juntos-live__status">{LIVE_TEXT.checking}</p> : null}
          <SourceFold
            summary={LIVE_TEXT.weakFold(model.weak.length)}
            items={model.weak}
            busy={busy}
            onPut={onPut}
          />
          <SourceFold
            summary={LIVE_TEXT.restFold(model.failed, model.checking)}
            items={model.rest}
            busy={busy}
            onPut={onPut}
          />
          <SourceFold
            summary={LIVE_TEXT.foreignFold(model.foreign.length)}
            items={model.foreign}
            busy={busy}
            onPut={onPut}
          />
        </>
      )}
      {sources.isPending ? null : searchMore}
    </div>
  );
}

/**
 * «Recuperar el mando» (directo §14): quien creó la sala y no es el líder (la corona pasó a otro
 * mientras no estaba) la recupera de un toque. Sin nada si ya es el líder.
 */
export function LiveReclaim({
  room,
  client,
  selfId,
}: {
  room: PartyRoom | null;
  client: PartyClient;
  selfId: string;
}) {
  const [busy, setBusy] = useState(false);
  if (!room?.live || room.hostId !== selfId || room.leaderId === selfId) return null;
  return (
    <Button
      size="sm"
      variant="quiet"
      icon="corona"
      busy={busy}
      className="juntos-live__reclaim"
      onClick={() => {
        setBusy(true);
        void client
          .member(selfId, 'lead')
          .then(() => notify(LIVE_TEXT.reclaimDone, { tone: 'ok' }))
          .catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }))
          .finally(() => setBusy(false));
      }}
    >
      {LIVE_TEXT.reclaim}
    </Button>
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
