/* Agenda híbrida sobre la agenda (guide-overlay.ts, docs/iptv.md §4.7):
   etiqueta, canal de la guía delante, hora movida, partidos añadidos y la
   agenda tal cual (el mismo objeto) si la guía no dice nada. */

import { describe, expect, it } from 'vitest';
import {
  FootballScheduleSchema,
  channelMatchScore,
  type FootballMatch,
  type FootballSchedule,
} from '@ace/shared';
import type { GuideAgendaResult } from '../iptv/types.js';
import {
  applyGuideAgenda,
  guideAgendaRequest,
  matchKickoff,
  withoutGuideInfo,
} from './guide-overlay.js';

/** Sábado 3 de octubre de 2026 (Madrid, UTC+2). */
const at = (hour: number, minute = 0, day = 3): number => Date.UTC(2026, 9, day, hour - 2, minute);
const NOW = at(12);

function fltv(
  id: string,
  home: string,
  away: string,
  start: number,
  channels: string[],
  competition = 'La Liga EA Sports',
): FootballMatch {
  const date = new Date(start + 2 * 3_600_000).toISOString().slice(0, 10);
  const time = new Date(start + 2 * 3_600_000).toISOString().slice(11, 16);
  return {
    id,
    date,
    time,
    start,
    title: `${home} - ${away}`,
    home,
    away,
    competition,
    country: 'España',
    channels: channels.map((name, index) => ({ id: `${id}-${index}`, name })),
  };
}

function schedule(matches: FootballMatch[]): FootballSchedule {
  const dates = ['2026-10-03', '2026-10-04', '2026-10-05'];
  return {
    generatedAt: '2026-10-03T10:00:00.000Z',
    timezone: 'Europe/Madrid',
    country: 'España',
    source: 'futbolenlatv',
    attribution: 'futbolenlatv.com',
    demo: false,
    limited: false,
    partial: false,
    days: dates.map((date) => ({ date, matches: matches.filter((m) => m.date === date) })),
  };
}

const RSO = fltv('fltv-rso', 'Real Sociedad', 'Villarreal', at(18, 30), ['DAZN LaLiga']);
const BET = fltv('fltv-bet', 'Real Betis', 'Athletic Club', at(21), [
  'M+ LaLiga TV',
  'LaLiga TV Bar',
]);
const MAN = fltv('fltv-man', 'Arsenal', 'Liverpool', at(17, 30, 5), ['DAZN 1'], 'Premier League');
const PAYLOAD = schedule([RSO, BET, MAN]);

const options = { sameChannel: (a: string, b: string) => channelMatchScore(a, b) };
const nothing: GuideAgendaResult = { confirmations: [], additions: [] };

function day(payload: FootballSchedule, date: string): FootballMatch[] {
  return payload.days.find((d) => d.date === date)?.matches ?? [];
}

describe('applyGuideAgenda', () => {
  it('sin nada de la guía: la misma agenda (el mismo objeto)', () => {
    expect(applyGuideAgenda(PAYLOAD, null, options)).toBe(PAYLOAD);
    expect(applyGuideAgenda(PAYLOAD, nothing, options)).toBe(PAYLOAD);
  });

  it('confirmado por un canal que la agenda no anuncia: etiqueta y ese canal el primero', () => {
    const result = applyGuideAgenda(
      PAYLOAD,
      {
        confirmations: [
          {
            matchId: 'fltv-rso',
            channels: ['M+ LaLiga TV 2'],
            start: RSO.start as number,
            moved: false,
          },
        ],
        additions: [],
      },
      options,
    );
    const rso = day(result, '2026-10-03').find((m) => m.id === 'fltv-rso');
    expect(rso?.guide).toEqual({ channel: 'M+ LaLiga TV 2', time: '18:30', added: false });
    expect(rso?.channels).toEqual([
      { id: 'fltv-rso-guia-0', name: 'M+ LaLiga TV 2' },
      { id: 'fltv-rso-0', name: 'DAZN LaLiga' },
    ]);
    expect(rso?.time).toBe('18:30');
    /* Lo demás, igual (los mismos objetos). */
    expect(day(result, '2026-10-03').find((m) => m.id === 'fltv-bet')).toBe(BET);
    expect(result.days[2]).toBe(PAYLOAD.days[2]);
    expect(FootballScheduleSchema.parse(result)).toEqual(result);
  });

  it('confirmado por un canal que la agenda ya anuncia: ese, con su nombre, pasa delante', () => {
    const result = applyGuideAgenda(
      PAYLOAD,
      {
        confirmations: [
          {
            matchId: 'fltv-bet',
            channels: ['LALIGA TV BAR'],
            start: BET.start as number,
            moved: false,
          },
        ],
        additions: [],
      },
      options,
    );
    const bet = day(result, '2026-10-03').find((m) => m.id === 'fltv-bet');
    expect(bet?.channels.map((c) => c.name)).toEqual(['LaLiga TV Bar', 'M+ LaLiga TV']);
    expect(bet?.guide?.channel).toBe('LaLiga TV Bar');
  });

  it('la guía mueve la hora: cambian hora y saque (no el id), con la que decía la agenda, y el orden del día', () => {
    const result = applyGuideAgenda(
      PAYLOAD,
      {
        confirmations: [
          { matchId: 'fltv-rso', channels: ['M+ LaLiga TV 2'], start: at(21, 15), moved: true },
        ],
        additions: [],
      },
      options,
    );
    const today = day(result, '2026-10-03');
    expect(today.map((m) => m.id)).toEqual(['fltv-bet', 'fltv-rso']);
    expect(today[1]).toMatchObject({
      id: 'fltv-rso',
      time: '21:15',
      start: at(21, 15),
      guide: { channel: 'M+ LaLiga TV 2', time: '21:15', agendaTime: '18:30', added: false },
    });
  });

  it('un partido que solo trae la guía entra en su día, con su competición de la agenda y id «guia-…»', () => {
    const result = applyGuideAgenda(
      PAYLOAD,
      {
        confirmations: [],
        additions: [
          {
            home: 'Girona',
            away: 'Sevilla',
            family: 'laliga',
            competition: 'LaLiga EA Sports',
            date: '2026-10-03',
            start: at(16, 15),
            channels: ['DAZN LaLiga', 'M+ LaLiga TV'],
          },
        ],
      },
      options,
    );
    const today = day(result, '2026-10-03');
    expect(today.map((m) => m.home)).toEqual(['Girona', 'Real Sociedad', 'Real Betis']);
    const added = today[0] as FootballMatch;
    expect(added.id).toMatch(/^guia-2026-10-03-[0-9a-f]{10}$/);
    expect(added).toMatchObject({
      date: '2026-10-03',
      time: '16:15',
      start: at(16, 15),
      title: 'Girona - Sevilla',
      competition: 'La Liga EA Sports',
      country: 'España',
      guide: { channel: 'DAZN LaLiga', time: '16:15', added: true },
    });
    expect(added.channels.map((c) => c.name)).toEqual(['DAZN LaLiga', 'M+ LaLiga TV']);
    expect(FootballScheduleSchema.parse(result)).toEqual(result);
  });

  it('una competición que la agenda no trae: el rótulo de la guía', () => {
    const result = applyGuideAgenda(
      PAYLOAD,
      {
        confirmations: [],
        additions: [
          {
            home: 'Inter',
            away: 'Napoli',
            family: 'seriea',
            competition: 'Serie A',
            date: '2026-10-04',
            start: at(20, 45, 4),
            channels: ['DAZN 2'],
          },
        ],
      },
      options,
    );
    expect(day(result, '2026-10-04')[0]?.competition).toBe('Serie A');
  });

  it('nunca el rótulo de la femenina o de la cantera de esa competición (salvo en Liga F)', () => {
    const champions = (competition: string) =>
      schedule([
        fltv('fltv-fem', 'Barcelona', 'Lyon', at(18, 45), ['DAZN'], competition),
        fltv(
          'fltv-cl',
          'Arsenal',
          'PSG',
          at(21, 0, 4),
          ['M+ Liga de Campeones'],
          'Liga de Campeones',
        ),
      ]);
    const addition = {
      home: 'Real Madrid',
      away: 'Inter',
      family: 'champions' as const,
      competition: 'Champions League',
      date: '2026-10-03',
      start: at(21),
      channels: ['M+ Liga de Campeones 2'],
    };
    for (const competition of [
      'Liga de Campeones Femenina',
      'UEFA Champions League Femenina',
      'UEFA Youth League',
      'Liga de Campeones Sub-19',
    ]) {
      const result = applyGuideAgenda(
        champions(competition),
        { confirmations: [], additions: [addition] },
        options,
      );
      const added = day(result, '2026-10-03').find((m) => m.home === 'Real Madrid');
      /* El de la agenda para el primer equipo, aunque salga después. */
      expect(added?.competition, competition).toBe('Liga de Campeones');
    }
    /* Sin otro de esa familia en la agenda: el rótulo de la guía. */
    const alone = applyGuideAgenda(
      schedule([
        fltv('fltv-fem', 'Barcelona', 'Lyon', at(18, 45), ['DAZN'], 'Liga de Campeones Femenina'),
      ]),
      { confirmations: [], additions: [addition] },
      options,
    );
    expect(day(alone, '2026-10-03').find((m) => m.home === 'Real Madrid')?.competition).toBe(
      'Champions League',
    );
    /* Un partido de Liga F que añade la guía sí lleva el rótulo de Liga F de la agenda. */
    const ligaF = applyGuideAgenda(
      schedule([fltv('fltv-lf', 'Levante', 'Sevilla', at(12), ['DAZN'], 'Liga F Moeve')]),
      {
        confirmations: [],
        additions: [{ ...addition, family: 'ligaf', competition: 'Liga F', home: 'Barcelona' }],
      },
      options,
    );
    expect(day(ligaF, '2026-10-03').find((m) => m.home === 'Barcelona')?.competition).toBe(
      'Liga F Moeve',
    );
  });
});

describe('guideAgendaRequest', () => {
  it('hoy y mañana mandan; pasado solo para no repetir; el saque de la demo sale de fecha y hora', () => {
    const demo: FootballMatch = { ...RSO, id: 'demo-4', start: undefined } as FootballMatch;
    delete (demo as { start?: number }).start;
    const request = guideAgendaRequest(schedule([demo, BET, MAN]), NOW);
    expect(request.dates).toEqual(['2026-10-03', '2026-10-04']);
    expect(request.matches.map((m) => [m.id, m.start, m.channels])).toEqual([
      ['demo-4', at(18, 30), ['DAZN LaLiga']],
      ['fltv-bet', at(21), ['M+ LaLiga TV', 'LaLiga TV Bar']],
      ['fltv-man', at(17, 30, 5), ['DAZN 1']],
    ]);
    expect(request.key).toBe('2026-10-03T10:00:00.000Z|2026-10-03');
    expect(request.dateOf(at(23, 59))).toBe('2026-10-03');
    expect(matchKickoff({ date: '2026-10-03', time: 'Por confirmar' })).toBe(null);
  });
});

describe('withoutGuideInfo (ruta antigua)', () => {
  it('quita `guide` y deja lo demás; sin guía, el mismo objeto', () => {
    expect(withoutGuideInfo(PAYLOAD)).toBe(PAYLOAD);
    const hybrid = applyGuideAgenda(
      PAYLOAD,
      {
        confirmations: [
          { matchId: 'fltv-rso', channels: ['M+ LaLiga TV 2'], start: at(21, 15), moved: true },
        ],
        additions: [],
      },
      options,
    );
    const legacy = withoutGuideInfo(hybrid);
    const rso = day(legacy, '2026-10-03').find((m) => m.id === 'fltv-rso');
    expect(rso && 'guide' in rso).toBe(false);
    expect(rso?.time).toBe('21:15');
    expect(rso?.channels[0]?.name).toBe('M+ LaLiga TV 2');
  });
});
