/* Copiar al portapapeles también por HTTP en la LAN (regla 34).

   `navigator.clipboard` solo existe en contexto seguro (HTTPS o localhost), y
   la app se abre a menudo como http://umbrel.local:7792. Ahí se recurre a
   `document.execCommand('copy')` con un textarea oculto, como la 0.6.59
   (index.html:5440-5451). La 0.6.59 se olvidó del respaldo en «Copiar nombre
   del canal» (§29.10): aquí TODAS las copias pasan por copyText. */

import { normalizeHash } from '@ace/shared';
import { notify } from '../../notices/index.ts';

function legacyCopy(text: string, doc: Document): boolean {
  const previous = doc.activeElement instanceof HTMLElement ? doc.activeElement : null;
  const area = doc.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  // Fuera de la vista pero en el documento: si no está, no se puede seleccionar.
  area.style.position = 'fixed';
  area.style.top = '0';
  area.style.left = '-9999px';
  area.style.opacity = '0';
  doc.body.appendChild(area);
  let ok: boolean;
  try {
    area.select();
    area.setSelectionRange(0, text.length);
    ok = doc.execCommand('copy');
  } catch {
    ok = false;
  }
  area.remove();
  // Seleccionar el textarea se lleva el foco: se devuelve a donde estaba.
  previous?.focus({ preventScroll: true });
  return ok;
}

export async function copyText(text: string, doc: Document = document): Promise<boolean> {
  try {
    if (globalThis.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Permiso denegado o sin foco: se prueba el camino antiguo.
  }
  return legacyCopy(text, doc);
}

/** `acestream://<hash>`: lo abre la app de AceStream si está instalada (D7). */
export function acestreamLink(hash: string): string {
  return `acestream://${hash}`;
}

/* Textos de la 0.6.59 (index.html:5452-5470) para que suenen igual. */

export async function copyHash(value: string): Promise<void> {
  const hash = normalizeHash(value);
  if (!hash) {
    notify('No hay un hash válido para copiar', { tone: 'warn' });
    return;
  }
  const ok = await copyText(hash);
  notify(ok ? 'Hash copiado' : 'No se pudo copiar el hash', {
    tone: ok ? 'ok' : 'err',
    icon: ok ? 'copy' : undefined,
  });
}

export async function copyAcestreamLink(hash: string): Promise<void> {
  const ok = await copyText(acestreamLink(hash));
  notify(ok ? 'Enlace acestream:// copiado' : 'No se pudo copiar', {
    tone: ok ? 'ok' : 'err',
    icon: ok ? 'link' : undefined,
  });
}

export async function copyChannelName(name: string): Promise<void> {
  const ok = await copyText(name);
  notify(ok ? 'Nombre del canal copiado' : 'No se pudo copiar', {
    tone: ok ? 'ok' : 'err',
    icon: ok ? 'copy' : undefined,
  });
}

export async function copyStreamUrl(url: string): Promise<void> {
  const ok = await copyText(url);
  notify(ok ? 'URL del stream copiada: pégala en VLC' : 'No se pudo copiar', {
    tone: ok ? 'ok' : 'err',
    icon: ok ? 'externo' : undefined,
  });
}

/**
 * «Abrir en AceStream» (D7): un enlace `acestream://` pulsado de verdad. Si
 * la app no está instalada el navegador no hace nada (o avisa él), así que
 * se deja una pista.
 */
export function openInAceStream(hash: string, doc: Document = document): void {
  const link = doc.createElement('a');
  link.href = acestreamLink(hash);
  link.rel = 'noopener';
  link.style.display = 'none';
  doc.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
  }
  notify('Abriendo en AceStream… Si no se abre, instala la app de AceStream.', {
    tone: 'info',
    icon: 'externo',
  });
}
