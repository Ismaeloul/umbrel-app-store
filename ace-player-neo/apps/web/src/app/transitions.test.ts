import { describe, expect, it } from 'vitest';
import { canalTransitionName, partidoTransitionName } from './transitions.ts';

describe('nombres de transición', () => {
  it('son identificadores CSS válidos y estables', () => {
    expect(partidoTransitionName('fltv-2026-09-23-3')).toBe('partido-fltv-2026-09-23-3');
    expect(partidoTransitionName('espn:401.7')).toBe('partido-espn_401_7');
    expect(canalTransitionName('a1b2')).toBe('canal-a1b2');
    expect(partidoTransitionName('x')).toMatch(/^[A-Za-z][A-Za-z0-9_-]*$/);
  });
});
