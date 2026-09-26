/* La guía para encontrar el canal del partido (docs/iptv.md §4.5): mejor no
   emparejar que emparejar mal. Formatos reales de Movistar y DAZN,
   anonimizados. */

import { describe, expect, it } from 'vitest';
import { channelMatchScore } from '@ace/shared';
import {
  competitionFamily,
  confirmByGuide,
  isNotLive,
  teamAliases,
  type GuideChannelCandidate,
  type GuideMatchInput,
  type GuideProgramme,
} from './guide-match.js';

const MIN = 60_000;
const KICKOFF = Date.UTC(2026, 8, 26, 16, 30);

function programme(title: string, extra: Partial<GuideProgramme> = {}): GuideProgramme {
  return {
    start: KICKOFF - 5 * MIN,
    stop: KICKOFF + 115 * MIN,
    title,
    subTitle: '',
    desc: '',
    categories: [],
    previouslyShown: false,
    live: false,
    ...extra,
  };
}

function channel(
  display: string,
  programmes: GuideProgramme[],
  country: string | null = 'ES',
): GuideChannelCandidate {
  return { key: display.toLowerCase(), display, country, programmes };
}

const MATCH: GuideMatchInput = {
  home: 'Real Sociedad',
  away: 'Villarreal',
  competition: 'LaLiga',
  start: KICKOFF,
  channels: ['DAZN LaLiga'],
};

const agendaScore = (display: string): number =>
  MATCH.channels.reduce((max, c) => Math.max(max, channelMatchScore(c, display)), 0);

function confirmed(candidates: GuideChannelCandidate[], input: GuideMatchInput = MATCH): string[] {
  return confirmByGuide(input, candidates, { agendaScore }).map((item) => item.display);
}

describe('confirmByGuide', () => {
  it('partido en directo confirmado aunque la agenda anuncie otro canal (formato Movistar)', () => {
    expect(
      confirmed([
        channel('M+ LaLiga TV 2', [
          programme('LaLiga EA Sports. Jornada 7: Real Sociedad - Villarreal'),
        ]),
      ]),
    ).toEqual(['M+ LaLiga TV 2']);
  });

  it('formatos habituales: «vs», «v», «×», en el subtítulo o en la descripción', () => {
    for (const p of [
      programme('Fútbol', { subTitle: 'Real Sociedad vs. Villarreal CF' }),
      programme('LaLiga', { desc: 'Jornada 7. Real Sociedad v Villarreal, desde el Reale Arena.' }),
      programme('Real Sociedad × Villarreal'),
      programme('R. Sociedad - Villarreal'.replace('R. ', 'Real ')),
    ]) {
      expect(confirmed([channel('M+ LaLiga TV 2', [p])])).toEqual(['M+ LaLiga TV 2']);
    }
  });

  it('(R), Resumen, Previa y Diferido no cuentan; tampoco previously-shown ni noticias', () => {
    for (const p of [
      programme('(R) Real Sociedad - Villarreal'),
      programme('Resumen: Real Sociedad - Villarreal'),
      programme('Previa: Real Sociedad - Villarreal'),
      programme('Real Sociedad - Villarreal (diferido)'),
      programme('Real Sociedad - Villarreal', { previouslyShown: true }),
      programme('Real Sociedad - Villarreal', { categories: ['News'] }),
      programme('R: Real Sociedad - Villarreal'),
    ]) {
      expect(isNotLive(p) || confirmed([channel('M+ LaLiga TV 2', [p])]).length === 0).toBe(true);
      expect(confirmed([channel('M+ LaLiga TV 2', [p])])).toEqual([]);
    }
  });

  it('hora fuera de ventana: repetición a la mañana siguiente, empieza tarde, dura poco', () => {
    for (const p of [
      programme('Real Sociedad - Villarreal', {
        start: KICKOFF + 16 * 60 * MIN,
        stop: KICKOFF + 18 * 60 * MIN,
      }),
      programme('Real Sociedad - Villarreal', {
        start: KICKOFF + 20 * MIN,
        stop: KICKOFF + 130 * MIN,
      }),
      programme('Real Sociedad - Villarreal', {
        start: KICKOFF - 40 * MIN,
        stop: KICKOFF + 100 * MIN,
      }),
      programme('Real Sociedad - Villarreal', { start: KICKOFF, stop: KICKOFF + 60 * MIN }),
    ]) {
      expect(confirmed([channel('M+ LaLiga TV 2', [p])])).toEqual([]);
    }
  });

  it('filiales y femeninos no cuentan', () => {
    const barca: GuideMatchInput = { ...MATCH, home: 'FC Barcelona', away: 'Real Madrid' };
    for (const title of [
      'Barcelona B - Real Madrid',
      'Barcelona - Real Madrid Castilla',
      'FC Barcelona Femenino - Real Madrid',
      'Barça Atlètic - Real Madrid',
      'Barcelona - Real Madrid Sub-19',
    ]) {
      expect(confirmed([channel('M+ LaLiga TV', [programme(title)])], barca)).toEqual([]);
    }
    expect(confirmed([channel('M+ LaLiga TV', [programme('Barça - Real Madrid')])], barca)).toEqual(
      ['M+ LaLiga TV'],
    );
    const sevilla: GuideMatchInput = { ...MATCH, home: 'Sevilla', away: 'Real Betis' };
    expect(
      confirmed(
        [channel('M+ LaLiga TV', [programme('Sevilla Atlético - Betis Deportivo')])],
        sevilla,
      ),
    ).toEqual([]);
    expect(confirmed([channel('M+ LaLiga TV', [programme('Sevilla - Betis')])], sevilla)).toEqual([
      'M+ LaLiga TV',
    ]);
    const athletic: GuideMatchInput = { ...MATCH, home: 'Athletic Club', away: 'Osasuna' };
    expect(
      confirmed([channel('M+ LaLiga TV', [programme('Bilbao Athletic - Osasuna')])], athletic),
    ).toEqual([]);
    expect(
      confirmed([channel('M+ LaLiga TV', [programme('Athletic - Osasuna')])], athletic),
    ).toEqual(['M+ LaLiga TV']);
  });

  it('texto de otra competición: fuera; sin competición en el texto, solo si la nombra el canal', () => {
    expect(
      confirmed([
        channel('M+ LaLiga TV 2', [programme('UEFA Champions League: Real Sociedad - Villarreal')]),
      ]),
    ).toEqual([]);
    expect(
      confirmed([channel('M+ LaLiga TV 2', [programme('Real Sociedad - Villarreal')])]),
    ).toEqual(['M+ LaLiga TV 2']);
    /* Canal generalista: sin la competición en la guía, no se confirma. */
    expect(confirmed([channel('La 1', [programme('Real Sociedad - Villarreal')])])).toEqual([]);
    expect(confirmed([channel('DAZN 1', [programme('Real Sociedad - Villarreal')])])).toEqual([]);
    expect(
      confirmed([
        channel('DAZN 1', [programme('Real Sociedad - Villarreal', { categories: ['LaLiga'] })]),
      ]),
    ).toEqual(['DAZN 1']);
    /* Dos familias a la vez: dudoso, fuera. */
    expect(
      confirmed([
        channel('DAZN 1', [
          programme('LaLiga: Real Sociedad - Villarreal', {
            desc: 'Tras su partido de Champions…',
          }),
        ]),
      ]),
    ).toEqual([]);
  });

  it('mismos equipos en otro deporte, en el femenino o en categorías inferiores: fuera (LaLiga, DAZN LaLiga, ES)', () => {
    const clasico: GuideMatchInput = {
      ...MATCH,
      home: 'Real Madrid',
      away: 'FC Barcelona',
      channels: ['DAZN LaLiga'],
    };
    const dazn = (p: GuideProgramme): string[] => confirmed([channel('DAZN LaLiga', [p])], clasico);
    for (const title of [
      'Baloncesto: Real Madrid - Barcelona',
      'ACB: Real Madrid - Barça',
      'Liga Endesa: Real Madrid - Barça',
      'Euroliga: Real Madrid - Barcelona',
      'Futsal: Real Madrid - Barcelona',
      'Fútbol sala: Real Madrid - Barcelona',
      'Balonmano: Barça - Real Madrid',
      'Fútbol femenino: Real Madrid - Barcelona',
      'Real Madrid - Barcelona (Femenino)',
      'Real Madrid - Barcelona (Fem.)',
      'Real Madrid - Barcelona SC',
      'UEFA Youth League: Real Madrid - Barcelona',
      'Real Madrid - Barcelona (Dif.)',
      'Real Madrid - Barcelona Sub-19',
    ]) {
      expect(dazn(programme(title)), title).toEqual([]);
    }
    expect(dazn(programme('Real Madrid - Barcelona', { categories: ['Baloncesto'] }))).toEqual([]);
    expect(
      dazn(programme('Real Madrid - Barcelona', { desc: 'Jornada 5 de la Liga F Moeve.' })),
    ).toEqual([]);
    /* El de verdad sí. */
    expect(dazn(programme('LaLiga EA Sports: Real Madrid - Barcelona'))).toEqual(['DAZN LaLiga']);
    expect(dazn(programme('Real Madrid - Barcelona'))).toEqual(['DAZN LaLiga']);
    /* Un partido de Liga F casa con su programa aunque diga «femenino». */
    const ligaF: GuideMatchInput = { ...clasico, competition: 'Liga F', channels: [] };
    expect(
      confirmed(
        [
          channel('DAZN 1', [
            programme('Liga F: Real Madrid - Barcelona', { categories: ['Fútbol femenino'] }),
          ]),
        ],
        ligaF,
      ),
    ).toEqual(['DAZN 1']);
  });

  it('canal de otra competición («M+ Liga de Campeones» con un partido de LaLiga) o Hypermotion con Primera: fuera', () => {
    const shows = [programme('Real Sociedad - Villarreal')];
    expect(confirmed([channel('M+ Liga de Campeones', shows)])).toEqual([]);
    expect(confirmed([channel('LaLiga TV Hypermotion', shows)])).toEqual([]);
    expect(confirmed([channel('Liga F', shows)])).toEqual([]);
    const segunda: GuideMatchInput = {
      ...MATCH,
      competition: 'LaLiga Hypermotion',
      home: 'Racing de Santander',
      away: 'Real Oviedo',
    };
    const segundaShows = [programme('Racing Santander - Real Oviedo')];
    expect(confirmed([channel('DAZN LaLiga', segundaShows)], segunda)).toEqual([]);
    expect(confirmed([channel('LaLiga TV Hypermotion', segundaShows)], segunda)).toEqual([
      'LaLiga TV Hypermotion',
    ]);
    /* Generalistas: pasan si la guía nombra la competición. */
    expect(confirmed([channel('La 1', [programme('LaLiga: Real Sociedad - Villarreal')])])).toEqual(
      ['La 1'],
    );
  });

  it('canal sin país: solo si casa con la agenda; extranjero: nunca', () => {
    const shows = [programme('Real Sociedad - Villarreal')];
    expect(confirmed([channel('Sport TV 1', shows, null)])).toEqual([]);
    expect(confirmed([channel('DAZN LaLiga', shows, null)])).toEqual(['DAZN LaLiga']);
    expect(confirmed([channel('DAZN LaLiga', shows, 'UK')])).toEqual([]);
    /* Sin canales en la agenda, solo ES explícito. */
    expect(confirmed([channel('DAZN LaLiga', shows, null)], { ...MATCH, channels: [] })).toEqual(
      [],
    );
    expect(confirmed([channel('M+ LaLiga TV 2', shows)], { ...MATCH, channels: [] })).toEqual([
      'M+ LaLiga TV 2',
    ]);
  });

  it('más de 3 canales distintos: solo los que casan con la agenda; si ninguno, nada', () => {
    const shows = [programme('LaLiga: Real Sociedad - Villarreal')];
    const four = ['M+ LaLiga TV', 'M+ LaLiga TV 2', 'M+ Vamos', 'La 1'].map((name) =>
      channel(name, shows),
    );
    expect(confirmed(four)).toEqual([]);
    expect(confirmed([...four, channel('DAZN LaLiga', shows)])).toEqual(['DAZN LaLiga']);
  });

  it('abreviaturas solo en el patrón compacto AAA-BBB y con las dos como abreviatura', () => {
    const input: GuideMatchInput = { ...MATCH, homeAliases: ['RSO'], awayAliases: ['VIL'] };
    expect(confirmed([channel('M+ LaLiga TV 2', [programme('RSO-VIL')])], input)).toEqual([
      'M+ LaLiga TV 2',
    ]);
    expect(confirmed([channel('M+ LaLiga TV 2', [programme('RSO y otros - VIL')])], input)).toEqual(
      [],
    );
    expect(confirmed([channel('M+ LaLiga TV 2', [programme('RSO-VIL')])])).toEqual([]);
  });

  it('entre dos válidos, el que dice «directo» va primero', () => {
    const list = confirmByGuide(
      { ...MATCH, channels: [] },
      [
        channel('M+ LaLiga TV', [programme('Real Sociedad - Villarreal')]),
        channel('M+ LaLiga TV 2', [programme('Real Sociedad - Villarreal', { live: true })]),
      ],
      { agendaScore: () => 0 },
    );
    expect(list.map((item) => item.display)).toEqual(['M+ LaLiga TV 2', 'M+ LaLiga TV']);
  });
});

/* Formas de la guía de una lista pública de canales en abierto (títulos «Competición: A - B», categoría
   SPORTS), con un partido de fútbol inventado a la misma hora y con los mismos nombres. */
describe('guía de canales en abierto: nada por error', () => {
  const at = (
    home: string,
    away: string,
    competition: string,
    title: string,
    minutes = 115,
  ): string[] =>
    confirmByGuide(
      { home, away, competition, start: KICKOFF, channels: ['Deportes Uno'] },
      [
        channel('Deportes Uno', [
          programme(title, { categories: ['SPORTS'], stop: KICKOFF - 5 * MIN + minutes * MIN }),
        ]),
      ],
      { agendaScore: () => 100 },
    ).map((item) => item.display);

  it('resúmenes de 15 min, fútbol sala, baloncesto y balonmano femenino: no', () => {
    expect(
      at(
        'Girona',
        'Albacete',
        'LaLiga Hypermotion',
        'Resúmenes LALIGA HyperMotion: Girona - Albacete BP',
        15,
      ),
    ).toEqual([]);
    expect(
      at(
        'Girona',
        'Albacete',
        'LaLiga Hypermotion',
        'Resúmenes LALIGA HyperMotion: Girona - Albacete BP',
      ),
    ).toEqual([]);
    expect(
      at('Real Jaén', 'Inter', 'Segunda Federación', 'Liga Prime Futsal: Jaén - Inter'),
    ).toEqual([]);
    expect(
      at(
        'Real Zaragoza',
        'Valencia',
        'LaLiga Hypermotion',
        'Supercopa LF Endesa: Casademont Zaragoza - Valencia Basket',
      ),
    ).toEqual([]);
    expect(
      at(
        'CD Tenerife',
        'Real Zaragoza',
        'LaLiga Hypermotion',
        'Liga Endesa: La Laguna Tenerife - Basket Zaragoza',
      ),
    ).toEqual([]);
    expect(
      at('España', 'Alemania', 'Partido amistoso', 'Amistoso de balonmano F: España - Alemania'),
    ).toEqual([]);
  });

  it('Liga F con un partido masculino: no; una repetición de 30 min sin marca: no', () => {
    expect(
      at('SD Logroñés', 'FC Barcelona', 'LaLiga EA Sports', 'Liga F: DUX Logroño - Barcelona'),
    ).toEqual([]);
    expect(
      at(
        'Inglaterra',
        'España',
        'UEFA Nations League',
        'UEFA Nations League: Inglaterra - España',
        30,
      ),
    ).toEqual([]);
  });

  it('el partido de verdad sí: Nations League en directo y el Mundial Sub-20 femenino con su partido', () => {
    expect(
      at(
        'Inglaterra',
        'España',
        'UEFA Nations League',
        'UEFA Nations League: Inglaterra - España',
        125,
      ),
    ).toEqual(['Deportes Uno']);
    expect(
      at(
        'España',
        'Corea del Norte',
        'FIFA Mundial Femenino Sub-20',
        'Mundial Sub-20 F: España - Corea del Norte',
      ),
    ).toEqual(['Deportes Uno']);
    expect(
      at(
        'CD Tenerife',
        'Cádiz CF',
        'LaLiga Hypermotion',
        'LALIGA HYPERMOTION: CD Tenerife - Cádiz CF',
      ),
    ).toEqual(['Deportes Uno']);
  });
});

describe('piezas', () => {
  it('alias de equipos sin los débiles', () => {
    expect(teamAliases('Real Madrid')).toEqual(['real madrid']);
    expect(teamAliases('Real Betis')).toContain('betis');
    expect(teamAliases('Atlético de Madrid')).toContain('atleti');
    expect(teamAliases('Atlético de Madrid')).not.toContain('atletico');
    expect(teamAliases('Racing de Santander')).not.toContain('racing');
  });

  it('familias de competición', () => {
    expect(competitionFamily('LaLiga EA Sports')).toBe('laliga');
    expect(competitionFamily('LaLiga Hypermotion')).toBe('hypermotion');
    expect(competitionFamily('M+ Liga de Campeones')).toBe('champions');
    expect(competitionFamily('DAZN 1')).toBe(null);
    expect(competitionFamily('Liga F Moeve')).toBe('ligaf');
  });
});
