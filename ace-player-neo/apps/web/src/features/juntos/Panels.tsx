/* Lo de la sala que viene de Rave (docs/ver-juntos.md §11 y §13): las caras
   de la gente (corona del líder, escudo del co-líder), Gente con el menú del
   líder (pulsación larga o «⋯»: hacer co-líder, pasar la corona, echar) y
   «Quién controla», Siguiente (la regla y lo propuesto con sus votos), la
   tarjeta «Cuando acabe», la cuenta atrás de «A continuación» y «Esperando a
   todos» antes de empezar. Sin reacciones: el chat es solo texto. */

import {
  PARTY,
  type PartyMember,
  type PartyQueueItem,
  type PartyQueueMode,
  type PartyRoom,
} from '@ace/shared';
import { useEffect, useState, type CSSProperties } from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Menu, MenuButton, useContextMenu, type MenuItem } from '../../ui/Menu.tsx';
import { canControl, controllers, isManager, roleOf, type PartyClient } from './client.ts';
import { Art } from '../cine/Art.tsx';
import { clock, targetPosition } from './sync.ts';
import { JUNTOS_TEXT } from './texts.ts';

/** Una orden de la sala: si falla, se dice por qué (p. ej. «Solo el líder…»). */
function attempt(run: () => Promise<void>): void {
  void run().catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }));
}

/** «Ismael y Yassin» o «Ana, Bea y Carla». */
export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names.at(-1)}`;
}

// --- Caras ---

/* Colores de las caras: oscuros para que las iniciales en blanco pasen AA. */
const FACE_COLORS = [
  '#8a6400',
  '#2457d6',
  '#be185d',
  '#047857',
  '#6d28d9',
  '#b4410c',
  '#0e7490',
  '#4d6b0f',
] as const;

/** El color de cada uno: por orden de llegada (distintos en la sala); quien ya no está, por su id. */
function faceColor(room: PartyRoom, id: string): string {
  const index = room.members.findIndex((member) => member.id === id);
  if (index >= 0) return FACE_COLORS[index % FACE_COLORS.length] ?? FACE_COLORS[0];
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return FACE_COLORS[hash % FACE_COLORS.length] ?? FACE_COLORS[0];
}

/** «IS» de Ismael, «LU» de Lucía. */
function initials(name: string): string {
  const letters = [...name.replace(/[^\p{L}\p{N}]/gu, '')];
  return (letters.slice(0, 2).join('') || '?').toLocaleUpperCase('es');
}

/** La cara de alguien: iniciales en su color, corona encima del líder y escudo del co-líder. */
export function Avatar({
  member,
  room,
  size = 'md',
}: {
  member: Pick<PartyMember, 'id' | 'name' | 'online'>;
  room: PartyRoom;
  size?: 'sm' | 'md';
}) {
  const role = roleOf(room, member.id);
  return (
    <span
      className={cx('juntos-av', `juntos-av--${size}`, !member.online && 'juntos-av--off')}
      style={{ '--av': faceColor(room, member.id) } as CSSProperties}
      aria-hidden="true"
    >
      {initials(member.name)}
      {size === 'md' && role === 'leader' ? (
        <span className="juntos-av__crown">
          <Icon name="corona" size={16} />
        </span>
      ) : null}
      {size === 'md' && role === 'coleader' ? (
        <span className="juntos-av__shield">
          <Icon name="colider" size={16} />
        </span>
      ) : null}
    </span>
  );
}

/** Arriba del panel: las caras de todos con su nombre. */
export function Faces({ room, selfId }: { room: PartyRoom; selfId: string }) {
  return (
    <ul className="juntos-faces" aria-label={JUNTOS_TEXT.people}>
      {room.members.map((member) => {
        const role = roleOf(room, member.id);
        const tag =
          role === 'leader' ? JUNTOS_TEXT.leader : role === 'coleader' ? JUNTOS_TEXT.coleader : '';
        return (
          <li key={member.id} className="juntos-faces__item">
            <Avatar member={member} room={room} />
            <span className="juntos-faces__name">
              {member.name}
              {member.id === selfId ? <span className="sr-only"> {JUNTOS_TEXT.you}</span> : null}
              {tag ? <span className="sr-only"> · {tag}</span> : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// --- Gente ---

export function People({
  room,
  client,
  selfId,
  onCloseRoom,
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
  /** «Cerrar la sala» al final (quien la creó; en la maqueta no hay sitio para ello junto a «Invitar»). */
  onCloseRoom?: () => void;
}) {
  const control = canControl(room, selfId);
  const names = controllers(room);
  const iLead = room.leaderId === selfId;
  return (
    <div className="juntos-people">
      <ul className="juntos-people__list" aria-label={JUNTOS_TEXT.people}>
        {room.members.map((member) => (
          <Person key={member.id} member={member} room={room} client={client} selfId={selfId} />
        ))}
      </ul>
      {!control && names && names.length ? (
        <p className="juntos-note">
          <Icon name="info" size={18} />
          <span>
            {names.length === 1
              ? JUNTOS_TEXT.guestNoteOne(names[0] ?? '')
              : JUNTOS_TEXT.guestNote(joinNames(names))}
          </span>
        </p>
      ) : null}
      {iLead ? <ControlRule room={room} client={client} /> : null}
      {onCloseRoom ? (
        <Button variant="quiet" icon="x" className="juntos-people__close" onClick={onCloseRoom}>
          {JUNTOS_TEXT.closeRoom}
        </Button>
      ) : null}
    </div>
  );
}

export type ControlValue = 'solo' | 'leaders' | 'everyone';

export function controlValue(room: PartyRoom): ControlValue {
  if (room.settings.control === 'everyone') return 'everyone';
  return room.settings.coleaders ? 'leaders' : 'solo';
}

/** «Solo yo / Yo y co-líderes / Todos» → los dos campos de los ajustes (compatibles con las apps viejas). */
export function controlSettings(value: ControlValue): {
  control: 'leader' | 'everyone';
  coleaders: boolean;
} {
  if (value === 'everyone') return { control: 'everyone', coleaders: true };
  return { control: 'leader', coleaders: value === 'leaders' };
}

export const CONTROL_ITEMS = [
  { value: 'solo', label: JUNTOS_TEXT.controlSolo, icon: 'corona' },
  { value: 'leaders', label: JUNTOS_TEXT.controlLeaders, icon: 'colider' },
  { value: 'everyone', label: JUNTOS_TEXT.controlEveryone, icon: 'personas' },
] as const satisfies ReadonlyArray<{ value: ControlValue; label: string; icon: string }>;

/**
 * «Solo yo / Yo y co-líderes / Todos» en tres baldosas (icono encima del
 * rótulo, como en la maqueta). Lo usan Gente (el líder) y crear la sala.
 */
export function ControlTiles({
  value,
  onChange,
}: {
  value: ControlValue;
  onChange(value: ControlValue): void;
}) {
  return (
    <div className="juntos-tiles" role="radiogroup" aria-label={JUNTOS_TEXT.settingsControl}>
      {CONTROL_ITEMS.map((item) => (
        <button
          key={item.value}
          type="button"
          role="radio"
          aria-checked={value === item.value}
          className="juntos-tile"
          onClick={() => onChange(item.value)}
        >
          <Icon name={item.icon} size={20} />
          {item.label}
        </button>
      ))}
    </div>
  );
}

/** «Quién controla» para el líder (al final de Gente). */
function ControlRule({ room, client }: { room: PartyRoom; client: PartyClient }) {
  return (
    <div className="juntos-rule">
      <p className="juntos-kicker">{JUNTOS_TEXT.settingsControl}</p>
      <ControlTiles
        value={controlValue(room)}
        onChange={(value) => attempt(() => client.settings(controlSettings(value)))}
      />
    </div>
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
  /* El líder, sobre los demás. El co-líder no ve nada de esto: no echa ni pasa la corona. */
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
        icon: 'salir',
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
  const status = !member.online
    ? JUNTOS_TEXT.offline
    : role === 'leader'
      ? JUNTOS_TEXT.roleLeader
      : role === 'coleader'
        ? room.settings.coleaders
          ? JUNTOS_TEXT.roleColeader
          : JUNTOS_TEXT.roleColeaderOff
        : member.buffering
          ? JUNTOS_TEXT.loading
          : JUNTOS_TEXT.roleWatching;
  return (
    <li
      className={cx('juntos-people__item', member.id === selfId && 'juntos-people__item--self')}
      {...(items.length ? bind : {})}
    >
      <Avatar member={member} room={room} />
      <span className="juntos-people__text">
        <span className="juntos-people__name">
          {member.name}
          {member.id === selfId ? ` ${JUNTOS_TEXT.you}` : ''}
          {role === 'coleader' ? (
            <span className="juntos-badge">
              <Icon name="colider" size={16} />
              {JUNTOS_TEXT.coleader}
            </span>
          ) : null}
        </span>
        <span className="juntos-people__tag">{status}</span>
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

// --- Siguiente ---

const RULES: ReadonlyArray<readonly [PartyQueueMode, string]> = [
  ['autoplay', JUNTOS_TEXT.ruleOrder],
  ['vote', JUNTOS_TEXT.ruleVotes],
  ['leader', JUNTOS_TEXT.rulePick],
];

function ruleLabel(mode: PartyQueueMode): string {
  return RULES.find(([value]) => value === mode)?.[1] ?? JUNTOS_TEXT.ruleStop;
}

/** Lo propuesto en el orden en que se verá: por votos (en «Por votos») o como se añadió. */
export function orderedQueue(room: PartyRoom): PartyQueueItem[] {
  if (room.settings.queueMode !== 'vote') return [...room.queue];
  /* `sort` es estable: en un empate gana lo que se añadió antes (como en el servidor). */
  return [...room.queue].sort((a, b) => b.votes.length - a.votes.length);
}

/** Lo que vendrá al acabar, si se sabe: la cuenta atrás, lo propuesto o el siguiente episodio. */
function nextUp(room: PartyRoom): {
  title: string;
  subtitle: string | null;
  item: PartyQueueItem | null;
} | null {
  if (room.upNext) {
    const item = room.queue.find((entry) => entry.id === room.upNext?.itemId) ?? null;
    return { title: room.upNext.title.title, subtitle: room.upNext.title.subtitle, item };
  }
  const mode = room.settings.queueMode;
  if (mode === 'leader' || mode === 'once') return null;
  const first = orderedQueue(room)[0];
  if (first) return { title: first.title.title, subtitle: first.title.subtitle, item: first };
  if (room.title.kind === 'episode')
    return { title: JUNTOS_TEXT.nextEpisode, subtitle: null, item: null };
  return null;
}

function nextHint(room: PartyRoom, item: PartyQueueItem | null): string {
  const mode = room.settings.queueMode;
  const leader = room.members.find((m) => m.id === room.leaderId)?.name ?? '';
  if (mode === 'leader') return JUNTOS_TEXT.nextPick(leader);
  if (!item) return JUNTOS_TEXT.nextEpisodeAuto;
  return mode === 'vote'
    ? JUNTOS_TEXT.nextByVotes(JUNTOS_TEXT.votes(item.votes.length))
    : JUNTOS_TEXT.nextFirst;
}

/** El cartel pequeño de un título (el relleno con su inicial si no tiene). */
function Poster({ stamp, artId, title }: { stamp: string | null; artId: string; title: string }) {
  return <Art id={artId} art="poster" v={stamp} title={title} className="juntos-poster" />;
}

/** La tarjeta «Cuando acabe · Por votos» bajo el vídeo (escritorio). */
export function NextCard({ room, onSeeList }: { room: PartyRoom; onSeeList(): void }) {
  const next = nextUp(room);
  if (!next) return null;
  const others = orderedQueue(room).filter((item) => item !== next.item);
  const after = others[0];
  const line = next.item
    ? [
        room.settings.queueMode === 'vote' ? JUNTOS_TEXT.votes(next.item.votes.length) : null,
        after
          ? JUNTOS_TEXT.nextThen(
              after.title.subtitle
                ? `${after.title.title} ${after.title.subtitle}`
                : after.title.title,
              after.votes.length,
            )
          : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : JUNTOS_TEXT.nextEpisodeAuto;
  const art = next.item?.title ?? room.title;
  return (
    <section className="juntos-nextcard" aria-label={JUNTOS_TEXT.whenEnds}>
      <Poster stamp={art.poster} artId={art.artId} title={art.title} />
      <span className="juntos-nextcard__text">
        <span className="juntos-kicker juntos-kicker--accent">
          {JUNTOS_TEXT.whenEndsRule(ruleLabel(room.settings.queueMode))}
        </span>
        <span className="juntos-nextcard__title">
          {next.title}
          {next.subtitle ? <span className="juntos-nextcard__sub"> {next.subtitle}</span> : null}
        </span>
        {line ? <span className="juntos-nextcard__line">{line}</span> : null}
      </span>
      <Button size="sm" variant="quiet" onClick={onSeeList}>
        {JUNTOS_TEXT.seeList}
      </Button>
    </section>
  );
}

/** El anillo de «Cuando acabe»: lo que falta de la cuenta atrás (con sus segundos) o de la película. */
function Countdown({ room, client }: { room: PartyRoom; client: PartyClient }) {
  const upNext = room.upNext;
  const [now, setNow] = useState(() => client.serverNow());
  useEffect(() => {
    const timer = globalThis.setInterval(() => setNow(client.serverNow()), upNext ? 250 : 5_000);
    return () => globalThis.clearInterval(timer);
  }, [upNext, client]);
  const duration = room.title.durationS ?? 0;
  let done: number;
  let seconds: number | null = null;
  if (upNext) {
    const left = Math.max(0, upNext.startsAt - now);
    seconds = Math.ceil(left / 1000);
    done = 1 - Math.min(1, left / PARTY.upNextMs);
  } else {
    done = duration ? targetPosition(room.playback, now, duration) / duration : 0;
  }
  const ring = 2 * Math.PI * 24;
  return (
    <span className="juntos-ring" aria-hidden="true">
      <svg className="juntos-ring__svg" viewBox="0 0 52 52">
        <circle cx="26" cy="26" r="24" className="juntos-ring__track" />
        <circle
          cx="26"
          cy="26"
          r="24"
          className="juntos-ring__done"
          strokeDasharray={ring}
          strokeDashoffset={ring * (1 - Math.max(0, Math.min(1, done)))}
        />
      </svg>
      {seconds !== null ? seconds : <Icon name="clock" size={18} />}
    </span>
  );
}

/** Una propuesta: cartel, título, quién la propuso y el voto. «Poner ya» y «Quitar», con el menú contextual. */
function NextItem({
  item,
  room,
  client,
  selfId,
}: {
  item: PartyQueueItem;
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
}) {
  const control = canControl(room, selfId);
  const voted = item.votes.includes(selfId);
  const removable = isManager(room, selfId) || item.addedBy === selfId;
  const kind = item.title.kind === 'episode' ? JUNTOS_TEXT.episode : JUNTOS_TEXT.movie;
  const actions: MenuItem[] = [
    ...(control
      ? [
          {
            id: 'play',
            label: JUNTOS_TEXT.playNow,
            icon: 'play' as const,
            onSelect: () => attempt(() => client.queue({ action: 'play', itemId: item.id })),
          },
        ]
      : []),
    ...(removable
      ? [
          {
            id: 'remove',
            label: JUNTOS_TEXT.remove,
            icon: 'trash' as const,
            danger: true,
            onSelect: () => attempt(() => client.queue({ action: 'remove', itemId: item.id })),
          },
        ]
      : []),
  ];
  const { bind, menu } = useContextMenu();
  const title = item.title.subtitle
    ? `${item.title.title} · ${item.title.subtitle}`
    : item.title.title;
  return (
    <li
      className="juntos-next__item"
      title={actions.length ? JUNTOS_TEXT.itemMenuHint : undefined}
      {...(actions.length ? bind : {})}
    >
      <Poster stamp={item.title.poster} artId={item.title.artId} title={item.title.title} />
      <span className="juntos-next__text">
        <span className="juntos-next__title">{title}</span>
        <span className="juntos-next__by">{JUNTOS_TEXT.proposedBy(kind, item.addedByName)}</span>
      </span>
      <button
        type="button"
        className="juntos-vote"
        aria-pressed={voted}
        aria-label={`${JUNTOS_TEXT.vote} ${title} (${JUNTOS_TEXT.votes(item.votes.length)})`}
        aria-haspopup={actions.length ? 'menu' : undefined}
        onClick={() => attempt(() => client.queue({ action: 'vote', itemId: item.id }))}
      >
        <Icon name="chev-u" size={18} />
        <span className="juntos-vote__n">{item.votes.length}</span>
      </button>
      {actions.length ? (
        <Menu {...menu} label={JUNTOS_TEXT.itemActions(item.title.title)} items={actions} />
      ) : null}
    </li>
  );
}

/**
 * La pestaña Siguiente, como la maqueta: «Cuando acabe» con su anillo, la
 * regla y lo propuesto con sus votos. Sin botones de más en cada fila:
 * «Poner ya» y «Quitar» van en el menú contextual (clic derecho, pulsación
 * larga o la tecla de menú sobre el voto).
 */
export function NextPanel({
  room,
  client,
  selfId,
  onPropose,
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
  /** «Proponer algo de Pelis y series» (en casa; el invitado de fuera no tiene catálogo). */
  onPropose?: () => void;
}) {
  const manager = isManager(room, selfId);
  const next = nextUp(room);
  const items = orderedQueue(room);
  return (
    <div className="juntos-next">
      {next ? (
        <div className="juntos-next__up">
          <Poster
            stamp={(next.item?.title ?? room.title).poster}
            artId={(next.item?.title ?? room.title).artId}
            title={next.title}
          />
          <span className="juntos-nextcard__text">
            <span className="juntos-kicker juntos-kicker--accent">{JUNTOS_TEXT.whenEnds}</span>
            <span className="juntos-nextcard__title">{next.title}</span>
            <span className="juntos-nextcard__line">{nextHint(room, next.item)}</span>
          </span>
          <Countdown room={room} client={client} />
        </div>
      ) : null}
      <div className="juntos-next__rules" role="radiogroup" aria-label={JUNTOS_TEXT.ruleLabel}>
        {RULES.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={room.settings.queueMode === mode}
            disabled={!manager}
            className="juntos-rule-chip"
            onClick={() => attempt(() => client.settings({ queueMode: mode }))}
          >
            {label}
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <div className="juntos-next__empty">
          <p>{JUNTOS_TEXT.queueEmpty}</p>
          <p className="juntos-next__hint">
            {onPropose ? JUNTOS_TEXT.queueEmptyHint : JUNTOS_TEXT.queueEmptyGuestHint}
          </p>
        </div>
      ) : (
        <ol className="juntos-next__list">
          {items.map((item) => (
            <NextItem key={item.id} item={item} room={room} client={client} selfId={selfId} />
          ))}
        </ol>
      )}
      {onPropose ? (
        <button type="button" className="juntos-propose" onClick={onPropose}>
          <Icon name="plus" size={18} />
          {JUNTOS_TEXT.propose}
        </button>
      ) : null}
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

// --- Esperando a todos (§13) ---

/** «2 h 46 min» o «48 min». */
function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Antes de empezar: quién está listo y quién cargando; «Empezar para todos» para quien controla. */
export function Lobby({
  room,
  client,
  selfId,
  onGesture,
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
  /** Un toque en la espera (el navegador lo necesita para que luego suene el vídeo). */
  onGesture?: () => void;
}) {
  const control = canControl(room, selfId);
  const present = room.members.filter((member) => member.online);
  const missing = present.filter((member) => !member.ready).map((member) => member.name);
  const leader = room.members.find((m) => m.id === room.leaderId)?.name ?? '';
  const kind = room.title.kind === 'episode' ? JUNTOS_TEXT.episode : JUNTOS_TEXT.movie;
  const meta = [
    room.title.subtitle ?? null,
    room.title.durationS ? JUNTOS_TEXT.lobbyMeta(kind, duration(room.title.durationS)) : kind,
    room.playback.positionS > 1 ? JUNTOS_TEXT.lobbyFrom(clock(room.playback.positionS)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const hint = missing.length
    ? JUNTOS_TEXT.lobbyWaiting(joinNames(missing))
    : present.length < 2
      ? JUNTOS_TEXT.lobbyAlone
      : JUNTOS_TEXT.lobbyAllReady;
  return (
    <section
      className="juntos-lobby"
      aria-labelledby="juntos-lobby-title"
      onPointerDown={onGesture}
      onKeyDown={onGesture}
    >
      <Poster stamp={room.title.poster} artId={room.title.artId} title={room.title.title} />
      <div className="juntos-lobby__body">
        <p className="juntos-kicker juntos-kicker--accent">{JUNTOS_TEXT.lobbyTitle}</p>
        <h2 id="juntos-lobby-title" className="juntos-lobby__title">
          {room.title.title}
        </h2>
        <p className="juntos-lobby__meta">{meta}</p>
        <ul className="juntos-lobby__list">
          {room.members.map((member) => (
            <li
              key={member.id}
              className={cx('juntos-lobby__row', !member.online && 'juntos-lobby__row--off')}
            >
              <Avatar member={member} room={room} size="sm" />
              <span className="juntos-lobby__name">
                {member.name}
                {member.id === selfId ? ` ${JUNTOS_TEXT.you}` : ''}
              </span>
              {!member.online ? (
                <span className="juntos-lobby__state">{JUNTOS_TEXT.offline}</span>
              ) : member.ready ? (
                <span className="juntos-lobby__state juntos-lobby__state--ok">
                  <Icon name="check" size={16} />
                  {JUNTOS_TEXT.ready}
                </span>
              ) : (
                <span className="juntos-lobby__state">
                  <span className="juntos-lobby__bar" aria-hidden="true">
                    <span style={{ transform: `scaleX(${(member.progress ?? 0) / 100})` }} />
                  </span>
                  <span className="juntos-lobby__pct">
                    {member.progress === null
                      ? JUNTOS_TEXT.loading
                      : JUNTOS_TEXT.loadingPercent(member.progress)}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
        {control ? (
          <Button
            variant="primary"
            icon="play"
            className="juntos-lobby__start"
            onClick={() =>
              attempt(() => client.control({ action: 'play', positionS: room.playback.positionS }))
            }
          >
            {JUNTOS_TEXT.startForAll}
          </Button>
        ) : null}
        <p className="juntos-lobby__hint" role="status">
          {control ? hint : JUNTOS_TEXT.lobbyGuest(leader)}
        </p>
      </div>
    </section>
  );
}
