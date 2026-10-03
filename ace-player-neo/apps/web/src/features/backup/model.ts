/* Ajustes → Copia de seguridad (decisiones.md D24): lo que no es React.

   - La copia la hace el servidor (GET /api/v1/backup o, con la contraseña
     de la IPTV, POST /api/v1/backup/export). La web le añade `browser` (tema,
     transparencia y modo de reproducción: viven en este navegador) y la
     descarga como fichero.
   - Restaurar: se lee el fichero AQUÍ (tope de tamaño, JSON, objeto), se
     manda compacto a POST /api/v1/backup/import, primero en vista previa y,
     tras confirmar, de verdad. Lo de `browser` lo aplica la web.
   Textos en español, para enseñarlos tal cual. */

import {
  BACKUP_FORMAT,
  BACKUP_MAX_BYTES,
  BACKUP_MAX_FILE_BYTES,
  type BackupBrowser,
  type BackupCounts,
  type BackupFile,
  type BackupImportResponse,
  type BackupIptvOutcome,
  type PlaybackMode,
} from '@ace/shared';
import {
  setTheme,
  setTransparency,
  themeStore,
  type ThemePreference,
  type Transparency,
} from '../../app/theme.ts';
import { getPlaybackMode, setPlaybackMode } from '../../player/api.ts';

export const BACKUP_DESCRIPTION =
  'Guarda en un fichero tus listas, favoritos, recientes, «Tu fútbol», la IPTV y tus ajustes, por si reinstalas o formateas el Umbrel.';
export const BACKUP_EXCLUDED =
  'No lleva los dispositivos emparejados (habrá que volver a emparejarlos) ni nada que identifique a este Umbrel.';
export const BACKUP_SECRET_LABEL = 'Incluir la contraseña de la IPTV';
export const BACKUP_SECRET_HELP =
  'Va cifrada con una clave que eliges ahora. Sin esa clave nadie puede leerla, tampoco tú: apúntala.';
export const BACKUP_NO_SECRET_HELP =
  'Sin ella, al restaurar te pediremos otra vez la contraseña (o la dirección de la lista M3U).';
export const BACKUP_REPLACE_WARNING =
  'Reemplazar cambia tus favoritos, recientes, listas, «Tu fútbol» y ajustes por los de la copia. Lo de ahora se pierde.';
export const BACKUP_MERGE_HELP =
  'Combinar añade lo que falte (favoritos, recientes, listas, vínculos y correcciones) y no cambia lo que ya tienes configurado.';

/** Nombre del fichero: `ace-player-neo-copia-AAAA-MM-DD.json` (fecha de este dispositivo). */
export function backupFileName(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${BACKUP_FORMAT}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.json`;
}

// --- Lo de este navegador ---

export function browserPrefs(): BackupBrowser {
  const theme = themeStore.get();
  return {
    theme: theme.theme,
    transparency: theme.transparency,
    playbackMode: getPlaybackMode(),
  };
}

/** Aplica lo del navegador de la copia. Devuelve si cambió algo. */
export function applyBrowserPrefs(prefs: BackupBrowser | null | undefined): boolean {
  if (!prefs) return false;
  let changed = false;
  const now = themeStore.get();
  if (prefs.theme && prefs.theme !== now.theme) {
    setTheme(prefs.theme as ThemePreference);
    changed = true;
  }
  if (prefs.transparency && prefs.transparency !== now.transparency) {
    setTransparency(prefs.transparency as Transparency);
    changed = true;
  }
  if (prefs.playbackMode && prefs.playbackMode !== getPlaybackMode()) {
    setPlaybackMode(prefs.playbackMode as PlaybackMode);
    changed = true;
  }
  return changed;
}

/** La copia del servidor con lo de este navegador, como texto para el fichero. */
export function backupText(file: BackupFile, prefs: BackupBrowser = browserPrefs()): string {
  return `${JSON.stringify({ ...file, browser: prefs }, null, 2)}\n`;
}

/** Descarga un texto como fichero (enlace temporal con `download`). */
export function downloadText(text: string, name: string, doc: Document = document): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = doc.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.style.display = 'none';
  doc.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// --- Leer el fichero ---

export class BackupFileError extends Error {}

/** Texto del fichero (FileReader si el navegador no tiene `Blob.text`). */
function textOf(file: Blob): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read'));
    reader.readAsText(file);
  });
}

/** Lee el fichero elegido: tope de tamaño, JSON y que sea una copia de Ace Player Neo. */
export async function readBackupFile(file: Blob): Promise<Record<string, unknown>> {
  if (file.size > BACKUP_MAX_FILE_BYTES) {
    throw new BackupFileError(
      'El fichero es demasiado grande para ser una copia de Ace Player Neo.',
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(await textOf(file));
  } catch {
    throw new BackupFileError('El fichero no es una copia de seguridad: no se puede leer.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BackupFileError('El fichero no es una copia de seguridad de Ace Player Neo.');
  }
  const record = value as Record<string, unknown>;
  if (record.format !== BACKUP_FORMAT) {
    throw new BackupFileError('El fichero no es una copia de seguridad de Ace Player Neo.');
  }
  /* Compacta tiene que caber en una petición (nginx corta en 2 MiB). */
  if (new Blob([JSON.stringify(record)]).size > BACKUP_MAX_BYTES - 4096) {
    throw new BackupFileError('La copia es demasiado grande (máximo 2 MiB).');
  }
  return record;
}

/** ¿La copia trae la contraseña de la IPTV protegida con clave? (para pedirla antes de la vista previa) */
export function isProtected(backup: Record<string, unknown>): boolean {
  const iptv = backup.iptv as { secret?: unknown } | null | undefined;
  return Boolean(iptv && typeof iptv === 'object' && iptv.secret);
}

// --- Resumen de la vista previa ---

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

const COUNT_LABELS: ReadonlyArray<[keyof BackupCounts, string, string]> = [
  ['favorites', 'favorito', 'favoritos'],
  ['history', 'reciente', 'recientes'],
  ['directories', 'lista', 'listas'],
  ['channels', 'canal en las listas', 'canales en las listas'],
  ['channelBindings', 'vínculo de partido', 'vínculos de partido'],
  ['channelFeedback', 'corrección de canal', 'correcciones de canal'],
];

export interface SummaryRow {
  readonly key: keyof BackupCounts;
  /** «12 favoritos». */
  readonly label: string;
  /** «ahora 3». */
  readonly now: string;
}

/** Filas «lo que trae la copia · lo que tienes ahora» (sin las que están a cero en los dos). */
export function summaryRows(preview: BackupImportResponse): SummaryRow[] {
  return COUNT_LABELS.filter(
    ([key]) => preview.result[key] > 0 || preview.current[key] > 0 || preview.incoming[key] > 0,
  ).map(([key, one, many]) => ({
    key,
    label: n(preview.result[key], one, many),
    now: `ahora ${preview.current[key]}`,
  }));
}

/** Frase de lo que pasa con la IPTV. */
export function iptvLine(iptv: BackupIptvOutcome): string {
  const name = iptv.name ? `«${iptv.name}»` : 'tu IPTV';
  switch (iptv.action) {
    case 'none':
      return 'La copia no trae IPTV: la de ahora, si la tienes, no se toca.';
    case 'restore':
      return `IPTV ${name}: se restaura con su contraseña y se descarga la lista de canales.`;
    case 'keep':
      return `IPTV: se queda la que tienes ahora (la copia trae ${name}${iptv.protected ? '' : ' sin contraseña'}).`;
    case 'needs_secret':
      return iptv.kind === 'm3u'
        ? `IPTV ${name}: después te pediremos la dirección de la lista.`
        : `IPTV ${name}: después te pediremos la contraseña.`;
  }
}

/** Frase de «Tu fútbol» y de los ajustes. */
export function settingsLine(preview: BackupImportResponse): string | null {
  const parts: string[] = [];
  if (preview.preferences) parts.push('«Tu fútbol»');
  if (preview.settings) parts.push('«Un solo dispositivo a la vez»');
  if (preview.browser) parts.push('el tema y el modo de reproducción de este navegador');
  if (!parts.length) return null;
  const last = parts.pop() as string;
  return `También cambia ${parts.length ? `${parts.join(', ')} y ${last}` : last}.`;
}

/** Fecha de la copia para enseñarla («3 oct 2026, 09:00»). */
export function createdLine(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  try {
    return new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short' }).format(
      date,
    );
  } catch {
    return date.toISOString();
  }
}

/** Aviso final tras restaurar. */
export function doneMessage(result: BackupImportResponse): string {
  const base = result.mode === 'merge' ? 'Copia combinada con lo que tenías.' : 'Copia restaurada.';
  if (result.iptv.action === 'needs_secret') {
    return `${base} Falta la ${result.iptv.kind === 'm3u' ? 'dirección de la lista' : 'contraseña'} de tu IPTV.`;
  }
  return base;
}
