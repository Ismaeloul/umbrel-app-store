/* Copiar al portapapeles también por HTTP en la LAN (regla 34): la API del
   portapapeles solo existe en contextos seguros (HTTPS o localhost), así que
   hay un respaldo con un textarea y execCommand('copy'), como la 0.6.59
   (index.html:5440-5451). */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (globalThis.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Sigue con el respaldo.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    // Fuera de la vista pero en el documento; 16 px para que iOS no haga zoom.
    area.style.cssText = 'position:fixed;top:-1000px;left:0;opacity:0;font-size:16px;';
    document.body.appendChild(area);
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    area.select();
    area.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    area.remove();
    previous?.focus({ preventScroll: true });
    return ok;
  } catch {
    return false;
  }
}

/** Enlace que abre la app de AceStream si está instalada (D7). */
export function acestreamLink(hash: string): string {
  return `acestream://${hash}`;
}

/**
 * URL del stream para un reproductor externo como VLC (D7): la del motor por
 * el proxy de la app, con `id` o `infohash` según el canal. Ojo: abrirla
 * crea otra sesión del motor para ese contenido, que para la de aquí (el
 * motor solo sostiene una por contenido).
 *
 * LIMITACIÓN conocida: en el Umbrel, el proxy de apps pide iniciar sesión y
 * VLC no lleva la cookie, así que ahí esta URL da la página de acceso. Hace
 * falta que el backend dé una URL firmada y exenta de login (como la del
 * remux de la app nativa); cuando exista, se pide aquí en vez de montarla.
 */
export function externalStreamUrl(
  hash: string,
  kind: 'id' | 'infohash' | 'auto' = 'auto',
  origin: string = globalThis.location?.origin ?? '',
): string {
  const param = kind === 'infohash' ? 'infohash' : 'id';
  return `${origin}/ace/getstream?${param}=${hash}`;
}

/** Abre un enlace con esquema propio sin salir de la página si nadie lo atiende. */
export function openExternal(url: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
}
