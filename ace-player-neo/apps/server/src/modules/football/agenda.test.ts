/* Agenda de fútbol: las tres fuentes, la demo, la caché y el plazo global
   (server.js:1818-2749; api.md §4.8; B-115 a B-126). Los T-xxx llevan el
   título de tests/server.test.js; lo nuevo de la v2 va en su propio bloque. */

import { FootballScheduleSchema, TIMEOUTS } from '@ace/shared';
import { describe, expect, it } from 'vitest';
import { EPG_BASE, ESPN_BASE, FLTV_URL, FOOTBALL_CACHE_MS, THESPORTSDB_BASE } from './constants.js';
import {
  epgSplitTeams,
  enrichFootballLeagues,
  madridDateTime,
  normalizeEpgAirings,
  normalizeFootballRows,
  parseFutbolEnLaTv,
} from './legacy-exports.js';
import {
  fltvMatches,
  normalizeFootballRows as normalizeRowsV2,
  stableMatchId,
} from './agenda-sources.js';
import { addIsoDays, madridClock, madridDateTimeWithStart } from './time.js';
import { createFootball, fixture, type NetRoute } from './test-support.js';

// FakeClock: 2026-01-01T00:00Z (01:00 en Madrid); FOOTBALL_DAYS por defecto, 7.
const EPG_GRID = `${EPG_BASE}/OTT/epg?from=2026-01-01T00:00:00&span=7&channel=`;

/** Rutas de una EPG sana: tres cadenas deportivas, una sin rejilla. */
function epgRoutes(): Record<string, NetRoute | string> {
  return {
    [`${EPG_BASE}/OTT/contents/channels`]: fixture('epg-channels.json'),
    [`${EPG_GRID}MLIGA`]: fixture('epg-grid-mliga.json'),
    [`${EPG_GRID}CHAPIO`]: fixture('epg-grid-chapio.json'),
    [`${EPG_BASE}/contents/501/details`]: fixture('epg-details-501.json'),
    [`${EPG_BASE}/contents/502/details`]: fixture('epg-details-502.json'),
  };
}

function sportsDbRoutes(): Record<string, NetRoute | string> {
  return {
    [`${THESPORTSDB_BASE}/123/eventstv.php?d=2026-01-01`]: fixture('thesportsdb-eventstv.json'),
    [`${THESPORTSDB_BASE}/123/eventstv.php?d=2026-01-02`]: '{"tvevents":null}',
    [`${THESPORTSDB_BASE}/123/eventstv.php?d=2026-01-03`]: 'no es json',
    [`${THESPORTSDB_BASE}/123/lookupevent.php`]: fixture('thesportsdb-lookupevent.json'),
  };
}

describe('T-006 · agrupa las emisiones de un partido y normaliza sus canales (B-117)', () => {
  it('dos filas con el mismo idEvent son un solo partido', () => {
    const matches = normalizeFootballRows([
      {
        idEvent: '9001',
        strSport: 'Soccer',
        strEvent: 'Barcelona vs Valencia',
        strLeague: 'LaLiga',
        dateEvent: '2026-08-16',
        strTime: '21:30:00',
        idChannel: '11',
        strChannel: 'DAZN LaLiga',
        strCountry: 'Spain',
      },
      {
        idEvent: '9001',
        strSport: 'Soccer',
        strEvent: 'Barcelona vs Valencia',
        strLeague: 'LaLiga',
        dateEvent: '2026-08-16',
        strTime: '21:30:00',
        idChannel: '12',
        strChannel: 'DAZN LaLiga 2',
        strCountry: 'Spain',
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.home).toBe('Barcelona');
    expect(matches[0]?.away).toBe('Valencia');
    // 21:30 UTC en agosto son las 23:30 en Madrid
    expect(matches[0]?.time).toBe('23:30');
    expect(matches[0]?.channels.map((channel) => channel.name)).toEqual([
      'DAZN LaLiga',
      'DAZN LaLiga 2',
    ]);
  });
});

const T007_HTML = `
    <tr class="cabeceraCompericion"><td colspan="5">
      <img alt="Champions League" title="Champions League" />
      <a class="internalLink" href="/competicion/liga-campeones"> Champions League </a>
    </td></tr>
    <tr><td class="hora "> 21:00 </td>
      <td class="local"><a><span title="Fenerbah&#231;e">Fenerbah&#231;e</span></a></td>
      <td class="visitante"><span title="O. Lyonnais">O. Lyonnais</span></td>
      <td class="canales"><meta itemprop="startDate" content="2026-08-18T19:00:00" />
        <ul><li title="M+ Liga de Campeones (M60 O115)">M+ Liga de Campeones</li></ul>
      </td></tr>
    <tr class="cabeceraCompericion"><td colspan="5">
      <img alt="Torneo BetPlay DIMAYOR" title="Torneo BetPlay DIMAYOR" />Torneo BetPlay DIMAYOR
    </td></tr>
    <tr><td class="hora "> 02:00 </td>
      <td class="local"><span title="Atl&#233;tico Nacional">Atl&#233;tico Nacional</span></td>
      <td class="visitante"><span title="Mill&#243;n">Mill&#243;n</span></td>
      <td class="canales"><meta itemprop="startDate" content="2026-08-19T00:00:00" />
        <ul><li class="canal-sin-enlace" title="Zapping Internacional">Zapping</li></ul>
      </td></tr>`;

describe('T-007 · lee futbolenlatv con sus dos formatos de cabecera de competicion (B-118)', () => {
  it('cabecera enlazada y en texto suelto, entidades, hora UTC y dial recortado', () => {
    const airings = parseFutbolEnLaTv(T007_HTML, null);
    expect(airings).toHaveLength(2);
    const [champions, dimayor] = airings;
    expect(champions?.competition).toBe('Champions League');
    expect(champions?.home).toBe('Fenerbahçe');
    expect(champions?.away).toBe('O. Lyonnais');
    expect(champions?.time).toBe('21:00');
    expect(champions?.date).toBe('2026-08-18');
    expect(champions?.channels).toEqual(['M+ Liga de Campeones']);
    expect(dimayor?.competition).toBe('Torneo BetPlay DIMAYOR');
    expect(dimayor?.home).toBe('Atlético Nacional');
    expect(dimayor?.channels).toEqual(['Zapping Internacional']);
  });
});

describe('T-008 · la ventana de futbolenlatv descarta lo que cae fuera de rango (B-119)', () => {
  it('con ventana solo entra su día; sin ventana, los dos', () => {
    const fila = (fecha: string): string => `
      <tr class="cabeceraCompericion"><td><img title="La Liga EA Sports" /></td></tr>
      <tr><td class="hora "> 21:00 </td>
        <td class="local"><span title="Sevilla">Sevilla</span></td>
        <td class="visitante"><span title="Rayo">Rayo</span></td>
        <td class="canales"><meta itemprop="startDate" content="${fecha}T19:00:00" />
          <ul><li title="M+ LALIGA">M+ LALIGA</li></ul></td></tr>`;
    const html = fila('2026-08-18') + fila('2026-09-30');
    const dentro = parseFutbolEnLaTv(html, new Set(['2026-08-18']));
    expect(dentro).toHaveLength(1);
    expect(dentro[0]?.date).toBe('2026-08-18');
    expect(parseFutbolEnLaTv(html, null)).toHaveLength(2);
  });
});

describe('T-013 · separa los equipos del titulo de la EPG (B-120)', () => {
  it('guion corto y largo; sin separador, null', () => {
    expect(epgSplitTeams('Sevilla - Rayo')).toEqual({ home: 'Sevilla', away: 'Rayo' });
    expect(epgSplitTeams('Atlético Madrid - Málaga')).toEqual({
      home: 'Atlético Madrid',
      away: 'Málaga',
    });
    expect(epgSplitTeams('Espanyol – Real Madrid')).toEqual({
      home: 'Espanyol',
      away: 'Real Madrid',
    });
    expect(epgSplitTeams('LALIGA EA SPORTS')).toBeNull();
    expect(epgSplitTeams('Real Sociedad B')).toBeNull();
    expect(epgSplitTeams('')).toBeNull();
  });
});

const madridFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Madrid',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function emision(
  canal: { id: string; name: string },
  start: number,
  teams: string,
  competition: string,
  showId: number,
) {
  return {
    channel: canal,
    start,
    date: '2026-08-22',
    time: madridFormat.format(new Date(start)),
    row: { ShowId: showId, Titulo: 'LALIGA EA SPORTS' },
    detail: { teams, competition },
  };
}

describe('T-014 · agrupa una emision repetida en varias cadenas en un solo partido (B-121)', () => {
  it('un partido, dos canales, la hora más temprana y ordenados por hora', () => {
    const base = Date.UTC(2026, 7, 22, 18, 55);
    const matches = normalizeEpgAirings([
      emision(
        { id: 'VAMOSD', name: 'M+ Vamos' },
        base + 120_000,
        'Fluminense - Remo',
        'Brasileirao',
        1,
      ),
      emision(
        { id: 'CHAPIO', name: 'M+ Liga de Campeones' },
        base,
        'Fluminense - Remo',
        'Brasileirao',
        2,
      ),
      emision(
        { id: 'MLIGA', name: 'M+ LALIGA' },
        Date.UTC(2026, 7, 22, 14, 54),
        'Athletic - Sevilla',
        'LALIGA EA SPORTS',
        3,
      ),
    ]);
    expect(matches).toHaveLength(2);
    const fluminense = matches.find((match) => match.home === 'Fluminense');
    expect(fluminense?.channels.map((channel) => channel.name).sort()).toEqual([
      'M+ Liga de Campeones',
      'M+ Vamos',
    ]);
    expect(fluminense?.time).toBe('20:55');
    expect(fluminense?.away).toBe('Remo');
    expect(fluminense?.competition).toBe('Brasileirao');
    expect(matches.map((match) => match.time)).toEqual(['16:54', '20:55']);
    // la fachada es la 0.6.59: sin `start`
    expect(matches.every((match) => !('start' in match))).toBe(true);
  });
});

describe('T-015 · una emision sin ficha conserva el titulo generico y no rompe la agenda (B-122)', () => {
  it('título genérico, sin visitante y con su canal', () => {
    const matches = normalizeEpgAirings([
      {
        channel: { id: 'MLIGA', name: 'M+ LALIGA' },
        start: Date.UTC(2026, 7, 22, 18, 0),
        date: '2026-08-22',
        time: '20:00',
        row: { ShowId: 9, Titulo: 'LALIGA EA SPORTS' },
      },
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.title).toBe('LALIGA EA SPORTS');
    expect(matches[0]?.away).toBe('');
    expect(matches[0]?.channels.map((channel) => channel.name)).toEqual(['M+ LALIGA']);
  });
});

describe('T-016 · pasa la hora de TheSportsDB (UTC) al horario peninsular (B-115)', () => {
  it('verano, invierno, madrugada, sin hora y fecha rota', () => {
    expect(madridDateTime('2026-08-17', '19:30:00')).toEqual({ date: '2026-08-17', time: '21:30' });
    expect(madridDateTime('2026-01-17', '19:30:00')).toEqual({ date: '2026-01-17', time: '20:30' });
    expect(madridDateTime('2026-08-17', '22:30:00')).toEqual({ date: '2026-08-18', time: '00:30' });
    expect(madridDateTime('2026-08-17', '')).toEqual({ date: '2026-08-17', time: 'Por confirmar' });
    expect(madridDateTime('no-es-fecha', '19:30:00')).toBeNull();
  });

  it('v2: además da el saque en UTC (null sin hora utilizable)', () => {
    expect(madridDateTimeWithStart('2026-08-17', '19:30:00')?.start).toBe(
      Date.UTC(2026, 7, 17, 19, 30),
    );
    expect(madridDateTimeWithStart('2026-08-17', '25:00')).toEqual({
      date: '2026-08-17',
      time: 'Por confirmar',
      start: null,
    });
    expect(madridClock('no')).toBe('');
    expect(addIsoDays('2026-13', 1)).toBe('');
  });
});

describe('T-023 · completa la competicion por evento y aguanta que el servicio falle (B-116)', () => {
  it('solo pide los "Fútbol" con id numérico y un fallo deja "Fútbol"', async () => {
    const matches = [
      { id: '9001', competition: 'Fútbol' },
      { id: '9002', competition: 'Fútbol' },
      { id: '9003', competition: 'LaLiga' },
      { id: 'sin-id-numerico', competition: 'Fútbol' },
    ];
    const asked: string[] = [];
    await enrichFootballLeagues(matches, async (id) => {
      asked.push(id);
      if (id === '9002') throw new Error('thesportsdb_down');
      return 'Spanish La Liga 2';
    });
    expect(asked.sort()).toEqual(['9001', '9002']);
    expect(matches[0]?.competition).toBe('Spanish La Liga 2');
    expect(matches[1]?.competition).toBe('Fútbol');
    expect(matches[2]?.competition).toBe('LaLiga');
    expect(matches[3]?.competition).toBe('Fútbol');
  });
});

describe('Cadena de la agenda del servicio (B-123, B-124, B-125; arquitectura §5.10)', () => {
  it('futbolenlatv: partidos de la ventana, con saque, canales sin repetir e ids estables', async () => {
    const { football, net } = createFootball({ net: { [FLTV_URL]: fixture('futbolenlatv.html') } });
    const schedule = await football.schedule();
    expect(FootballScheduleSchema.parse(schedule)).toEqual(schedule);
    expect(schedule).toMatchObject({
      timezone: 'Europe/Madrid',
      country: 'España',
      source: 'futbolenlatv',
      attribution: 'futbolenlatv.com',
      demo: false,
      limited: false,
      partial: false,
    });
    expect(schedule.days).toHaveLength(7);
    expect(schedule.days[0]?.date).toBe('2026-01-01');
    const matches = schedule.days.flatMap((day) => day.matches);
    expect(matches.map((match) => `${match.home} - ${match.away}`)).toEqual([
      'Sevilla - Rayo Vallecano',
      'Real Madrid - Manchester City',
      'Atlético de Madrid - Girona & Co',
    ]);
    const madrid = matches[1];
    expect(madrid).toMatchObject({
      date: '2026-01-01',
      time: '21:00',
      start: Date.UTC(2026, 0, 1, 20),
      title: 'Real Madrid - Manchester City',
      competition: 'Champions League',
    });
    expect(madrid?.channels.map((channel) => channel.name)).toEqual([
      'M+ Liga de Campeones',
      'Movistar Plus+',
    ]);
    // id por hash de fecha, hora, local y visitante (no por posición)
    expect(madrid?.id).toBe(
      stableMatchId('fltv', '2026-01-01', '21:00', 'Real Madrid', 'Manchester City'),
    );
    expect(madrid?.id).toMatch(/^fltv-2026-01-01-[a-f0-9]{10}$/);
    expect(madrid?.channels[0]?.id).toBe(`${madrid?.id}-0`);
    expect(net.calls[0]?.options).toMatchObject({ maxBytes: 6 * 1024 * 1024 });
    expect(net.calls[0]?.options.signal).toBeInstanceOf(AbortSignal);
  });

  it('los ids no se corren si aparece un partido anterior (antes, `fltv-<fecha>-<índice>`)', () => {
    const base = parseFutbolEnLaTv(fixture('futbolenlatv.html'), null);
    const extra = {
      ...base[0]!,
      start: base[0]!.start - 3_600_000,
      time: '19:00',
      home: 'Nuevo',
      away: 'Partido',
    };
    const before = fltvMatches(base, 'stable');
    const after = fltvMatches([extra, ...base], 'stable');
    for (const match of before) expect(after.map((item) => item.id)).toContain(match.id);
    // la forma antigua sí se corría
    const legacyBefore = fltvMatches(base, 'legacy').map((match) => match.id);
    const legacyAfter = fltvMatches([extra, ...base], 'legacy').map((match) => match.id);
    expect(legacyBefore[0]).toBe('fltv-2026-01-01-0');
    expect(legacyAfter.slice(1)).not.toEqual(legacyBefore);
  });

  it('dos filas idénticas no comparten id: la segunda lleva `-2`', () => {
    const [airing] = parseFutbolEnLaTv(fixture('futbolenlatv.html'), null);
    const ids = fltvMatches([airing!, { ...airing! }], 'stable').map((match) => match.id);
    expect(ids[1]).toBe(`${ids[0]}-2`);
  });

  it('si futbolenlatv falla, la EPG de Movistar+: agrupada, con `start` y parcial', async () => {
    const { football } = createFootball({ net: epgRoutes() });
    const schedule = await football.schedule();
    expect(FootballScheduleSchema.parse(schedule)).toEqual(schedule);
    expect(schedule).toMatchObject({
      source: 'movistarplus',
      attribution: 'EPG de Movistar Plus+',
      partial: true, // DAZNL no dio rejilla
    });
    const matches = schedule.days.flatMap((day) => day.matches);
    expect(matches.map((match) => match.title)).toEqual([
      'Sevilla - Rayo Vallecano',
      'Real Madrid - Manchester City',
      'FÚTBOL INTERNACIONAL',
    ]);
    const sevilla = matches[0];
    expect(sevilla).toMatchObject({
      id: 'epg-22',
      time: '20:00',
      start: Date.UTC(2026, 0, 1, 19),
      home: 'Sevilla',
      away: 'Rayo Vallecano',
      competition: 'LALIGA EA SPORTS',
    });
    expect(sevilla?.channels.map((channel) => channel.name)).toEqual([
      'M+ Liga de Campeones',
      'M+ LaLiga',
    ]);
    expect(matches[2]).toMatchObject({ away: '', competition: 'FÚTBOL INTERNACIONAL' });
  });

  it('si también falla la EPG, TheSportsDB: liga por evento, `start` y `limited` con la clave pública', async () => {
    const { football } = createFootball({ net: sportsDbRoutes() });
    const schedule = await football.schedule();
    expect(FootballScheduleSchema.parse(schedule)).toEqual(schedule);
    expect(schedule).toMatchObject({
      source: 'thesportsdb',
      attribution: 'TheSportsDB',
      limited: true,
      partial: true,
    });
    const matches = schedule.days.flatMap((day) => day.matches);
    const sevilla = matches.find((match) => match.id === '9001');
    expect(sevilla).toMatchObject({
      time: '20:00',
      start: Date.UTC(2026, 0, 1, 19),
      competition: 'Spanish La Liga',
      country: 'Spain',
    });
    expect(sevilla?.channels.map((channel) => channel.name)).toEqual(['DAZN LaLiga']);
    expect(matches.find((match) => match.id === '9002')).toMatchObject({
      home: 'Real Madrid',
      away: 'Manchester City',
      competition: 'UEFA Champions League',
    });
    const sinHora = matches.find((match) => match.time === 'Por confirmar');
    expect(sinHora).toBeDefined();
    expect(sinHora && 'start' in sinHora).toBe(false);
    expect(matches.some((match) => match.title.includes('Barça'))).toBe(false);
  });

  it('con otra clave de TheSportsDB la agenda no sale `limited`', async () => {
    const routes = Object.fromEntries(
      Object.entries(sportsDbRoutes()).map(([key, value]) => [
        key.replace('/123/', '/clave/'),
        value,
      ]),
    );
    const { football } = createFootball({ env: { THESPORTSDB_API_KEY: 'clave' }, net: routes });
    expect((await football.schedule()).limited).toBe(false);
  });

  it('si todo falla y no hay agenda anterior: football_unavailable', async () => {
    const { football } = createFootball();
    await expect(football.schedule()).rejects.toMatchObject({ code: 'football_unavailable' });
    expect(football.healthInfo()).toMatchObject({ status: 'warming', matches: 0 });
  });

  it('caché de 30 min con una sola descarga compartida; al caducar, se refresca', async () => {
    const { football, net, core } = createFootball({
      net: { [FLTV_URL]: fixture('futbolenlatv.html') },
    });
    const [a, b] = await Promise.all([football.schedule(), football.schedule()]);
    expect(a).toBe(b);
    await football.schedule();
    expect(net.fetchText).toHaveBeenCalledTimes(1);
    core.clock.advance(FOOTBALL_CACHE_MS);
    await football.schedule();
    expect(net.fetchText).toHaveBeenCalledTimes(2);
    expect(football.healthInfo()).toMatchObject({ status: 'ready', matches: 3 });
  });

  it('si el refresco falla, la última agenda buena con `stale: true` y la salud lo dice', async () => {
    let up = true;
    const { football, core } = createFootball({
      net: {
        [FLTV_URL]: () => {
          if (!up) throw new Error('socket hang up');
          return fixture('futbolenlatv.html');
        },
      },
    });
    const fresh = await football.schedule();
    up = false;
    core.clock.advance(FOOTBALL_CACHE_MS + 1);
    const stale = await football.schedule();
    expect(stale).toEqual({ ...fresh, stale: true });
    expect(football.healthInfo()).toMatchObject({
      status: 'stale',
      generatedAt: fresh.generatedAt,
    });
  });

  it('plazo global de 60 s: si la cadena se cuelga, football_unavailable sin esperar más', async () => {
    const { football, core, net } = createFootball({
      net: { [FLTV_URL]: () => new Promise<string>(() => {}) },
    });
    const pending = football.schedule();
    await core.clock.advanceAsync(TIMEOUTS.agendaTotalMs - 1);
    let settled = false;
    void pending.then(
      () => (settled = true),
      () => (settled = true),
    );
    await core.clock.advanceAsync(0);
    expect(settled).toBe(false);
    await core.clock.advanceAsync(1);
    await expect(pending).rejects.toMatchObject({ code: 'football_unavailable' });
    expect(net.calls[0]?.options.signal?.aborted).toBe(true);
  });

  it('plazo global con agenda anterior: se sirve la vieja con `stale: true`', async () => {
    let hang = false;
    const { football, core } = createFootball({
      net: {
        [FLTV_URL]: () => (hang ? new Promise<string>(() => {}) : fixture('futbolenlatv.html')),
      },
    });
    const fresh = await football.schedule();
    hang = true;
    core.clock.advance(FOOTBALL_CACHE_MS);
    const pending = football.schedule();
    await core.clock.advanceAsync(TIMEOUTS.agendaTotalMs);
    expect(await pending).toEqual({ ...fresh, stale: true });
  });

  it('futbolenlatv vacío, EPG ilegible y TheSportsDB caído: football_unavailable', async () => {
    const { football } = createFootball({
      net: {
        [FLTV_URL]: 'sin partidos',
        [`${EPG_BASE}/OTT/contents/channels`]: 'no es json',
        [`${THESPORTSDB_BASE}/123/eventstv.php`]: () => {
          throw new Error('ECONNRESET');
        },
      },
    });
    await expect(football.schedule()).rejects.toMatchObject({ code: 'football_unavailable' });
  });

  it('EPG vacía o sin cadenas deportivas pasa a TheSportsDB', async () => {
    for (const channels of ['[]', '{"no":"array"}', '[{"CodCadenaTv":"LA1","Nombre":"La 1"}]']) {
      const { football } = createFootball({
        net: { [`${EPG_BASE}/OTT/contents/channels`]: channels, ...sportsDbRoutes() },
      });
      expect((await football.schedule()).source).toBe('thesportsdb');
    }
    const sinPartidos = createFootball({
      net: {
        [`${EPG_BASE}/OTT/contents/channels`]: fixture('epg-channels.json'),
        [`${EPG_GRID}MLIGA`]: '[]',
        [`${EPG_GRID}CHAPIO`]: '{"rejilla":"rara"}',
        ...sportsDbRoutes(),
      },
    });
    expect((await sinPartidos.football.schedule()).source).toBe('thesportsdb');
    const sinRejillas = createFootball({
      net: {
        [`${EPG_BASE}/OTT/contents/channels`]: fixture('epg-channels.json'),
        ...sportsDbRoutes(),
      },
    });
    expect((await sinRejillas.football.schedule()).source).toBe('thesportsdb');
  });

  it('la demo (FOOTBALL_DEMO_ONLY) no sale a internet y cuenta para la salud', async () => {
    const { football, net } = createFootball({ env: { FOOTBALL_DEMO_ONLY: 'true' } });
    expect(football.healthInfo().status).toBe('warming');
    const schedule = await football.schedule();
    expect(schedule).toMatchObject({ source: 'demo', demo: true, attribution: 'Datos de muestra' });
    expect(net.fetchText).not.toHaveBeenCalled();
    expect(football.healthInfo()).toMatchObject({ status: 'ready', matches: 10, aiEnabled: false });
    expect(football.programChannels('demo-5')).toEqual(['M+ Liga de Campeones']);
    expect(football.programChannels('no-existe')).toEqual([]);
  });

  it('las filas de TheSportsDB con `withStart` llevan el saque solo si la hora vale', () => {
    const rows = JSON.parse(fixture('thesportsdb-eventstv.json')).tvevents;
    const withStart = normalizeRowsV2(rows, { country: 'Spain', withStart: true });
    expect(withStart.find((match) => match.id === '9002')?.start).toBe(Date.UTC(2026, 0, 1, 20));
    expect(normalizeFootballRows(rows).every((match) => !('start' in match))).toBe(true);
  });

  it('ESPN no se usa para la agenda (solo marcadores)', async () => {
    const { football, net } = createFootball({ net: { [FLTV_URL]: fixture('futbolenlatv.html') } });
    await football.schedule();
    expect(net.calls.some((call) => call.url.startsWith(ESPN_BASE))).toBe(false);
  });
});
