/* La cola de la sala (docs/ver-juntos.md §11): «Siguiente» (la regla y lo
   propuesto con sus votos), la tarjeta «Cuando acabe» bajo el vídeo y la
   cuenta atrás de «A continuación». Sale de Panels.tsx para que la sala del
   móvil y la de escritorio la compartan, y para poder resaltar lo que se
   acaba de proponer desde Pelis y series (`highlightId`). */

import { PARTY, type PartyQueueItem, type PartyQueueMode, type PartyRoom } from '@ace/shared';
import { useEffect, useRef, useState } from 'react';
import { describeFailure } from '../../api/index.ts';
import { notify } from '../../notices/index.ts';
import { Button } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { Menu, useContextMenu, type MenuItem } from '../../ui/Menu.tsx';
import { canControl, isManager, type PartyClient } from './client.ts';
import { cx } from '../../lib/cx.ts';
import { Art } from '../cine/Art.tsx';
import { PROPOSE_TEXT } from './proposeTexts.ts';
import { targetPosition } from './sync.ts';
import { JUNTOS_TEXT } from './texts.ts';
import './queue.css';

/** Lo recién propuesto se resalta este rato al volver de Pelis y series. */
export const HIGHLIGHT_MS = 2_000;

/** Una orden de la sala: si falla, se dice por qué (p. ej. «Solo el líder…»). */
function attempt(run: () => Promise<void>): void {
  void run().catch((error: unknown) => notify(describeFailure(error), { tone: 'err' }));
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
  highlight = false,
}: {
  item: PartyQueueItem;
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
  /** Recién propuesto (al volver de Pelis y series): resaltado y a la vista. */
  highlight?: boolean;
}) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (!highlight) return;
    const node = ref.current;
    /* Sin desplazar la página: solo la lista (jsdom no tiene `scrollIntoView`). */
    node?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [highlight]);
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
      ref={ref}
      className={cx('juntos-next__item', highlight && 'juntos-next__item--new')}
      data-new={highlight || undefined}
      title={actions.length ? JUNTOS_TEXT.itemMenuHint : undefined}
      {...(actions.length ? bind : {})}
    >
      <Poster stamp={item.title.poster} artId={item.title.artId} title={item.title.title} />
      <span className="juntos-next__text">
        <span className="juntos-next__title">{title}</span>
        <span className="juntos-next__by">
          {highlight ? (
            <span className="juntos-next__fresh">{PROPOSE_TEXT.justProposed} · </span>
          ) : null}
          {JUNTOS_TEXT.proposedBy(kind, item.addedByName)}
        </span>
      </span>
      {/* «Poner ya» a la vista (en el móvil; en escritorio va en el menú contextual). */}
      {control ? (
        <button
          type="button"
          className="juntos-next__play"
          aria-label={`${JUNTOS_TEXT.playNow}: ${title}`}
          onClick={() => attempt(() => client.queue({ action: 'play', itemId: item.id }))}
        >
          <Icon name="play" size={18} />
          <span className="juntos-next__play-label">{JUNTOS_TEXT.playNow}</span>
        </button>
      ) : null}
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
 * regla y lo propuesto con sus votos. «Quitar» (y «Poner ya» en escritorio)
 * van en el menú contextual (clic derecho, pulsación larga o la tecla de menú
 * sobre el voto); en el móvil, «Poner ya» se ve en cada fila para quien
 * controla.
 *
 * - «Proponer una peli o serie» va pegado arriba (solo en casa, con catálogo).
 * - La regla: chips para quien manda; para los demás, una línea de solo lectura.
 * - Vacío: lo que pasará según la regla (o, al invitado de fuera, que votará).
 * - `highlightId`: lo recién propuesto desde Pelis y series, resaltado un momento.
 */
export function NextPanel({
  room,
  client,
  selfId,
  onPropose,
  highlightId = null,
}: {
  room: PartyRoom;
  client: PartyClient;
  selfId: string;
  /** «Proponer algo de Pelis y series» (en casa; el invitado de fuera no tiene catálogo). */
  onPropose?: () => void;
  /** Id de lo recién propuesto (`nuevo` de la ruta): se resalta `HIGHLIGHT_MS`. */
  highlightId?: string | null;
}) {
  const manager = isManager(room, selfId);
  const next = nextUp(room);
  const items = orderedQueue(room);
  const mode = room.settings.queueMode;
  const leader = room.members.find((m) => m.id === room.leaderId)?.name ?? '';
  const [fresh, setFresh] = useState<string | null>(highlightId);
  useEffect(() => {
    setFresh(highlightId);
    if (!highlightId) return;
    const timer = globalThis.setTimeout(() => setFresh(null), HIGHLIGHT_MS);
    return () => globalThis.clearTimeout(timer);
  }, [highlightId]);
  return (
    <div className="juntos-next">
      {onPropose ? (
        <div className="juntos-next__propose">
          <button type="button" className="juntos-propose" onClick={onPropose}>
            <Icon name="plus" size={18} />
            {PROPOSE_TEXT.proposeSticky}
          </button>
        </div>
      ) : null}
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
      {manager ? (
        <div className="juntos-next__rules" role="radiogroup" aria-label={JUNTOS_TEXT.ruleLabel}>
          {RULES.map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              className="juntos-rule-chip"
              onClick={() => attempt(() => client.settings({ queueMode: value }))}
            >
              {label}
            </button>
          ))}
        </div>
      ) : (
        <p className="juntos-next__rule-line">
          <Icon name="info" size={16} />
          {PROPOSE_TEXT.ruleLine(mode, leader)}
        </p>
      )}
      {items.length === 0 ? (
        <div className="juntos-next__empty">
          <p>{JUNTOS_TEXT.queueEmpty}</p>
          <p className="juntos-next__hint">
            {onPropose ? PROPOSE_TEXT.emptyHint(mode) : PROPOSE_TEXT.emptyGuest}
          </p>
        </div>
      ) : (
        <ol className="juntos-next__list">
          {items.map((item) => (
            <NextItem
              key={item.id}
              item={item}
              room={room}
              client={client}
              selfId={selfId}
              highlight={item.id === fresh}
            />
          ))}
        </ol>
      )}
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
