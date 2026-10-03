import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark.tsx';

const ICON = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public/icon.svg'),
  'utf8',
);

describe('BrandMark', () => {
  it('decorativa, cuadrada y del tamaño pedido', () => {
    const { container } = render(<BrandMark size={40} />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('width', '40');
    expect(svg).toHaveAttribute('height', '40');
  });

  it('el mismo dibujo que public/icon.svg (el icono de Umbrel): trazos y colores', () => {
    const { container } = render(<BrandMark />);
    const html = container.innerHTML;
    for (const d of ICON.matchAll(/ d="([^"]+)"/g)) expect(html).toContain(`d="${d[1]}"`);
    for (const color of new Set(ICON.match(/#[0-9a-f]{6}/gi))) expect(html).toContain(color);
    expect(container.querySelector('rect')).toHaveAttribute('rx', '112');
  });

  it('id de degradados únicos con dos marcas en la página', () => {
    const { container } = render(
      <>
        <BrandMark />
        <BrandMark />
      </>,
    );
    const ids = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
