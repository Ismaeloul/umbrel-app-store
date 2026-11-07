/* Fuentes, la pestaña de la sala en directo para quien puede cambiar la fuente
   (docs/ver-juntos.md §14), como la maqueta ver-juntos.html: «Cambio
   automático si se cae» arriba y las conexiones del partido por canal con la
   lógica de la ficha (liveSources.ts): las IPTV, la que suena y las AceStream
   verificadas, con su señal; las flojas y el resto, plegadas. Es una ruta de
   la sala: también por el enlace.

   Room.tsx la baja al abrirla (`lazy`): con la lógica de la ficha viene parte
   de la agenda, que la página del invitado no necesita para una peli.
   Partidos va en LiveMatches.tsx (solo en casa) y «Recuperar el mando» en
   LiveReclaim.tsx (sin nada de esto). Los invitados no las ven: solo Chat y
   Gente. */

import type { PartyLiveChoice, PartyRoom } from '@ace/shared';
import { useState } from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Switch } from '../../ui/Field.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { SignalBadge } from '../../ui/SignalBadge.tsx';
import type { PartyClient } from './client.ts';
import type { RoomSourceRow } from './liveSources.ts';
import { LIVE_TEXT } from './liveTexts.ts';
import { JUNTOS_TEXT } from './texts.ts';
import { useRoomSources } from './useRoomSources.ts';
import '../sources/demo.ts';
import './live.css';

/**
 * «Poner» para todos. Con `from` (lo que suena según esta pantalla): si otro ya la ha cambiado,
 * el servidor ignora este cambio (gana el primero, sin dos saltos seguidos).
 */
export function put(client: PartyClient, live: PartyLiveChoice, from?: string): Promise<void> {
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

/**
 * Una fila de Fuentes: el número en su pastilla, la calidad, el origen y de dónde sale (en una
 * línea), la señal en su glifo (la palabra va en el `title` y en el nombre de «Poner») y «Poner»
 * (o «En la sala»).
 */
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
  const origin = item.choice.source === 'iptv' ? LIVE_TEXT.iptv : LIVE_TEXT.engine;
  const signal = item.row.signal.word;
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
        <span className="juntos-live__sig" title={signal}>
          <SignalBadge state={item.row.signal.state} label={signal} size="sm" compact hideWord />
        </span>
      )}
      {item.here ? (
        <span className="juntos-live__here">
          <span className="juntos-chip__dot" aria-hidden="true" />
          {JUNTOS_TEXT.liveHere}
        </span>
      ) : (
        <Button
          size="sm"
          variant="primary"
          className="juntos-live__put"
          busy={busy === hash}
          disabled={busy !== null && busy !== hash}
          aria-label={LIVE_TEXT.putSource(
            item.row.number,
            item.choice.channel,
            origin,
            item.meta,
            signal,
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
