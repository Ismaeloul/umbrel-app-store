import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Skeleton, SkeletonRows } from './Skeleton.tsx';

describe('Skeleton', () => {
  it('es decorativo y toma el tamaño pedido', () => {
    const { container } = render(<Skeleton width={120} height={20} radius="circle" />);
    const block = container.querySelector('.skeleton') as HTMLElement;
    expect(block).toHaveAttribute('aria-hidden', 'true');
    expect(block.style.width).toBe('120px');
    expect(block.style.borderRadius).toBe('50%');
  });

  it('las filas anuncian la carga una sola vez', () => {
    render(<SkeletonRows rows={3} label="Cargando la agenda…" />);
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Cargando la agenda…');
    expect(status.querySelectorAll('.skeleton-row')).toHaveLength(3);
  });
});
