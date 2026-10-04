import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TagChips, visibleTags } from './TagChips.tsx';

describe('chips de distintivos (docs/vod.md §4.4 y §4.10)', () => {
  const counts = [
    { tag: '4k' as const, count: 12 },
    { tag: 'multi' as const, count: 1234 },
    { tag: 'castellano' as const, count: 1234 },
    { tag: 'vose' as const, count: 0 },
  ];

  it('solo la calidad (el idioma va en su botón), en su orden fijo; el elegido aunque sea de lengua', () => {
    expect(visibleTags(counts, null).map((entry) => entry.tag)).toEqual(['multi', '4k']);
    /* Un enlace viejo con `cinetag=vose`: su chip sale para poder quitarlo. */
    expect(visibleTags(counts, 'vose').map((entry) => entry.tag)).toEqual(['vose', 'multi', '4k']);
  });

  it('interruptores con su número; tocar el elegido lo quita', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TagChips counts={counts} value={null} onChange={onChange} />);
    expect(screen.queryByRole('button', { name: /^Castellano/ })).toBeNull();
    const multi = screen.getByRole('button', { name: 'Multi, 1.234' });
    expect(multi).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(multi);
    expect(onChange).toHaveBeenLastCalledWith('multi');
    rerender(<TagChips counts={counts} value="multi" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Multi, 1.234' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('sin ninguno, nada', () => {
    const { container } = render(<TagChips counts={[]} value={null} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
