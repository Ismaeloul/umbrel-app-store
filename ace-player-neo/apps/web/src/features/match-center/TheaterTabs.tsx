/* Panel con pestañas del teatro (plan Palco fase 2, decisión W5): debajo del
   vídeo en el móvil y la tableta (o con el panel lateral plegado) y en el
   panel lateral desde 1024 px. Partido: Fuentes · Partido · Datos técnicos;
   canal suelto: Fuentes (si hay hermanas) · Canal · Datos técnicos.

   - Pestañas de ui/ (Tabs: role tablist/tab/tabpanel, flechas, la gota que
     se desliza) y un toque háptico de selección al cambiar (HAPTIC_MAP).
   - Los paneles que no se ven siguen MONTADOS (con `hidden`): los atajos de
     las fuentes (N, 1-9) funcionan desde cualquier pestaña y cambiar de
     pestaña no vuelve a pedir nada.
   - La pestaña elegida se recuerda en la sesión de la pestaña del navegador
     (sessionStorage), una para partidos y otra para canales.
   - «Datos técnicos» va de la mano de la tecla S: S (o «Datos técnicos» en
     «Más opciones» del vídeo) abre esta pestaña y otra S vuelve a la de
     antes; elegir la pestaña a mano también lo apunta en el reproductor. */

import type { FootballMatch, LiveScore } from '@ace/shared';
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { cx } from '../../lib/cx.ts';
import { haptic } from '../../lib/haptics.ts';
import { readJson, writeJson } from '../../lib/storage.ts';
import { createStore, useStore } from '../../lib/store.ts';
import { setNerdOpen, usePlayerSelector } from '../../player/api.ts';
import { Tabs, tabPanelProps, type SegmentItem } from '../../ui/index.ts';
import type { ChannelInfo } from '../agenda/domain.ts';
import { useSession } from '../sources/session.ts';
import type { SourceListVariant } from '../sources/SourceList.tsx';
import { SourcesPanel } from '../sources/SourcesPanel.tsx';
import { MatchPanel } from './MatchPanel.tsx';
import { NerdSection } from './NerdSection.tsx';

export type TheaterTab = 'fuentes' | 'partido' | 'canal' | 'datos';
export type TheaterKind = 'match' | 'channel';
type Memory = Record<TheaterKind, TheaterTab>;

const STORAGE_KEY = 'aceneo-teatro-pestana';
const ALL_TABS: readonly TheaterTab[] = ['fuentes', 'partido', 'canal', 'datos'];
const DEFAULTS: Memory = { match: 'fuentes', channel: 'fuentes' };

const isTab = (value: unknown): value is TheaterTab =>
  typeof value === 'string' && (ALL_TABS as readonly string[]).includes(value);
const isMemory = (value: unknown): value is Partial<Record<TheaterKind, unknown>> =>
  typeof value === 'object' && value !== null;

function savedMemory(): Memory {
  const saved = readJson(STORAGE_KEY, isMemory, 'session');
  return {
    match: isTab(saved?.match) ? saved.match : DEFAULTS.match,
    channel: isTab(saved?.channel) ? saved.channel : DEFAULTS.channel,
  };
}

/** La pestaña elegida, por tipo de teatro (la comparten la vista y el panel lateral). */
export const theaterTabStore = createStore<Memory>(savedMemory());

function remember(kind: TheaterKind, tab: TheaterTab): void {
  theaterTabStore.set((memory) => (memory[kind] === tab ? memory : { ...memory, [kind]: tab }));
  writeJson(STORAGE_KEY, theaterTabStore.get(), 'session');
}

/** Solo para los tests: vuelve a «Fuentes». */
export function resetTheaterTabsForTests(): void {
  theaterTabStore.set(DEFAULTS);
}

export interface TheaterTabDef {
  value: TheaterTab;
  label: string;
  count?: number;
  content: ReactNode;
}

export interface TheaterTabsProps {
  kind: TheaterKind;
  tabs: readonly TheaterTabDef[];
  /** A la derecha de las pestañas: plegar o mostrar el panel lateral. */
  extra?: ReactNode;
  className?: string;
}

export function TheaterTabs({ kind, tabs, extra, className }: TheaterTabsProps) {
  const prefix = `mc-tabs-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const stored = useStore(theaterTabStore, (memory) => memory[kind]);
  const values = tabs.map((tab) => tab.value);
  const fallback = values[0] ?? 'fuentes';
  const value = values.includes(stored) ? stored : fallback;
  const hasNerd = values.includes('datos');

  // La última pestaña que no era «Datos técnicos»: a ella vuelve la segunda S.
  const lastPlain = useRef<TheaterTab>(value === 'datos' ? fallback : value);
  useEffect(() => {
    if (value !== 'datos') lastPlain.current = value;
  }, [value]);

  const nerdOpen = usePlayerSelector((state) => state.nerdOpen);
  const seenNerd = useRef(nerdOpen);
  useEffect(() => {
    if (seenNerd.current === nerdOpen) return;
    seenNerd.current = nerdOpen;
    if (!hasNerd) return;
    if (nerdOpen) remember(kind, 'datos');
    else if (theaterTabStore.get()[kind] === 'datos') remember(kind, lastPlain.current);
  }, [nerdOpen, hasNerd, kind]);

  // Se vuelve a una sesión con «Datos técnicos» elegida: el reproductor lo sabe.
  const openedWithNerd = useRef(value === 'datos');
  useEffect(() => {
    if (openedWithNerd.current) setNerdOpen(true);
  }, []);

  const onChange = (next: TheaterTab) => {
    if (next === value) return;
    haptic('selection');
    remember(kind, next);
    if (hasNerd) setNerdOpen(next === 'datos');
  };

  const items: SegmentItem<TheaterTab>[] = tabs.map(({ value: tab, label, count }) =>
    count ? { value: tab, label, count } : { value: tab, label },
  );

  return (
    <div className={cx('mc-tabs', className)}>
      <div className="mc-tabs__bar">
        <Tabs
          label={kind === 'match' ? 'Panel del partido' : 'Panel del canal'}
          items={items}
          value={value}
          onChange={onChange}
          idPrefix={prefix}
          block
          className="mc-tabs__list"
        />
        {extra}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.value}
          {...tabPanelProps(prefix, tab.value)}
          className="mc-tabs__panel"
          hidden={tab.value !== value}
        >
          {tab.content}
        </div>
      ))}
    </div>
  );
}

export interface MatchTabsProps {
  /** Sin partido (ya no está en la agenda, pero hay sesión): sin pestaña «Partido». */
  match: FootballMatch | null;
  score: LiveScore | null;
  now: number;
  channels: readonly ChannelInfo[];
  today: string;
  variant: SourceListVariant;
  extra?: ReactNode;
  className?: string;
}

/** Las pestañas de un partido: Fuentes · Partido · Datos técnicos. */
export function MatchTabs({
  match,
  score,
  now,
  channels,
  today,
  variant,
  extra,
  className,
}: MatchTabsProps) {
  const count = useSession((state) => (state.kind === 'match' ? state.entries.length : 0));
  const tabs: TheaterTabDef[] = [
    {
      value: 'fuentes',
      label: 'Fuentes',
      count,
      content: <SourcesPanel variant={variant} className="mc-sources" />,
    },
  ];
  if (match)
    tabs.push({
      value: 'partido',
      label: 'Partido',
      content: (
        <MatchPanel match={match} score={score} now={now} channels={channels} today={today} />
      ),
    });
  tabs.push({ value: 'datos', label: 'Datos técnicos', content: <NerdSection /> });
  return <TheaterTabs kind="match" tabs={tabs} extra={extra} className={className} />;
}
