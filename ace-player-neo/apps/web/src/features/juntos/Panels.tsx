/* Lo de la sala que viene de Rave (docs/ver-juntos.md §11 y §13): las caras
   de la gente (corona del líder, escudo del co-líder y, en la espera, el
   anillo de cada uno), Gente con el menú del líder (pulsación larga o «⋯»:
   hacer co-líder, pasar la corona, echar), «Quién controla» y quién está
   listo, y «Esperando a todos» antes de empezar: una tarjeta del tamaño del
   vídeo con una sola pista y «Estoy listo». Siguiente, «Cuando acabe» y «A
   continuación» van en Queue.tsx (se re-exportan aquí). Sin reacciones: el
   chat es solo texto. */

import type { PartyMember, PartyRoom } from '@ace/shared';
import type { CSSProperties, ReactNode } from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Menu, MenuButton, useContextMenu, type MenuItem } from '../../ui/Menu.tsx';
import {
  canControl,
  canSwitchLive,
  controllers,
  liveSwitchers,
  roleOf,
  type PartyClient,
} from './client.ts';
import { clock } from './sync.ts';
import { useSecondTap } from '../settings/second-tap.ts';
import { JUNTOS_TEXT } from './texts.ts';

/** Una orden de la sala: si falla, se dice por qué (p. ej. «Solo el líder…»). */
function attempt(run: () => Promise<void>): void {
  void run().catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }));
}

/* «Echar» con segundo toque (regla 31, sin confirm() nativo). El menú se
   cierra al elegir, así que el primer toque arma y deja en la fila un botón
   rojo «¿Echar? Pulsa» durante unos segundos; ese botón (o «Echar» otra vez
   en el menú) es el segundo toque. Lo usan la sala de escritorio y la del
   móvil. */
const KICK_CONFIRM_MS = 5_000;

export function useKickConfirm(
  member: PartyMember,
  client: PartyClient,
): { tap(): void; armed: boolean; confirm: ReactNode } {
  const second = useSecondTap(KICK_CONFIRM_MS);
  const armed = second.armed === 'kick';
  const tap = () => second.tap('kick', () => attempt(() => client.member(member.id, 'kick')));
  const confirm = armed ? (
    <Button
      size="sm"
      variant="danger"
      icon="aviso"
      className="juntos-people__kick"
      aria-label={JUNTOS_TEXT.kickArmed(member.name)}
      onClick={tap}
    >
      {JUNTOS_TEXT.kickArmedShort}
    </Button>
  ) : null;
  return { tap, armed, confirm };
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

/**
 * El anillo de una cara en «Esperando a todos» (§13): `ready`, listo (verde); `wait`, sin darle a
 * «Estoy listo»; un número, el % que lleva cargado. Quien está desconectado va en gris (sin
 * anillo de espera). Fuera de la espera, nada. Sale de lo mismo que la lista de Gente
 * (`member.ready`, `progress` y `online`) y de quién ha tocado (`party.votes`).
 */
export type FaceMark = 'ready' | 'wait' | number;

export function faceMark(
  room: PartyRoom,
  member: PartyMember,
  selfId: string,
  selfVoted: boolean | undefined,
  unvoted: readonly string[],
): FaceMark | undefined {
  if (!room.playback.lobby || room.live || !member.online) return undefined;
  const voted =
    member.id === selfId && selfVoted !== undefined ? selfVoted : !unvoted.includes(member.id);
  if (!voted) return 'wait';
  return member.ready ? 'ready' : (member.progress ?? 0);
}

/** Lo que dice el anillo al lector de pantalla («listo», «sin confirmar», «42 %»). */
export function faceMarkText(mark: FaceMark | undefined): string {
  if (mark === undefined) return '';
  if (mark === 'ready') return JUNTOS_TEXT.votedTag;
  if (mark === 'wait') return JUNTOS_TEXT.notVotedTag;
  return JUNTOS_TEXT.loadingPercent(mark);
}

/** La cara de alguien: iniciales en su color, corona encima del líder y escudo del co-líder. */
export function Avatar({
  member,
  room,
  size = 'md',
  voted,
  mark,
}: {
  member: Pick<PartyMember, 'id' | 'name' | 'online'>;
  room: PartyRoom;
  size?: 'sm' | 'md';
  /** En «Esperando a todos» (§13): con la marca de «Estoy listo» (true) o atenuada (false). */
  voted?: boolean;
  /** En «Esperando a todos»: el anillo (verde listo, el % cargando, gris sin tocar). */
  mark?: FaceMark;
}) {
  const role = roleOf(room, member.id);
  const ring = mark === undefined ? undefined : typeof mark === 'number' ? 'loading' : mark;
  return (
    <span
      className={cx(
        'juntos-av',
        `juntos-av--${size}`,
        !member.online && 'juntos-av--off',
        voted === false && 'juntos-av--unvoted',
      )}
      style={
        {
          '--av': faceColor(room, member.id),
          ...(typeof mark === 'number' ? { '--ring': mark / 100 } : {}),
        } as CSSProperties
      }
      aria-hidden="true"
      data-voted={voted === undefined ? undefined : voted ? 'true' : 'false'}
      data-ring={ring}
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
      {size === 'md' && voted ? (
        <span className="juntos-av__voted">
          <Icon name="check" size={16} />
        </span>
      ) : null}
    </span>
  );
}

/**
 * Arriba del panel: las caras de todos con su nombre. En «Esperando a todos» (§13, pelis y series),
 * con la marca de quien ya ha tocado «Estoy listo» (`selfVoted`: lo mío, como lo sabe esta página;
 * lo de los demás, `unvoted`, del evento `party.votes`).
 */
export function Faces({
  room,
  selfId,
  selfVoted,
  unvoted = [],
}: {
  room: PartyRoom;
  selfId: string;
  selfVoted?: boolean;
  unvoted?: readonly string[];
}) {
  const lobby = room.playback.lobby && !room.live;
  return (
    <ul className="juntos-faces" aria-label={JUNTOS_TEXT.people}>
      {room.members.map((member) => {
        const role = roleOf(room, member.id);
        const tag =
          role === 'leader' ? JUNTOS_TEXT.leader : role === 'coleader' ? JUNTOS_TEXT.coleader : '';
        const voted = !lobby
          ? undefined
          : member.id === selfId && selfVoted !== undefined
            ? selfVoted
            : !unvoted.includes(member.id);
        const mark = faceMark(room, member, selfId, selfVoted, unvoted);
        return (
          <li key={member.id} className="juntos-faces__item">
            <Avatar member={member} room={room} voted={voted} mark={mark} />
            <span className="juntos-faces__name">
              {member.name}
              {member.id === selfId ? <span className="sr-only"> {JUNTOS_TEXT.you}</span> : null}
              {tag ? <span className="sr-only"> · {tag}</span> : null}
              {voted === undefined ? null : (
                <span className="sr-only"> · {faceMarkText(mark) || JUNTOS_TEXT.offline}</span>
              )}
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
  closeArmed = false,
  closing = false,
  canPropose = false,
  selfVoted,
  unvoted = [],
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
  /** «Cerrar la sala» al final (quien la creó; en la maqueta no hay sitio para ello junto a «Invitar»). */
  onCloseRoom?: () => void;
  /** Primer toque dado: el segundo la cierra (regla 31, sin confirm() nativo). */
  closeArmed?: boolean;
  closing?: boolean;
  /** En casa se propone desde Pelis y series; el invitado de fuera solo vota (la nota lo dice). */
  canPropose?: boolean;
  /** «Esperando a todos»: lo mío, como lo sabe esta página (la lista dice quién está listo). */
  selfVoted?: boolean;
  /** «Esperando a todos»: quién de los demás no ha tocado aún (`party.votes`). */
  unvoted?: readonly string[];
}) {
  const control = canControl(room, selfId);
  const names = controllers(room);
  const iLead = room.leaderId === selfId;
  return (
    <div className="juntos-people">
      <ul className="juntos-people__list" aria-label={JUNTOS_TEXT.people}>
        {room.members.map((member) => (
          <Person
            key={member.id}
            member={member}
            room={room}
            client={client}
            selfId={selfId}
            mark={faceMark(room, member, selfId, selfVoted, unvoted)}
          />
        ))}
      </ul>
      {/* directo §14: en directo, quién puede cambiar la fuente (también los co-líderes). */}
      {room.live ? <LiveGuestNote room={room} selfId={selfId} /> : null}
      {!room.live && !control && names && names.length ? (
        <p className="juntos-note">
          <Icon name="info" size={18} />
          <span>
            {names.length === 1
              ? JUNTOS_TEXT.guestNoteOne(names[0] ?? '', canPropose)
              : JUNTOS_TEXT.guestNote(joinNames(names), canPropose)}
          </span>
        </p>
      ) : null}
      {iLead ? <ControlRule room={room} client={client} /> : null}
      {onCloseRoom ? (
        <Button
          variant={closeArmed ? 'danger' : 'quiet'}
          icon={closeArmed ? 'aviso' : 'x'}
          className="juntos-people__close"
          busy={closing}
          aria-label={closeArmed ? JUNTOS_TEXT.closeArmed : undefined}
          onClick={onCloseRoom}
        >
          {closeArmed ? JUNTOS_TEXT.closeArmedShort : JUNTOS_TEXT.closeRoom}
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
  mark,
}: {
  member: PartyMember;
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
  /** «Esperando a todos»: listo, sin confirmar o su % (lo mismo que el anillo de su cara). */
  mark?: FaceMark;
}) {
  const self = room.members.find((m) => m.id === selfId);
  const iLead = room.leaderId === selfId;
  const role = roleOf(room, member.id);
  const kick = useKickConfirm(member, client);
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
        onSelect: () => kick.tap(),
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
  const roleText = !member.online
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
  /* En la espera, quién está listo va aquí (la tarjeta del vídeo solo lleva una pista). */
  const lobbyState =
    mark === undefined
      ? null
      : mark === 'ready'
        ? JUNTOS_TEXT.ready
        : mark === 'wait'
          ? JUNTOS_TEXT.notVoted
          : JUNTOS_TEXT.loadingPercent(mark);
  const status = !lobbyState
    ? roleText
    : role === 'leader' || role === 'coleader'
      ? `${role === 'leader' ? JUNTOS_TEXT.roleLeader : JUNTOS_TEXT.roleColeaderOff} · ${lobbyState}`
      : lobbyState;
  return (
    <li
      className={cx('juntos-people__item', member.id === selfId && 'juntos-people__item--self')}
      {...(items.length ? bind : {})}
    >
      <Avatar member={member} room={room} mark={mark} />
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
      {kick.confirm}
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

// --- Siguiente (Queue.tsx) ---

/* La cola vive en Queue.tsx (la comparten la sala del móvil y la de escritorio, y resalta lo que se
   acaba de proponer); se re-exporta para quien la importaba de aquí. */
export { NextCard, NextPanel, UpNext, orderedQueue } from './Queue.tsx';

// --- Esperando a todos ---

/** «2 h 46 min» o «48 min». */
function duration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** «Empezar sin esperar» queda armado este rato tras el primer toque. */
const START_CONFIRM_MS = 5_000;

/**
 * Antes de empezar (§13, pelis y series): una tarjeta del tamaño del vídeo, encima de él (que ya
 * va cargando por debajo), con el título, UNA sola pista («Esperando a Ana (42 %)», «Te esperamos
 * a ti», «Ya estáis todos») y «Estoy listo» (el toque que deja sonar el vídeo en este aparato). La
 * sala arranca sola cuando le han dado todos y lo tienen cargado. Quien controla tiene además
 * «Empezar sin esperar», con un segundo toque si falta alguien (se ha ido a por palomitas). Quién
 * está listo, uno a uno, va en el anillo de las caras y en Gente: aquí no cabe en el móvil.
 */
export function Lobby({
  room,
  client,
  selfId,
  voted,
  unvoted = [],
  onVote,
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
  /** Esta página ya ha dado el toque (lo sabe el reproductor antes que el servidor). */
  voted: boolean;
  /** Quién de los demás no ha tocado aún (`party.votes`; vacío con un servidor viejo). */
  unvoted?: readonly string[];
  /**
   * «Estoy listo», con el clic (o Intro y espacio en el botón), no con `pointerdown`: en el
   * iPhone, un dedo que baja aún no cuenta como gesto para el sonido.
   */
  onVote(): void;
}) {
  const startTap = useSecondTap(START_CONFIRM_MS);
  const control = canControl(room, selfId);
  /* Lo mío, como lo sabe esta página; lo de los demás, como lo dice el servidor. */
  const hasVoted = (member: PartyMember) =>
    member.id === selfId ? voted : !unvoted.includes(member.id);
  const present = room.members.filter((member) => member.online);
  const selfUnvoted = present.some((member) => member.id === selfId) && !voted;
  /* A quién se espera: sin tocar o aún cargando (con su %, si lo dice). Yo, al final y como «ti». */
  const waiting = present
    .filter((member) => !hasVoted(member) || !member.ready)
    .sort((a, b) => Number(a.id === selfId) - Number(b.id === selfId))
    .map((member) => {
      const name = member.id === selfId ? JUNTOS_TEXT.youObject : member.name;
      return hasVoted(member) && member.progress !== null
        ? JUNTOS_TEXT.lobbyWaitingPct(name, member.progress)
        : name;
    });
  const othersMissing = present.some(
    (member) => member.id !== selfId && (!hasVoted(member) || !member.ready),
  );
  const kind = room.title.kind === 'episode' ? JUNTOS_TEXT.episode : JUNTOS_TEXT.movie;
  const meta = [
    room.title.subtitle ?? null,
    room.title.durationS ? JUNTOS_TEXT.lobbyMeta(kind, duration(room.title.durationS)) : kind,
    room.playback.positionS > 1 ? JUNTOS_TEXT.lobbyFrom(clock(room.playback.positionS)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const hint = selfUnvoted
    ? JUNTOS_TEXT.lobbyWaitYou
    : waiting.length
      ? JUNTOS_TEXT.lobbyWaitingFor(joinNames(waiting))
      : present.length < 2
        ? JUNTOS_TEXT.lobbyAloneShort
        : JUNTOS_TEXT.lobbyAllHere;
  /* Forzar con otro sin tocar o cargando pide un segundo toque; si no falta nadie más, no. */
  const forcing = othersMissing;
  const startArmed = startTap.armed === 'start';
  const start = () => {
    /* El toque de quien fuerza también deja sonar su vídeo. */
    if (!voted) onVote();
    attempt(() => client.control({ action: 'play', positionS: room.playback.positionS }, 'lobby'));
  };
  return (
    <section className="juntos-lobby" aria-labelledby="juntos-lobby-title">
      <div className="juntos-lobby__body">
        <p className="juntos-kicker juntos-kicker--accent">{JUNTOS_TEXT.lobbyTitle}</p>
        <h2 id="juntos-lobby-title" className="juntos-lobby__title">
          {room.title.title}
        </h2>
        <p className="juntos-lobby__meta">{meta}</p>
        <p className="juntos-lobby__hint" role="status">
          {hint}
        </p>
        {/* Un solo botón que pasa a «Estás listo» (desactivado con aria-disabled, que no lo
            saca del orden del Tab): el foco no se pierde al votar con el teclado. */}
        <Button
          variant={voted ? 'quiet' : 'primary'}
          icon="check"
          className={cx('juntos-lobby__vote', voted && 'juntos-lobby__vote--done')}
          aria-disabled={voted ? 'true' : undefined}
          title={voted ? undefined : JUNTOS_TEXT.imReadyHint}
          onClick={voted ? undefined : onVote}
        >
          {voted ? JUNTOS_TEXT.youAreReady : JUNTOS_TEXT.imReady}
        </Button>
        {control ? (
          <button
            type="button"
            className={cx('juntos-lobby__start', startArmed && 'juntos-lobby__start--armed')}
            onClick={() => (forcing ? startTap.tap('start', start) : start())}
          >
            {startArmed
              ? JUNTOS_TEXT.startNowConfirm
              : forcing
                ? JUNTOS_TEXT.startNoWait
                : JUNTOS_TEXT.startNow}
          </button>
        ) : null}
        {/* Siempre montada (vacía antes de votar): un lector de pantalla solo lee los cambios de
            una región que ya estaba. */}
        <p className="sr-only" role="status">
          {voted ? JUNTOS_TEXT.youAreReady : ''}
        </p>
      </div>
    </section>
  );
}

/* directo §14 */
/** La nota de Gente en directo: solo quien puede cambiar la fuente, y tú chateas. */
function LiveGuestNote({ room, selfId }: { room: PartyRoom; selfId: string }) {
  const names = liveSwitchers(room);
  if (canSwitchLive(room, selfId) || !names?.length) return null;
  return (
    <p className="juntos-note">
      <Icon name="info" size={18} />
      <span>{JUNTOS_TEXT.liveGuestNote(joinNames(names), names.length > 1)}</span>
    </p>
  );
}
