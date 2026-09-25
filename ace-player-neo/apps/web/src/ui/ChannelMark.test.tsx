import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hueFromName, isForbiddenHue, parseOklch } from '../lib/color.ts';
import { channelAbbrev, ChannelMark, channelDorsal } from './ChannelMark.tsx';

describe('channelDorsal', () => {
  it('el número del canal o su inicial', () => {
    expect(channelDorsal('DAZN 1')).toBe('1');
    expect(channelDorsal('M+ Liga de Campeones 2')).toBe('2');
    expect(channelDorsal('Eurosport')).toBe('E');
    expect(channelDorsal('Ñoño TV')).toBe('N');
    expect(channelDorsal('***')).toBe('·');
  });
});

describe('channelAbbrev', () => {
  it('la sigla del canal para la tesela', () => {
    expect(channelAbbrev('DAZN LaLiga')).toBe('DAZN');
    expect(channelAbbrev('M+ Liga de Campeones 2')).toBe('M+');
    expect(channelAbbrev('La 1 HD')).toBe('LA 1');
    expect(channelAbbrev('Eurosport 1')).toBe('EUROSP');
    expect(channelAbbrev('')).toBe('');
  });
});

describe('ChannelMark', () => {
  it('pinta el dorsal sobre un tono que nunca es de estado ni violeta (C2)', () => {
    const { container } = render(<ChannelMark name="DAZN LaLiga" size={46} />);
    const mark = container.querySelector('.dorsal') as HTMLElement;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark).toHaveAttribute('data-shape', 'round');
    expect(mark.style.getPropertyValue('--s')).toBe('46px');
    const tone = parseOklch(mark.style.getPropertyValue('--tone'));
    expect(tone).not.toBeNull();
    expect(isForbiddenHue(tone?.h ?? 0)).toBe(false);
    expect(tone?.h).toBe(hueFromName('DAZN LaLiga'));
    expect(container.querySelector('.dorsal__abbrev')).toBeNull();
  });

  it('tesela 16:9 con la sigla y la cifra, mismo tono que el dorsal', () => {
    const { container } = render(<ChannelMark name="DAZN 1" size={54} shape="tile" />);
    const mark = container.querySelector('.dorsal') as HTMLElement;
    expect(mark).toHaveClass('dorsal--tile');
    expect(mark).toHaveAttribute('data-shape', 'tile');
    expect(container.querySelector('.dorsal__abbrev')).toHaveTextContent('DAZN');
    expect(container.querySelector('b')).toHaveTextContent('1');
    expect(parseOklch(mark.style.getPropertyValue('--tone'))?.h).toBe(hueFromName('DAZN 1'));
  });
});
