/* Vínculos canal → hash hechos a mano (server.js:839-866, 4463-4469; B-149).

   `normalizeChannelBinding` también lo porta `state` (normaliza el fichero al
   cargar y tras cada mutación, y lo exporta en la fachada antigua); aquí solo
   se construye el vínculo nuevo de `POST /api/football/bind` con la misma
   regla, y el estado lo vuelve a normalizar al persistir (mismo resultado). */

import {
  MAX_CHANNEL_BINDINGS,
  cleanTitle,
  normalizeChannelKey,
  normalizeHash,
  type ChannelBinding,
} from '@ace/shared';

/** `normalizeChannelBinding` (server.js:839-853): null si falta el canal o un hash válido. */
export function buildChannelBinding(value: unknown, nowIso: string): ChannelBinding | null {
  const input = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const channel = cleanTitle(input.channel, '');
  const channelKey = normalizeChannelKey(channel);
  const id = normalizeHash(input.id);
  if (!channel || !channelKey || !id) return null;
  const updatedAt = input.updatedAt;
  return {
    channel,
    channelKey,
    id,
    title: cleanTitle(input.title, channel),
    ih: input.ih === true,
    updatedAt:
      typeof updatedAt === 'string' && Number.isFinite(Date.parse(updatedAt))
        ? new Date(updatedAt).toISOString()
        : nowIso,
  };
}

/**
 * `saveChannelBinding` (server.js:4463-4469) sin escribir: el vínculo nuevo el
 * primero, sustituyendo al de su misma clave, y 120 como mucho (lo que deja
 * `normalizeChannelBindings` al persistir).
 */
export function withBinding(
  current: readonly ChannelBinding[],
  binding: ChannelBinding,
): ChannelBinding[] {
  const output: ChannelBinding[] = [];
  const seen = new Set<string>();
  for (const item of [
    binding,
    ...current.filter((entry) => entry.channelKey !== binding.channelKey),
  ]) {
    if (seen.has(item.channelKey)) continue;
    seen.add(item.channelKey);
    output.push(item);
    if (output.length >= MAX_CHANNEL_BINDINGS) break;
  }
  return output;
}
