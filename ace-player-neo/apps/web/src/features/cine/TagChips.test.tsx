import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TagChips, visibleTags } from './TagChips.tsx';

describe('chips de distintivos (docs/vod.md §4.4)', () => {
  const counts = [
    { tag: '4k' as const, count: 12 },
    { tag: 'castellano' as const, count: 1234 },
    { tag: 'vose' as const, count: 0 },
  ];

  it('solo los que tienen algo, en su orden fijo; el elegido aunque se quede a 0', () => {
    expect(visibleTags(counts, null).map((entry) => entry.tag)).toEqual(['castellano', '4k']);
    expect(visibleTags(counts, 'vose').map((entry) => entry.tag)).toEqual([
      'castellano',
      'vose',
      '4k',
    ]);
  });

  it('interruptores con su número; tocar el elegido lo quita', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TagChips counts={counts} value={null} onChange={onChange} />);
    const castellano = screen.getByRole('button', { name: 'Castellano, 1234' });
    expect(castellano).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(castellano);
    expect(onChange).toHaveBeenLastCalledWith('castellano');
    rerender(<TagChips counts={counts} value="castellano" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Castellano, 1234' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('sin ninguno, nada', () => {
    const { container } = render(<TagChips counts={[]} value={null} onChange={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });
});
