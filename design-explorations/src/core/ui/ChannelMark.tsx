/* Dorsal de canal generado: cifra o inicial sobre un tono derivado del
   nombre (evitando el verde de «verificada» y el rojo de «sin señal»). */

export function hueFromName(name: string): number {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  let hue = h % 360;
  // esquiva verde (130–170), rojo (0–35, 340–360) y violeta (275–320)
  if (hue >= 130 && hue <= 170) hue = 200 + (hue - 130);
  if (hue <= 35 || hue >= 340) hue = 40 + (hue % 30);
  if (hue >= 275 && hue <= 320) hue = 220 + (hue - 275);
  return hue;
}

export function channelGlyph(name: string): string {
  const m = name.match(/(\d+)\s*$/);
  if (m) return m[1].slice(-1);
  const clean = name.replace(/^(M\+|DAZN|Sky|TNT|beIN|M\.)\s*/i, '').trim();
  return (clean[0] ?? name[0] ?? '?').toUpperCase();
}

export function ChannelMark({ name, size = 40, radius = 10, className, style, mono = false }: { name: string; size?: number; radius?: number; className?: string; style?: React.CSSProperties; mono?: boolean }) {
  const hue = hueFromName(name);
  const glyph = channelGlyph(name);
  const prefix = name.match(/^(M\+|DAZN|Sky|TNT|beIN)/i)?.[1];
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: 'inline-grid',
        placeItems: 'center',
        width: size,
        height: size,
        borderRadius: radius,
        background: mono ? 'var(--mark-bg, rgba(127,127,127,0.18))' : `oklch(0.62 0.13 ${hue})`,
        color: mono ? 'currentColor' : '#fff',
        fontWeight: 800,
        fontSize: size * 0.48,
        lineHeight: 1,
        position: 'relative',
        letterSpacing: '-0.02em',
        flex: 'none',
        ...style,
      }}
    >
      {glyph}
      {prefix && size >= 36 && (
        <span style={{ position: 'absolute', left: 4, top: 3, fontSize: Math.max(7, size * 0.19), fontWeight: 700, opacity: 0.8, letterSpacing: 0 }}>{prefix.toUpperCase().replace('M+', 'M+')}</span>
      )}
    </span>
  );
}
