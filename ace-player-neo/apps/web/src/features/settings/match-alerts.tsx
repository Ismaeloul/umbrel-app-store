/* «Avisos» de Ajustes (rediseño, sección 7: «Antes de empezar · 5 min»).
   Con la pestaña abierta en el escritorio, un aviso cuando va a empezar un
   partido de Mis equipos, con «Ver» para abrirlo. Es el aviso de siempre
   (notify → toast), no una notificación del sistema: no pide permisos ni
   sigue avisando con la pestaña cerrada (eso necesitaría el servidor).

   - Cuánto antes: «Avisos» (local-prefs.ts). «Nunca» lo apaga, y sin
     equipos en Mis equipos no se pide nada. El mismo ajuste manda en los
     avisos de la campana («Te aviso» de la Guía, features/avisos).
   - Cada partido avisa una vez por pestaña. Si la abres con el partido ya
     empezado (más de un minuto), no se avisa de algo que ya ves en la agenda.
   - Un partido con aviso en la campana no avisa aquí: ya lo hace ella, y si
     no, el mismo partido saldría dos veces.
   - El toast dura 10 s, como el de la campana. Con el vídeo a pantalla
     completa no se pinta ningún toast: el aviso espera y sale al salir, si
     el partido sigue dentro del plazo.
   - En el móvil no: allí no está el ajuste y el móvil no cambia. */

import type { FootballMatch, FootballSchedule, Preferences } from '@ace/shared';
import { useEffect } from 'react';
import { useApiQuery } from '../../api/index.ts';
import { useNavigate } from '../../app/router.tsx';
import { useLayoutKind } from '../../lib/media.ts';
import { notify, useNoticeFlags } from '../../notices/index.ts';
import { useNow } from '../agenda/data.ts';
import { getAvisos } from '../avisos/store.ts';
import { isMine, matchTitle, minutesToMatch } from '../agenda/domain.ts';
import type { AlertLead } from './local-prefs.ts';
import { useLocalPrefs } from './local-prefs.ts';

/** Un partido que ya empezó hace más de esto no avisa (al abrir la pestaña tarde). */
const LATE_MIN = 1;

/** Lo que dura el toast (el de la campana dura lo mismo). */
const ALERT_MS = 10_000;

/** Partidos ya avisados en esta pestaña. */
const seen = new Set<string>();

/** Los partidos que ya tienen un aviso en la campana («Te aviso»): avisa ella. */
function belledMatches(): Set<string> {
  const out = new Set<string>();
  for (const aviso of getAvisos()) if (aviso.match) out.add(aviso.match);
  return out;
}

export interface DueAlert {
  match: FootballMatch;
  minutes: number;
}

/** Puro: los partidos de tus equipos de los que toca avisar ahora (sin los ya
    avisados ni los que avisa la campana, `belled`). */
export function dueAlerts(
  schedule: Pick<FootballSchedule, 'days'> | undefined,
  preferences: Preferences | undefined,
  lead: AlertLead,
  now: number,
  done: ReadonlySet<string> = seen,
  belled: ReadonlySet<string> = new Set(),
): DueAlert[] {
  if (lead === null || !schedule || !preferences?.teams?.length) return [];
  const out: DueAlert[] = [];
  for (const day of schedule.days) {
    for (const match of day.matches) {
      if (done.has(match.id) || belled.has(match.id) || !isMine(match, preferences)) continue;
      const minutes = minutesToMatch(match, now);
      if (minutes === null || minutes > lead || minutes < -LATE_MIN) continue;
      out.push({ match, minutes });
    }
  }
  return out;
}

/** «Real Madrid – Barcelona empieza en 5 min» / «… empieza ya». */
export function alertText({ match, minutes }: DueAlert): string {
  const title = matchTitle(match);
  return minutes <= 0 ? `${title} empieza ya` : `${title} empieza en ${minutes} min`;
}

/** Va en el armazón (Shell): no pinta nada, solo avisa. */
export function MatchAlerts() {
  const desk = useLayoutKind() !== 'mobile';
  const { alertLead } = useLocalPrefs();
  const on = desk && alertLead !== null;
  const prefs = useApiQuery('preferencesGet', undefined, { enabled: on });
  const preferences = prefs.data?.preferences;
  const wanted = on && !!preferences?.teams?.length;
  // La misma consulta que la agenda (la caché es compartida).
  const schedule = useApiQuery('footballSchedule', undefined, {
    enabled: wanted,
    staleTime: 10 * 60_000,
  });
  const now = useNow();
  const navigate = useNavigate();
  // A pantalla completa no se pinta ningún toast: se espera a salir.
  const { immersive } = useNoticeFlags();

  useEffect(() => {
    if (!wanted || immersive) return;
    for (const due of dueAlerts(
      schedule.data,
      preferences,
      alertLead,
      now,
      seen,
      belledMatches(),
    )) {
      seen.add(due.match.id);
      notify(alertText(due), {
        tone: 'info',
        icon: 'campana',
        ms: ALERT_MS,
        action: {
          label: 'Ver',
          onAction: () => navigate({ vista: 'partido', id: due.match.id, canal: null }),
        },
      });
    }
  }, [wanted, immersive, schedule.data, preferences, alertLead, now, navigate]);

  return null;
}

/** Solo para los tests. */
export function resetMatchAlertsForTests(): void {
  seen.clear();
}
