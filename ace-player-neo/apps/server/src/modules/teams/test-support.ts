/* Piezas comunes de los tests del módulo `teams`: el servicio de verdad con
   un cliente `net` de verdad sobre DNS de tabla y transporte falso (nada sale
   a la red), una agenda falsa, respuestas de TheSportsDB con el formato real
   y PNG sintéticos con colores exactos. Reloj falso siempre. */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import type { FootballMatch, FootballSchedule } from '@ace/shared';
import { vi, type Mock } from 'vitest';
import { createTestCore, type TestCore } from '../../../test/helpers/index.js';
import type { Env } from '../../config/index.js';
import { AppError } from '../../core/errors.js';
import { THESPORTSDB_BASE } from '../football/index.js';
import type { FootballService } from '../football/types.js';
import { createNetClient, type NetClient } from '../net/index.js';
import { fakeTransport, tableResolver, type FakeHandler, type FakeReply } from '../net/testing.js';
import { TEAMS_REQUEST_GAP_MS } from './constants.js';
import { BUNDLED_OVERRIDES } from './index.js';
import type { Overrides } from './normalize.js';
import { PNG_SIGNATURE } from './png.js';
import { TeamsServiceImpl, type TeamsServiceOptions } from './service.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Un fixture de fixtures/ como texto. */
export function fixture(name: string): string {
  return readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
}

// --- URLs de TheSportsDB (clave de prueba `123`) ---

export const API = `${THESPORTSDB_BASE}/123`;
export const searchTeamsUrl = (query: string): string =>
  `${API}/searchteams.php?t=${encodeURIComponent(query)}`;
export const lookupTeamUrl = (id: string): string => `${API}/lookupteam.php?id=${id}`;
export const searchLeaguesUrl = (country: string): string =>
  `${API}/search_all_leagues.php?s=Soccer&c=${encodeURIComponent(country)}`;
export const lookupLeagueUrl = (id: string): string => `${API}/lookupleague.php?id=${id}`;
export const BADGE_URL = 'https://r2.thesportsdb.com/images/media/team/badge/wq9sir1639406443.png';
export const LEAGUE_BADGE_URL =
  'https://r2.thesportsdb.com/images/media/league/badge/ja4it51687628717.png';

export function json(body: unknown): FakeReply {
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export function png(bytes: Buffer): FakeReply {
  return { status: 200, headers: { 'content-type': 'image/png' }, body: bytes };
}

/** Una fila de `searchteams.php` con el formato real (el Barça por defecto). */
export function apiTeam(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idTeam: '133739',
    strTeam: 'Barcelona',
    strTeamShort: 'FCB',
    strAlternate: 'FC Barcelona',
    strLeague: 'Spanish La Liga',
    idLeague: '4335',
    strCountry: 'Spain',
    strSport: 'Soccer',
    strBadge: BADGE_URL,
    strColour1: '#004d98',
    strColour2: '#a50044',
    ...overrides,
  };
}

/** Una fila de `lookupleague.php` (LaLiga por defecto). */
export function apiLeague(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    idLeague: '4335',
    strLeague: 'Spanish La Liga',
    strSport: 'Soccer',
    strCountry: 'Spain',
    strBadge: LEAGUE_BADGE_URL,
    strLogo: null,
    ...overrides,
  };
}

// --- Agenda ---

let seq = 0;

export function match(
  home: string,
  away: string,
  extra: Partial<FootballMatch> = {},
): FootballMatch {
  seq += 1;
  return {
    id: `t-${seq}`,
    date: '2026-01-02',
    time: '21:00',
    title: `${home} - ${away}`,
    home,
    away,
    /* "Fútbol" está en `skip` en overrides.json: así un test de equipos no consulta ligas. */
    competition: 'Fútbol',
    country: 'España',
    channels: [],
    ...extra,
  };
}

/** Agenda con estos partidos agrupados por día (en orden de fecha). */
export function schedule(
  matches: readonly FootballMatch[],
  extra: Partial<FootballSchedule> = {},
): FootballSchedule {
  const byDate = new Map<string, FootballMatch[]>();
  for (const item of matches) {
    const list = byDate.get(item.date) ?? [];
    list.push(item);
    byDate.set(item.date, list);
  }
  return {
    generatedAt: '2026-01-01T00:00:00.000Z',
    timezone: 'Europe/Madrid',
    country: 'Spain',
    source: 'futbolenlatv',
    attribution: 'futbolenlatv.com',
    demo: false,
    limited: false,
    partial: false,
    days: [...byDate.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, list]) => ({ date, matches: list })),
    ...extra,
  };
}

// --- PNG sintéticos ---

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xff] as number) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

export type Rgba = readonly [number, number, number, number];

export interface PngSpec {
  readonly width: number;
  readonly height: number;
  /** 0 gris, 2 RGB, 3 paleta, 4 gris+alfa, 6 RGBA. */
  readonly colorType: 0 | 2 | 3 | 4 | 6;
  readonly bitDepth?: number;
  /** Filtro de cada fila (0..4), fijo o por fila. */
  readonly filter?: number | ((y: number) => number);
  readonly interlace?: number;
  readonly palette?: readonly (readonly [number, number, number])[];
  readonly trns?: readonly number[];
  /** Muestras del píxel (una por canal; en paleta y gris < 8 bits, el índice o el valor). */
  readonly sample: (x: number, y: number) => readonly number[];
}

/** Codifica un PNG válido (con CRC) a partir de sus muestras: así los colores esperados son exactos. */
export function encodePng(spec: PngSpec): Buffer {
  const depth = spec.bitDepth ?? 8;
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[spec.colorType];
  const rowBytes = Math.ceil((spec.width * channels * depth) / 8);
  const bpp = Math.max(1, (channels * depth) >> 3);
  const rows: Buffer[] = [];
  let prev = Buffer.alloc(rowBytes);
  for (let y = 0; y < spec.height; y += 1) {
    const raw = Buffer.alloc(rowBytes);
    for (let x = 0; x < spec.width; x += 1) {
      const samples = spec.sample(x, y);
      if (depth === 8) {
        for (let c = 0; c < channels; c += 1) raw[x * channels + c] = samples[c] ?? 0;
      } else {
        const bit = x * depth;
        raw[bit >> 3] = (raw[bit >> 3] as number) | ((samples[0] ?? 0) << (8 - depth - (bit & 7)));
      }
    }
    const filter = typeof spec.filter === 'function' ? spec.filter(y) : (spec.filter ?? 0);
    const out = Buffer.alloc(rowBytes + 1);
    out[0] = filter;
    for (let x = 0; x < rowBytes; x += 1) {
      const a = x >= bpp ? (raw[x - bpp] as number) : 0;
      const b = prev[x] as number;
      const c = x >= bpp ? (prev[x - bpp] as number) : 0;
      const value = raw[x] as number;
      let predicted: number;
      switch (filter) {
        case 1:
          predicted = a;
          break;
        case 2:
          predicted = b;
          break;
        case 3:
          predicted = (a + b) >> 1;
          break;
        case 4:
          predicted = paeth(a, b, c);
          break;
        default:
          predicted = 0;
      }
      out[x + 1] = (value - predicted) & 0xff;
    }
    rows.push(out);
    prev = raw;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(spec.width, 0);
  ihdr.writeUInt32BE(spec.height, 4);
  ihdr[8] = depth;
  ihdr[9] = spec.colorType;
  ihdr[12] = spec.interlace ?? 0;
  const parts = [PNG_SIGNATURE, pngChunk('IHDR', ihdr)];
  if (spec.palette) parts.push(pngChunk('PLTE', Buffer.from(spec.palette.flat())));
  if (spec.trns) parts.push(pngChunk('tRNS', Buffer.from(spec.trns)));
  parts.push(pngChunk('IDAT', deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

/** PNG RGBA de un solo color. */
export function solidPng(width: number, height: number, rgba: Rgba): Buffer {
  return encodePng({ width, height, colorType: 6, sample: () => rgba });
}

/**
 * Escudo de juguete: fondo transparente, un borde de `border` píxeles y
 * dentro la mitad izquierda de un color y la derecha de otro.
 */
export function twoTonePng(
  width: number,
  height: number,
  left: Rgba,
  right: Rgba,
  border = 0,
): Buffer {
  return encodePng({
    width,
    height,
    colorType: 6,
    sample: (x, y) => {
      if (x < border || y < border || x >= width - border || y >= height - border)
        return [0, 0, 0, 0];
      return x < width / 2 ? left : right;
    },
  });
}

// --- Arnés ---

export type FakeFootball = Pick<FootballService, 'schedule'> & {
  readonly schedule: Mock<() => Promise<FootballSchedule>>;
};

export interface TeamsHarness {
  readonly core: TestCore;
  readonly teams: TeamsServiceImpl;
  readonly transport: ReturnType<typeof fakeTransport>;
  readonly net: NetClient;
  readonly football: FakeFootball;
}

export interface TeamsHarnessOptions {
  readonly env?: Env;
  /** Agenda que devuelve `football.schedule()`; `null` = falla con `football_unavailable`. */
  readonly schedule?: FootballSchedule | null | (() => Promise<FootballSchedule>);
  /** Respuestas del transporte por `href` exacto (o una función para todo). */
  readonly routes?: Record<string, FakeReply | FakeHandler> | FakeHandler;
  readonly overrides?: Overrides;
  readonly limits?: TeamsServiceOptions['limits'];
}

/**
 * El servicio de verdad con `net` de verdad (DNS de tabla y transporte
 * falso) y la agenda falsa. Por defecto, sin demo (así el módulo está
 * encendido) y con las correcciones empaquetadas.
 */
export function createTeams(options: TeamsHarnessOptions = {}): TeamsHarness {
  const core = createTestCore({ env: { FOOTBALL_DEMO_ONLY: 'false', ...options.env } });
  const transport = fakeTransport(options.routes ?? {});
  const resolver = tableResolver({
    'www.thesportsdb.com': [{ address: '93.184.216.34', family: 4 }],
    'r2.thesportsdb.com': [{ address: '93.184.216.35', family: 4 }],
  });
  const net = createNetClient({ ...core, resolver, transport });
  const source = options.schedule;
  const football = {
    schedule: vi.fn(async (): Promise<FootballSchedule> => {
      if (typeof source === 'function') return source();
      if (source === null) throw new AppError('football_unavailable');
      return source ?? schedule([]);
    }),
  } as FakeFootball;
  const teams = new TeamsServiceImpl(
    { ...core, net, football },
    {
      overrides: options.overrides ?? BUNDLED_OVERRIDES,
      ...(options.limits ? { limits: options.limits } : {}),
    },
  );
  return { core, teams, transport, net, football };
}

/** Deja correr las promesas y los streams del transporte falso (macrotareas). */
export async function flush(rounds = 4): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * Una vuelta completa: `runOnce` con el reloj falso avanzando lo justo para
 * las pausas entre peticiones (`clock.sleep`), hasta que termine.
 */
export async function runRound(
  harness: Pick<TeamsHarness, 'teams' | 'core'>,
  options?: { readonly budget?: number },
): Promise<void> {
  let settled = false;
  const run = harness.teams.runOnce(options).finally(() => {
    settled = true;
  });
  for (let index = 0; index < 500 && !settled; index += 1) {
    /* Bastantes macrotareas para que una descarga en curso termine antes de tocar el reloj. */
    await flush(12);
    if (!settled && harness.core.clock.pendingTimers() > 0) {
      await harness.core.clock.advanceAsync(TEAMS_REQUEST_GAP_MS);
    }
  }
  await run;
}
