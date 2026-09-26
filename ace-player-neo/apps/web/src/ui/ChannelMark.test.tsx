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

  it('se salta la resolución, el códec y los fotogramas: el número es el del canal (§18)', () => {
    expect(channelDorsal('La 1 TVE 720p')).toBe('1');
    expect(channelDorsal('La 1 TVE 720p *')).toBe('1');
    expect(channelDorsal('La 1 TVE 720')).toBe('1');
    expect(channelDorsal('DAZN 2 1080p')).toBe('2');
    expect(channelDorsal('DAZN 2 1080i')).toBe('2');
    expect(channelDorsal('DAZN 2 1080p50 H265')).toBe('2');
    expect(channelDorsal('M+ LaLiga TV 3 2160')).toBe('3');
    expect(channelDorsal('M+ LaLiga TV 3 x265 60fps')).toBe('3');
    expect(channelDorsal('Eurosport 4K')).toBe('E');
    expect(channelDorsal('Eurosport 8K')).toBe('E');
    expect(channelDorsal('Movistar Plus+ 1080p H264')).toBe('M');
    expect(channelDorsal('Canal 24 Horas 50 FPS')).toBe('24');
    expect(channelDorsal('TV3 HD')).toBe('3');
  });

  it('se salta la reserva y la resolución escrita con «x» (§19)', () => {
    expect(channelDorsal('M. LALIGA 1 FHD (BK-2)')).toBe('1');
    expect(channelDorsal('M. LALIGA HD (BK-1)')).toBe('M');
    expect(channelDorsal('M. LALIGA [BK 2]')).toBe('M');
    expect(channelDorsal('DAZN 2 BK-1')).toBe('2');
    expect(channelDorsal('La 1 HD 1920x1080')).toBe('1');
    expect(channelDorsal('DAZN 1 1280×720')).toBe('1');
    expect(channelDorsal('Canal 24 Horas')).toBe('24');
  });

  it('una letra suelta pegada al número va con él: «DAZN F1» no es «DAZN 1» (§16.16)', () => {
    expect(channelDorsal('DAZN F1')).toBe('F1');
    expect(channelDorsal('SKY SPORTS F1 FHD')).toBe('F1');
    expect(channelDorsal('M4 SPORT')).toBe('M4');
    expect(channelDorsal('DAZN ACB 1')).toBe('1');
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

  it('una sigla entre la marca y el número va en la sigla: «DAZN ACB 1» (§16.16)', () => {
    expect(channelAbbrev('DAZN ACB 1')).toBe('DAZN ACB');
    expect(channelAbbrev('DAZN 1')).toBe('DAZN');
    expect(channelAbbrev('DAZN F1')).toBe('DAZN');
    expect(channelAbbrev('MOVISTAR PLUS +2')).toBe('MOVIST');
    expect(channelAbbrev('LA LIGA 1')).toBe('LA LIG');
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

  it('`label` cambia la etiqueta de la tesela; el tono y la cifra siguen saliendo del nombre', () => {
    const { container } = render(
      <ChannelMark name="Movistar LaLiga 2" size={54} shape="tile" label="New Era" />,
    );
    const mark = container.querySelector('.dorsal') as HTMLElement;
    const tag = container.querySelector('.dorsal__abbrev');
    expect(tag).toHaveTextContent('New Era');
    expect(tag).not.toHaveTextContent('MOVIST');
    expect(tag).not.toHaveClass('dorsal__abbrev--long');
    expect(container.querySelector('b')).toHaveTextContent('2');
    expect(parseOklch(mark.style.getPropertyValue('--tone'))?.h).toBe(
      hueFromName('Movistar LaLiga 2'),
    );
  });

  it('una etiqueta larga va entera (sin cortar a mitad de palabra) y con letra menor', () => {
    const { container } = render(
      <ChannelMark name="DAZN 1" shape="tile" label="Proveedor Muy Largo" />,
    );
    const tag = container.querySelector('.dorsal__abbrev');
    expect(tag).toHaveTextContent('Proveedor Muy Largo');
    expect(tag).toHaveClass('dorsal__abbrev--long');
  });

  it('una etiqueta vacía vuelve a la sigla; en `round` no hay etiqueta', () => {
    const tile = render(<ChannelMark name="DAZN 1" shape="tile" label="  " />);
    expect(tile.container.querySelector('.dorsal__abbrev')).toHaveTextContent('DAZN');
    const round = render(<ChannelMark name="DAZN 1" label="Elcano" />);
    expect(round.container.querySelector('.dorsal__abbrev')).toBeNull();
  });
});
