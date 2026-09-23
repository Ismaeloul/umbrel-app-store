import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hueFromName, isForbiddenHue, parseOklch } from '../lib/color.ts';
import { ChannelMark, channelDorsal } from './ChannelMark.tsx';

describe('channelDorsal', () => {
  it('el número del canal o su inicial', () => {
    expect(channelDorsal('DAZN 1')).toBe('1');
    expect(channelDorsal('M+ Liga de Campeones 2')).toBe('2');
    expect(channelDorsal('Eurosport')).toBe('E');
    expect(channelDorsal('Ñoño TV')).toBe('N');
    expect(channelDorsal('***')).toBe('·');
  });
});

describe('ChannelMark', () => {
  it('pinta el dorsal sobre un tono que nunca es de estado ni violeta (C2)', () => {
    const { container } = render(<ChannelMark name="DAZN LaLiga" size={46} />);
    const mark = container.querySelector('.dorsal') as HTMLElement;
    expect(mark).toHaveAttribute('aria-hidden', 'true');
    expect(mark.style.getPropertyValue('--s')).toBe('46px');
    const tone = parseOklch(mark.style.getPropertyValue('--tone'));
    expect(tone).not.toBeNull();
    expect(isForbiddenHue(tone?.h ?? 0)).toBe(false);
    expect(tone?.h).toBe(hueFromName('DAZN LaLiga'));
  });
});
