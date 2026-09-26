/* Lista virtual: `onEndReached` una vez por página y `aria-setsize` /
   `aria-posinset` para el lector de pantalla (docs/iptv.md §16.6). */

import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { VirtualList } from './VirtualList.tsx';

const rowsOf = (n: number) => Array.from({ length: n }, (_, i) => `Canal ${i + 1}`);

function List({ rows, onEnd, total }: { rows: string[]; onEnd(): void; total?: number }) {
  return (
    <VirtualList
      rows={rows}
      rowKey={(row) => row}
      estimate={() => 76}
      renderRow={(row) => <span>{row}</span>}
      label="Canales"
      onEndReached={onEnd}
      {...(total === undefined ? {} : { setSize: total })}
    />
  );
}

describe('VirtualList', () => {
  it('onEndReached: una vez por largo de la lista, al pintarse las últimas filas', () => {
    const onEnd = vi.fn();
    const { rerender } = render(<List rows={rowsOf(5)} onEnd={onEnd} />);
    expect(onEnd).toHaveBeenCalledTimes(1);
    rerender(<List rows={rowsOf(5)} onEnd={onEnd} />);
    expect(onEnd).toHaveBeenCalledTimes(1);
    rerender(<List rows={rowsOf(8)} onEnd={onEnd} />);
    expect(onEnd).toHaveBeenCalledTimes(2);
  });

  it('con setSize, cada fila dice su posición y el total aunque no esté cargado', () => {
    render(<List rows={rowsOf(3)} onEnd={() => {}} total={27687} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('aria-setsize', '27687');
    expect(items[2]).toHaveAttribute('aria-posinset', '3');
  });

  it('sin setSize no pone nada', () => {
    render(<List rows={rowsOf(2)} onEnd={() => {}} />);
    expect(screen.getAllByRole('listitem')[0]).not.toHaveAttribute('aria-setsize');
  });
});
