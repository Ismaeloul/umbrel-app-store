/* Catálogo de programación: los canales y partidos de la última agenda
   (server.js:2564-2577, 2682-2721). La resolución lo usa para no fiarse del
   nombre de canal que manda el cliente (B-231) y la IA para comparar cada
   fuente con toda la parrilla (B-165, B-166). En la 0.6.59 era un global
   (`footballProgramming`); aquí cada servicio tiene el suyo. */

import { cleanTitle, normalizeChannelKey } from '@ace/shared';
import { footballScheduleMatches } from './agenda-sources.js';
import { FOOTBALL_FALLBACK_COMPETITION } from './constants.js';

/** Partido del catálogo (`ProgramMatch`, api.md §3.14). */
export interface ProgramEntry {
  readonly id: string;
  readonly title: string;
  readonly home: string;
  readonly away: string;
  readonly competition: string;
  readonly date: string;
  readonly time: string;
  readonly start: number | null;
  readonly channels: string[];
}

/** `cleanTitle(channel?.name ?? channel, "")`: los canales son `{ id, name }` o texto. */
export function channelName(channel: unknown): string {
  const named =
    channel !== null && channel !== undefined
      ? (channel as { readonly name?: unknown }).name
      : undefined;
  return cleanTitle(named ?? channel, '');
}

/** `footballProgramChannelNames` (server.js:2564-2577): canales de toda la agenda, sin repetir por clave. T-020. */
export function footballProgramChannelNames(payload: unknown): string[] {
  const output: string[] = [];
  const seen = new Set<string>();
  for (const match of footballScheduleMatches(payload)) {
    for (const channel of Array.isArray(match.channels) ? (match.channels as unknown[]) : []) {
      const name = channelName(channel);
      const key = normalizeChannelKey(name);
      if (!name || !key || seen.has(key)) continue;
      seen.add(key);
      output.push(name);
    }
  }
  return output;
}

export class ProgrammingCatalog {
  private programChannels: string[] = [];
  private programMatches = new Map<string, ProgramEntry>();

  /** Canales de la última agenda. */
  get channels(): readonly string[] {
    return this.programChannels;
  }

  /**
   * `rememberFootballProgramming` (server.js:2682-2697), sin la parte de la IA
   * (el calentado lo hace el servicio). Devuelve los canales recordados.
   */
  remember(payload: unknown): string[] {
    const matches = footballScheduleMatches(payload);
    this.programChannels = footballProgramChannelNames(payload);
    this.programMatches = new Map(
      matches.map((match) => {
        const id = String(match.id || '');
        return [
          id,
          {
            id,
            title: cleanTitle(match.title, 'Partido'),
            home: cleanTitle(match.home, ''),
            away: cleanTitle(match.away, ''),
            competition: cleanTitle(match.competition, FOOTBALL_FALLBACK_COMPETITION),
            date: cleanTitle(match.date, ''),
            time: cleanTitle(match.time, ''),
            start: Number(match.start) || null,
            channels: (Array.isArray(match.channels) ? (match.channels as unknown[]) : [])
              .map(channelName)
              .filter(Boolean),
          },
        ];
      }),
    );
    return this.programChannels;
  }

  /** `footballProgramMatch` (server.js:2719-2721): el partido por id, o null. */
  match(id: unknown): ProgramEntry | null {
    return this.programMatches.get(String(id || '')) || null;
  }
}
