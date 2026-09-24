import type { Team } from '../types';
import { markCrestFailed, useRealCrest } from './crests';

/* Escudo: si hay un escudo real en `public/escudos/` (ver crests.ts) se pinta la
   imagen; si no, se genera uno con forma + colores del club + monograma. Cuatro
   formas (shield, round, hex, square) para que no todos parezcan iguales.
   `variant='mono'` siempre usa el generado (un logo real no se tiñe). */

export interface CrestProps {
  team: Team;
  size?: number;
  variant?: 'full' | 'flat' | 'mono';
  className?: string;
  style?: React.CSSProperties;
  title?: string;
}

function ideal(hex: string): string {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return l > 0.6 ? '#151515' : '#ffffff';
}

const SHAPES: Record<Team['crest'], string> = {
  shield: 'M50 4 L92 16 V52 C92 74 74 90 50 96 C26 90 8 74 8 52 V16 Z',
  round: 'M50 4 A46 46 0 1 1 49.9 4 Z',
  hex: 'M50 4 L90 27 V73 L50 96 L10 73 V27 Z',
  square: 'M14 8 H86 Q92 8 92 14 V78 Q92 92 78 92 H22 Q8 92 8 78 V14 Q8 8 14 8 Z',
};

export function Crest({ team, size = 32, variant = 'full', className, style, title }: CrestProps) {
  const real = useRealCrest(team.id);
  if (real && variant !== 'mono') {
    return (
      <span className={`crest-real ${className ?? ''}`} style={{ width: size, height: size, ...style }} role="img" aria-label={title ?? team.name} title={title}>
        <img src={real} alt="" width={size} height={size} loading="lazy" decoding="async" draggable={false} onError={() => markCrestFailed(team.id)} />
      </span>
    );
  }
  return <GeneratedCrest team={team} size={size} variant={variant} className={className} style={style} title={title} />;
}

export function GeneratedCrest({ team, size = 32, variant = 'full', className, style, title }: CrestProps) {
  const id = `crest-${team.id}-${variant}`;
  const path = SHAPES[team.crest];
  const ink = ideal(team.primary);
  const mono = variant === 'mono';
  const primary = mono ? 'currentColor' : team.primary;
  const secondary = mono ? 'currentColor' : team.secondary;
  return (
    <svg
      className={className}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label={title ?? team.name}
      shapeRendering="geometricPrecision"
    >
      <defs>
        <clipPath id={`${id}-clip`}>
          <path d={path} />
        </clipPath>
        {variant === 'full' && (
          <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
            <stop offset="1" stopColor="#000" stopOpacity="0.22" />
          </linearGradient>
        )}
      </defs>
      <path d={path} fill={primary} opacity={mono ? 0.18 : 1} />
      {!mono && (
        <g clipPath={`url(#${id}-clip)`}>
          {team.crest === 'shield' && <path d="M50 4 L92 16 V52 L50 96 Z" fill={secondary} opacity="0.92" />}
          {team.crest === 'round' && <rect x="0" y="44" width="100" height="12" fill={secondary} opacity="0.95" />}
          {team.crest === 'hex' && <path d="M50 4 L90 27 L50 50 L10 27 Z" fill={secondary} opacity="0.92" />}
          {team.crest === 'square' && <rect x="8" y="8" width="84" height="26" fill={secondary} opacity="0.92" />}
        </g>
      )}
      {variant === 'full' && <path d={path} fill={`url(#${id}-sheen)`} />}
      <path d={path} fill="none" stroke={mono ? 'currentColor' : 'rgba(0,0,0,0.35)'} strokeWidth={mono ? 4 : 3} />
      <text
        x="50"
        y={team.crest === 'round' ? 74 : 70}
        textAnchor="middle"
        fontFamily="Inter Variable, system-ui, sans-serif"
        fontWeight={800}
        fontSize={team.short.length > 3 ? 26 : 30}
        fill={mono ? 'currentColor' : ink}
        style={{ letterSpacing: '-0.02em' }}
      >
        {team.short}
      </text>
    </svg>
  );
}
