/* Redactor con secretos conocidos (docs/iptv.md §2.4, punto 1).

   La regla principal es que el módulo `iptv` nunca escribe URLs del
   proveedor (solo el host y el id del canal). Esto es la red de seguridad:
   `clean(text)` sustituye por `•••` cada aparición exacta, en crudo y
   codificada con `encodeURIComponent`, de:
   - usuario y contraseña de Xtream (3 caracteres o más);
   - en M3U, la URL de la lista y su query, y cada valor de la query de 3
     caracteres o más (la forma `get.php?username=U&password=P`);
   - los dos tramos de ruta que se repiten antes del id en las URLs de
     stream cortas `/<u>/<p>/<id>` (se aprenden al parsear, `m3u.ts`);
   - las URLs de guía y sus valores de query;
   - los tickets del relé.
   Después pasa `redactText` (core/logger.ts), que tapa lo genérico aunque
   no se conozca el secreto. */

import { REDACTED_PART, redactText } from '../../core/logger.js';

/** Secretos de menos de esto no se tapan (taparían media frase). */
export const MIN_SECRET_LENGTH = 3;

export class IptvRedactor {
  private readonly secrets = new Set<string>();
  private sorted: string[] | null = null;

  /** Añade un secreto (y su forma codificada). */
  add(value: string | null | undefined): void {
    const secret = String(value ?? '');
    if (secret.length < MIN_SECRET_LENGTH) return;
    const before = this.secrets.size;
    this.secrets.add(secret);
    for (const form of [encodeURIComponent(secret), encodeURI(secret)]) {
      if (form !== secret) this.secrets.add(form);
    }
    if (this.secrets.size !== before) this.sorted = null;
  }

  /**
   * Añade una URL con credenciales: entera, su query y cada valor de la
   * query (y cada tramo de ruta de 3 caracteres o más si `pathSegments`).
   */
  addUrl(url: string | null | undefined, options: { readonly pathSegments?: boolean } = {}): void {
    const text = String(url ?? '');
    if (!text) return;
    this.add(text);
    let parsed: URL | null = null;
    try {
      parsed = new URL(text);
    } catch {}
    if (!parsed) return;
    if (parsed.search.length > 1) this.add(parsed.search.slice(1));
    for (const value of parsed.searchParams.values()) this.add(value);
    if (parsed.username) this.add(decodeURIComponent(parsed.username));
    if (parsed.password) this.add(decodeURIComponent(parsed.password));
    if (options.pathSegments) {
      for (const segment of parsed.pathname.split('/')) {
        if (segment.length >= MIN_SECRET_LENGTH && !/^\d+(?:\.[a-z0-9]{1,5})?$/i.test(segment)) {
          this.add(safeDecode(segment));
        }
      }
    }
  }

  /** Olvida todo (al cambiar de proveedor o al eliminar). */
  reset(): void {
    this.secrets.clear();
    this.sorted = null;
  }

  get size(): number {
    return this.secrets.size;
  }

  /** Texto sin secretos conocidos ni URLs con credenciales. */
  clean(text: string): string {
    let out = String(text ?? '');
    if (!this.sorted) this.sorted = [...this.secrets].sort((a, b) => b.length - a.length);
    for (const secret of this.sorted) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED_PART);
    }
    return redactText(out);
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
