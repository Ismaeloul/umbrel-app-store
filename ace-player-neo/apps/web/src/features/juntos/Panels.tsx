/* Lo de la sala que viene de Rave (docs/ver-juntos.md §11): quién está y el
   líder (con pulsación larga o «⋯» para echar o pasar el liderazgo), la
   lista con sus votos, los ajustes del líder, las reacciones que suben por
   encima del vídeo y la tarjeta de «A continuación» con su cuenta atrás. */

import {
  PARTY_REACTIONS,
  type PartyQueueMode,
  type PartyMember,
  type PartyReactBody,
  type PartyRoom,
} from '@ace/shared';
import { useEffect, useState } from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Menu, MenuButton, useContextMenu, type MenuItem } from '../../ui/Menu.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { canControl, type PartyClient, type Reaction } from './client.ts';
import { JUNTOS_TEXT } from './texts.ts';

/** Una orden de la sala: si falla, se dice por qué (p. ej. «Solo el líder…»). */
function attempt(run: () => Promise<void>): void {
  void run().catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }));
}

// --- Personas ---

export function People({
  room,
  client,
  selfId,
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
}) {
  return (
    <ul className="juntos-people__list" aria-label={JUNTOS_TEXT.people}>
      {room.members.map((member) => (
        <Person key={member.id} member={member} room={room} client={client} selfId={selfId} />
      ))}
    </ul>
  );
}

function Person({
  member,
  room,
  client,
  selfId,
}: {
  member: PartyMember;
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
}) {
  const self = room.members.find((m) => m.id === selfId);
  const iLead = room.leaderId === selfId;
  const items: MenuItem[] = [];
  if (iLead && member.id !== selfId) {
    if (!member.leader && member.online) {
      items.push({
        id: 'lead',
        label: JUNTOS_TEXT.makeLeader,
        icon: 'corona',
        onSelect: () => attempt(() => client.member(member.id, 'lead')),
      });
    }
    if (!member.host) {
      items.push({
        id: 'kick',
        label: JUNTOS_TEXT.kick,
        icon: 'x',
        danger: true,
        onSelect: () => {
          if (globalThis.confirm(JUNTOS_TEXT.kickConfirm(member.name))) {
            attempt(() => client.member(member.id, 'kick'));
          }
        },
      });
    }
  }
  /* Quien creó la sala puede volver a ser líder cuando quiera. */
  if (member.id === selfId && self?.host && !member.leader) {
    items.push({
      id: 'take',
      label: JUNTOS_TEXT.takeLead,
      icon: 'corona',
      onSelect: () => attempt(() => client.member(member.id, 'lead')),
    });
  }
  const { bind, menu } = useContextMenu();
  return (
    <li
      className={cx(
        'juntos-people__item',
        !member.online && 'juntos-people__item--off',
        member.id === selfId && 'juntos-people__item--self',
      )}
      {...(items.length ? bind : {})}
    >
      <span className="juntos-people__avatar" aria-hidden="true">
        {member.name.slice(0, 1).toLocaleUpperCase('es')}
      </span>
      <span className="juntos-people__name">
        {member.name}
        {member.leader ? (
          <span className="juntos-people__leader" title={JUNTOS_TEXT.leader}>
            <Icon name="corona" size={16} />
            <span className="sr-only">{JUNTOS_TEXT.leader}</span>
          </span>
        ) : null}
      </span>
      <span className="juntos-people__tag">
        {!member.online
          ? JUNTOS_TEXT.offline
          : member.buffering
            ? JUNTOS_TEXT.loading
            : member.host
              ? JUNTOS_TEXT.host
              : ''}
      </span>
      {items.length ? (
        <>
          <MenuButton
            label={JUNTOS_TEXT.memberActions(member.name)}
            variant="quiet"
            items={items}
          />
          <Menu {...menu} label={JUNTOS_TEXT.memberActions(member.name)} items={items} />
        </>
      ) : null}
    </li>
  );
}

// --- Lista ---

export function Queue({
  room,
  client,
  selfId,
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
}) {
  const control = canControl(room, selfId);
  const iLead = room.leaderId === selfId;
  const hasNext = room.queue.length > 0 || room.title.kind === 'episode';
  return (
    <div className="juntos-queue">
      {room.queue.length === 0 ? (
        <div className="juntos-queue__empty">
          <p>{JUNTOS_TEXT.queueEmpty}</p>
          <p className="juntos-queue__hint">{JUNTOS_TEXT.queueEmptyHint}</p>
        </div>
      ) : (
        <ol className="juntos-queue__list">
          {room.queue.map((item) => {
            const voted = item.votes.includes(selfId);
            const removable = iLead || item.addedBy === selfId;
            return (
              <li key={item.id} className="juntos-queue__item">
                <div className="juntos-queue__text">
                  <span className="juntos-queue__title">{item.title.title}</span>
                  {item.title.subtitle ? (
                    <span className="juntos-queue__sub">{item.title.subtitle}</span>
                  ) : null}
                  <span className="juntos-queue__by">{JUNTOS_TEXT.queueBy(item.addedByName)}</span>
                </div>
                <div className="juntos-queue__actions">
                  <button
                    type="button"
                    className={cx('juntos-vote', voted && 'juntos-vote--on')}
                    aria-pressed={voted}
                    aria-label={`${JUNTOS_TEXT.vote} (${JUNTOS_TEXT.votes(item.votes.length)})`}
                    onClick={() => attempt(() => client.queue({ action: 'vote', itemId: item.id }))}
                  >
                    👍 <span>{item.votes.length}</span>
                  </button>
                  {control ? (
                    <Button
                      size="sm"
                      variant="quiet"
                      icon="play"
                      onClick={() =>
                        attempt(() => client.queue({ action: 'play', itemId: item.id }))
                      }
                    >
                      {JUNTOS_TEXT.playNow}
                    </Button>
                  ) : null}
                  {removable ? (
                    <IconButton
                      variant="quiet"
                      icon="trash"
                      label={JUNTOS_TEXT.remove}
                      onClick={() =>
                        attempt(() => client.queue({ action: 'remove', itemId: item.id }))
                      }
                    />
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {control && hasNext ? (
        <Button
          size="sm"
          icon="chev-r"
          onClick={() => attempt(() => client.queue({ action: 'next' }))}
        >
          {room.queue.length === 0 ? JUNTOS_TEXT.nextEpisode : JUNTOS_TEXT.next}
        </Button>
      ) : null}
    </div>
  );
}

// --- Ajustes (solo el líder) ---

export function Settings({ room, client }: { room: PartyRoom; client: PartyClient }) {
  return (
    <div className="juntos-settings">
      <div className="juntos-settings__group">
        <p className="juntos-settings__label">{JUNTOS_TEXT.settingsControl}</p>
        <Segmented
          label={JUNTOS_TEXT.settingsControl}
          block
          value={room.settings.control}
          items={[
            { value: 'leader', label: JUNTOS_TEXT.controlLeader },
            { value: 'everyone', label: JUNTOS_TEXT.controlEveryone },
          ]}
          onChange={(control) => attempt(() => client.settings({ control }))}
        />
      </div>
      <div className="juntos-settings__group">
        <p className="juntos-settings__label">{JUNTOS_TEXT.settingsQueue}</p>
        <div
          className="juntos-settings__modes"
          role="radiogroup"
          aria-label={JUNTOS_TEXT.settingsQueue}
        >
          {QUEUE_MODES.map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={room.settings.queueMode === mode}
              className={cx(
                'juntos-settings__mode',
                room.settings.queueMode === mode && 'juntos-settings__mode--on',
              )}
              onClick={() => attempt(() => client.settings({ queueMode: mode }))}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="juntos-settings__hint">{JUNTOS_TEXT.settingsHint}</p>
      </div>
    </div>
  );
}

const QUEUE_MODES: ReadonlyArray<readonly [PartyQueueMode, string]> = [
  ['autoplay', JUNTOS_TEXT.queueAutoplay],
  ['vote', JUNTOS_TEXT.queueVote],
  ['leader', JUNTOS_TEXT.queueLeader],
  ['once', JUNTOS_TEXT.queueOnce],
];

// --- Reacciones ---

/** La fila de emojis para lanzar. */
export function ReactionBar({ client }: { client: PartyClient }) {
  const send = (emoji: PartyReactBody['emoji']) => attempt(() => client.react(emoji));
  return (
    <div className="juntos-react" role="group" aria-label={JUNTOS_TEXT.react}>
      {PARTY_REACTIONS.map((emoji) => (
        <button key={emoji} type="button" className="juntos-react__btn" onClick={() => send(emoji)}>
          {emoji}
        </button>
      ))}
    </div>
  );
}

/** Las reacciones subiendo por encima del vídeo; cada una se quita al acabar de subir. */
export function ReactionLayer({
  reactions,
  client,
}: {
  reactions: readonly Reaction[];
  client: PartyClient;
}) {
  return (
    <div className="juntos-floats" aria-hidden="true">
      {reactions.map((reaction) => (
        <span
          key={reaction.id}
          className="juntos-floats__item"
          style={{ left: `${8 + ((reaction.id * 37) % 80)}%` }}
          onAnimationEnd={() => client.dropReaction(reaction.id)}
        >
          <span className="juntos-floats__emoji">{reaction.emoji}</span>
          <span className="juntos-floats__name">{reaction.self ? '' : reaction.name}</span>
        </span>
      ))}
    </div>
  );
}

// --- A continuación ---

export function UpNext({
  room,
  client,
  selfId,
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
}) {
  const upNext = room.upNext;
  const [now, setNow] = useState(() => client.serverNow());
  useEffect(() => {
    if (!upNext) return;
    const timer = globalThis.setInterval(() => setNow(client.serverNow()), 250);
    return () => globalThis.clearInterval(timer);
  }, [upNext, client]);
  if (!upNext) return null;
  const seconds = Math.max(0, Math.ceil((upNext.startsAt - now) / 1000));
  const control = canControl(room, selfId);
  return (
    <div className="juntos-upnext" role="status">
      <span className="juntos-upnext__kicker">{JUNTOS_TEXT.upNextTitle}</span>
      <span className="juntos-upnext__title">{upNext.title.title}</span>
      {upNext.title.subtitle ? (
        <span className="juntos-upnext__sub">{upNext.title.subtitle}</span>
      ) : null}
      <span className="juntos-upnext__in">{JUNTOS_TEXT.upNextIn(seconds)}</span>
      {control ? (
        <div className="juntos-upnext__actions">
          <Button
            size="sm"
            variant="primary"
            icon="play"
            onClick={() => attempt(() => client.queue({ action: 'next' }))}
          >
            {JUNTOS_TEXT.watchNow}
          </Button>
          <Button
            size="sm"
            variant="quiet"
            onClick={() => attempt(() => client.queue({ action: 'cancel' }))}
          >
            {JUNTOS_TEXT.cancelNext}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
