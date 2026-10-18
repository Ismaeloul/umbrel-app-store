/* El chat de la sala (docs/ver-juntos.md §7): los mensajes de cada uno y los
   avisos de la sala («Ana ha pausado») en gris. Baja solo al último mensaje
   salvo que se esté leyendo más arriba. */

import { PARTY, type PartyChatMessage } from '@ace/shared';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { describeFailure } from '../../api/index.ts';
import { cx } from '../../lib/cx.ts';
import { notify } from '../../notices/index.ts';
import { IconButton } from '../../ui/Button.tsx';
import { JUNTOS_TEXT } from './texts.ts';

const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

export function Chat({
  messages,
  selfId,
  onSend,
}: {
  messages: readonly PartyChatMessage[];
  selfId: string;
  onSend(text: string): Promise<void>;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = list.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

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
        {messages.map((message) => (
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
                <time className="juntos-chat__time" dateTime={new Date(message.at).toISOString()}>
                  {TIME.format(message.at)}
                </time>
              </span>
            ) : null}
            <span className="juntos-chat__text">{message.text}</span>
          </li>
        ))}
      </ol>
      <form className="juntos-chat__form" onSubmit={(event) => void submit(event)}>
        <label className="sr-only" htmlFor="juntos-chat-input">
          {JUNTOS_TEXT.chatPlaceholder}
        </label>
        <input
          id="juntos-chat-input"
          className="juntos-chat__input"
          value={text}
          maxLength={PARTY.chatMaxChars}
          placeholder={JUNTOS_TEXT.chatPlaceholder}
          autoComplete="off"
          enterKeyHint="send"
          onChange={(event) => setText(event.target.value)}
        />
        <IconButton
          type="submit"
          icon="subir"
          label={JUNTOS_TEXT.send}
          variant="quiet"
          busy={sending}
          disabled={!text.trim()}
        />
      </form>
    </section>
  );
}
