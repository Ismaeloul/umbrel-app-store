/* Agenda híbrida (docs/iptv.md §4.7): la guía confirma, mueve la hora con
   la marca de directo y añade solo lo que es de verdad un partido en directo
   que la agenda no trae. Formatos de las guías de Movistar y DAZN,
   inventados. */

import { describe, expect, it } from 'vitest';
import { isoDateInMadrid } from '../football/time.js';
import {
  guideAgenda,
  guideAgendaFrom,
  prepareGuideAgenda,
  type GuideAgendaMatch,
  type GuideAgendaRequest,
  type GuideAgendaResult,
} from './guide-agenda.js';
import type { GuideChannelCandidate, GuideProgramme } from './guide-match.js';
import { agendaScorer, guideHints } from './layer.js';

describe('guideHints', () => {
  it('dos pistas como mucho y un canal una vez (el de bar o el UHD no gastan otra)', () => {
    expect(
      guideHints(['M+ LaLiga TV', 'M+ LaLiga TV Bar', 'M+ LaLiga TV UHD', 'DAZN LaLiga']),
    ).toEqual(['M+ LaLiga TV', 'DAZN LaLiga']);
    expect(guideHints(['M+ LaLiga TV 2', 'DAZN LaLiga', 'La 1'])).toEqual([
      'M+ LaLiga TV 2',
      'DAZN LaLiga',
    ]);
    expect(guideHints([])).toEqual([]);
  });
});

const MIN = 60_000;
const HOUR = 60 * MIN;
/** Sábado 3 de octubre de 2026, 18:30 en Madrid (UTC+2). */
const KICKOFF = Date.UTC(2026, 9, 3, 16, 30);
const TODAY = '2026-10-03';
const TOMORROW = '2026-10-04';

function programme(
  title: string,
  start: number,
  minutes = 120,
  extra: Partial<GuideProgramme> = {},
): GuideProgramme {
  return {
    start,
    stop: start + minutes * MIN,
    title,
    subTitle: '',
    desc: '',
    categories: [],
    previouslyShown: false,
    live: false,
    ...extra,
  };
}

const live = { live: true } as const;

function channel(
  display: string,
  programmes: GuideProgramme[],
  country: string | null = 'ES',
): GuideChannelCandidate {
  return { key: display.toLowerCase(), display, country, programmes };
}

function match(extra: Partial<GuideAgendaMatch> = {}): GuideAgendaMatch {
  return {
    id: 'fltv-1',
    date: TODAY,
    home: 'Real Sociedad',
    away: 'Villarreal',
    competition: 'La Liga EA Sports',
    title: 'Real Sociedad - Villarreal',
    start: KICKOFF,
    channels: ['DAZN LaLiga'],
    ...extra,
  };
}

function run(
  candidates: GuideChannelCandidate[],
  matches: GuideAgendaMatch[] = [match()],
  request: Partial<GuideAgendaRequest> = {},
): GuideAgendaResult {
  return guideAgenda(
    candidates,
    {
      matches,
      dates: [TODAY, TOMORROW],
      dateOf: isoDateInMadrid,
      key: 'k',
      ...request,
    },
    { agendaScorer },
  );
}

describe('guideAgenda: confirmar', () => {
  it('la guía confirma el partido y su canal exacto aunque la agenda anuncie otro', () => {
    const result = run([
      channel('M+ LaLiga TV 2', [
        programme('LaLiga EA Sports. Jornada 7: Real Sociedad - Villarreal', KICKOFF - 5 * MIN),
      ]),
    ]);
    expect(result.confirmations).toEqual([
      { matchId: 'fltv-1', channels: ['M+ LaLiga TV 2'], start: KICKOFF, moved: false },
    ]);
    expect(result.additions).toEqual([]);
  });

  it('un canal una vez (el de bar o el UHD no cuentan otra vez) y dos como mucho', () => {
    const show = (): GuideProgramme =>
      programme('LaLiga EA Sports: Real Sociedad - Villarreal', KICKOFF - 5 * MIN);
    const result = run(
      [
        channel('M+ LaLiga TV', [show()]),
        channel('M+ LaLiga TV Bar', [show()]),
        channel('DAZN LaLiga', [show()]),
      ],
      [match({ channels: ['M+ LaLiga TV', 'DAZN LaLiga'] })],
    );
    expect(result.confirmations[0]?.channels).toEqual(['M+ LaLiga TV', 'DAZN LaLiga']);
  });

  it('sin nada en la guía para ese partido, el partido queda tal cual (ni confirmado ni movido)', () => {
    const result = run([channel('La 1', [programme('Telediario', KICKOFF, 90)])]);
    expect(result).toEqual({ confirmations: [], additions: [] });
    expect(run([])).toEqual({ confirmations: [], additions: [] });
  });

  it('solo hoy y mañana: un partido de pasado mañana no se toca', () => {
    const later = KICKOFF + 48 * HOUR;
    const result = run(
      [channel('M+ LaLiga TV 2', [programme('LaLiga: Real Sociedad - Villarreal', later)])],
      [match({ date: '2026-10-05', start: later })],
    );
    expect(result.confirmations).toEqual([]);
  });

  it('un partido sin hora conocida no se toca', () => {
    const result = run(
      [channel('M+ LaLiga TV 2', [programme('LaLiga: Real Sociedad - Villarreal', KICKOFF)])],
      [match({ start: null })],
    );
    expect(result.confirmations).toEqual([]);
  });
});

describe('guideAgenda: mover la hora', () => {
  const late = KICKOFF + 2.5 * HOUR - 10 * MIN; // 20:50 en Madrid

  it('a su hora no hay nada y ese día la guía lo tiene EN DIRECTO a otra: manda la guía', () => {
    const result = run([
      channel('M+ LaLiga TV 2', [
        programme('LaLiga EA Sports: Real Sociedad - Villarreal', late, 125, live),
      ]),
    ]);
    expect(result.confirmations).toEqual([
      {
        matchId: 'fltv-1',
        channels: ['M+ LaLiga TV 2'],
        start: KICKOFF + 2.5 * HOUR,
        moved: true,
      },
    ]);
  });

  it('«(Directo)» en el título también vale como marca', () => {
    const result = run([
      channel('M+ LaLiga TV 2', [
        programme('LaLiga EA Sports: Real Sociedad - Villarreal (Directo)', late, 125),
      ]),
    ]);
    expect(result.confirmations[0]?.moved).toBe(true);
  });

  it('sin marca de directo no se mueve (podría ser una repetición)', () => {
    const result = run([
      channel('M+ LaLiga TV 2', [programme('LaLiga EA Sports: Real Sociedad - Villarreal', late)]),
    ]);
    expect(result.confirmations).toEqual([]);
  });

  it('si a su hora la guía ya lo confirma, no se mueve aunque luego haya otra emisión en directo', () => {
    const result = run([
      channel('M+ LaLiga TV 2', [
        programme('LaLiga: Real Sociedad - Villarreal', KICKOFF - 5 * MIN),
        programme('LaLiga: Real Sociedad - Villarreal', late, 125, live),
      ]),
    ]);
    expect(result.confirmations[0]).toMatchObject({ start: KICKOFF, moved: false });
  });

  it('a su hora solo la repetición sin marca y el directo antes, ese día: manda el directo', () => {
    const early = KICKOFF - 3 * HOUR - 5 * MIN; // 15:25 → 15:30
    const result = run([
      channel('M+ LaLiga TV 2', [
        programme('LaLiga: Real Sociedad - Villarreal (Directo)', early, 120),
        programme('LaLiga: Real Sociedad - Villarreal', KICKOFF - 5 * MIN, 120),
      ]),
    ]);
    expect(result.confirmations).toEqual([
      {
        matchId: 'fltv-1',
        channels: ['M+ LaLiga TV 2'],
        start: KICKOFF - 3 * HOUR,
        moved: true,
      },
    ]);
  });

  it('un directo que empieza mucho antes y acaba antes del final de un partido a esa hora: es de antes', () => {
    /* Agenda a las 18:30; la guía, en directo de 17:45 (o de 17:30) a 20:00: a las 18:30
       acabaría a las 20:20. Manda la guía (17:45 o 17:30). */
    for (const before of [45, 60]) {
      const result = run([
        channel('M+ LaLiga TV', [
          programme(
            'LaLiga: Real Sociedad - Villarreal (Directo)',
            KICKOFF - before * MIN,
            before + 90,
          ),
        ]),
      ]);
      expect(result.confirmations).toEqual([
        {
          matchId: 'fltv-1',
          channels: ['M+ LaLiga TV'],
          start: KICKOFF - before * MIN,
          moved: true,
        },
      ]);
    }
  });

  it('con la previa dentro y el partido entero después: confirma la hora de la agenda', () => {
    for (const [before, after] of [
      [30, 90],
      [45, 110],
      [60, 120],
    ] as const) {
      const result = run([
        channel('M+ LaLiga TV', [
          programme(
            'LaLiga: Real Sociedad - Villarreal (Directo)',
            KICKOFF - before * MIN,
            before + after,
          ),
        ]),
      ]);
      expect(result.confirmations).toEqual([
        { matchId: 'fltv-1', channels: ['M+ LaLiga TV'], start: KICKOFF, moved: false },
      ]);
    }
  });

  it('nunca a otro día', () => {
    const nextDay = KICKOFF + 24 * HOUR;
    const result = run([
      channel('M+ LaLiga TV 2', [
        programme('LaLiga: Real Sociedad - Villarreal', nextDay, 120, live),
      ]),
    ]);
    expect(result.confirmations).toEqual([]);
  });

  describe('la descripción nunca mueve un partido a la hora de otro (revisión)', () => {
    /* Sevilla - Betis a las 18:30 en DAZN LaLiga; el Clásico a las 21:00 en M+ LaLiga TV. La
       guía del derbi, en directo, anuncia el Clásico en su descripción (las guías reales traen
       descripción en todos los programas). */
    const derbi = match({
      id: 'fltv-derbi',
      home: 'Sevilla',
      away: 'Real Betis',
      title: 'Sevilla - Real Betis',
      channels: ['DAZN LaLiga'],
    });
    const clasico = match({
      id: 'fltv-clasico',
      home: 'Real Madrid',
      away: 'Barcelona',
      title: 'Real Madrid - Barcelona',
      start: KICKOFF + 2.5 * HOUR,
      channels: ['M+ LaLiga TV'],
    });
    const derbiShow = (display = 'DAZN LaLiga'): GuideChannelCandidate =>
      channel(display, [
        programme('LaLiga EA Sports: Sevilla - Betis (Directo)', KICKOFF - 5 * MIN, 125, {
          desc: 'Jornada 8 desde el Sánchez-Pizjuán. Esta noche, Real Madrid - Barcelona en M+ LaLiga TV.',
        }),
      ]);
    const nine = KICKOFF + 2.5 * HOUR - 5 * MIN; // 20:55

    it('a su hora la guía no lo confirma (otro título o sin marca): ni se mueve ni coge el canal del otro', () => {
      for (const title of ['El Clásico (Directo)', 'Fútbol']) {
        const result = run(
          [derbiShow(), channel('M+ LaLiga TV', [programme(title, nine, 125)])],
          [derbi, clasico],
        );
        expect(result.confirmations, title).toEqual([
          { matchId: 'fltv-derbi', channels: ['DAZN LaLiga'], start: KICKOFF, moved: false },
        ]);
      }
    });

    it('a su hora el partido sin marca y antes un directo que solo lo nombra en la descripción: se queda a su hora', () => {
      for (const display of ['DAZN LaLiga', 'M+ LaLiga TV']) {
        const result = run(
          [
            derbiShow(display),
            channel('M+ LaLiga TV', [
              programme('LaLiga EA Sports: Real Madrid - Barcelona', nine, 125),
            ]),
          ],
          [derbi, { ...clasico, channels: [display === 'DAZN LaLiga' ? 'M+ LaLiga TV' : display] }],
        );
        expect(
          result.confirmations.find((item) => item.matchId === 'fltv-clasico'),
          display,
        ).toEqual({
          matchId: 'fltv-clasico',
          channels: ['M+ LaLiga TV'],
          start: KICKOFF + 2.5 * HOUR,
          moved: false,
        });
      }
    });

    it('un directo sin enfrentamiento en el título que solo lo nombra en la descripción no lo mueve', () => {
      const result = run([
        channel('M+ LaLiga TV 2', [
          programme('Fútbol (Directo)', KICKOFF - 3 * HOUR - 5 * MIN, 120, {
            desc: 'LaLiga EA Sports: Real Sociedad - Villarreal desde Anoeta.',
          }),
        ]),
      ]);
      expect(result.confirmations).toEqual([]);
    });

    it('a la misma hora, el programa de otro partido no confirma este por su descripción', () => {
      const result = run(
        [
          derbiShow(),
          channel('M+ LaLiga TV', [
            programme(
              'LaLiga EA Sports: Real Madrid - Barcelona (Directo)',
              KICKOFF - 5 * MIN,
              125,
            ),
          ]),
        ],
        [derbi, { ...clasico, start: KICKOFF }],
      );
      expect(result.confirmations).toEqual([
        { matchId: 'fltv-derbi', channels: ['DAZN LaLiga'], start: KICKOFF, moved: false },
        { matchId: 'fltv-clasico', channels: ['M+ LaLiga TV'], start: KICKOFF, moved: false },
      ]);
    });

    it('sin enfrentamiento en el título, la descripción sigue confirmando a su hora (como en la resolución)', () => {
      const result = run(
        [
          channel('M+ LaLiga TV', [
            programme('El Clásico (Directo)', nine, 125, {
              desc: 'LaLiga EA Sports: Real Madrid - Barcelona desde el Bernabéu.',
            }),
          ]),
        ],
        [clasico],
      );
      expect(result.confirmations).toEqual([
        {
          matchId: 'fltv-clasico',
          channels: ['M+ LaLiga TV'],
          start: KICKOFF + 2.5 * HOUR,
          moved: false,
        },
      ]);
      /* Pero no la mueve a otra hora. */
      expect(run([derbiShow()], [{ ...clasico, start: KICKOFF + 4 * HOUR }]).confirmations).toEqual(
        [],
      );
    });
  });

  it('el primero del día si hay dos en directo', () => {
    const early = KICKOFF - 3 * HOUR - 5 * MIN; // 15:25 → 15:30
    const result = run([
      channel('M+ LaLiga TV 2', [programme('LaLiga: Real Sociedad - Villarreal', late, 125, live)]),
      channel('DAZN LaLiga', [programme('LaLiga: Real Sociedad - Villarreal', early, 125, live)]),
    ]);
    expect(result.confirmations[0]).toMatchObject({
      start: KICKOFF - 3 * HOUR,
      channels: ['DAZN LaLiga'],
      moved: true,
    });
  });
});

describe('guideAgenda: lo que solo trae la guía', () => {
  const girona = KICKOFF - 2 * HOUR - 20 * MIN; // 16:10 → 16:15

  it('un partido en directo que la agenda no trae se añade con su canal y su competición', () => {
    /* En el mismo canal que el de la agenda (DAZN LaLiga), que a su hora da el suyo. */
    const result = run([
      channel('DAZN LaLiga', [
        programme('LaLiga EA Sports. Jornada 7: Girona - Sevilla', girona, 125, live),
        programme('LaLiga EA Sports. Jornada 7: Real Sociedad - Villarreal', KICKOFF - 5 * MIN),
      ]),
    ]);
    expect(result.confirmations).toMatchObject([{ matchId: 'fltv-1', moved: false }]);
    expect(result.additions).toEqual([
      {
        home: 'Girona',
        away: 'Sevilla',
        family: 'laliga',
        competition: 'LaLiga EA Sports',
        date: TODAY,
        start: KICKOFF - 2 * HOUR - 15 * MIN,
        channels: ['DAZN LaLiga'],
      },
    ]);
  });

  it('la competición puede venir del canal si el texto no nombra ninguna', () => {
    const result = run([
      channel('M+ LaLiga TV', [programme('Girona - Sevilla', girona, 125, live)]),
    ]);
    expect(result.additions[0]).toMatchObject({ family: 'laliga', channels: ['M+ LaLiga TV'] });
  });

  it('el mismo partido en dos canales: uno, con los dos canales', () => {
    const result = run([
      channel('DAZN LaLiga', [programme('LaLiga: Girona - Sevilla', girona, 125, live)]),
      channel('M+ LaLiga TV', [programme('LaLiga: Girona FC - Sevilla FC', girona, 125, live)]),
    ]);
    expect(result.additions).toHaveLength(1);
    expect(result.additions[0]?.channels).toEqual(['DAZN LaLiga', 'M+ LaLiga TV']);
  });

  it('nada de repeticiones, resúmenes, previas, diferidos ni programas sin marca de directo', () => {
    for (const p of [
      programme('LaLiga: Girona - Sevilla', girona, 125),
      programme('(R) LaLiga: Girona - Sevilla', girona, 125, live),
      programme('Resumen LaLiga: Girona - Sevilla', girona, 125, live),
      programme('Previa LaLiga: Girona - Sevilla', girona, 125, live),
      programme('LaLiga: Girona - Sevilla (diferido)', girona, 125, live),
      programme('LaLiga: Girona - Sevilla', girona, 125, { live: true, previouslyShown: true }),
      programme('LaLiga: Girona - Sevilla', girona, 30, live),
    ]) {
      expect(run([channel('DAZN LaLiga', [p])]).additions).toEqual([]);
    }
  });

  it('ni otros deportes, ni filiales, ni cantera, ni femenino (salvo Liga F), ni sin competición conocida', () => {
    for (const title of [
      'Liga Endesa: Girona - Sevilla',
      'LaLiga: Girona B - Sevilla Atlético',
      'UEFA Youth League: Girona - Sevilla',
      'LaLiga: Girona Femení - Sevilla',
    ]) {
      expect(
        run([channel('DAZN LaLiga', [programme(title, girona, 125, live)])]).additions,
      ).toEqual([]);
    }
    /* «La 1» no nombra competición y el texto tampoco: no. */
    expect(
      run([channel('La 1', [programme('Girona - Sevilla', girona, 125, live)])]).additions,
    ).toEqual([]);
    /* Liga F en directo sí (es fútbol de la agenda, con su competición). */
    expect(
      run([channel('DAZN', [programme('Liga F: Barcelona - Real Madrid', girona, 120, live)])])
        .additions[0],
    ).toMatchObject({ family: 'ligaf', competition: 'Liga F' });
  });

  it('lo que se llama como una competición de fútbol sin ser el fútbol de la agenda: no (casos de la revisión)', () => {
    for (const [display, title, extra] of [
      ['DAZN 1', 'EHF Champions League: Barça - Veszprém', { categories: ['Deportes'] }],
      ['DAZN 1', 'Premier League Darts: Littler - Humphries', { categories: ['Deportes'] }],
      ['Eurosport 1', "Mundial de Snooker: Trump - O'Sullivan", {}],
      ['DAZN 1', 'Mundial de Fórmula 1: Hamilton - Verstappen', {}],
      ['M+ LaLiga TV', 'eLaLiga: Real Madrid - Barcelona', {}],
      ['DAZN 2', 'Premier League 2: Arsenal - Chelsea', {}],
      ['M+ LaLiga TV', 'Real Madrid Leyendas - Juventus Leyendas', {}],
      ['M+ LaLiga TV', 'LaLiga: Real Madrid - Barcelona. Partido amistoso de leyendas', {}],
      ['DAZN 1', 'Champions League: Real Madrid - Barcelona. Fútbol americano', {}],
      ['Teledeporte', 'Mundial de Fútbol 7: España - Portugal', {}],
      ['Teledeporte', 'Mundial de fútbol para ciegos: España - Brasil', {}],
      ['M+ LaLiga TV', 'LaLiga: Real Madrid - Barcelona. Partido benéfico', {}],
      /* Con categorías, alguna tiene que ser de deportes. */
      ['DAZN 1', 'Champions League: Real Madrid - Inter', { categories: ['Cine', 'Comedia'] }],
    ] as const) {
      expect(
        run([channel(display, [programme(title, girona, 120, { ...extra, live: true })])])
          .additions,
        title,
      ).toEqual([]);
    }
    /* El fútbol de verdad sigue entrando, con categoría de deportes o sin categorías. */
    for (const [display, title, extra] of [
      [
        'M+ Liga de Campeones',
        'Champions League: Real Madrid - Inter',
        { categories: ['Deportes', 'Fútbol'] },
      ],
      ['DAZN 1', 'Premier League: Arsenal - Chelsea', { categories: ['Sports'] }],
      ['La 1', 'Mundial: España - Portugal', {}],
    ] as const) {
      expect(
        run([channel(display, [programme(title, girona, 120, { ...extra, live: true })])])
          .additions,
        title,
      ).toHaveLength(1);
    }
  });

  it('solo canales de España', () => {
    for (const country of [null, 'PT']) {
      expect(
        run([
          channel(
            'Sport TV 1',
            [programme('LaLiga: Girona - Sevilla', girona, 125, live)],
            country,
          ),
        ]).additions,
      ).toEqual([]);
    }
  });

  it('el canal no puede nombrar otra competición', () => {
    expect(
      run([
        channel('M+ Liga de Campeones', [programme('LaLiga: Girona - Sevilla', girona, 125, live)]),
      ]).additions,
    ).toEqual([]);
  });

  it('si un equipo ya juega en la agenda ese día, el anterior o el siguiente (escrito como sea), no se añade', () => {
    const guide = [
      channel('DAZN LaLiga', [programme('LaLiga: Barça - Atleti', girona, 125, live)]),
    ];
    const barca = match({
      id: 'fltv-2',
      home: 'FC Barcelona',
      away: 'Atlético de Madrid',
      channels: ['DAZN LaLiga'],
    });
    expect(run(guide, [barca]).additions).toEqual([]);
    expect(
      run(guide, [{ ...barca, date: TOMORROW, start: KICKOFF + 24 * HOUR }]).additions,
    ).toEqual([]);
    expect(
      run(guide, [{ ...barca, away: 'Getafe', date: '2026-10-02', start: KICKOFF - 24 * HOUR }])
        .additions,
    ).toEqual([]);
    /* Dos días después no choca: se añade. */
    expect(
      run(guide, [{ ...barca, date: '2026-10-05', start: KICKOFF + 48 * HOUR }]).additions,
    ).toHaveLength(1);
  });

  it('los DOS equipos escritos de otra forma: a la misma hora no sale dos veces', () => {
    /* Guías reales contra futbolenlatv: con alias o siglas, la guía lo confirma. */
    for (const [competition, agendaHome, agendaAway, title] of [
      ['Serie A', 'Atalanta', 'Fiorentina', 'Serie A: Atalanta BC - ACF Fiorentina (Directo)'],
      [
        'Premier League',
        'Brighton & Hove Albion',
        'Tottenham Hotspur',
        'Premier League: Brighton - Spurs (Directo)',
      ],
      [
        'Premier League',
        'Wolverhampton Wanderers',
        'Nottingham Forest',
        'Premier League: Wolves - Nottingham (Directo)',
      ],
      ['Bundesliga', 'Colonia', 'Maguncia', 'Bundesliga: FC Köln - Mainz 05 (Directo)'],
      [
        'Bundesliga',
        'Borussia Mönchengladbach',
        'Eintracht Fráncfort',
        'Bundesliga: B. Mönchengladbach - Eintracht Frankfurt (Directo)',
      ],
    ] as const) {
      const result = run(
        [channel('DAZN 1', [programme(title, KICKOFF - 5 * MIN, 120)])],
        [
          match({
            home: agendaHome,
            away: agendaAway,
            title: `${agendaHome} - ${agendaAway}`,
            competition,
            channels: ['DAZN 1'],
          }),
        ],
      );
      expect(result.confirmations, title).toHaveLength(1);
      expect(result.additions, title).toEqual([]);
    }
  });

  describe('los dos equipos escritos de otra forma, sin alias que valga (revisión)', () => {
    const at = (display: string, title: string, start = KICKOFF - 5 * MIN): GuideChannelCandidate =>
      channel(display, [programme(title, start, 120, live)]);
    /* futbolenlatv en castellano; la guía, como en su país. Ningún alias los junta. */
    const shakhtar = match({
      home: 'Shajtar Donetsk',
      away: 'Dinamo de Kiev',
      title: 'Shajtar Donetsk - Dinamo de Kiev',
      competition: 'Liga de Campeones',
      channels: ['M+ Liga de Campeones 3'],
    });
    const guideShakhtar = 'Champions League: Shakhtar Donetsk - Dynamo Kyiv';

    it('en ese canal y a esa hora es ese partido (un canal da un partido a la vez)', () => {
      expect(run([at('M+ Liga de Campeones 3', guideShakhtar)], [shakhtar]).additions).toEqual([]);
      /* Aunque la agenda no diga la competición. */
      expect(
        run(
          [at('M+ Liga de Campeones 3', guideShakhtar)],
          [{ ...shakhtar, competition: 'Partido internacional' }],
        ).additions,
      ).toEqual([]);
    });

    it('la misma competición a la misma hora, sola, no basta: en una noche de Champions se añade el que falta', () => {
      const night = [
        ['Real Madrid', 'Juventus'],
        ['Liverpool', 'Bayern Múnich'],
        ['Inter de Milán', 'Arsenal'],
        ['PSG', 'Benfica'],
        ['Borussia Dortmund', 'Atalanta'],
        ['Manchester City', 'Celtic'],
        ['Ajax', 'Chelsea'],
        ['Barcelona', 'Oporto'],
      ].map(([home = '', away = ''], index) =>
        match({
          id: `fltv-c${index}`,
          home,
          away,
          title: `${home} - ${away}`,
          competition: 'Liga de Campeones',
          channels: [`M+ Liga de Campeones ${index + 1}`],
        }),
      );
      expect(
        run([at('M+ Liga de Campeones 9', 'Liga de Campeones: Galatasaray - Club Brujas')], night)
          .additions,
      ).toMatchObject([{ home: 'Galatasaray', away: 'Club Brujas', family: 'champions' }]);
      /* Un sábado de Premier: Arsenal - Chelsea en DAZN 1 y, a la vez, Everton - Fulham en DAZN 2. */
      expect(
        run(
          [at('DAZN 2', 'Premier League: Everton - Fulham')],
          [
            match({
              home: 'Arsenal',
              away: 'Chelsea',
              title: 'Arsenal - Chelsea',
              competition: 'Premier League',
              channels: ['DAZN 1'],
            }),
          ],
        ).additions,
      ).toMatchObject([{ home: 'Everton', away: 'Fulham' }]);
    });

    it('una palabra en común no basta: «Newcastle United» no es «Newcastle Jets» ni «Manchester City» es «Manchester United»', () => {
      expect(
        run(
          [at('M+ Liga de Campeones 2', 'Liga de Campeones: Newcastle United - Barcelona')],
          [
            match({
              home: 'Newcastle Jets',
              away: 'Sydney FC',
              title: 'Newcastle Jets - Sydney FC',
              competition: 'A-League',
              channels: ['Movistar Plus+'],
            }),
          ],
        ).additions,
      ).toHaveLength(1);
      expect(
        run(
          [at('DAZN 2', 'Premier League: Manchester City - Everton')],
          [
            match({
              home: 'Manchester United',
              away: 'Fulham',
              title: 'Manchester United - Fulham',
              competition: 'Premier League',
              channels: ['DAZN 1'],
              start: KICKOFF - 3 * HOUR,
            }),
          ],
        ).additions,
      ).toHaveLength(1);
    });

    it('los dos nombres se parecen, a la hora que sea: es ese partido', () => {
      /* «Sheffield Wed - Leeds Utd» y «Sheffield Wednesday - Leeds United», también dos horas antes. */
      for (const start of [KICKOFF - 5 * MIN, KICKOFF - 2 * HOUR - 15 * MIN]) {
        expect(
          run(
            [at('DAZN 2', 'Premier League: Sheffield Wed - Leeds Utd', start)],
            [
              match({
                home: 'Sheffield Wednesday',
                away: 'Leeds United',
                title: 'Sheffield Wednesday - Leeds United',
                competition: 'Championship',
                channels: ['Movistar Plus+'],
              }),
            ],
          ).additions,
        ).toEqual([]);
      }
    });

    it('uno se parece y es de la misma competición, ese día: es ese partido aunque la hora no cuadre', () => {
      /* «Kairat Almaty - Pafos» (futbolenlatv, a las 18:30) y «Qairat - Paphos» (la guía, a las 21:00, en otro canal). */
      const kairat = match({
        home: 'Kairat Almaty',
        away: 'Pafos',
        title: 'Kairat Almaty - Pafos',
        competition: 'Liga de Campeones',
        channels: ['M+ Liga de Campeones 4'],
      });
      const guide = [
        at(
          'M+ Liga de Campeones 6',
          'Liga de Campeones: Qairat - Paphos',
          KICKOFF + 2.5 * HOUR - 5 * MIN,
        ),
      ];
      expect(run(guide, [kairat]).additions).toEqual([]);
      /* De otra competición, sí se añade (uno parecido solo no basta). */
      expect(run(guide, [{ ...kairat, competition: 'Copa de Kazajistán' }]).additions).toHaveLength(
        1,
      );
    });

    it('con la hora de la agenda mal: en su mismo canal y de su competición, si a su hora el canal no da nada que pueda ser un partido, es ese partido', () => {
      /* La agenda lo pone a las 18:30 en M+ Liga de Campeones 3; la guía, a las 21:00 en ese canal. */
      const late = KICKOFF + 2.5 * HOUR - 5 * MIN;
      expect(
        run([at('M+ Liga de Campeones 3', guideShakhtar, late)], [shakhtar]).additions,
      ).toEqual([]);
      /* En un canal generalista, una película a la hora de la agenda no es un partido: tampoco. */
      expect(
        run(
          [
            channel('Movistar Plus+', [
              programme('Cine: Gladiator', KICKOFF - 5 * MIN, 150),
              programme(guideShakhtar, late, 120, live),
            ]),
          ],
          [{ ...shakhtar, channels: ['Movistar Plus+'] }],
        ).additions,
      ).toEqual([]);
      /* Si a la hora de la agenda el canal da algo que puede ser un partido, la hora de la agenda
         vale y lo de las 21:00 en ese canal es otro partido: se añade. */
      const other = 'Liga de Campeones: Galatasaray - Club Brujas';
      expect(
        run(
          [
            channel('M+ Liga de Campeones 3', [
              programme('Liga de Campeones (Directo)', KICKOFF - 5 * MIN, 120),
              programme(other, late, 120, live),
            ]),
          ],
          [shakhtar],
        ).additions,
      ).toMatchObject([{ home: 'Galatasaray' }]);
      /* Y si la guía confirma el de la agenda a su hora, también. */
      expect(
        run(
          [
            channel('M+ Liga de Campeones 3', [
              programme(
                'Liga de Campeones: Shajtar Donetsk - Dinamo de Kiev',
                KICKOFF - 5 * MIN,
                120,
              ),
              programme(other, late, 120, live),
            ]),
          ],
          [shakhtar],
        ),
      ).toMatchObject({ confirmations: [{ moved: false }], additions: [{ home: 'Galatasaray' }] });
    });
  });

  it('con alias de la Champions, la guía mueve la hora en vez de duplicar («Estrella Roja» es «Crvena Zvezda»)', () => {
    /* La agenda: Estrella Roja - Olympiacos a las 18:30; la guía, en su canal, a las 21:00 en directo. */
    const result = run(
      [
        channel('M+ Liga de Campeones 3', [
          programme(
            'Liga de Campeones: Crvena Zvezda - Olympiakos (Directo)',
            KICKOFF + 2.5 * HOUR - 5 * MIN,
            120,
          ),
        ]),
      ],
      [
        match({
          home: 'Estrella Roja',
          away: 'Olympiacos',
          title: 'Estrella Roja - Olympiacos',
          competition: 'Liga de Campeones',
          channels: ['M+ Liga de Campeones 3'],
        }),
      ],
    );
    expect(result).toEqual({
      confirmations: [
        {
          matchId: 'fltv-1',
          channels: ['M+ Liga de Campeones 3'],
          start: KICKOFF + 2.5 * HOUR,
          moved: true,
        },
      ],
      additions: [],
    });
  });

  it('un partido de la agenda movido por la guía no se añade otra vez', () => {
    const late = KICKOFF + 2.5 * HOUR - 10 * MIN;
    const result = run([
      channel('M+ LaLiga TV 2', [
        programme('LaLiga EA Sports: Real Sociedad - Villarreal', late, 125, live),
      ]),
    ]);
    expect(result.confirmations).toHaveLength(1);
    expect(result.additions).toEqual([]);
  });

  it('dos grafías del mismo partido el mismo día: uno', () => {
    const result = run([
      channel('DAZN LaLiga', [programme('LaLiga: Barça - R. Madrid', girona, 125, live)]),
      channel('M+ LaLiga TV', [
        programme('LaLiga: Barcelona - Real Madrid', girona + 5 * MIN, 125, live),
      ]),
    ]);
    expect(result.additions).toHaveLength(1);
  });

  it('solo hoy y mañana', () => {
    const later = girona + 48 * HOUR;
    expect(
      run([channel('DAZN LaLiga', [programme('LaLiga: Girona - Sevilla', later, 125, live)])])
        .additions,
    ).toEqual([]);
    const tomorrow = girona + 24 * HOUR;
    expect(
      run([channel('DAZN LaLiga', [programme('LaLiga: Girona - Sevilla', tomorrow, 125, live)])])
        .additions[0]?.date,
    ).toBe(TOMORROW);
  });
});

describe('guideAgenda: lo preparado de la guía (una vez por guía y días)', () => {
  const guide = (): GuideChannelCandidate[] => [
    channel('M+ LaLiga TV 2', [
      programme('Telediario', KICKOFF - 3 * HOUR, 90),
      programme('Los Simpson - T12 Ep. 4', KICKOFF - 2 * HOUR, 30, { desc: 'Una - dos' }),
      programme('Fútbol', KICKOFF - 5 * MIN, 120, { subTitle: 'Real Sociedad vs. Villarreal CF' }),
    ]),
    channel('DAZN LaLiga', [programme('Real Sociedad × Villarreal', KICKOFF - 5 * MIN, 120)]),
    channel('M+ LaLiga TV', [
      /* A las 23:55 en directo: su saque (00:00) ya es de mañana. */
      programme('LaLiga: Girona - Sevilla (Directo)', KICKOFF + 5 * HOUR + 25 * MIN, 120),
    ]),
  ];

  it('lo mismo que mirar la guía entera, con «vs.», «×» y el cambio de día', () => {
    const request: GuideAgendaRequest = {
      matches: [match({ channels: ['M+ LaLiga TV 2', 'DAZN LaLiga'] })],
      dates: [TODAY, TOMORROW],
      dateOf: isoDateInMadrid,
      key: 'k',
    };
    const index = prepareGuideAgenda(guide(), request.dates, request.dateOf);
    /* Solo lo que puede ser un partido: ni el telediario (sin enfrentamiento) ni la serie (dura poco). */
    expect(index.candidates.flatMap((c) => c.programmes.map((p) => p.title))).toEqual([
      'Fútbol',
      'Real Sociedad × Villarreal',
      'LaLiga: Girona - Sevilla (Directo)',
    ]);
    const result = guideAgendaFrom(index, request, { agendaScorer });
    expect(result).toEqual(guideAgenda(guide(), request, { agendaScorer }));
    expect(result.confirmations).toEqual([
      {
        matchId: 'fltv-1',
        channels: ['M+ LaLiga TV 2', 'DAZN LaLiga'],
        start: KICKOFF,
        moved: false,
      },
    ]);
    expect(result.additions).toMatchObject([
      { home: 'Girona', away: 'Sevilla', date: TOMORROW, start: KICKOFF + 5.5 * HOUR },
    ]);
    /* Otra agenda sobre lo mismo preparado, sin volver a mirar la guía. */
    expect(
      guideAgendaFrom(index, { ...request, matches: [] }, { agendaScorer }).confirmations,
    ).toEqual([]);
  });
});
