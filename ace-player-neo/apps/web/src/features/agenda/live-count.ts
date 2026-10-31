/* Partidos de hoy en directo ahora: el contador rojo de «Agenda» en el menú
   lateral. Usa la misma consulta que la Agenda (no pide nada aparte) y la
   hora de inicio, sin marcadores: el menú no debe pedir resultados.

   El menú pinta antes que la Agenda, así que es quien pide la agenda primero:
   importa demo.ts para que en demo no se quede con el ejemplo del fixture. */

import './demo.ts';
import { countLive, madridClock } from './domain.ts';
import './demo.ts';
import { useNow, useSchedule } from './data.ts';

export function useLiveCountToday(): number {
  const now = useNow();
  const schedule = useSchedule();
  const today = madridClock(now).date;
  const matches = schedule.data?.days.find((day) => day.date === today)?.matches ?? [];
  return countLive(matches, now);
}
