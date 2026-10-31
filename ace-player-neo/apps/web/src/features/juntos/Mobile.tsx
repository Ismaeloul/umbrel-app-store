/* La sala en el móvil (menos de 768): las pestañas de siempre (docs/ver-juntos.md
   §11). El rediseño de escritorio (Panels.tsx) no cambia el móvil; aquí solo
   entra lo que cambia el funcionamiento:
   - Gente: el escudo del co-líder y, en el menú del líder (pulsación larga o
     «⋯»), «Hacer co-líder» / «Quitar co-líder». El co-líder no ve el menú: no
     echa ni pasa la corona.
   - Ajustes (solo el líder): «Quién controla» con las tres opciones (Solo yo /
     Yo y co-líderes / Todos) y qué pasa al acabar.
   - Lista: la de siempre, con sus votos y «Poner ya» para quien controla. */

import type { PartyMember, PartyQueueMode, PartyRoom } from '@ace/shared';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button, IconButton } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Menu, MenuButton, useContextMenu, type MenuItem } from '../../ui/Menu.tsx';
import { Segmented } from '../../ui/Segmented.tsx';
import { canControl, isManager, roleOf, type PartyClient } from './client.ts';
import { CONTROL_ITEMS, controlSettings, controlValue } from './Panels.tsx';
import { JUNTOS_TEXT } from './texts.ts';

/** Una orden de la sala: si falla, se dice por qué (p. ej. «Solo el líder…»). */
function attempt(run: () => Promise<void>): void {
  void run().catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }));
}

// --- Gente ---

export function MobilePeople({
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
  const role = roleOf(room, member.id);
  const items: MenuItem[] = [];
  if (iLead && member.id !== selfId) {
    items.push(
      role === 'coleader'
        ? {
            id: 'guest',
            label: JUNTOS_TEXT.removeColeader,
            icon: 'colider',
            onSelect: () => attempt(() => client.member(member.id, 'guest')),
          }
        : {
            id: 'coleader',
            label: JUNTOS_TEXT.makeColeader,
            icon: 'colider',
            onSelect: () => attempt(() => client.member(member.id, 'coleader')),
          },
    );
    if (member.online) {
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
  if (member.id === selfId && self?.host && role !== 'leader') {
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
        {role === 'leader' ? (
          <span className="juntos-people__leader" title={JUNTOS_TEXT.leader}>
            <Icon name="corona" size={16} />
            <span className="sr-only">{JUNTOS_TEXT.leader}</span>
          </span>
        ) : role === 'coleader' ? (
          <span className="juntos-people__leader" title={JUNTOS_TEXT.coleader}>
            <Icon name="colider" size={16} />
            <span className="sr-only">{JUNTOS_TEXT.coleader}</span>
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

export function MobileQueue({
  room,
  client,
  selfId,
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
}) {
  const control = canControl(room, selfId);
  const manager = isManager(room, selfId);
  const hasNext = room.queue.length > 0 || room.title.kind === 'episode';
  return (
    <div className="juntos-queue">
      {room.queue.length === 0 ? (
        <div className="juntos-queue__empty">
          <p>{JUNTOS_TEXT.listEmpty}</p>
          <p className="juntos-queue__hint">{JUNTOS_TEXT.listEmptyHint}</p>
        </div>
      ) : (
        <ol className="juntos-queue__list">
          {room.queue.map((item) => {
            const voted = item.votes.includes(selfId);
            const removable = manager || item.addedBy === selfId;
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

const QUEUE_MODES: ReadonlyArray<readonly [PartyQueueMode, string]> = [
  ['autoplay', JUNTOS_TEXT.queueAutoplay],
  ['vote', JUNTOS_TEXT.queueVote],
  ['leader', JUNTOS_TEXT.queueLeader],
  ['once', JUNTOS_TEXT.queueOnce],
];

export function MobileSettings({ room, client }: { room: PartyRoom; client: PartyClient }) {
  return (
    <div className="juntos-settings">
      <div className="juntos-settings__group">
        <p className="juntos-settings__label">{JUNTOS_TEXT.settingsControl}</p>
        <Segmented
          label={JUNTOS_TEXT.settingsControl}
          block
          value={controlValue(room)}
          items={CONTROL_ITEMS.map(({ value, label }) => ({ value, label }))}
          onChange={(value) => attempt(() => client.settings(controlSettings(value)))}
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
