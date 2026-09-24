/* Iconos propios de Palco: trazo 2, estilo Apple TV. Los rellenos solo en
   play/pausa y en los puntos de directo. */

import type { CSSProperties } from 'react';

export type IconName =
  | 'play'
  | 'pause'
  | 'stop'
  | 'back30'
  | 'live'
  | 'fullscreen'
  | 'exitFullscreen'
  | 'pip'
  | 'airplay'
  | 'more'
  | 'chevronDown'
  | 'chevronUp'
  | 'chevronLeft'
  | 'chevronRight'
  | 'search'
  | 'gear'
  | 'calendar'
  | 'tv'
  | 'star'
  | 'starFill'
  | 'x'
  | 'check'
  | 'warning'
  | 'refresh'
  | 'paste'
  | 'flag'
  | 'link'
  | 'copy'
  | 'arrowLeft'
  | 'volume'
  | 'mute'
  | 'plus'
  | 'qr'
  | 'iphone'
  | 'ipad'
  | 'laptop'
  | 'list'
  | 'clock'
  | 'signal'
  | 'eye'
  | 'eyeOff'
  | 'external'
  | 'keyboard'
  | 'heart'
  | 'info'
  | 'trash'
  | 'pencil'
  | 'sparkle'
  | 'devices'
  | 'health'
  | 'palette'
  | 'ball'
  | 'wave'
  | 'help'
  | 'sun'
  | 'moon'
  | 'auto';

const P: Record<IconName, React.ReactNode> = {
  play: <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
      <rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />,
  back30: (
    <>
      <path d="M4.5 10a8 8 0 1 1 1.9 7.4" />
      <path d="M4.5 4v6h6" />
      <text x="12.5" y="15.2" fontSize="7" fontWeight="800" textAnchor="middle" fill="currentColor" stroke="none" fontFamily="Inter Variable, system-ui">
        30
      </text>
    </>
  ),
  live: <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />,
  fullscreen: <path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />,
  exitFullscreen: <path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5" />,
  pip: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2.5" />
      <rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  airplay: (
    <>
      <path d="M5 17H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1" />
      <path d="M12 14l5 6H7z" />
    </>
  ),
  more: (
    <>
      <circle cx="6" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
      <circle cx="18" cy="12" r="1.7" fill="currentColor" stroke="none" />
    </>
  ),
  chevronDown: <path d="M6 9l6 6 6-6" />,
  chevronUp: <path d="M6 15l6-6 6 6" />,
  chevronLeft: <path d="M15 6l-6 6 6 6" />,
  chevronRight: <path d="M9 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.8M12 18.7v2.8M2.5 12h2.8M18.7 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M5.3 18.7l2-2M16.7 7.3l2-2" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  tv: (
    <>
      <rect x="3" y="4.5" width="18" height="12.5" rx="2.5" />
      <path d="M8 20.5h8" />
    </>
  ),
  star: <path d="M12 3.5l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 17.3l-5.5 2.9 1.2-6.1-4.5-4.2 6.1-.8z" />,
  starFill: <path d="M12 3.5l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 17.3l-5.5 2.9 1.2-6.1-4.5-4.2 6.1-.8z" fill="currentColor" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  warning: (
    <>
      <path d="M12 3.5L21.5 20h-19z" />
      <path d="M12 9.5v4.5" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v5h-5" />
    </>
  ),
  paste: (
    <>
      <rect x="5" y="5" width="14" height="16" rx="2.5" />
      <path d="M9 5V3.5h6V5" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  flag: <path d="M5 21V4.5h12l-1.5 4 1.5 4H5" />,
  link: (
    <>
      <path d="M10 14a4 4 0 0 1 0-5.7l2.5-2.5a4 4 0 0 1 5.7 5.7L17 12.7" />
      <path d="M14 10a4 4 0 0 1 0 5.7l-2.5 2.5a4 4 0 0 1-5.7-5.7L7 11.3" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </>
  ),
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  volume: (
    <>
      <path d="M4 9.5v5h3l4 3.5v-12l-4 3.5z" />
      <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path d="M4 9.5v5h3l4 3.5v-12l-4 3.5z" />
      <path d="M16 9.5l5 5M21 9.5l-5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  qr: (
    <>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" fill="currentColor" stroke="none" />
    </>
  ),
  iphone: (
    <>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M10.5 5h3" />
    </>
  ),
  ipad: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <circle cx="12" cy="17.8" r="0.8" fill="currentColor" stroke="none" />
    </>
  ),
  laptop: (
    <>
      <rect x="4" y="5" width="16" height="11" rx="2" />
      <path d="M2 19h20" />
    </>
  ),
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  signal: <path d="M4 18v-3M9 18v-7M14 18V7M19 18V4" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M3 3l18 18" />
      <path d="M10.6 6.2A10 10 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3 3.6M6.5 8.4A16 16 0 0 0 2.5 12S6 18 12 18a10 10 0 0 0 4-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </>
  ),
  keyboard: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </>
  ),
  heart: <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5" />
      <circle cx="12" cy="8" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  trash: <path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5M14 11v5" />,
  pencil: <path d="M4 20l4.5-1 10-10-3.5-3.5-10 10z M13.5 7l3.5 3.5" />,
  sparkle: <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />,
  devices: (
    <>
      <rect x="2.5" y="5" width="13" height="10" rx="2" />
      <rect x="17" y="9" width="4.5" height="10" rx="1.5" />
      <path d="M6 19h6" />
    </>
  ),
  health: <path d="M3 12h4l2.5-6 4 12 2.5-6h5" />,
  palette: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="8.5" cy="10" r="1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="7.5" r="1" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="10" r="1" fill="currentColor" stroke="none" />
      <path d="M12 20.5c-1.5-2 0-3.5 1.5-3.5h2a3 3 0 0 0 3-3" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5l3.5 2.5-1.3 4.2h-4.4L8.5 10z" />
      <path d="M12 7.5V3.5M15.5 10l3.8-1.3M14.2 14.2l2.4 3.4M9.8 14.2l-2.4 3.4M8.5 10L4.7 8.7" />
    </>
  ),
  wave: <path d="M3 12c2 0 2-4 4-4s2 8 4 8 2-8 4-8 2 8 4 8 2-4 2-4" />,
  help: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7" />
      <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </>
  ),
  moon: <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />,
  auto: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5v17" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17" fill="currentColor" stroke="none" />
    </>
  ),
};

export function Icon({ name, size = 20, className, style, strokeWidth = 2 }: { name: IconName; size?: number; className?: string; style?: CSSProperties; strokeWidth?: number }) {
  return (
    <svg className={className} style={style} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {P[name]}
    </svg>
  );
}

/** Rueda de carga (solo gira: transform). */
export function Spinner({ size = 22, className }: { size?: number; className?: string }) {
  return (
    <svg className={`pl-spin ${className ?? ''}`} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}
