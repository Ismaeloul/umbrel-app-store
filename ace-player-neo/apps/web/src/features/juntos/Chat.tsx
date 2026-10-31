/* El chat de la sala (docs/ver-juntos.md §7 y §13): solo texto (los emojis,
   desde el teclado). Los mensajes de los demás van a la izquierda con su
   cara y su nombre; los tuyos, a la derecha en amarillo; los avisos de la
   sala («Ismael ha saltado a 1:12:04»), centrados y en gris. Debajo, «Lucía
   está escribiendo…» y la caja para escribir. Así en escritorio (`desk`); en
   el móvil, el chat de siempre: una lista con el nombre y la hora de cada
   mensaje (también solo texto). Baja solo al último mensaje salvo que se esté
   leyendo más arriba. */

import { PARTY, type PartyChatMessage, type PartyRoom } from '@ace/shared';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { IconButton } from '../../ui/Button.tsx';
import { Icon } from '../../ui/Icon.tsx';
import type { Typing } from './client.ts';
import { Avatar, joinNames } from './Panels.tsx';
import { JUNTOS_TEXT } from './texts.ts';

const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

/** Un aviso de la sala con el nombre de quien lo hizo en negrita, si empieza por él. */
function systemText(text: string, room: PartyRoom | null): ReactNode {
  const name = room?.members
    .map((member) => member.name)
    .sort((a, b) => b.length - a.length)
    .find((candidate) => text.startsWith(`${candidate} `));
  if (!name) return text;
  return (
    <>
      <b>{name}</b>
      {text.slice(name.length)}
    </>
  );
}

export function Chat({
  messages,
  room,
  selfId,
  desk = false,
  typing = [],
  onSend,
  onTyping,
  onExpireTyping,
}: {
  messages: readonly PartyChatMessage[];
  room: PartyRoom | null;
  selfId: string;
  /** El chat del rediseño de escritorio; sin él, el de siempre del móvil. */
  desk?: boolean;
  typing?: readonly Typing[];
  onSend(text: string): Promise<void>;
  /** Se está escribiendo (el cliente ya lo espacia). */
  onTyping?: () => void;
  /** Quita los «está escribiendo» caducados (cada segundo mientras haya alguno). */
  onExpireTyping?: () => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const anyoneTyping = typing.length > 0;
  useEffect(() => {
    if (!anyoneTyping || !onExpireTyping) return;
    const timer = globalThis.setInterval(onExpireTyping, 1_000);
    return () => globalThis.clearInterval(timer);
  }, [anyoneTyping, onExpireTyping]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true);
    try {
      await onSend(clean);
      setText('');
      stick.current = true;
    } catch (error) {
      notify(describeFailure(error), { tone: 'err' });
    } finally {
      setSending(false);
    }
  };

  const typingNames = typing.map((entry) => entry.name);
  const members = new Map(room?.members.map((member) => [member.id, member]));

  return (
    <section className="juntos-chat" aria-label={JUNTOS_TEXT.chat}>
      <ol
        ref={list}
        className="juntos-chat__list"
        aria-live="polite"
        onScroll={(event) => {
          const el = event.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {messages.length === 0 ? (
          <li className="juntos-chat__empty">{JUNTOS_TEXT.chatEmpty}</li>
        ) : null}
        {messages.map((message) => {
          if (!desk) {
            return (
              <li
                key={message.id}
                className={cx(
                  'juntos-chat__msg',
                  message.kind === 'system' && 'juntos-chat__msg--system',
                  message.memberId === selfId && 'juntos-chat__msg--self',
                )}
              >
                {message.kind === 'chat' ? (
                  <span className="juntos-chat__who">
                    {message.name}
                    <time
                      className="juntos-chat__time"
                      dateTime={new Date(message.at).toISOString()}
                    >
                      {TIME.format(message.at)}
                    </time>
                  </span>
                ) : null}
                <span className="juntos-chat__text">{message.text}</span>
              </li>
            );
          }
          if (message.kind === 'system') {
            return (
              <li key={message.id} className="juntos-chat__msg juntos-chat__msg--system">
                {systemText(message.text, room)}
              </li>
            );
          }
          const self = message.memberId === selfId;
          const member = message.memberId ? members.get(message.memberId) : undefined;
          return (
            <li
              key={message.id}
              className={cx('juntos-chat__msg', self && 'juntos-chat__msg--self')}
            >
              {!self && room ? (
                <Avatar
                  member={
                    member ?? { id: message.memberId ?? 'm_', name: message.name, online: false }
                  }
                  room={room}
                  size="sm"
                />
              ) : null}
              <span className="juntos-chat__bubble">
                {self ? (
                  <span className="sr-only">{JUNTOS_TEXT.you}: </span>
                ) : (
                  <span className="juntos-chat__who">{message.name}</span>
                )}
                <span className="juntos-chat__text">{message.text}</span>
                <time className="sr-only" dateTime={new Date(message.at).toISOString()}>
                  {TIME.format(message.at)}
                </time>
              </span>
            </li>
          );
        })}
      </ol>
      {desk ? (
        <p className="juntos-chat__typing" aria-live="polite">
          {typingNames.length ? (
            <>
              <span className="juntos-chat__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              {typingNames.length === 1
                ? JUNTOS_TEXT.typingOne(typingNames[0] ?? '')
                : JUNTOS_TEXT.typingMany(joinNames(typingNames))}
            </>
          ) : null}
        </p>
      ) : null}
      <form className="juntos-chat__form" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="juntos-chat-input">
          {desk ? JUNTOS_TEXT.chatPlaceholder : JUNTOS_TEXT.chatPlaceholderMobile}
        </label>
        <input
          id="juntos-chat-input"
          className="juntos-chat__input"
          value={text}
          maxLength={PARTY.chatMaxChars}
          placeholder={desk ? JUNTOS_TEXT.chatPlaceholder : JUNTOS_TEXT.chatPlaceholderMobile}
          autoComplete="off"
          enterKeyHint="send"
          onChange={(event) => {
            setText(event.target.value);
            if (event.target.value.trim()) onTyping?.();
          }}
        />
        {desk ? (
          <button
            type="submit"
            className="juntos-chat__send"
            aria-label={JUNTOS_TEXT.send}
            aria-busy={sending || undefined}
            disabled={!text.trim() || sending}
          >
            <Icon name="enviar" size={20} />
          </button>
        ) : (
          <IconButton
            type="submit"
            icon="subir"
            label={JUNTOS_TEXT.send}
            variant="quiet"
            busy={sending}
            disabled={!text.trim()}
          />
        )}
      </form>
    </section>
  );
}
