/* El escenario: qué pinta el vídeo falso según el reproductor y el objetivo
   (partido o canal), y las acciones del centro de partido compartidas. */

import { useMemo } from 'react';
import type { LiveScore, Match, Source, Team } from '../../../core/types';
import { addManualSource, derivePhase, isEngaged, itemById, markCorrect, playChannel, reportSource, research, stop, useNow, useSim, type SourceSession } from '../../../core/store';
import { scoreAt } from '../../../core/score';
import { team } from '../../../core/data/teams';
import { navigate } from '../../../core/router';
import { matchOnChannel } from './library';
import { compName, matchTitle } from './text';
import type { MenuItem } from './sheets';
import { openInItems } from './sheets';
import { simulate } from './player';

/** Títulos de resultados del motor (no están en la biblioteca). */
export const ENGINE_TITLES = new Map<string, string>();

export function engineHash(title: string): string {
  let h = 2166136261;
  for (const c of title) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  let s = '';
  for (let i = 0; i < 40; i++) {
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    s += (h & 15).toString(16);
  }
  return s;
}

export interface StageInfo {
  kind: 'match' | 'channel';
  id: string;
  match: Match | null;
  score: LiveScore | null;
  title: string;
  subtitle: string;
  isTarget: boolean;
  engaged: boolean;
  active: Source | undefined;
  activeIndex: number;
  session: SourceSession | undefined;
  home: Team;
  away: Team;
  videoKind: 'broadcast' | 'studio';
  playing: boolean;
  quality: 'ok' | 'weak' | 'frozen';
  channelLabel: string | undefined;
  phase: ReturnType<typeof derivePhase>;
  external: boolean;
}

export function useStageInfo(kind: 'match' | 'channel', id: string): StageInfo {
  const player = useSim((s) => s.player);
  const agenda = useSim((s) => s.agenda);
  const session = useSim((s) => s.sourceSessions[`${kind}:${id}`]);
  const now = useNow();
  return useMemo(() => {
    const match = kind === 'match' ? (agenda.find((m) => m.id === id) ?? null) : null;
    const item = kind === 'channel' ? itemById(id) : undefined;
    const external = kind === 'channel' && !item;
    const isTarget = player.target?.kind === kind && player.target.id === id;
    // Con objetivo ya hay «partido en marcha» aunque el comprobador siga buscando la primera señal.
    const engaged = isTarget && isEngaged(player);
    const active = isTarget && player.target?.sourceId ? session?.sources.find((s) => s.id === player.target!.sourceId) : undefined;
    const activeIndex = active && session ? session.sources.indexOf(active) + 1 : 0;
    const chMatch = kind === 'channel' && item ? matchOnChannel(item.title, agenda, now) : null;
    const m = match ?? chMatch?.match ?? null;
    const score = m ? scoreAt(m, now) : null;
    const home = m ? team(m.home) : team('esp-nt');
    const away = m ? team(m.away) : team('fra-nt');
    const videoKind: 'broadcast' | 'studio' = score?.state === 'in' ? 'broadcast' : 'studio';
    const playing = engaged ? player.conn === 'activa' && player.media === 'playing' : true;
    const quality: 'ok' | 'weak' | 'frozen' = engaged ? (player.conn === 'reconectando' || player.media === 'buffering' ? 'frozen' : active?.state === 'weak' ? 'weak' : 'ok') : 'ok';
    const title = kind === 'match' && match ? matchTitle(match) : (item?.title ?? ENGINE_TITLES.get(id) ?? 'Enlace pegado');
    const subtitle = kind === 'match' && match ? compName(match.competition) : external ? 'Fuente externa' : (item?.category ?? 'Canal');
    const channelLabel = active?.matchedChannel ?? item?.title ?? m?.channels[0]?.name;
    return { kind, id, match: m, score, title, subtitle, isTarget, engaged, active, activeIndex, session, home, away, videoKind, playing, quality, channelLabel, phase: derivePhase(player), external };
  }, [kind, id, player, agenda, session, now]);
}

/** Acciones del menú «Más» del centro de partido. */
export function moreItems(info: StageInfo, opts: { onPaste: () => void; onReport: (s: Source) => void; onTech: () => void; onOpenIn: (items: MenuItem[]) => void; onSessions: () => void }): MenuItem[] {
  const { kind, id, active, engaged } = info;
  const items: MenuItem[] = [
    { id: 'rebuscar', label: 'Rebuscar señales', icon: 'refresh', hint: 'Sin cortar lo que estás viendo', run: () => research(kind, id) },
    { id: 'pegar', label: 'Pegar un Content ID', icon: 'paste', run: opts.onPaste },
  ];
  if (active) {
    items.push({ id: 'correcto', label: 'Es el canal correcto', icon: 'check', hint: 'Se recordará para la próxima', run: () => markCorrect(kind, id, active.id, true) });
    items.push({ id: 'reportar', label: 'Reportar la fuente en pantalla', icon: 'flag', run: () => opts.onReport(active) });
    items.push({ id: 'abrir', label: 'Abrir en…', icon: 'external', run: () => opts.onOpenIn(openInItems(active)) });
  }
  items.push({ id: 'tech', label: 'Datos técnicos', icon: 'info', run: opts.onTech });
  items.push({ id: 'donde', label: 'Dónde se está reproduciendo', icon: 'devices', run: opts.onSessions });
  if (engaged) items.push({ id: 'stop', label: 'Detener', icon: 'stop', danger: true, run: () => stop('usuario') });
  return items;
}

/** Acciones de una fuente concreta. */
export function sourceItems(info: StageInfo, s: Source, opts: { onReport: (s: Source) => void; onOpenIn: (items: MenuItem[]) => void; onSelect: () => void }): MenuItem[] {
  const { kind, id } = info;
  return [
    { id: 'ver', label: 'Ver esta fuente', icon: 'play', run: opts.onSelect, disabled: s.state === 'failed' },
    { id: 'ok', label: 'Es el canal correcto', icon: 'check', run: () => markCorrect(kind, id, s.id, true) },
    { id: 'no', label: 'No es este canal', icon: 'x', run: () => markCorrect(kind, id, s.id, false) },
    { id: 'rep', label: 'Reportar…', icon: 'flag', run: () => opts.onReport(s) },
    { id: 'abrir', label: 'Abrir en…', icon: 'external', run: () => opts.onOpenIn(openInItems(s)) },
  ];
}

export function doReport(info: StageInfo, s: Source, reason: string) {
  reportSource(info.kind, info.id, s.id, reason);
}

export function doPaste(info: StageInfo, hash: string) {
  addManualSource(info.kind, info.id, hash);
}

/** Ver un canal de «Dónde se emite» (si está en la biblioteca). */
export function openChannelByName(name: string, items: { id: string; title: string }[]): boolean {
  const it = items.find((c) => c.title === name);
  if (!it) {
    simulate('copy');
    return false;
  }
  playChannel(it.id);
  navigate('canal', it.id);
  return true;
}
