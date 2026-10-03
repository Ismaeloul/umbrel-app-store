/* Agenda híbrida (docs/iptv.md §4.7): la guía confirma, mueve la hora con
   la marca de directo y añade solo lo que es de verdad un partido en directo
   que la agenda no trae. Formatos de las guías de Movistar y DAZN,
   inventados. */

import { describe, expect, it } from 'vitest';
import { isoDateInMadrid } from '../football/time.js';
import {
  guideAgenda,
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
    const result = run([
      channel('DAZN LaLiga', [
        programme('LaLiga EA Sports. Jornada 7: Girona - Sevilla', girona, 125, live),
      ]),
    ]);
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
