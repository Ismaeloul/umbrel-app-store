/* Ajustes que de momento solo viven en este navegador (rediseño, sección 7):
   el servidor aún no los guarda, así que van a localStorage con try/catch
   (lib/storage.ts) y, si no se puede escribir, duran lo que la pestaña.

   - «Cambiar de fuente sola»: si la que suena se corta, pasar a la siguiente
     buena. Por defecto, sí (es lo que ya hace el reproductor).
   - «Avisos»: cuántos minutos antes de empezar avisar de un partido.
   - «Idioma preferido»: el idioma que se prefiere cuando hay varias fuentes.

   Quien los use los lee con `localPrefs.get()` o `useLocalPrefs()`. */

import { readItem, STORAGE_KEYS, writeItem } from '../../lib/storage.ts';
import { createStore, useStore } from '../../lib/store.ts';

/** Minutos antes de empezar; `null` = sin avisos. */
export type AlertLead = 0 | 5 | 10 | 15 | 30 | null;
export type PreferredLang = 'es' | 'en' | 'original';

export interface LocalPrefs {
  autoSwitch: boolean;
  alertLead: AlertLead;
  preferredLang: PreferredLang;
}

export const ALERT_LEADS: readonly AlertLead[] = [0, 5, 10, 15, 30, null];
export const DEFAULT_ALERT_LEAD: AlertLead = 5;

export const LANG_LABEL: Record<PreferredLang, string> = {
  es: 'Español',
  en: 'Inglés',
  original: 'Original',
};

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

function readLang(): PreferredLang {
  const raw = readItem(STORAGE_KEYS.preferredLang);
  return raw === 'en' || raw === 'original' ? raw : 'es';
}

function read(): LocalPrefs {
  return {
    autoSwitch: readItem(STORAGE_KEYS.autoSwitch) !== 'no',
    alertLead: readLead(),
    preferredLang: readLang(),
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

export function setPreferredLang(lang: PreferredLang): void {
  writeItem(STORAGE_KEYS.preferredLang, lang);
  localPrefs.set((s) => ({ ...s, preferredLang: lang }));
}

export function useLocalPrefs(): LocalPrefs {
  return useStore(localPrefs);
}

/** Solo para los tests: vuelve a leer lo guardado. */
export function resetLocalPrefsForTests(): void {
  localPrefs.set(read());
}
