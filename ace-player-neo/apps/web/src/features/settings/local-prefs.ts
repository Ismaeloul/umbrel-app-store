/* Ajustes que de momento solo viven en este navegador (rediseño, sección 7):
   el servidor aún no los guarda, así que van a localStorage con try/catch
   (lib/storage.ts) y, si no se puede escribir, duran lo que la pestaña. Se
   cambian en la portada de escritorio (desde 768 px); quien no los toca
   tiene lo de siempre.

   - «Cambiar de fuente sola»: si la que suena se corta, pasar a la siguiente
     buena. Por defecto, sí (es lo que ya hacía el reproductor). Lo lee
     sources/session.ts al caerse una fuente y en el salto de entrada.
   - «Avisos»: cuántos minutos antes de empezar avisar de un partido de tus
     equipos (match-alerts.tsx) y de lo que apuntaste con «Te aviso» en la
     Guía (avisos/store.ts), con la pestaña abierta. «Nunca» apaga los dos.
   - «Idioma preferido»: el idioma en el que quieres oír los partidos. Por
     ahora solo se guarda y su fila no sale en la portada (Overview.tsx): ni
     el servidor ni las fuentes saben aún de qué idioma es cada emisión, y
     un ajuste que no hace nada confunde. (El de Películas y series es otro:
     lo guarda el servidor, vodLanguages, y se elige en su cabecera.) */

import { readItem, STORAGE_KEYS, writeItem } from '../../lib/storage.ts';
import { createStore, useStore } from '../../lib/store.ts';

/** Minutos antes de empezar; `null` = sin avisos. */
export type AlertLead = 0 | 5 | 10 | 15 | 30 | null;

/** Idioma de los partidos: español, inglés o el de la emisión. */
export type PlaybackLang = 'es' | 'en' | 'original';

export interface LocalPrefs {
  autoSwitch: boolean;
  alertLead: AlertLead;
  lang: PlaybackLang;
}

export const ALERT_LEADS: readonly AlertLead[] = [0, 5, 10, 15, 30, null];
export const DEFAULT_ALERT_LEAD: AlertLead = 5;

export const PLAYBACK_LANGS: readonly { value: PlaybackLang; label: string }[] = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'Inglés' },
  { value: 'original', label: 'Original' },
];
export const DEFAULT_LANG: PlaybackLang = 'es';

/** «5 min», «Al empezar», «Nunca». */
export function alertLeadLabel(lead: AlertLead): string {
  if (lead === null) return 'Nunca';
  if (lead === 0) return 'Al empezar';
  return `${lead} min`;
}

function readLead(): AlertLead {
  const raw = readItem(STORAGE_KEYS.alertLead);
  if (raw === 'no') return null;
  const n = Number(raw);
  return raw !== null && ALERT_LEADS.includes(n as AlertLead)
    ? (n as AlertLead)
    : DEFAULT_ALERT_LEAD;
}

function readLang(): PlaybackLang {
  const raw = readItem(STORAGE_KEYS.playbackLang);
  return PLAYBACK_LANGS.find((option) => option.value === raw)?.value ?? DEFAULT_LANG;
}

function read(): LocalPrefs {
  return {
    autoSwitch: readItem(STORAGE_KEYS.autoSwitch) !== 'no',
    alertLead: readLead(),
    lang: readLang(),
  };
}

export const localPrefs = createStore<LocalPrefs>(read());

export function setAutoSwitch(on: boolean): void {
  writeItem(STORAGE_KEYS.autoSwitch, on ? 'si' : 'no');
  localPrefs.set((s) => ({ ...s, autoSwitch: on }));
}

export function setAlertLead(lead: AlertLead): void {
  writeItem(STORAGE_KEYS.alertLead, lead === null ? 'no' : String(lead));
  localPrefs.set((s) => ({ ...s, alertLead: lead }));
}

export function setPlaybackLang(lang: PlaybackLang): void {
  writeItem(STORAGE_KEYS.playbackLang, lang);
  localPrefs.set((s) => ({ ...s, lang }));
}

export function useLocalPrefs(): LocalPrefs {
  return useStore(localPrefs);
}

/** Solo para los tests: vuelve a leer lo guardado. */
export function resetLocalPrefsForTests(): void {
  localPrefs.set(read());
}
