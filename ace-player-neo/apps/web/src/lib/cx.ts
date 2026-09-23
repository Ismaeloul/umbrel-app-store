/** Junta clases CSS saltándose las vacías: cx('btn', primary && 'btn--primary'). */
export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(' ');
}
