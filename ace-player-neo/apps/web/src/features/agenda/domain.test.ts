import {
  channelMatchScore,
  FootballScheduleSchema,
  normalizeChannelKey,
  type FootballMatch,
  type Item,
} from '@ace/shared';
import { describe, expect, it } from 'vitest';
import matrix from '../../../../../packages/shared/test/fixtures/t088-channel-matrix.json';
import { fixture } from '../../test/fetch.ts';
import {
  addDays,
  buildLibraryLookup,
  channelInfo,
  countLive,
  dayLabel,
  defaultDay,
  effectiveMode,
  featuredMatch,
  groupByCompetition,
  inPreheatWindow,
  isMine,
  keepUnitsTogether,
  laterMatches,
  liveMinute,
  madridClock,
  madridHour,
  matchProgressAt,
  matchStatus,
  matchTitle,
  minutesToMatch,
  paintableScore,
  resolveDay,
  scoresInterval,
  scoresWanted,
  signalFromPreheat,
  signalFromScan,
  visibleMatches,
} from './domain.ts';
import { liveScore, matchAt, NOW, TODAY } from './test-utils.tsx';

const MIN = 60_000;

describe('reloj de Madrid', () => {
  it('la fecha y el minuto salen de Madrid, no del dispositivo', () => {
    expect(madridClock(NOW)).toEqual({ date: TODAY, minutes: 20 * 60 + 30 });
    // 23:30 UTC ya es el día siguiente en Madrid (horario de verano, +2).
    expect(madridClock(Date.parse('2026-09-23T22:30:00Z')).date).toBe('2026-09-24');
    // En invierno Madrid está a +1.
    expect(madridClock(Date.parse('2026-12-01T12:00:00Z')).minutes).toBe(13 * 60);
    expect(madridHour(NOW)).toBe('20:30');
    expect(madridHour(null)).toBeNull();
    expect(madridHour('no es fecha')).toBeNull();
  });

  it('minutos para el partido con su fecha y su hora; «Por confirmar» no cuenta', () => {
    expect(minutesToMatch({ date: TODAY, time: '21:00' }, NOW)).toBe(30);
    expect(minutesToMatch({ date: addDays(TODAY, 1), time: '20:30' }, NOW)).toBe(1440);
    expect(minutesToMatch({ date: TODAY, time: 'Por confirmar' }, NOW)).toBeNull();
  });
});

describe('insignia de estado (index.html:3001-3008)', () => {
  const at = (time: string) => ({ date: TODAY, time });
  it('en directo desde la hora de inicio hasta 120 min después; luego terminado', () => {
    expect(matchStatus(at('20:30'), NOW)).toEqual({ phase: 'live', text: 'En directo' });
    expect(matchStatus(at('18:31'), NOW)?.phase).toBe('live');
    expect(matchStatus(at('18:30'), NOW)).toEqual({ phase: 'done', text: 'Terminado' });
  });
  it('«en n min» hasta 60 y «en h h m min» hasta 6 h; más allá, nada', () => {
    expect(matchStatus(at('21:18'), NOW)).toEqual({ phase: 'soon', text: 'En 48 min' });
    expect(matchStatus(at('21:30'), NOW)).toEqual({ phase: 'soon', text: 'En 60 min' });
    expect(matchStatus(at('21:48'), NOW)).toEqual({ phase: 'next', text: 'En 1 h 18 min' });
    expect(matchStatus({ date: addDays(TODAY, 1), time: '02:30' }, NOW)?.text).toBe('En 6 h 0 min');
    expect(matchStatus({ date: addDays(TODAY, 1), time: '02:31' }, NOW)).toBeNull();
  });
  it('se actualiza con el tiempo (contradicción 12 de la 0.6.59)', () => {
    const match = at('21:00');
    expect(matchStatus(match, NOW)?.text).toBe('En 30 min');
    expect(matchStatus(match, NOW + 20 * MIN)?.text).toBe('En 10 min');
    expect(matchStatus(match, NOW + 31 * MIN)?.phase).toBe('live');
  });
  it('el marcador de ESPN manda sobre el reloj (prórroga o final)', () => {
    expect(matchStatus(at('18:00'), NOW, { state: 'in' })?.phase).toBe('live');
    expect(matchStatus(at('20:00'), NOW, { state: 'post' })?.phase).toBe('done');
    expect(matchStatus(at('20:00'), NOW, { state: 'pre' })?.phase).toBe('live');
  });
  const NBSP = '\u00A0';
  it('al pintarla, cifra y unidad no se separan (parte «En 2 h» / «28 min»)', () => {
    expect(keepUnitsTogether('En 2 h 28 min')).toBe(`En 2${NBSP}h 28${NBSP}min`);
    expect(keepUnitsTogether('En 48 min')).toBe(`En 48${NBSP}min`);
    expect(keepUnitsTogether('En directo')).toBe('En directo');
  });
});

describe('días', () => {
  it('Hoy, Mañana, Ayer o el día abreviado, con el número y el nombre largo', () => {
    expect(dayLabel(TODAY, TODAY)).toMatchObject({ primary: 'Hoy', number: '23' });
    expect(dayLabel('2026-09-24', TODAY).primary).toBe('Mañana');
    expect(dayLabel('2026-09-22', TODAY).primary).toBe('Ayer');
    expect(dayLabel('2026-09-25', TODAY)).toMatchObject({ primary: 'Vie', number: '25' });
    expect(dayLabel('2026-09-25', TODAY).long).toBe('viernes, 25 de septiembre');
  });
  it('abre en hoy si existe; si el elegido ya no existe, el de por defecto', () => {
    const days = [{ date: '2026-09-22' }, { date: TODAY }, { date: '2026-09-24' }];
    expect(defaultDay(days, TODAY)).toBe(TODAY);
    expect(defaultDay([{ date: '2026-09-24' }], TODAY)).toBe('2026-09-24');
    expect(defaultDay([], TODAY)).toBeNull();
    expect(resolveDay(days, '2026-09-24', TODAY)).toBe('2026-09-24');
    expect(resolveDay(days, '2026-01-01', TODAY)).toBe(TODAY);
  });
});

describe('«Para ti» con las reglas de @ace/shared', () => {
  const prefs = { leagues: ['LaLiga'], teams: ['Barcelona'], nationalities: ['España'] };
  const m = (home: string, away: string, competition: string, channels = ['DAZN']) =>
    matchAt(0, {
      home,
      away,
      competition,
      title: `${home} vs ${away}`,
      channels: channels.map((name, i) => ({ id: `${i}`, name })),
    });

  it('sin gustos se fuerza «Todos»; con gustos y sin tocar, «Para ti»', () => {
    expect(effectiveMode(null, null)).toBe('all');
    expect(effectiveMode('forYou', { leagues: [], teams: [], nationalities: [] })).toBe('all');
    expect(effectiveMode(null, prefs)).toBe('forYou');
    expect(effectiveMode('all', prefs)).toBe('all');
  });

  it('es la UNIÓN: liga, equipo (con alias y sin «incluye») y nacionalidad', () => {
    const barca = m('FC Barcelona', 'Juventus', 'Amistoso');
    const barcaSc = m('Barcelona SC', 'Emelec', 'Amistoso');
    const liga = m('Real Sociedad', 'Villarreal', 'La Liga EA Sports');
    const espana = m('España', 'Marruecos', 'Amistoso');
    const premier = m('Arsenal', 'Liverpool', 'Premier League');
    const all = [barca, barcaSc, liga, espana, premier];
    expect(visibleMatches(all, 'forYou', prefs).map((x) => x.id)).toEqual([
      barca.id,
      liga.id,
      espana.id,
    ]);
    expect(visibleMatches(all, 'all', prefs)).toHaveLength(5);
    // El orden de la agenda se conserva y tu equipo solo se resalta.
    expect(isMine(barca, prefs)).toBe(true);
    expect(isMine(barcaSc, prefs)).toBe(false);
  });

  it('guarda de Hypermotion: ni «LaLiga» ni «España» traen Segunda', () => {
    const segunda = m('Racing', 'Sporting', 'LaLiga', ['LaLiga TV Hypermotion']);
    const segundaRotulada = m('Racing', 'Sporting', 'LaLiga Hypermotion');
    expect(visibleMatches([segunda, segundaRotulada], 'forYou', prefs)).toEqual([]);
    const conSegunda = { ...prefs, leagues: ['LaLiga Hypermotion'] };
    expect(visibleMatches([segunda, segundaRotulada], 'forYou', conSegunda)).toHaveLength(2);
  });

  it('nacionalidades por alias y por competición doméstica', () => {
    const spain = m('Spain', 'Italy', 'Nations League');
    const copa = m('Getafe', 'Elche', 'Copa del Rey');
    const mx = m('América', 'Chivas', 'Liga MX');
    const onlyNat = { leagues: [], teams: [], nationalities: ['España'] };
    expect(visibleMatches([spain, copa, mx], 'forYou', onlyNat).map((x) => x.id)).toEqual([
      spain.id,
      copa.id,
    ]);
  });

  it('con el ejemplo de la API (fixture) «LaLiga» entra en «Para ti»', () => {
    const schedule = FootballScheduleSchema.parse(fixture('footballSchedule'));
    const matches = schedule.days[0]?.matches ?? [];
    expect(
      visibleMatches(
        matches,
        'forYou',
        fixture<{ preferences: typeof prefs }>('preferencesGet').preferences,
      ),
    ).toHaveLength(1);
  });
});

describe('bloques por competición', () => {
  it('en directo, luego próximos y los terminados al final; bloques por su primer partido pendiente', () => {
    const done = matchAt(-200, { competition: 'LaLiga' });
    const live = matchAt(-30, { competition: 'LaLiga' });
    const next = matchAt(60, { competition: 'LaLiga' });
    const ucl = matchAt(15, { competition: 'Champions League' });
    const onlyDone = matchAt(-300, { competition: 'Serie A' });
    const groups = groupByCompetition([done, onlyDone, next, ucl, live], NOW);
    expect(groups.map((g) => g.competition)).toEqual(['LaLiga', 'Champions League', 'Serie A']);
    expect(groups[0]?.matches.map((x) => x.id)).toEqual([live.id, next.id, done.id]);
  });
  it('sin competición, «Fútbol»', () => {
    expect(groupByCompetition([matchAt(10, { competition: '' })], NOW)[0]?.competition).toBe(
      'Fútbol',
    );
  });
  it('cuenta los directos y elige el destacado (tu equipo en directo primero)', () => {
    const a = matchAt(-20, { home: 'Girona' });
    const b = matchAt(-10, { home: 'Real Madrid' });
    const c = matchAt(40);
    const prefs = { leagues: [], teams: ['Real Madrid'], nationalities: [] };
    expect(countLive([a, b, c], NOW)).toBe(2);
    expect(featuredMatch([a, b, c], NOW, {}, prefs)?.id).toBe(b.id);
    expect(featuredMatch([a, b, c], NOW, {}, null)?.id).toBe(a.id);
    expect(featuredMatch([c], NOW, {}, null)?.id).toBe(c.id);
    expect(laterMatches([a, b, c], NOW, {}, null).map((x) => x.id)).toEqual([c.id]);
  });
});

describe('marcadores (regla 29)', () => {
  it('solo se piden si el día tiene un partido entre 15 min antes y 3,5 h después', () => {
    expect(scoresWanted([matchAt(14)], NOW)).toBe(true);
    expect(scoresWanted([matchAt(16)], NOW)).toBe(false);
    expect(scoresWanted([matchAt(-209)], NOW)).toBe(true);
    expect(scoresWanted([matchAt(-211)], NOW)).toBe(false);
    expect(scoresWanted([{ ...matchAt(0), start: undefined }], NOW)).toBe(false);
  });
  it('cada 8 s si hay algo en juego; cada 45 s si no', () => {
    expect(scoresInterval({ a: liveScore(0, 0) })).toBe(8_000);
    expect(scoresInterval({ a: { ...liveScore(0, 0), state: 'pre' } })).toBe(45_000);
    expect(scoresInterval(undefined)).toBe(45_000);
  });
  it('«pre» nunca se pinta', () => {
    expect(paintableScore({ ...liveScore(0, 0), state: 'pre' })).toBeNull();
    expect(paintableScore({ ...liveScore(1, 0), state: 'post' })).not.toBeNull();
    expect(paintableScore(null)).toBeNull();
  });
  it('minuto del reloj de ESPN, descanso y añadido', () => {
    expect(liveMinute(liveScore(0, 0, "72'"))).toEqual({ minute: '72', halftime: false });
    expect(liveMinute(liveScore(0, 0, "45'+2'"))).toEqual({ minute: '45+2', halftime: false });
    expect(liveMinute(liveScore(0, 0, "45'", 'HT'))).toEqual({ minute: '45', halftime: true });
    expect(liveMinute(liveScore(0, 0, '', 'Final'))).toBeNull();
    expect(liveMinute({ ...liveScore(0, 0), state: 'post' })).toBeNull();
  });
  it('progreso del partido: por el minuto, o aproximado por el reloj', () => {
    const match = matchAt(-30);
    expect(matchProgressAt(match, NOW, liveScore(0, 0, "45'"))).toBeCloseTo(0.5);
    expect(matchProgressAt(match, NOW, null)).toBeCloseTo(30 / 90);
    expect(matchProgressAt(match, NOW, { ...liveScore(0, 0), state: 'post' })).toBe(1);
    expect(matchProgressAt(matchAt(-52), NOW, null)).toBe(0.5);
  });
});

describe('señal por partido', () => {
  it('ventana del precalentado: de 45 min antes a 120 después', () => {
    expect(inPreheatWindow(matchAt(45), NOW)).toBe(true);
    expect(inPreheatWindow(matchAt(46), NOW)).toBe(false);
    expect(inPreheatWindow(matchAt(-120), NOW)).toBe(true);
    expect(inPreheatWindow(matchAt(-121), NOW)).toBe(false);
  });
  it('precalentado → medidor (comprobando siempre hueco, nunca «lleno»)', () => {
    const base = {
      matchId: 'x',
      stage: 'scan' as const,
      updatedAt: null,
      candidateCount: 6,
      checked: 2,
      playable: 0,
      total: 6,
      error: '',
    };
    expect(signalFromPreheat(null).state).toBe('pending');
    expect(signalFromPreheat({ ...base, status: 'scanning' })).toMatchObject({ state: 'checking' });
    expect(signalFromPreheat({ ...base, status: 'scanning', playable: 2 })).toMatchObject({
      state: 'ok',
    });
    expect(signalFromPreheat({ ...base, status: 'ready', playable: 3 }).summary).toBe(
      '3 de 6 fuentes verificadas',
    );
    expect(signalFromPreheat({ ...base, status: 'ready', playable: 0 }).state).toBe('fail');
    expect(signalFromPreheat({ ...base, status: 'no_sources' })).toMatchObject({
      state: 'fail',
      label: 'Sin fuentes',
    });
    expect(signalFromPreheat({ ...base, status: 'scanner_offline' }).state).toBe('pending');
    expect(signalFromPreheat({ ...base, status: 'resolving' }).state).toBe('checking');
    expect(signalFromPreheat({ ...base, status: 'failed' }).state).toBe('fail');
  });
  it('SSE `scan.progress`: B7 «Sin señal · reintento 20:51» en la propia fila', () => {
    const base = { status: 'running', playable: 0, checked: 1, total: 4, retryAt: null };
    expect(signalFromScan(base)?.state).toBe('checking');
    expect(signalFromScan({ ...base, playable: 1 })?.state).toBe('ok');
    expect(
      signalFromScan({ ...base, status: 'waiting', retryAt: '2026-09-23T18:51:00.000Z' }),
    ).toMatchObject({
      state: 'fail',
      label: 'Sin señal · reintento 20:51',
    });
    expect(signalFromScan({ ...base, status: 'complete' })?.state).toBe('fail');
    expect(signalFromScan({ ...base, status: 'cancelled' })).toBeNull();
  });
});

describe('«Ver canal» o «Buscar canal» (findFootballChannel)', () => {
  const item = (title: string, extra: Partial<Item> = {}): Item => ({
    id: `${title.length.toString(16).padStart(2, '0')}${'a'.repeat(38)}`.slice(0, 40),
    title,
    type: 'web',
    category: '',
    date: '2026-09-23T18:30:00.000Z',
    fromWebSync: true,
    ih: false,
    ...extra,
  });

  it('cuenta desde 70 puntos, mira el tvg-id y no repite canales', () => {
    const lookup = buildLibraryLookup({
      web: [item('DAZN 1'), item('Canal raro', { id: 'b'.repeat(40), alias: 'M+ LaLiga TV' })],
      favorites: [item('DAZN 1')],
      history: [],
    });
    expect(lookup.size).toBe(2);
    expect(lookup.has('DAZN')).toBe(true); // familia: 78
    expect(lookup.has('DAZN 2')).toBe(false); // otro número: 0
    expect(lookup.has('M+ LaLiga TV')).toBe(true); // por el alias
    expect(lookup.has('LaLiga TV Hypermotion')).toBe(false); // variante: 58
    const match = matchAt(0, {
      channels: [
        { id: '1', name: 'DAZN' },
        { id: '2', name: 'GOL Play' },
      ],
    });
    expect(channelInfo(match, lookup)).toEqual([
      { name: 'DAZN', inLibrary: true },
      { name: 'GOL Play', inLibrary: false },
    ]);
  });

  it('normalizar la biblioteca una vez da la misma puntuación (matriz T-088 de la 0.6.59)', () => {
    const { names, scores } = matrix as { names: string[]; scores: number[][] };
    names.forEach((a, i) => {
      names.forEach((b, j) => {
        expect(channelMatchScore(a, normalizeChannelKey(b))).toBe(scores[i]?.[j]);
        expect(normalizeChannelKey(normalizeChannelKey(b))).toBe(normalizeChannelKey(b));
      });
    });
  });

  it('título legible del partido', () => {
    const match: FootballMatch = matchAt(0, { home: 'A', away: 'B', title: 'A - B' });
    expect(matchTitle(match)).toBe('A vs B');
    expect(matchTitle({ ...match, away: '' })).toBe('A - B');
  });
});
