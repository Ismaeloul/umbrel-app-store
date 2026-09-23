/* Parsers de directorios, portados tal cual (server.js:2751-2812).

   Devuelven la forma CRUDA de la 0.6.59 (`{ id, title, alias, type, category }`
   en M3U, sin `alias` en HTML). La normalización a `Item` (fecha, `ih`,
   `fromWebSync`, sin duplicados, categoría a 48) la hace `normalizeWebSource`
   al guardar, igual que `writeState` en la 0.6.59. */

import { cleanTitle, normalizeHash } from '@ace/shared';

export interface ParsedStream {
  readonly id: string;
  readonly title: string;
  /** Solo en M3U: el `tvg-id` (puede ser ""). */
  readonly alias?: string;
  readonly type: 'web';
  readonly category: string;
}

/**
 * `parseM3u` (server.js:2751-2785): `#EXTINF` con `group-title` como
 * categoría y `tvg-id` como alias; el título es lo que va tras la primera
 * coma. Cualquier línea con un hash (`acestream://…`, `?id=…` o 40 hex) es
 * un canal; los duplicados se quitan al normalizar.
 */
export function parseM3u(text: string): ParsedStream[] {
  const streams: ParsedStream[] = [];
  let currentTitle = '';
  let currentAlias = '';
  let currentCategory = 'Importado';
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF:')) {
      const categoryMatch = line.match(/group-title="([^"]+)"/i);
      currentCategory = cleanTitle(categoryMatch?.[1], 'Importado');
      /* El nombre visible de algunas listas lleva coletilla del proveedor
         ("DAZN 1 --> NEW ERA"); el tvg-id es el nombre canónico del canal
         ("DAZN 1 HD") y se guarda como alias para emparejar (server.js:2762-2766). */
      currentAlias = cleanTitle(line.match(/tvg-id="([^"]*)"/i)?.[1], '');
      currentTitle = cleanTitle(line.split(',').slice(1).join(','), 'Stream M3U');
      continue;
    }
    const id = normalizeHash(line);
    if (id) {
      streams.push({
        id,
        title: currentTitle || `Stream ${id.slice(0, 8)}`,
        alias: currentAlias,
        type: 'web',
        category: currentCategory || 'Importado',
      });
      currentTitle = '';
      currentAlias = '';
    }
  }
  return streams;
}

/**
 * `parseHtml` (server.js:2787-2812): primero los enlaces `<a href>` con
 * `acestream://` o `?id=`/`?content_id=` (título = texto del enlace), luego
 * cualquier `acestream://<hash>` suelto. Sin duplicados.
 */
export function parseHtml(text: string): ParsedStream[] {
  const streams: ParsedStream[] = [];
  const seen = new Set<string>();
  const linkRe =
    /<a\b[^>]*href=["']([^"']*(?:acestream:\/\/|[?&](?:id|content_id)=)[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRe.exec(text))) {
    const id = normalizeHash(match[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    streams.push({
      id,
      title: cleanTitle(match[2], `Stream ${id.slice(0, 8)}`),
      type: 'web',
      category: 'Importado',
    });
  }

  const bareRe = /acestream:\/\/([a-fA-F0-9]{40})/gi;
  while ((match = bareRe.exec(text))) {
    const id = normalizeHash(match[1]);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    streams.push({ id, title: `Stream ${id.slice(0, 8)}`, type: 'web', category: 'Importado' });
  }
  return streams;
}
