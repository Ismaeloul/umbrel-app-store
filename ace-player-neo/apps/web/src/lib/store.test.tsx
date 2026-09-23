import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createStore, shallowEqual, useStore } from './store.ts';

describe('createStore', () => {
  it('avisa a los oyentes solo si cambia', () => {
    const store = createStore({ n: 0 });
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.set((s) => ({ n: s.n + 1 }));
    const same = store.get();
    store.set(same);
    expect(listener).toHaveBeenCalledOnce();
    off();
    store.set({ n: 5 });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('shallowEqual compara un nivel', () => {
    expect(shallowEqual({ a: 1, b: 'x' }, { a: 1, b: 'x' })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual([1, 2], [1, 2])).toBe(true);
    expect(shallowEqual({ a: {} }, { a: {} })).toBe(false);
  });
});

describe('useStore', () => {
  it('repinta solo cuando cambia el trozo elegido', () => {
    const store = createStore({ a: 1, b: 1 });
    let renders = 0;
    function Probe() {
      renders += 1;
      const a = useStore(store, (s) => s.a);
      return <span>a={a}</span>;
    }
    render(<Probe />);
    expect(screen.getByText('a=1')).toBeInTheDocument();
    const before = renders;
    act(() => store.set((s) => ({ ...s, b: 2 })));
    expect(renders).toBe(before);
    act(() => store.set((s) => ({ ...s, a: 3 })));
    expect(screen.getByText('a=3')).toBeInTheDocument();
  });
});
