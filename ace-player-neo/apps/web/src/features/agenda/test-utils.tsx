/* Ayudas de los tests de la agenda y de las preferencias: partidos con horas
   relativas a un «ahora» fijo y el render con los proveedores que pone el
   armazón (datos, rutas y maquetación). Solo lo importan los *.test.tsx. */

import type { FootballMatch, FootballSchedule, LiveScore } from '@ace/shared';
import { QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { createQueryClient } from '../../api/query.ts';
import { LayoutContext, type LayoutValue } from '../../app/layout.tsx';
import { RouterProvider } from '../../app/router.tsx';
import type { LayoutKind } from '../../lib/media.ts';
import { madridClock, madridHour } from './domain.ts';

/** Miércoles 23-sep-2026, 20:30 en Madrid (18:30 UTC): el «ahora» de los ejemplos. */
export const NOW = Date.parse('2026-09-23T18:30:00.000Z');
export const TODAY = '2026-09-23';
const MINUTE = 60_000;

let counter = 0;

/** Un partido que empieza `minutes` minutos después de `now` (hora y fecha de Madrid). */
export function matchAt(
  minutes: number,
  overrides: Partial<FootballMatch> = {},
  now = NOW,
): FootballMatch {
  counter += 1;
  const start = now + minutes * MINUTE;
  const home = overrides.home ?? `Local ${counter}`;
  const away = overrides.away ?? `Visitante ${counter}`;
  return {
    id: `t-${counter}`,
    date: madridClock(start).date,
    time: madridHour(start) ?? '00:00',
    start,
    title: `${home} vs ${away}`,
    home,
    away,
    competition: 'LaLiga',
    country: 'Spain',
    channels: [{ id: `c-${counter}`, name: 'M+ LaLiga' }],
    ...overrides,
  };
}

export function scheduleOf(
  days: Record<string, FootballMatch[]>,
  extra: Partial<FootballSchedule> = {},
): FootballSchedule {
  return {
    generatedAt: new Date(NOW).toISOString(),
    timezone: 'Europe/Madrid',
    country: 'Spain',
    source: 'futbolenlatv',
    attribution: 'futbolenlatv.com',
    demo: false,
    limited: false,
    partial: false,
    days: Object.entries(days).map(([date, matches]) => ({ date, matches })),
    ...extra,
  };
}

export function liveScore(
  home: number,
  away: number,
  clock = "54'",
  detail = '2ª parte',
): LiveScore {
  return { home, away, state: 'in', clock, detail, confidence: 0.9 };
}

export function renderWithApp(
  ui: ReactNode,
  { kind = 'mobile' as LayoutKind, search = '' }: { kind?: LayoutKind; search?: string } = {},
) {
  const client = createQueryClient();
  // En los tests un fallo es un fallo: sin reintentos con espera.
  client.setDefaultOptions({ queries: { retry: false }, mutations: { retry: false } });
  const layout: LayoutValue = {
    kind,
    asideVisible: false,
    asideAvailable: false,
    setAsideOpen: () => {},
    columnVisible: false,
  };
  const result = render(
    <QueryClientProvider client={client}>
      <RouterProvider initialSearch={search}>
        <LayoutContext value={layout}>{ui}</LayoutContext>
      </RouterProvider>
    </QueryClientProvider>,
  );
  return { ...result, client };
}
