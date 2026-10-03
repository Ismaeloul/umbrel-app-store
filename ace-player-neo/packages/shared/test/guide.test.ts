/* Contrato de la Guía TV (docs/iptv.md §20.6) y la guía de ejemplo de la
   demo (§20.8): las 5 rutas nacen solo web en el módulo iptv, los 3
   `guide_*` con su HTTP (y los 16 `iptv_*` intactos), los esquemas aceptan lo
   que deben y nada más, y el generador de ejemplo es determinista, coherente
   entre trozos y valida contra los esquemas. */

import { describe, expect, it } from 'vitest';
import {
  DemoGuideError,
  ERROR_CATALOG,
  GUIDE_FLAGS,
  IPTV_ERROR_CODES,
  IPTV_GUIDE_API,
  IPTV_GUIDE_STORE,
  IptvGuideArtParamsSchema,
  IptvGuideNowQuerySchema,
  IptvGuideNowResponseSchema,
  IptvGuideProgrammeDetailSchema,
  IptvGuideProgrammeIdSchema,
  IptvGuideProgrammesQuerySchema,
  IptvGuideProgrammesResponseSchema,
  IptvGuideQuerySchema,
  IptvGuideResponseSchema,
  V1_ROUTES,
  V1_ROUTE_IDS,
  V2_FILES,
  demoGuide,
  demoGuideChannelId,
  demoGuideChannels,
  demoGuideNow,
  demoGuideProgramme,
  demoGuideProgrammes,
  demoGuideStamp,
  hasGuideFlag,
  type IptvGuideProgramme,
} from '../src/index.js';
import { VARIANT_FIXTURES, WEB_FIXTURE_ROUTE_IDS, WEB_V1_FIXTURES } from '../scripts/fixtures.js';

const HOUR = 3_600_000;
/** Un sábado de octubre a las 18:30 UTC (20:30 en Madrid). */
const NOW = Date.UTC(2026, 9, 3, 18, 30);

describe('rutas y errores de la Guía TV', () => {
  it('5 rutas GET, solo web, del módulo iptv', () => {
    const guide = V1_ROUTE_IDS.filter((id) => id.startsWith('iptvGuide'));
    expect(guide.map((id) => `${id} ${V1_ROUTES[id].method} ${V1_ROUTES[id].path}`)).toEqual([
      'iptvGuide GET /api/v1/iptv/guide',
      'iptvGuideProgrammes GET /api/v1/iptv/guide/programmes',
      'iptvGuideProgramme GET /api/v1/iptv/guide/programmes/:id',
      'iptvGuideNow GET /api/v1/iptv/guide/now',
      'iptvGuideArt GET /api/v1/iptv/guide/art/:ref',
    ]);
    for (const id of guide) {
      const route = V1_ROUTES[id];
      expect(route.access, id).toBe('web');
      expect(route.credential, id).toBe('bearer');
      expect(route.module, id).toBe('iptv');
      expect(route.sideEffects, id).toBe(false);
    }
    expect(V1_ROUTES.iptvGuideArt.content).toBe('binary');
    expect(V1_ROUTES.iptvGuideProgrammes.errors).toEqual(['guide_unavailable', 'guide_stale']);
    /* Las 4 JSON tienen ejemplo en web/v1 (la app no las usa todavía). */
    expect(WEB_FIXTURE_ROUTE_IDS.filter((id) => id.startsWith('iptvGuide'))).toEqual([
      'iptvGuide',
      'iptvGuideProgrammes',
      'iptvGuideProgramme',
      'iptvGuideNow',
    ]);
  });

  it('3 códigos guide_*, públicos y sin estado antiguo; los 16 iptv_* no cambian', () => {
    expect(ERROR_CATALOG.guide_unavailable.status).toBe(409);
    expect(ERROR_CATALOG.guide_stale.status).toBe(409);
    expect(ERROR_CATALOG.guide_busy.status).toBe(503);
    for (const code of ['guide_unavailable', 'guide_stale', 'guide_busy'] as const) {
      expect(ERROR_CATALOG[code].public, code).toBe(true);
      expect(ERROR_CATALOG[code].legacyStatus, code).toBeNull();
    }
    expect(IPTV_ERROR_CODES).toHaveLength(16);
  });

  it('el fichero de la guía completa va junto a lo demás de la IPTV', () => {
    expect(V2_FILES.iptvGuideDb).toBe('v2/iptv/guia.db');
    expect(V2_FILES.iptvGuideDb.startsWith(`${V2_FILES.iptvDir}/`)).toBe(true);
  });
});

describe('esquemas', () => {
  it('iptvGuide: ámbito, página y límite; nada más', () => {
    expect(IptvGuideQuerySchema.parse({})).toEqual({});
    expect(IptvGuideQuerySchema.parse({ scope: 'all', offset: '200', limit: '0' })).toEqual({
      scope: 'all',
      offset: 200,
      limit: 0,
    });
    expect(IptvGuideQuerySchema.safeParse({ scope: 'deportes' }).success).toBe(false);
    expect(IptvGuideQuerySchema.safeParse({ limit: '1001' }).success).toBe(false);
    expect(IptvGuideQuerySchema.safeParse({ otro: '1' }).success).toBe(false);
  });

  it('iptvGuideProgrammes: hasta 60 canales sin ceros a la izquierda ni basura', () => {
    const ch = (n: number) => Array.from({ length: n }, (_, i) => i + 1).join(',');
    const base = { v: 'abc123', from: '0', to: String(HOUR) };
    expect(IptvGuideProgrammesQuerySchema.safeParse({ ...base, ch: ch(60) }).success).toBe(true);
    expect(IptvGuideProgrammesQuerySchema.safeParse({ ...base, ch: ch(61) }).success).toBe(false);
    for (const bad of ['', '0', '01', '1,,2', '1;2', 'a', '1,2,']) {
      expect(IptvGuideProgrammesQuerySchema.safeParse({ ...base, ch: bad }).success, bad).toBe(
        false,
      );
    }
    expect(IptvGuideProgrammesQuerySchema.safeParse({ ...base, ch: '1', v: 'ABC' }).success).toBe(
      false,
    );
  });

  it('ids de programa, referencias de imagen e ids de «ahora»', () => {
    expect(IptvGuideProgrammeIdSchema.safeParse('12.29324400').success).toBe(true);
    for (const bad of ['0.1', '12', '12.', '.1', '12.1.2', '12.-1', 'a.1']) {
      expect(IptvGuideProgrammeIdSchema.safeParse(bad).success, bad).toBe(false);
    }
    expect(IptvGuideArtParamsSchema.safeParse({ ref: 'c12' }).success).toBe(true);
    expect(IptvGuideArtParamsSchema.safeParse({ ref: 'p12.29324400' }).success).toBe(true);
    for (const bad of ['c0', 'x12', 'p12', 'c12.1', 'https://logo.example/a.png']) {
      expect(IptvGuideArtParamsSchema.safeParse({ ref: bad }).success, bad).toBe(false);
    }
    const id = 'a'.repeat(40);
    expect(IptvGuideNowQuerySchema.safeParse({ ids: `${id},${'b'.repeat(40)}` }).success).toBe(
      true,
    );
    expect(
      IptvGuideNowQuerySchema.safeParse({
        ids: Array.from({ length: IPTV_GUIDE_API.nowIdsMax + 1 }, () => id).join(','),
      }).success,
    ).toBe(false);
    expect(IptvGuideNowQuerySchema.safeParse({ ids: 'A'.repeat(40) }).success).toBe(false);
  });

  it('marcas: se suman y se leen por nombre', () => {
    const flags = GUIDE_FLAGS.live | GUIDE_FLAGS.detail;
    expect(hasGuideFlag(flags, 'live')).toBe(true);
    expect(hasGuideFlag(flags, 'detail')).toBe(true);
    expect(hasGuideFlag(flags, 'filler')).toBe(false);
    expect(new Set(Object.values(GUIDE_FLAGS)).size).toBe(Object.keys(GUIDE_FLAGS).length);
  });

  it('los ejemplos de fixtures validan', () => {
    expect(IptvGuideResponseSchema.safeParse(WEB_V1_FIXTURES.iptvGuide).success).toBe(true);
    expect(
      IptvGuideProgrammesResponseSchema.safeParse(WEB_V1_FIXTURES.iptvGuideProgrammes).success,
    ).toBe(true);
    expect(
      IptvGuideProgrammeDetailSchema.safeParse(WEB_V1_FIXTURES.iptvGuideProgramme).success,
    ).toBe(true);
    expect(IptvGuideNowResponseSchema.safeParse(WEB_V1_FIXTURES.iptvGuideNow).success).toBe(true);
    for (const name of ['iptvGuide.todos', 'iptvGuide.inactiva', 'iptvGuide.preparando'] as const) {
      expect(IptvGuideResponseSchema.safeParse(VARIANT_FIXTURES[name]).success, name).toBe(true);
    }
    /* El ejemplo del trozo trae programas de verdad (no un trozo vacío). */
    expect(
      WEB_V1_FIXTURES.iptvGuideProgrammes.channels.every((channel) => channel.programmes.length),
    ).toBe(true);
  });
});

/** Comprueba que una fila de programas está ordenada, sin solapes y con duraciones creíbles. */
function expectTidy(programmes: readonly IptvGuideProgramme[]): void {
  for (let index = 0; index < programmes.length; index += 1) {
    const item = programmes[index] as IptvGuideProgramme;
    expect(item.end).toBeGreaterThan(item.start);
    expect(item.end - item.start).toBeLessThanOrEqual(24 * HOUR);
    const next = programmes[index + 1];
    if (next) expect(next.start).toBeGreaterThanOrEqual(item.end);
  }
}

describe('guía de ejemplo (demo de la web)', () => {
  it('estado y canales: favoritos en su orden con uno sin guía; «Todos» con España primero y números seguidos', () => {
    const favorites = demoGuide({}, NOW);
    expect(IptvGuideResponseSchema.parse(favorites)).toBeTruthy();
    expect(favorites.state).toBe('ready');
    expect(favorites.scope).toBe('favorites');
    expect(favorites.channels.some((row) => row.guide === null && row.number === null)).toBe(true);
    expect(favorites.channels.every((row) => row.favorite)).toBe(true);
    expect(favorites.favorites).toBe(favorites.channels.filter((row) => row.guide).length);
    const all = demoGuide({ scope: 'all', limit: 1000 }, NOW);
    expect(all.total).toBe(all.all);
    expect(all.channels.map((row) => row.number)).toEqual(
      all.channels.map((_, index) => index + 1),
    );
    const firstForeign = all.channels.findIndex((row) => row.country !== null);
    expect(firstForeign).toBeGreaterThan(0);
    expect(all.channels.slice(firstForeign).every((row) => row.country !== null)).toBe(true);
    /* Página: offset y limit. */
    const page = demoGuide({ scope: 'all', offset: 10, limit: 5 }, NOW);
    expect(page.channels.map((row) => row.number)).toEqual([11, 12, 13, 14, 15]);
    expect(page.offset).toBe(10);
  });

  it('el sello cambia cada 8 h y la ventana va de 24 h antes a 80 h después', () => {
    const stamp = demoGuideStamp(NOW);
    expect(stamp.version).toMatch(/^[a-z0-9]{1,16}$/);
    expect(stamp.from).toBe(stamp.builtAt - IPTV_GUIDE_STORE.pastMs);
    expect(stamp.to).toBe(stamp.builtAt + IPTV_GUIDE_STORE.futureMs);
    expect(demoGuideStamp(stamp.builtAt + 8 * HOUR - 1).version).toBe(stamp.version);
    expect(demoGuideStamp(stamp.builtAt + 8 * HOUR).version).not.toBe(stamp.version);
  });

  it('un trozo: ordenado, sin solapes, valida; dos trozos que se solapan dicen lo mismo', () => {
    const { version } = demoGuideStamp(NOW);
    const ch = demoGuideChannels()
      .slice(0, 30)
      .map((row) => row.guide)
      .join(',');
    const from = Date.UTC(2026, 9, 3, 12);
    const a = demoGuideProgrammes({ v: version, ch, from, to: from + 6 * HOUR }, NOW);
    const b = demoGuideProgrammes(
      { v: version, ch, from: from + 3 * HOUR, to: from + 9 * HOUR },
      NOW,
    );
    expect(IptvGuideProgrammesResponseSchema.parse(a)).toBeTruthy();
    expect(a.channels).toHaveLength(30);
    for (const [index, channel] of a.channels.entries()) {
      expect(channel.programmes.length, String(channel.guide)).toBeGreaterThan(0);
      expectTidy(channel.programmes);
      for (const item of channel.programmes) {
        expect(item.end).toBeGreaterThan(from);
        expect(item.start).toBeLessThan(from + 6 * HOUR);
      }
      /* Lo que cae en las 3 h comunes es idéntico. */
      const overlap = (list: readonly IptvGuideProgramme[]) =>
        list.filter((item) => item.end > from + 3 * HOUR && item.start < from + 6 * HOUR);
      expect(overlap(channel.programmes)).toEqual(
        overlap(b.channels[index]?.programmes as IptvGuideProgramme[]),
      );
    }
    /* Determinista: la misma petición da lo mismo. */
    expect(demoGuideProgrammes({ v: version, ch, from, to: from + 6 * HOUR }, NOW)).toEqual(a);
  });

  it('hay partidos en directo, huecos de madrugada y un bloque de relleno', () => {
    const { version } = demoGuideStamp(NOW);
    const rows = demoGuideChannels();
    const guideOf = (name: string) => rows.find((row) => row.name === name)?.guide as number;
    const day = Date.UTC(2026, 9, 3);
    const slice = (name: string, from: number) =>
      demoGuideProgrammes(
        { v: version, ch: String(guideOf(name)), from, to: from + 12 * HOUR },
        NOW,
      ).channels[0]?.programmes ?? [];
    const football = slice('M+ LaLiga TV', day + 12 * HOUR);
    expect(
      football.some(
        (item) => hasGuideFlag(item.flags, 'live') && item.title.startsWith('LaLiga EA Sports'),
      ),
    ).toBe(true);
    const night = slice('Canal Sur', day);
    expect(night.some((item) => item.start < day + 2 * HOUR)).toBe(true);
    expect(night.every((item) => item.end <= day + 2 * HOUR || item.start >= day + 6 * HOUR)).toBe(
      true,
    );
    const odisea = slice('Odisea', day);
    expect(odisea.some((item) => hasGuideFlag(item.flags, 'filler') && item.title === '')).toBe(
      true,
    );
  });

  it('ficha, «ahora / después» y errores con el código del servidor', () => {
    const { version } = demoGuideStamp(NOW);
    const channel = demoGuideChannels()[0];
    const slice = demoGuideProgrammes(
      { v: version, ch: String(channel?.guide), from: NOW - HOUR, to: NOW + HOUR },
      NOW,
    );
    const onAir = slice.channels[0]?.programmes.find((item) => item.start <= NOW && item.end > NOW);
    expect(onAir).toBeDefined();
    const detail = demoGuideProgramme(onAir?.id as string, { v: version }, NOW);
    expect(IptvGuideProgrammeDetailSchema.parse(detail)).toBeTruthy();
    expect(detail.id).toBe(onAir?.id);
    const now = demoGuideNow({ ids: `${channel?.id},${'0'.repeat(40)}` }, NOW);
    expect(IptvGuideNowResponseSchema.parse(now)).toBeTruthy();
    expect(now.items[0]?.now?.id).toBe(onAir?.id);
    expect(now.items[0]?.next?.start).toBe(onAir?.end);
    expect(now.items[1]).toEqual({ id: '0'.repeat(40), guide: null, now: null, next: null });
    const code = (task: () => unknown): string => {
      try {
        task();
      } catch (error) {
        return error instanceof DemoGuideError ? `${error.code} ${error.status}` : 'otro';
      }
      return 'ok';
    };
    expect(
      code(() => demoGuideProgrammes({ v: 'viejo', ch: '1', from: NOW, to: NOW + 1 }, NOW)),
    ).toBe('guide_stale 409');
    expect(
      code(() => demoGuideProgrammes({ v: version, ch: '1', from: NOW, to: NOW + 13 * HOUR }, NOW)),
    ).toBe('validation_error 400');
    expect(code(() => demoGuideProgramme('1.1', { v: version }, NOW))).toBe('not_found 404');
  });

  it('los ids de canal tienen la forma de un id IPTV y no se repiten', () => {
    const ids = demoGuideChannels().map((row) => row.id);
    expect(ids.every((id) => /^[a-f0-9]{40}$/.test(id))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    expect(demoGuideChannelId('La 1')).toBe(demoGuideChannelId('La 1'));
  });
});
