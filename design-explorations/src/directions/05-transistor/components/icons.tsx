/* Iconos propios de la propuesta: trazo 2, esquinas redondeadas, motivos de
   radio (dial, onda, antena, presintonía). Todo SVG en línea. */

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function I({ size = 20, children, ...rest }: P) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      {children}
    </svg>
  );
}

export const IcDial = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 12l4.2-4.2" />
    <path d="M12 3.5v1.5M20.5 12H19M12 20.5V19M3.5 12H5" />
  </I>
);
export const IcAntenna = (p: P) => (
  <I {...p}>
    <path d="M12 21V10" />
    <path d="M7.5 5.5a6.4 6.4 0 0 1 9 0M5 3a10 10 0 0 1 14 0" />
    <circle cx="12" cy="8.5" r="1.6" fill="currentColor" stroke="none" />
    <path d="M8 21h8" />
  </I>
);
export const IcWave = (p: P) => (
  <I {...p}>
    <path d="M4 12v0M8 8v8M12 5v14M16 8v8M20 12v0" />
  </I>
);
export const IcGrid = (p: P) => (
  <I {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M9 9.5v10M15 9.5v10" />
  </I>
);
export const IcPreset = (p: P) => (
  <I {...p}>
    <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
    <path d="M7.5 9.5h3M7.5 13.5h6M14 9.5h2.5" />
  </I>
);
export const IcSearch = (p: P) => (
  <I {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </I>
);
export const IcSettings = (p: P) => (
  <I {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2.2" />
    <circle cx="10" cy="17" r="2.2" />
  </I>
);
export const IcPlay = (p: P) => (
  <I {...p}>
    <path d="M7 5.5v13l11-6.5z" fill="currentColor" stroke="none" />
  </I>
);
export const IcPause = (p: P) => (
  <I {...p}>
    <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" stroke="none" />
  </I>
);
export const IcStop = (p: P) => (
  <I {...p}>
    <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" stroke="none" />
  </I>
);
export const IcBack30 = (p: P) => (
  <I {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7" />
    <path d="M4 4v5h5" />
    <text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="inherit">
      30
    </text>
  </I>
);
export const IcLive = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    <path d="M6.3 6.3a8 8 0 0 0 0 11.4M17.7 6.3a8 8 0 0 1 0 11.4" />
  </I>
);
export const IcFull = (p: P) => (
  <I {...p}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4" />
  </I>
);
export const IcShrink = (p: P) => (
  <I {...p}>
    <path d="M9 4v4a1 1 0 0 1-1 1H4M15 4v4a1 1 0 0 0 1 1h4M20 15h-4a1 1 0 0 0-1 1v4M4 15h4a1 1 0 0 1 1 1v4" />
  </I>
);
export const IcPip = (p: P) => (
  <I {...p}>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <rect x="12" y="11" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
  </I>
);
export const IcAirplay = (p: P) => (
  <I {...p}>
    <path d="M5 16H4a1.5 1.5 0 0 1-1.5-1.5v-8A1.5 1.5 0 0 1 4 5h16a1.5 1.5 0 0 1 1.5 1.5v8A1.5 1.5 0 0 1 20 16h-1" />
    <path d="m12 14 5 6H7z" />
  </I>
);
export const IcMute = (p: P) => (
  <I {...p}>
    <path d="M4 9.5v5h3l4 3.5v-12l-4 3.5z" />
    <path d="m16 9.5 5 5M21 9.5l-5 5" />
  </I>
);
export const IcSound = (p: P) => (
  <I {...p}>
    <path d="M4 9.5v5h3l4 3.5v-12l-4 3.5z" />
    <path d="M15.5 9a4.5 4.5 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" />
  </I>
);
export const IcChevronLeft = (p: P) => (
  <I {...p}>
    <path d="m14.5 6-6 6 6 6" />
  </I>
);
export const IcChevronRight = (p: P) => (
  <I {...p}>
    <path d="m9.5 6 6 6-6 6" />
  </I>
);
export const IcChevronDown = (p: P) => (
  <I {...p}>
    <path d="m6 9.5 6 6 6-6" />
  </I>
);
export const IcChevronUp = (p: P) => (
  <I {...p}>
    <path d="m6 14.5 6-6 6 6" />
  </I>
);
export const IcClose = (p: P) => (
  <I {...p}>
    <path d="m6 6 12 12M18 6 6 18" />
  </I>
);
export const IcStar = ({ filled, ...p }: P & { filled?: boolean }) => (
  <I {...p}>
    <path d="m12 3.5 2.6 5.4 5.9.8-4.3 4.1 1.1 5.8L12 16.8l-5.3 2.8 1.1-5.8-4.3-4.1 5.9-.8z" fill={filled ? 'currentColor' : 'none'} />
  </I>
);
export const IcMore = (p: P) => (
  <I {...p}>
    <circle cx="6" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1.6" fill="currentColor" stroke="none" />
  </I>
);
export const IcRefresh = (p: P) => (
  <I {...p}>
    <path d="M20 12a8 8 0 1 1-2.3-5.7" />
    <path d="M20 4v5h-5" />
  </I>
);
export const IcPaste = (p: P) => (
  <I {...p}>
    <rect x="6" y="5" width="12" height="16" rx="2" />
    <path d="M9 5.5V4.5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M9 11h6M9 15h4" />
  </I>
);
export const IcFlag = (p: P) => (
  <I {...p}>
    <path d="M5 21V4.5" />
    <path d="M5 5h12l-2 4 2 4H5" />
  </I>
);
export const IcCheck = (p: P) => (
  <I {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </I>
);
export const IcExternal = (p: P) => (
  <I {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </I>
);
export const IcPhone = (p: P) => (
  <I {...p}>
    <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
    <path d="M11 18.5h2" />
  </I>
);
export const IcTablet = (p: P) => (
  <I {...p}>
    <rect x="4" y="3" width="16" height="18" rx="2.5" />
    <path d="M11 18h2" />
  </I>
);
export const IcDesktop = (p: P) => (
  <I {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </I>
);
export const IcTv = (p: P) => (
  <I {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M8 3l4 3 4-3" />
  </I>
);
export const IcQr = (p: P) => (
  <I {...p}>
    <rect x="4" y="4" width="6" height="6" rx="1" />
    <rect x="14" y="4" width="6" height="6" rx="1" />
    <rect x="4" y="14" width="6" height="6" rx="1" />
    <path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2h-2z" />
  </I>
);
export const IcPlus = (p: P) => (
  <I {...p}>
    <path d="M12 5v14M5 12h14" />
  </I>
);
export const IcTrash = (p: P) => (
  <I {...p}>
    <path d="M4 7h16M9 7V4.5h6V7M6.5 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
  </I>
);
export const IcPen = (p: P) => (
  <I {...p}>
    <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z" />
    <path d="m13.5 7.5 3 3" />
  </I>
);
export const IcLink = (p: P) => (
  <I {...p}>
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" />
  </I>
);
export const IcHeart = (p: P) => (
  <I {...p}>
    <path d="M12 20s-7-4.3-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.7-7 10-7 10z" />
  </I>
);
export const IcKeyboard = (p: P) => (
  <I {...p}>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10" />
  </I>
);
export const IcLightning = (p: P) => (
  <I {...p}>
    <path d="M13 3 5 14h6l-1 7 8-11h-6z" />
  </I>
);
export const IcWarning = (p: P) => (
  <I {...p}>
    <path d="M12 4 2.5 20h19z" />
    <path d="M12 10v4M12 17h.01" />
  </I>
);
export const IcInfo = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5M12 8h.01" />
  </I>
);
export const IcCalendar = (p: P) => (
  <I {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2" />
    <path d="M3.5 9.5h17M8 3v4M16 3v4" />
  </I>
);
export const IcList = (p: P) => (
  <I {...p}>
    <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
  </I>
);
export const IcSwap = (p: P) => (
  <I {...p}>
    <path d="M7 7h12l-3-3M17 17H5l3 3" />
  </I>
);
export const IcBall = (p: P) => (
  <I {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m12 7 3.2 2.3-1.2 3.7H10l-1.2-3.7z" />
    <path d="M12 7V3.6M15.2 9.3l3.2-1M14 13l2 3M10 13l-2 3M8.8 9.3l-3.2-1" />
  </I>
);
