/* «Descargar logs» (Ajustes → Registro, 0.9.0; docs/registro.md).

   La web pide el zip al servidor (POST /api/v1/diagnostics/log/download) con
   el periodo y lo suyo (lo mismo que «Descargar fallos», features/health/
   faults.ts) y lo guarda tal cual: `ace-player-neo-logs-AAAA-MM-DD-HHMM.zip`.
   La respuesta es un fichero, no JSON, así que va con fetch y no con `api()`
   (con el mismo plazo, cancelación y errores en español). En la demo, el zip
   lo monta demo-zip.ts con datos de muestra y las mismas funciones del servidor. */

import { formatBytes, logsFileName, type DiagnosticsLogInfo, type LogPeriod } from '@ace/shared';
import { ApiError, errorFromResponse, isAbortError } from '../../api/errors.ts';
import { isDemo, whenModeReady } from '../../api/mode.ts';
import { routeOf } from '../../api/routes.ts';
import { unbrokenFileName, webDiagnostics, type WebContext } from '../health/faults.ts';

/** Lo que tarda como mucho (nginx corta a los 60 s). */
export const LOGS_DOWNLOAD_TIMEOUT_MS = 55_000;

export const LOGS_PERIODS: ReadonlyArray<{ value: LogPeriod; label: string }> = [
  { value: 'dia', label: 'Último día' },
  { value: 'semana', label: 'Última semana' },
  { value: 'mes', label: 'Último mes' },
];

/** Descripción de la sección (la pone Ajustes bajo el título). */
export const LOGS_SECTION_DESCRIPTION =
  'La app apunta lo que pasa (arranques, cortes del relé, fallos del motor, de la IPTV y de la web) y lo guarda unos 45 días en tu Umbrel. Si algo va mal, descarga los logs y pásalos: ahí se ve dónde falló.';

/** Lo que va en el zip y lo que NO (una línea, para tranquilizar). */
export const LOGS_HELP =
  'Un .zip con el registro, los fallos clasificados y el estado de ahora. No lleva contraseñas, usuarios, enlaces con claves ni IPs públicas.';

const DATE = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/** Las filas de «lo que hay guardado» (o una frase si no hay registro). */
export function storageRows(
  info: DiagnosticsLogInfo,
): Array<{ label: string; value: string }> | string {
  if (!info.enabled)
    return 'Este servidor no está guardando el registro: el zip llevará solo los fallos de ahora.';
  if (!info.since) return 'Aún no hay nada guardado: empieza a apuntar desde ahora.';
  return [
    { label: 'Guardando desde', value: DATE.format(new Date(info.since)) },
    {
      label: 'Ocupa',
      value: `${formatBytes(info.bytes)} de ${formatBytes(info.maxBytes)}`,
    },
    { label: 'Se borra solo', value: `lo de más de ${info.maxDays} días` },
  ];
}

/** «Logs descargados: ace-player-neo-logs-2026-10-03-2145.zip (1,2 MB)». */
export function logsNotice(name: string, bytes: number): string {
  return `Logs descargados: ${unbrokenFileName(name)} (${formatBytes(bytes)})`;
}

/** Guarda unos bytes como fichero (el mismo truco que la copia de seguridad). */
export function saveBlob(blob: Blob, name: string, doc: Document = document): void {
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

/** El nombre que manda el servidor (o el de ahora, si no llega). */
export function fileNameFrom(disposition: string | null, now = Date.now()): string {
  const match = /filename="([^"]+\.zip)"/.exec(disposition ?? '');
  return match?.[1] ?? logsFileName(now);
}

/** Pide el zip y lo guarda. Devuelve su nombre y lo que pesa (para el aviso). */
export async function downloadLogs(
  period: LogPeriod,
  context: WebContext = {},
  fetchImpl: typeof fetch = (...args) => globalThis.fetch(...args),
): Promise<{ name: string; bytes: number }> {
  await whenModeReady();
  const web = webDiagnostics(context);
  if (isDemo()) {
    const { demoLogsZip } = await import('./demo-zip.ts');
    const now = Date.now();
    const zip = demoLogsZip(period, web, now);
    const name = logsFileName(now);
    saveBlob(new Blob([zip as Uint8Array<ArrayBuffer>], { type: 'application/zip' }), name);
    return { name, bytes: zip.length };
  }
  const route = 'diagnosticsLogDownload';
  const controller = new AbortController();
  let expired = false;
  const timer = setTimeout(() => {
    expired = true;
    controller.abort(new DOMException('Plazo agotado', 'TimeoutError'));
  }, LOGS_DOWNLOAD_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetchImpl(routeOf(route).path, {
        method: 'POST',
        headers: {
          Accept: 'application/zip, application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ period, web }),
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
    } catch (error) {
      if (expired) throw new ApiError({ code: 'timeout', route, cause: error });
      if (isAbortError(error)) throw error;
      throw new ApiError({ code: 'network', route, cause: error });
    }
    if (!response.ok) throw await errorFromResponse(response, route);
    let blob: Blob;
    try {
      blob = await response.blob();
    } catch (error) {
      throw new ApiError({ code: expired ? 'timeout' : 'network', route, cause: error });
    }
    const name = fileNameFrom(response.headers.get('content-disposition'));
    saveBlob(blob, name);
    return { name, bytes: blob.size };
  } finally {
    clearTimeout(timer);
  }
}
