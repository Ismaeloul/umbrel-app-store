/* La descarga de la guía XMLTV en UNA sola pasada con dos salidas
   (docs/iptv.md §20.3):

   1. la ventana de partidos de siempre (guide.ts: España o sin país, de
      ahora a +48 h, solo lo que parece un evento): `guia.enc`, guide-match.ts
      y la agenda híbrida, exactamente igual que antes;
   2. la guía COMPLETA de la Guía TV (guide-db.ts): todos los canales del
      catálogo de cualquier país, de 24 h antes a 80 h después, con su ficha
      limpia (guide-text.ts).

   Nunca guarda la guía entera en memoria: cada programa se mira, se mete en
   la ventana si toca y se escribe en disco. El tokenizador cede el hilo
   cada 12 ms de trabajo seguido. */

import type { Readable } from 'node:stream';
import { GUIDE_FLAGS, IPTV_GUIDE_STORE } from '@ace/shared';
import { GuideWindowCollector, type GuideWindow, type StoredProgramme } from './guide.js';
import type { GuideDetailInput, GuideProgrammeInput, GuideWriter } from './guide-db.js';
import {
  cleanGuideText,
  isFillerTitle,
  parseEpisode,
  parseYear,
  shortLabel,
  truncateWords,
} from './guide-text.js';
import { parseXmltvStream, type XmltvProgramme } from './xmltv.js';

/** URL de imagen que se puede guardar: http(s), sin usuario ni contraseña y de largo razonable. */
export function plainImageUrl(value: string | undefined): string | null {
  if (!value) return null;
  const text = value.trim();
  if (text.length > 1024) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  return url.href;
}

export interface FullGuideOptions {
  readonly now: number;
  /** Canales de la ventana de partidos (`tvg-id` en minúsculas → `tvg-shift`): España o sin país. */
  readonly eventChannels: ReadonlyMap<string, number>;
  /** Todos los `tvg-id` del catálogo (cualquier país) → `tvg-shift`. */
  readonly allChannels: ReadonlyMap<string, number>;
  /** Dónde se escribe la guía completa; null: solo la ventana (como antes). */
  readonly writer: GuideWriter | null;
  /**
   * ¿Se puede guardar esta URL de imagen? El servicio descarta las que
   * llevan algo de las credenciales (su redactor). Por defecto, todas las
   * que pasan `plainImageUrl`.
   */
  readonly acceptImage?: (url: string) => boolean;
  readonly signal?: AbortSignal;
}

export interface FullGuideResult {
  /** La ventana de partidos (puede quedar vacía aunque la guía completa tenga programas). */
  readonly window: GuideWindow;
  /** Programas que trae la guía (todos, antes de filtrar). */
  readonly parsed: number;
  /**
   * El disco falló al escribir la guía completa: se dejó de escribir (quien
   * llama la deshace) pero la ventana de partidos se terminó igual.
   */
  readonly writerError: unknown;
}

/** La ficha limpia de un programa, o null si no trae nada más que el título. */
export function detailOf(
  programme: XmltvProgramme,
  acceptImage: (url: string) => boolean,
): GuideDetailInput | null {
  const subTitle = cleanGuideText(programme.subTitle, IPTV_GUIDE_STORE.subTitleChars);
  const description = cleanGuideText(programme.desc, IPTV_GUIDE_STORE.descChars);
  const categories = [
    ...new Set(
      programme.categories
        .map((category) => cleanGuideText(category, IPTV_GUIDE_STORE.categoryChars))
        .filter(Boolean),
    ),
  ].slice(0, IPTV_GUIDE_STORE.categoriesMax);
  const episode = parseEpisode(programme.episodeNums);
  const year = parseYear(programme.date);
  const rating = shortLabel(programme.rating);
  const stars = shortLabel(programme.stars);
  const clean = (list: readonly string[] | undefined, max: number): string[] =>
    [
      ...new Set(
        (list ?? [])
          .map((name) => cleanGuideText(name, IPTV_GUIDE_STORE.creditChars))
          .filter(Boolean),
      ),
    ].slice(0, max);
  const directors = clean(programme.directors, IPTV_GUIDE_STORE.directorsMax);
  const actors = clean(programme.actors, IPTV_GUIDE_STORE.actorsMax);
  const url = plainImageUrl(programme.icon);
  const icon = url && acceptImage(url) ? url : null;
  if (
    !subTitle &&
    !description &&
    !categories.length &&
    !episode.season &&
    !episode.episode &&
    !episode.text &&
    year === null &&
    !rating &&
    !stars &&
    !directors.length &&
    !actors.length &&
    !icon
  ) {
    return null;
  }
  return {
    subTitle,
    description,
    categories,
    season: episode.season,
    episode: episode.episode,
    episodeText: episode.text,
    year,
    rating,
    stars,
    directors,
    actors,
    icon,
  };
}

/** Un programa del XMLTV listo para guardar (con el `tvg-shift` de su canal), o null si no vale. */
export function guideInputOf(
  programme: XmltvProgramme,
  tvg: string,
  shiftHours: number,
  acceptImage: (url: string) => boolean,
): GuideProgrammeInput | null {
  if (programme.start === null) return null;
  const offset = programme.naiveTime ? shiftHours * 3_600_000 : 0;
  const start = programme.start + offset;
  const stop = programme.stop === null ? null : programme.stop + offset;
  const title = cleanGuideText(programme.title, IPTV_GUIDE_STORE.titleChars);
  let flags = 0;
  if (programme.live) flags |= GUIDE_FLAGS.live;
  if (programme.isNew) flags |= GUIDE_FLAGS.new;
  if (programme.previouslyShown) flags |= GUIDE_FLAGS.repeat;
  if (isFillerTitle(title)) flags |= GUIDE_FLAGS.filler;
  return {
    tvg,
    start,
    stop,
    title,
    flags,
    clumpFollower: Boolean(programme.clump && programme.clump.index > 0),
    detail: flags & GUIDE_FLAGS.filler ? null : detailOf(programme, acceptImage),
  };
}

/**
 * Lee una guía XMLTV (ya descomprimida) y da la ventana de partidos; si hay
 * `writer`, a la vez escribe la guía completa (sin cerrarla: eso lo hace
 * quien llama con `writer.finish()`). Solo lanza si se aborta o falla el disco.
 */
export async function buildFullGuide(
  body: Readable,
  options: FullGuideOptions,
): Promise<FullGuideResult> {
  const collector = new GuideWindowCollector({ now: options.now, channels: options.eventChannels });
  let writer = options.writer;
  let writerError: unknown = null;
  const accept = options.acceptImage ?? (() => true);
  /* Un fallo del disco no tumba la ventana de partidos: se deja de escribir y se sigue leyendo. */
  const write = (task: (target: GuideWriter) => void): void => {
    if (!writer) return;
    try {
      task(writer);
    } catch (error) {
      writerError = error;
      writer = null;
    }
  };
  const { programmes } = await parseXmltvStream(
    body,
    {
      onChannel(channel) {
        const tvg = channel.id.trim().toLowerCase();
        if (!options.allChannels.has(tvg)) return;
        const url = plainImageUrl(channel.icon);
        if (url && accept(url)) write((target) => target.channel(tvg, url));
      },
      onProgramme(programme) {
        collector.add(programme);
        if (!writer) return;
        const tvg = programme.channel.trim().toLowerCase();
        const shift = options.allChannels.get(tvg);
        if (shift === undefined) return;
        const input = guideInputOf(programme, tvg, shift, accept);
        if (input) write((target) => target.add(input));
      },
    },
    {
      ...(options.signal ? { signal: options.signal } : {}),
      sliceMs: IPTV_GUIDE_STORE.sliceMs,
    },
  );
  return { window: collector.finish(), parsed: programmes, writerError };
}

/**
 * El respaldo de Xtream (`get_short_epg`, 40 canales): lo mismo a la guía
 * completa, para que la parrilla enseñe al menos esos canales (`partial`).
 */
export function writeShortEpg(writer: GuideWriter, list: readonly StoredProgramme[]): void {
  for (const programme of list) {
    const title = cleanGuideText(programme.title, IPTV_GUIDE_STORE.titleChars);
    const description = cleanGuideText(programme.desc, IPTV_GUIDE_STORE.descChars);
    writer.add({
      tvg: programme.channel,
      start: programme.start,
      stop: programme.stop,
      title: title || truncateWords(programme.title.trim(), IPTV_GUIDE_STORE.titleChars),
      flags: isFillerTitle(title) ? GUIDE_FLAGS.filler : 0,
      clumpFollower: false,
      detail: description
        ? {
            subTitle: '',
            description,
            categories: [],
            season: null,
            episode: null,
            episodeText: null,
            year: null,
            rating: null,
            stars: null,
            directors: [],
            actors: [],
            icon: null,
          }
        : null,
    });
  }
}
