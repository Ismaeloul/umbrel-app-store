import { describe, expect, it } from 'vitest';
import { matchGlow, signalTone, signalWord, versusSide, versusWhen } from './cards.ts';
import { liveScore, matchAt, NOW, TODAY } from './test-utils.tsx';

describe('tarjeta versus: lados', () => {
  it('nombre completo, o las siglas en la compacta, con la paleta ya resuelta', () => {
    const match = matchAt(30, {
      home: 'Real Madrid',
      away: 'Girona',
      homeTeam: {
        id: 'k-real-madrid',
        name: 'Real Madrid',
        short: 'RMA',
        crest: '/api/v1/football/teams/k-real-madrid/crest?v=1',
        colors: { primary: '#febe10', secondary: '#1a1a5e' },
      },
    });
    const home = versusSide(match, 'home');
    expect(home.name).toBe('Real Madrid');
    expect(home.short).toBe('RMA');
    expect(home.colors?.primary).toBe('#febe10');
    expect(home.crest).toBe('/api/v1/football/teams/k-real-madrid/crest?v=1');
    expect(versusSide(match, 'home', { short: true }).name).toBe('RMA');
    // Sin datos del backend: iniciales del nombre y un color sacado del nombre.
    const away = versusSide(match, 'away', { short: true });
    expect(away.name).toBe('GIR');
    expect(away.crest).toBeNull();
    expect(away.colors?.primary).toMatch(/^#[0-9a-f]{6}$/);
    // La compacta y la grande pintan el MISMO color aunque el texto cambie.
    expect(away.colors?.primary).toBe(versusSide(match, 'away').colors?.primary);
  });

  it('sin visitante, el local es el título del partido', () => {
    const match = matchAt(30, { home: '', away: '', title: 'Copa: final' });
    expect(versusSide(match, 'home').name).toBe('Copa: final');
    expect(versusSide(match, 'away').name).toBe('…');
  });
});

describe('tarjeta versus: chip de cuándo', () => {
  it('hora con el día, directo con minuto, descanso, final y por confirmar', () => {
    expect(versusWhen(matchAt(30), NOW, null, TODAY)).toEqual({
      kind: 'time',
      label: 'Hoy 21:00',
    });
    expect(versusWhen(matchAt(24 * 60), NOW, null, TODAY).label).toBe('Mañana 20:30');
    expect(versusWhen(matchAt(-30), NOW, liveScore(1, 0, "31'"), TODAY)).toEqual({
      kind: 'live',
      label: 'En directo',
      minute: '31',
    });
    expect(versusWhen(matchAt(-30), NOW, null, TODAY)).toEqual({
      kind: 'live',
      label: 'En directo',
    });
    expect(versusWhen(matchAt(-50), NOW, liveScore(0, 0, '', 'HT'), TODAY)).toEqual({
      kind: 'live',
      label: 'Descanso',
    });
    expect(versusWhen(matchAt(-200), NOW, null, TODAY)).toEqual({ kind: 'done', label: 'Final' });
    expect(versusWhen({ ...matchAt(60), time: 'Por confirmar' }, NOW, null, TODAY)).toEqual({
      kind: 'tbc',
      label: 'Por confirmar',
    });
  });
});

describe('cápsula de señal del partido', () => {
  it('«Señal» con fuentes verificadas; la etiqueta propia manda', () => {
    expect(signalWord({ state: 'ok' })).toBe('Señal');
    expect(signalWord({ state: 'weak' })).toBe('Floja');
    expect(signalWord({ state: 'fail' })).toBe('Sin señal');
    expect(signalWord({ state: 'checking' })).toBe('Comprobando');
    expect(signalWord({ state: 'pending' })).toBe('Pendiente');
    expect(signalWord({ state: 'fail', label: 'Sin fuentes' })).toBe('Sin fuentes');
  });

  it('tono: semáforo para lo sabido, neutro mientras se comprueba', () => {
    expect(signalTone('ok')).toBe('ok');
    expect(signalTone('weak')).toBe('weak');
    expect(signalTone('fail')).toBe('fail');
    expect(signalTone('checking')).toBe('neutral');
    expect(signalTone('pending')).toBe('neutral');
  });
});

describe('luz de los clubes', () => {
  it('oklch() por lado; sin visitante repite la del local', () => {
    const match = matchAt(30, {
      home: 'Real Sociedad',
      away: 'Villarreal',
      homeTeam: {
        id: 'k-real-sociedad',
        name: 'Real Sociedad',
        short: 'RSO',
        crest: null,
        colors: { primary: '#0067b1', secondary: '#ffffff' },
      },
    });
    const glow = matchGlow(match);
    expect(glow.home).toMatch(/^oklch\(/);
    expect(glow.away).toMatch(/^oklch\(/);
    expect(glow.home).not.toBe(glow.away);
    const solo = matchAt(30, { away: '' });
    expect(matchGlow(solo).away).toBe(matchGlow(solo).home);
  });
});
