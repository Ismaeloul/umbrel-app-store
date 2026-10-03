/* «Descargar fallos» de Ajustes → Salud (0.9.0; docs/pendiente.md, punto 8).

   La web junta lo suyo (el anillo de sus últimos errores, src/lib/web-log.ts,
   y cómo se está viendo: navegador, tamaño, vista, modo) y se lo manda al
   servidor (POST /api/v1/diagnostics/export), que devuelve UN fichero con
   todo lo de los dos lados, REDACTADO y con los fallos clasificados en
   «nuestro» y «de fuera». La web solo lo guarda tal cual, bonito para leer:
   `ace-player-neo-fallos-AAAA-MM-DD-HHMM.json`. En la demo lo monta
   demo.ts con los fallos de muestra. */

import {
  faultsFileName,
  WEB_LOG_MAX_ENTRIES,
  type DiagnosticsExport,
  type WebDiagnostics,
} from '@ace/shared';
import { api } from '../../api/index.ts';
import { webLogSnapshot, webLogUptimeSeconds } from '../../lib/web-log.ts';
import { downloadText } from '../backup/model.ts';

export interface WebContext {
  /** `mobile`, `tablet`, `desktop` o `wide` (useLayout). */
  layout?: string | undefined;
  mode?: 'live' | 'demo' | undefined;
}

/** Abierta como app instalada (PWA en la pantalla de inicio). */
function installed(): boolean {
  try {
    const standalone = (globalThis.navigator as { standalone?: boolean } | undefined)?.standalone;
    return (
      standalone === true || globalThis.matchMedia?.('(display-mode: standalone)').matches === true
    );
  } catch {
    return false;
  }
}

/** Lo que la web cuenta de sí misma en el fichero. */
export function webDiagnostics(context: WebContext = {}): WebDiagnostics {
  const width = Math.round(globalThis.innerWidth ?? 0);
  const height = Math.round(globalThis.innerHeight ?? 0);
  const ratio = Math.round((globalThis.devicePixelRatio ?? 1) * 100) / 100;
  const vista = new URLSearchParams(globalThis.location?.search ?? '').get('vista');
  return {
    userAgent: (globalThis.navigator?.userAgent ?? '').slice(0, 400),
    viewport: `${width}x${height}@${ratio}`.slice(0, 40),
    ...(context.layout ? { layout: context.layout.slice(0, 20) } : {}),
    ...(context.mode ? { mode: context.mode } : {}),
    view: (vista ?? 'agenda').slice(0, 160),
    online: globalThis.navigator?.onLine !== false,
    installed: installed(),
    uptimeSeconds: webLogUptimeSeconds(),
    log: webLogSnapshot().slice(-WEB_LOG_MAX_ENTRIES),
  };
}

/** El fichero como texto (sangrado: se lee bien en cualquier editor). */
export function faultsText(file: DiagnosticsExport): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Pide el fichero y lo guarda. Devuelve su nombre y lo que lleva (para el aviso). */
export async function downloadFaults(
  context: WebContext = {},
): Promise<{ name: string; file: DiagnosticsExport }> {
  const file = await api('diagnosticsExport', { body: { web: webDiagnostics(context) } });
  const name = faultsFileName(Date.parse(file.createdAt));
  downloadText(faultsText(file), name);
  return { name, file };
}

/** El aviso al terminar: el nombre y, de un vistazo, cuántos son nuestros. */
export function faultsNotice(name: string, file: DiagnosticsExport): string {
  const { nuestro, deFuera } = file.summary;
  if (!nuestro && !deFuera) return `Fallos descargados: ${name} (sin fallos que contar)`;
  return `Fallos descargados: ${name} · ${nuestro} nuestros, ${deFuera} de fuera`;
}
