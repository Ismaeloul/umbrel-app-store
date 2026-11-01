/* Avisos («Te aviso», rediseño de escritorio): la lista de programas de los
   que quieres un aviso antes de que empiecen. Cuánto antes lo dice el ajuste
   «Avisos» de Ajustes (settings/local-prefs.ts, 5 min por defecto), el mismo
   que el de los partidos de Mis equipos (settings/match-alerts.tsx); con
   «Nunca» no sale ningún aviso.

   - Viven en ESTE navegador (localStorage con try/catch, lib/storage.ts):
     son una comodidad por visor, como el tema. Otra pestaña abierta se
     entera por el evento `storage`.
   - El aviso sale con una notificación del navegador si diste permiso (se
     pide al pulsar «Te aviso», nunca solo); si no, con un toast, y solo con
     la página abierta: sin service worker no hay aviso con ella cerrada.
   - Un único temporizador para el próximo aviso, armado mientras haya alguien
     mirando (`useAvisosClock`, que lo pone <AvisosClock/> en el armazón:
     siempre montado, fuera de las vistas, así que también avisa viendo una
     película o un partido sin barra de sección). Los ya empezados se tiran
     solos.
   - Con varias pestañas abiertas, avisa solo la primera que llega: antes de
     avisar se relee lo guardado y se apunta como avisado (las demás ya lo ven
     así). Pulsar la notificación lleva a la ficha del partido o a la Guía
     (`setAvisoOpener`, lo pone también <AvisosClock/>, que tiene el router). */

import { useEffect } from 'react';
import { createStore, useStore } from '../../lib/store.ts';
import { readJson, writeJson } from '../../lib/storage.ts';
import { notify } from '../../notices/index.ts';
import { localPrefs } from '../settings/local-prefs.ts';

export const AVISOS_KEY = 'aceneo-avisos';
/** Cuánto antes de empezar sale el aviso si no se ha tocado el ajuste «Avisos». */
export const AVISO_LEAD_MS = 5 * 60_000;

/** Cuánto antes sale el aviso según el ajuste «Avisos»; `null` = «Nunca». */
export function avisoLeadMs(): number | null {
  const lead = localPrefs.get().alertLead;
  return lead === null ? null : lead * 60_000;
}
/** Un aviso que se pasó con la página cerrada aún sale si el programa empezó hace menos de esto. */
const LATE_MS = 60_000;
/** El temporizador nunca espera más (se vuelve a mirar: relojes que se duermen, cambios de hora). */
const MAX_WAIT_MS = 15 * 60_000;
const MAX_AVISOS = 100;

export interface Aviso {
  /** `guia:<id del programa>`: el mismo programa no se apunta dos veces. */
  id: string;
  title: string;
  /** Nombre del canal. */
  channel: string;
  /** Epoch ms. */
  start: number;
  end: number;
  /** Partido de la Agenda, si lo es (para «Ver ficha» desde la campana). */
  match?: string;
  /** Ya salió el aviso. */
  fired?: boolean;
}

function isAviso(value: unknown): value is Aviso {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.id === 'string' &&
    typeof item.title === 'string' &&
    typeof item.channel === 'string' &&
    typeof item.start === 'number' &&
    typeof item.end === 'number' &&
    (item.match === undefined || typeof item.match === 'string') &&
    (item.fired === undefined || typeof item.fired === 'boolean')
  );
}

const isAvisoList = (value: unknown): value is Aviso[] =>
  Array.isArray(value) && value.every(isAviso);

/** Lo que queda pendiente o empezando: fuera lo que ya terminó, en orden de hora. */
export function pruneAvisos(list: readonly Aviso[], now: number): Aviso[] {
  return list
    .filter((aviso) => aviso.end > now && aviso.start > now - 6 * 60 * 60_000)
    .sort((a, b) => a.start - b.start)
    .slice(0, MAX_AVISOS);
}

function load(now = Date.now()): Aviso[] {
  return pruneAvisos(readJson(AVISOS_KEY, isAvisoList) ?? [], now);
}

const avisos = createStore<readonly Aviso[]>(load());

function save(next: readonly Aviso[]): void {
  avisos.set(next);
  writeJson(AVISOS_KEY, next);
  arm();
}

export function getAvisos(): readonly Aviso[] {
  return avisos.get();
}

export function useAvisos(): readonly Aviso[] {
  return useStore(avisos);
}

export function useHasAviso(id: string): boolean {
  return useStore(avisos, (list) => list.some((aviso) => aviso.id === id));
}

export function addAviso(aviso: Aviso): void {
  const rest = avisos.get().filter((item) => item.id !== aviso.id);
  save(pruneAvisos([...rest, { ...aviso, fired: false }], Date.now()));
}

export function removeAviso(id: string): void {
  const list = avisos.get();
  if (list.some((aviso) => aviso.id === id)) save(list.filter((aviso) => aviso.id !== id));
}

/** Solo para los tests: vuelve a leer lo guardado y para el reloj. */
export function resetAvisos(): void {
  window.clearTimeout(timer);
  timer = 0;
  watchers = 0;
  window.removeEventListener('storage', onStorage);
  stopPrefs();
  stopPrefs = () => {};
  avisos.set(load());
}

// ---- Permiso de notificaciones -----------------------------------------------------------

export type NoticePermission = NotificationPermission | 'unsupported';

export function noticePermission(): NoticePermission {
  try {
    return typeof Notification === 'function' ? Notification.permission : 'unsupported';
  } catch {
    return 'unsupported';
  }
}

/** Se pide al pulsar «Te aviso» (un gesto del usuario), solo si aún no se ha contestado. */
export async function askNoticePermission(): Promise<NoticePermission> {
  const now = noticePermission();
  if (now !== 'default') return now;
  try {
    return await Notification.requestPermission();
  } catch {
    return noticePermission();
  }
}

// ---- Avisar -----------------------------------------------------------------------------

const TIME = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' });

/** «Empieza en 5 min», «Empieza ya» o «Ha empezado». */
export function avisoWhen(start: number, now: number): string {
  const minutes = Math.round((start - now) / 60_000);
  if (minutes > 0) return `Empieza en ${minutes} min`;
  if (minutes === 0) return 'Empieza ya';
  return 'Ha empezado';
}

let opener: ((aviso: Aviso) => void) | null = null;

/** Qué hacer al pulsar la notificación (<AvisosClock/>: la ficha del partido o la Guía). */
export function setAvisoOpener(next: ((aviso: Aviso) => void) | null): void {
  opener = next;
}

function fire(aviso: Aviso, now: number): void {
  const when = `${avisoWhen(aviso.start, now)} · ${aviso.channel} · ${TIME.format(aviso.start)}`;
  if (noticePermission() === 'granted') {
    try {
      const shown = new Notification(aviso.title, { body: when, tag: aviso.id, lang: 'es-ES' });
      shown.onclick = () => {
        try {
          window.focus();
        } catch {}
        opener?.(aviso);
        shown.close();
      };
      return;
    } catch {
      // Algunos navegadores (Chrome en Android) solo notifican desde un service worker: toast.
    }
  }
  notify(`${aviso.title}: ${when}`, { icon: 'campana', ms: 10_000 });
}

/** Los avisos que tocan ahora con esa antelación (`null` = «Nunca»: ninguno). */
export function dueAvisos(
  list: readonly Aviso[],
  now: number,
  lead: number | null = avisoLeadMs(),
): Aviso[] {
  if (lead === null) return [];
  return list.filter(
    (aviso) => !aviso.fired && aviso.start - lead <= now && aviso.start > now - LATE_MS,
  );
}

const sameAvisos = (a: readonly Aviso[], b: readonly Aviso[]): boolean =>
  a.length === b.length &&
  a.every((aviso, index) => aviso.id === b[index]?.id && aviso.fired === b[index]?.fired);

let timer = 0;
let watchers = 0;

function tick(): void {
  timer = 0;
  const now = Date.now();
  /* Lo guardado manda (otra pestaña puede haber avisado ya); si no se puede
     leer (navegación privada), lo de memoria. */
  const stored = readJson(AVISOS_KEY, isAvisoList);
  const list = stored ? pruneAvisos(stored, now) : avisos.get();
  const due = dueAvisos(list, now);
  const dueIds = new Set(due.map((aviso) => aviso.id));
  const next = pruneAvisos(
    list.map((aviso) =>
      dueIds.has(aviso.id) || (!aviso.fired && aviso.start <= now - LATE_MS)
        ? { ...aviso, fired: true }
        : aviso,
    ),
    now,
  );
  if (!sameAvisos(next, list)) {
    // Primero se apunta como avisado y luego se avisa: la otra pestaña ya no repite.
    avisos.set(next);
    writeJson(AVISOS_KEY, next);
  } else if (!sameAvisos(next, avisos.get())) avisos.set(next);
  for (const aviso of due) fire(aviso, now);
  arm();
}

function arm(): void {
  window.clearTimeout(timer);
  timer = 0;
  if (watchers === 0) return;
  const lead = avisoLeadMs();
  if (lead === null) return;
  const now = Date.now();
  const pending = avisos.get().filter((aviso) => !aviso.fired);
  if (!pending.length) return;
  const next = Math.min(...pending.map((aviso) => aviso.start - lead));
  const wait = Math.max(0, Math.min(MAX_WAIT_MS, next - now));
  timer = window.setTimeout(tick, wait);
}

function onStorage(event: StorageEvent): void {
  if (event.key !== AVISOS_KEY) return;
  avisos.set(load());
  arm();
}

let stopPrefs: () => void = () => {};

/** Mantiene el reloj de los avisos mientras el componente esté montado (<AvisosClock/>). */
export function useAvisosClock(): void {
  useEffect(() => {
    watchers += 1;
    if (watchers === 1) {
      window.addEventListener('storage', onStorage);
      // Cambiar «Avisos» en Ajustes vuelve a armar el reloj con la antelación nueva.
      stopPrefs = localPrefs.subscribe(arm);
    }
    tick();
    return () => {
      watchers -= 1;
      if (watchers === 0) {
        window.removeEventListener('storage', onStorage);
        stopPrefs();
        stopPrefs = () => {};
        window.clearTimeout(timer);
        timer = 0;
      }
    };
  }, []);
}
