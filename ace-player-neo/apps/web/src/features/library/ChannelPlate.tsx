/* Placa de canal de la tabla de Canales en escritorio (rediseño, sección 3):
   un rectángulo de 60 × 40 con el color de la marca y su nombre en el centro,
   como en la maqueta («DAZN» en blanco, «beIN» en rojo, «Gol» en negro…).

   - Si la guía de tu IPTV tiene logo del canal, va el logo (por el proxy
     propio, `iptvGuideArt`) sobre una placa clara; si no carga, la placa.
   - Las marcas que más salen en España tienen su color; las demás, el tono
     sacado del nombre (el de los dorsales, channelTone) con texto blanco.
   - Decorativa (aria-hidden): el nombre del canal va al lado. */

import { useState, type CSSProperties } from 'react';
import { stripQualityMarks } from '@ace/shared';
import { channelTone, oklchCss } from '../../lib/color.ts';
import { cx } from '../../lib/cx.ts';
import { foldText } from './model.ts';

interface Brand {
  /** Principio del nombre ya sin tildes ni mayúsculas. */
  match: RegExp;
  label: string;
  bg: string;
  ink: string;
}

/* Colores de cada marca, con el texto en contraste AA sobre su fondo. */
const BRANDS: readonly Brand[] = [
  { match: /^dazn\b/, label: 'DAZN', bg: '#f8f8f8', ink: '#0c0c0e' },
  { match: /^(?:m\+|movistar\b)/, label: 'M+', bg: '#1c2a6b', ink: '#ffffff' },
  { match: /^bein\b/, label: 'beIN', bg: '#c8102e', ink: '#ffffff' },
  { match: /^(?:la [12]\b|tve\b)/, label: 'La', bg: '#ffffff', ink: '#1d5a37' },
  { match: /^eurosport\b/, label: 'Eurosport', bg: '#c44100', ink: '#ffffff' },
  { match: /^cine\b/, label: 'Cine+', bg: '#5b21b6', ink: '#ffffff' },
  { match: /^gol\b/, label: 'Gol', bg: '#111111', ink: '#ffd60a' },
  { match: /^teledeporte\b/, label: 'tdp', bg: '#00467f', ink: '#ffffff' },
  { match: /^real madrid\b/, label: 'RMTV', bg: '#ffffff', ink: '#00529f' },
  { match: /^barca\b/, label: 'Barça', bg: '#a50044', ink: '#ffffff' },
  { match: /^laliga\b/, label: 'LaLiga', bg: '#ff4b44', ink: '#14070a' },
  { match: /^espn\b/, label: 'ESPN', bg: '#b30000', ink: '#ffffff' },
  { match: /^sky\b/, label: 'Sky', bg: '#0b2a6f', ink: '#ffffff' },
  { match: /^antena 3\b/, label: 'A3', bg: '#e04e10', ink: '#160600' },
  { match: /^telecinco\b/, label: 'T5', bg: '#0b3ea8', ink: '#ffffff' },
  { match: /^cuatro\b/, label: 'Cuatro', bg: '#d9001d', ink: '#ffffff' },
  { match: /^la ?sexta\b/, label: 'laSexta', bg: '#0c7a36', ink: '#ffffff' },
];

/** La marca de un canal, o null si no es de las conocidas. */
export function brandOf(name: string): Brand | null {
  const folded = foldText(stripQualityMarks(name)).trim();
  return BRANDS.find((brand) => brand.match.test(folded)) ?? null;
}

/** Lo que pone la placa sin marca conocida: la primera palabra («Teledeporte», «Canal»…). */
export function plateLabel(name: string): string {
  const words = stripQualityMarks(name).trim().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  // Un artículo solo («La 1») se lleva la siguiente palabra.
  if (/^(la|el|los|las)$/i.test(first) && words[1]) return `${first} ${words[1]}`.slice(0, 10);
  return first.slice(0, 10) || '·';
}

export interface ChannelPlateProps {
  name: string;
  /** Logo de la guía (`iptvGuideArt`), o null. */
  logo?: string | null;
  className?: string;
}

export function ChannelPlate({ name, logo = null, className }: ChannelPlateProps) {
  const [broken, setBroken] = useState<string | null>(null);
  const brand = brandOf(name);
  const tone = channelTone(name);
  const style = {
    '--plate-bg': brand ? brand.bg : oklchCss({ ...tone, l: Math.min(tone.l, 0.48) }),
    '--plate-ink': brand ? brand.ink : '#ffffff',
  } as CSSProperties;
  if (logo && broken !== logo)
    return (
      <span className={cx('plate', 'plate--logo', className)} aria-hidden="true">
        <img src={logo} alt="" loading="lazy" decoding="async" onError={() => setBroken(logo)} />
      </span>
    );
  return (
    <span className={cx('plate', className)} style={style} aria-hidden="true">
      {brand ? brand.label : plateLabel(name)}
    </span>
  );
}
