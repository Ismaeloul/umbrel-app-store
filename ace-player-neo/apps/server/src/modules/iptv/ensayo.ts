/* Ensayo con la IPTV real de Isma (docs/iptv.md §9.2), SIN tocar ningún
   stream ni escribir nada.

   Lee la configuración (`v2/iptv.json`), el catálogo y la guía ya guardados
   (`catalogo.enc`, `guia.enc`) y la agenda (del backend que está corriendo o
   de un fichero), y dice, ya tapado (sin URLs ni credenciales), qué IPTV
   saldría para cada partido de hoy y mañana, con su puntuación y si la
   confirma la guía, más las pistas para AceStream. Así Isma lo comprueba
   antes de un partido sin reproducir nada.

   Dentro del contenedor de la app:   node server.js --iptv-ensayo
   En el PC, contra una copia de /data (con la misma semilla):
     DATA_DIR=./copia ACE_SEED=… tsx apps/server/scripts/iptv-ensayo.ts --agenda agenda.json */

import { existsSync, readFileSync } from 'node:fs';
import { FootballScheduleSchema, IptvFileSchema, type FootballSchedule } from '@ace/shared';
import { loadConfig, type Env } from '../../config/index.js';
import { createSilentLogger } from '../../core/logger.js';
import { resolutionChannels, scoreResolutionCandidate } from '../football/resolution.js';
import { channelName } from '../football/programming.js';
import { addIsoDays, isoDateInMadrid, madridLocalToEpoch } from '../football/time.js';
import { loadIptvKeys } from './crypto.js';
import { iptvLayer } from './layer.js';
import { IptvFiles } from './store.js';

export interface EnsayoOptions {
  readonly env: Env;
  /**
   * Backend del que pedir la agenda (`http://[::1]:3100`) o la URL entera de la agenda. Por defecto, el
   * backend que corre en este contenedor (`127.0.0.1:PORT`).
   */
  readonly api?: string;
  /** Fichero JSON con la agenda (`GET /api/v1/football`), en vez de pedirla. */
  readonly agendaFile?: string;
  readonly now?: number;
  readonly print: (line: string) => void;
  /** Para pedir la agenda (tests). */
  readonly fetchJson?: (url: string) => Promise<unknown>;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { headers: { 'x-ace-origin': 'web' } });
  if (!response.ok) throw new Error(`la agenda respondió ${response.status}`);
  return response.json();
}

/** Ruta de la agenda (`footballSchedule`, docs/api.md). */
export const AGENDA_PATH = '/api/v1/football';

/** URL de la agenda: `api` puede ser solo el backend (`http://[::1]:3100`) o ya la URL entera. */
export function agendaUrl(api: string): string {
  const trimmed = api.trim().replace(/\/+$/, '');
  return /\/api\//.test(trimmed) ? trimmed : `${trimmed}${AGENDA_PATH}`;
}

function quality(value: string | null): string {
  switch (value) {
    case 'fhd':
      return '1080p';
    case 'hd':
      return '720p';
    case 'uhd':
      return '4K';
    case 'sd':
      return 'SD';
    default:
      return 'sin marca';
  }
}

/** Devuelve el código de salida (0 bien; 1 si falta algo). */
export async function runIptvEnsayo(options: EnsayoOptions): Promise<number> {
  const { print } = options;
  const { config } = loadConfig(options.env);
  const paths = config.paths;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(paths.iptvFile, 'utf8'));
  } catch {
    print(`No hay IPTV guardada en ${paths.iptvFile}.`);
    return 1;
  }
  const parsed = IptvFileSchema.safeParse(raw);
  const provider = parsed.success ? parsed.data.provider : null;
  if (!provider) {
    print('No hay IPTV guardada (o iptv.json no se entiende).');
    return 1;
  }
  if (config.security.seedSource === 'ephemeral' && !existsSync(paths.iptvKeyFile)) {
    print('Sin ACE_SEED ni ENGINE_CONTROL_TOKEN y sin v2/iptv/clave: no se puede descifrar nada.');
    return 1;
  }
  const keys = loadIptvKeys(config);
  const files = new IptvFiles(paths, () => keys, createSilentLogger(), true);
  const catalog = await files.loadCatalog(provider.id);
  if (!catalog) {
    print('No hay catálogo guardado de esta IPTV (o no se puede descifrar con esta semilla).');
    return 1;
  }
  const guide = await files.loadGuide(provider.id);
  print(
    `IPTV «${provider.name}» (${provider.kind === 'xtream' ? 'Xtream' : 'M3U'}, ${provider.host}${
      provider.enabled ? '' : ', EN PAUSA'
    }): ${catalog.size} canales; guía: ${guide ? `${guide.programmes} programas` : 'sin guía'}.`,
  );

  let schedule: FootballSchedule;
  try {
    const value = options.agendaFile
      ? (JSON.parse(readFileSync(options.agendaFile, 'utf8')) as unknown)
      : await (options.fetchJson ?? defaultFetchJson)(
          agendaUrl(options.api ?? `http://127.0.0.1:${config.port}`),
        );
    schedule = FootballScheduleSchema.parse(value);
  } catch (error) {
    print(`No se pudo leer la agenda: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const now = options.now ?? Date.now();
  const today = isoDateInMadrid(now);
  const days = new Set([today, addIsoDays(today, 1)]);
  const scorer = (
    channels: readonly string[],
    item: { id: string; title: string; alias?: string | null },
  ) => scoreResolutionCandidate(channels, item, 'iptv');
  let withIptv = 0;
  let total = 0;
  for (const day of schedule.days) {
    if (!days.has(day.date)) continue;
    for (const match of day.matches) {
      total += 1;
      const announced = match.channels.map((channel) => channelName(channel)).filter(Boolean);
      const start = match.start ?? madridLocalToEpoch(match.date, match.time);
      const layer = iptvLayer(
        catalog,
        guide,
        resolutionChannels(announced),
        {
          id: match.id,
          home: match.home,
          away: match.away,
          competition: match.competition,
          title: match.title,
          start,
          channels: announced,
        },
        scorer,
      );
      const head = `${match.date} ${match.time} · ${match.home} – ${match.away} · ${match.competition} · agenda: ${
        announced.join(', ') || 'sin canales'
      }`;
      print(head);
      if (!layer.matches.length) {
        print('   sin IPTV');
        continue;
      }
      withIptv += 1;
      layer.matches.forEach((item, index) => {
        /* Un cartel por variante de resolución (§16): «1080p · 4K · 720p · SD reserva». */
        const posters = item.posters
          .map((entry) => `${quality(entry.quality)}${entry.backup ? ' reserva' : ''}`)
          .join(' · ');
        print(
          `   ${index + 1}. ${item.best.display}${item.bucket ? ` (${item.bucket})` : ''}${
            item.guide ? ' [guía]' : ''
          } · ${item.score} · ${posters}${item.hidden.length ? ` · ${item.hidden.length} de respaldo` : ''}`,
        );
      });
      if (layer.hints.length) print(`   pistas para AceStream: ${layer.hints.join(', ')}`);
    }
  }
  print(`${withIptv} de ${total} partidos de hoy y mañana saldrían por la IPTV.`);
  return 0;
}
