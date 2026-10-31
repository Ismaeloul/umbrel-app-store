/* Partidos de hoy en directo ahora: el contador rojo de «Agenda» en el menú
   lateral. Usa la misma consulta que la Agenda (no pide nada aparte) y la
   hora de inicio, sin marcadores: el menú no debe pedir resultados.

   El menú es lo primero que pide la agenda: en la demo tiene que registrar
   sus respuestas aquí (si no, la caché se queda con el ejemplo genérico de
   @ace/shared, «Equipo Local», y la Agenda lo hereda). */

import './demo.ts';
import { countLive, madridClock } from './domain.ts';
import { useNow, useSchedule } from './data.ts';

export function useLiveCountToday(): number {
  const now = useNow();
  const schedule = useSchedule();
  const today = madridClock(now).date;
  const matches = schedule.data?.days.find((day) => day.date === today)?.matches ?? [];
  return countLive(matches, now);
}
