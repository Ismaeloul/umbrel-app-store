/* Marca de equipo: el escudo del backend si lo hay y, si no, un monograma
   con los colores del club (plan Palco fase 2, decisión W12).

   - `crest`: ruta relativa de mismo origen que da la API
     (`/api/v1/football/teams/<id>/crest?v=…`). Se pinta un <img> ENCIMA del
     monograma, que se queda debajo como respaldo: se ve mientras la imagen
     carga y vuelve a verse si falla (`onError`). Nunca se enlaza a terceros.
   - Sin `crest`: círculo con el color principal, aro con el secundario y, a
     partir de 40 px, una placa con las siglas.
   - Colores: `colors.primary`/`secondary` (hex, con o sin «#»). Sin datos,
     un tono sacado del nombre fuera de los tonos de estado.
   - «Los escudos se encienden» solo en directo (`lit`): un halo con el color
     del club normalizado por tema (src/lib/color.ts). Capa aparte, con
     opacidad.
   - Decorativa: el nombre del equipo siempre está escrito al lado. */

import { useState, type CSSProperties } from 'react';
import { channelTone, oklchCss, parseHex, rgbToHex, teamLight, hueFromName } from '../lib/color.ts';
import { cx } from '../lib/cx.ts';
import { teamInitials } from '../lib/teams.ts';
import './TeamMark.css';

export { teamInitials };

export interface TeamColors {
  primary?: string | null;
  secondary?: string | null;
}

export interface TeamMarkProps {
  name: string;
  /** Siglas para la placa (la API da `short`); si no, se sacan del nombre. */
  short?: string | null;
  colors?: TeamColors | null;
  /** Escudo del backend (ruta relativa) o null: entonces solo el monograma. */
  crest?: string | null;
  /** Lado en px. */
  size?: number;
  /** En directo: el escudo se enciende. */
  lit?: boolean;
  /** Dibujo del círculo (el dato no lo da ninguna API: por defecto, liso). */
  pattern?: 'liso' | 'rayas' | 'mitades';
  className?: string;
}

export function TeamMark({
  name,
  short,
  colors,
  crest,
  size = 28,
  lit = false,
  pattern = 'liso',
  className,
}: TeamMarkProps) {
  // Qué imagen ha cargado o fallado: al cambiar `crest` se vuelve a intentar.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const primaryRgb = parseHex(colors?.primary);
  const secondaryRgb = parseHex(colors?.secondary);
  const fallbackHue = hueFromName(name);
  const primary = primaryRgb ? rgbToHex(primaryRgb) : oklchCss(channelTone(name));
  const secondary = secondaryRgb
    ? rgbToHex(secondaryRgb)
    : oklchCss({ l: 0.93, c: 0.03, h: fallbackHue });
  const glowLight = teamLight(colors?.primary, colors?.secondary, 'light') ?? {
    l: 0.6,
    c: 0.12,
    h: fallbackHue,
  };
  const glowDark = teamLight(colors?.primary, colors?.secondary, 'dark') ?? {
    l: 0.66,
    c: 0.13,
    h: fallbackHue,
  };
  const style = {
    '--s': `${size}px`,
    '--team': primary,
    '--team-2': secondary,
    '--glow-l': oklchCss(glowLight),
    '--glow-d': oklchCss(glowDark),
  } as CSSProperties;
  const withPlate = size >= 40;
  const image = crest && crest.startsWith('/') && failed !== crest ? crest : null;
  const crestState = !image ? 'mono' : loaded === image ? 'image' : 'loading';
  return (
    <span
      className={cx('team', `team--${pattern}`, withPlate && 'team--plate', className)}
      style={style}
      data-lit={lit ? 'true' : 'false'}
      data-crest={crestState}
      aria-hidden="true"
    >
      {withPlate ? <b className="team__plate">{teamInitials(name, short)}</b> : null}
      {image ? (
        <img
          key={image}
          className="team__crest"
          src={image}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setLoaded(image)}
          onError={() => setFailed(image)}
        />
      ) : null}
    </span>
  );
}
