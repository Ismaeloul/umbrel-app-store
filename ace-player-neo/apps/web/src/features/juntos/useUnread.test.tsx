/* Sin leer en la pestaña Chat (directo §14): solo los mensajes de otros que
   llegan sin mirar el chat; ni los avisos de la sala ni lo que había al entrar. */

import type { PartyChatMessage } from '@ace/shared';
import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { unreadCount, useUnread } from './useUnread.ts';

const msg = (id: number, memberId: string | null): PartyChatMessage => ({
  id,
  at: id,
  kind: memberId ? 'chat' : 'system',
  memberId,
  name: memberId ?? 'Sala',
  text: 'hola',
});

describe('sin leer', () => {
  it('cuenta los de otros posteriores a lo visto', () => {
    const list = [msg(1, 'a'), msg(2, null), msg(3, 'yo'), msg(4, 'a')];
    expect(unreadCount(list, 'yo', 0)).toBe(2);
    expect(unreadCount(list, 'yo', 3)).toBe(1);
  });

  it('lo que había al entrar no cuenta; mirar el chat lo deja todo leído', () => {
    const first = [msg(1, 'a')];
    const view = renderHook(({ list, reading }) => useUnread(list, 'yo', reading), {
      initialProps: { list: first, reading: false },
    });
    expect(view.result.current).toBe(0);
    const more = [...first, msg(2, 'a'), msg(3, null)];
    view.rerender({ list: more, reading: false });
    expect(view.result.current).toBe(1);
    view.rerender({ list: more, reading: true });
    expect(view.result.current).toBe(0);
    view.rerender({ list: more, reading: false });
    expect(view.result.current).toBe(0);
  });
});
