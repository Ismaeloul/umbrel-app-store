/* Resaltado de lo que casa en el nombre de una fila (docs/buscador.md). jsdom no trae `CSS.highlights`: sin él
   no se resalta nada; con uno de prueba, cada fila añade sus rangos y los quita al cambiar o desmontarse. */

import { render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { useNameHighlight } from './name-highlight.ts';

function Name({ text, query }: { text: string; query?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useNameHighlightRef.current?.(ref, query, text);
  return <span ref={ref}>{text}</span>;
}

/* El hook se carga después de preparar (o no) la API falsa: guarda el estado del módulo. */
const useNameHighlightRef: { current: typeof useNameHighlight | null } = { current: null };

class FakeHighlight extends Set<Range> {}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
  useNameHighlightRef.current = null;
});

describe('useNameHighlight', () => {
  it('sin la API de resaltado no hace nada (y el texto sigue siendo un solo nodo)', async () => {
    useNameHighlightRef.current = (await import('./name-highlight.ts')).useNameHighlight;
    const { container } = render(<Name text="La 1 Catalunya" query="la 1" />);
    expect(container.querySelector('span')?.childNodes).toHaveLength(1);
  });

  it('con la API: marca «La» y «1» en «La 1 Catalunya» y los quita al desmontarse', async () => {
    const registry = new Map<string, FakeHighlight>();
    vi.stubGlobal('Highlight', FakeHighlight);
    vi.stubGlobal('CSS', { highlights: registry });
    const module = await import('./name-highlight.ts');
    useNameHighlightRef.current = module.useNameHighlight;
    const { unmount, rerender } = render(<Name text="La 1 Catalunya" query="la 1" />);
    const highlight = registry.get(module.NAME_HIGHLIGHT) as FakeHighlight;
    expect([...highlight].map((range) => range.toString())).toEqual(['La', '1']);
    rerender(<Name text="La 1 Catalunya" query="catalunya" />);
    expect([...highlight].map((range) => range.toString())).toEqual(['Catalunya']);
    rerender(<Name text="La 1 Catalunya" />);
    expect(highlight.size).toBe(0);
    rerender(<Name text="DAZN LA LIGA" query="laliga" />);
    expect([...highlight].map((range) => range.toString())).toEqual(['LA LIGA']);
    unmount();
    expect(highlight.size).toBe(0);
  });
});
