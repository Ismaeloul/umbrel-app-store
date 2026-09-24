import type { SVGProps } from 'react';

/* Iconos tipo SF Symbols (trazo 2, terminaciones redondas). Dibujados a mano. */

type P = SVGProps<SVGSVGElement> & { size?: number; filled?: boolean };

function Svg({ size = 20, children, filled: _filled, ...rest }: P & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const I = {
  Calendar: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="16" rx="4" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      {p.filled && <rect x="3" y="10" width="18" height="11" rx="0" fill="currentColor" stroke="none" style={{ clipPath: 'inset(0 round 0 0 4px 4px)' }} />}
    </Svg>
  ),
  Tv: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="13" rx="3" fill={p.filled ? 'currentColor' : 'none'} />
      <path d="M8 21h8" />
    </Svg>
  ),
  Gear: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3.2" fill={p.filled ? 'currentColor' : 'none'} />
      <path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.3 5.3l1.7 1.7M17 17l1.7 1.7M5.3 18.7 7 17M17 7l1.7-1.7" />
    </Svg>
  ),
  Search: (p: P) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  ),
  Play: (p: P) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <path d="M7 5.2v13.6a1 1 0 0 0 1.5.86l11-6.8a1 1 0 0 0 0-1.72l-11-6.8A1 1 0 0 0 7 5.2Z" />
    </Svg>
  ),
  Pause: (p: P) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <rect x="6" y="4.5" width="4.2" height="15" rx="1.2" />
      <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" />
    </Svg>
  ),
  Stop: (p: P) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <rect x="5.5" y="5.5" width="13" height="13" rx="2.5" />
    </Svg>
  ),
  Back30: (p: P) => (
    <Svg {...p}>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4 3.5v3.5h3.5" />
      <text x="12" y="15.2" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="inherit">
        30
      </text>
    </Svg>
  ),
  Chevron: (p: P & { dir?: 'l' | 'r' | 'u' | 'd' }) => {
    const rot = { l: 90, r: -90, u: 180, d: 0 }[p.dir ?? 'r'];
    return (
      <Svg {...p} style={{ transform: `rotate(${rot}deg)`, ...p.style }}>
        <path d="m6 9 6 6 6-6" />
      </Svg>
    );
  },
  Star: (p: P) => (
    <Svg {...p} fill={p.filled ? 'currentColor' : 'none'}>
      <path d="m12 3.3 2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.6l-5.4 2.9 1.2-5.9-4.4-4.1 6-.7Z" />
    </Svg>
  ),
  More: (p: P) => (
    <Svg {...p} fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="18.5" cy="12" r="1.8" />
    </Svg>
  ),
  Live: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
      <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
    </Svg>
  ),
  Speaker: (p: P) => (
    <Svg {...p}>
      <path d="M4 9.5v5h3.2L12 18.6V5.4L7.2 9.5Z" fill="currentColor" stroke="none" />
      <path d="M15.5 9a4.2 4.2 0 0 1 0 6M18.3 6.5a8 8 0 0 1 0 11" />
    </Svg>
  ),
  Mute: (p: P) => (
    <Svg {...p}>
      <path d="M4 9.5v5h3.2L12 18.6V5.4L7.2 9.5Z" fill="currentColor" stroke="none" />
      <path d="m15.5 9.5 5 5M20.5 9.5l-5 5" />
    </Svg>
  ),
  Full: (p: P) => (
    <Svg {...p}>
      <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" />
    </Svg>
  ),
  Pip: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <rect x="11" y="11" width="7" height="5" rx="1.2" fill="currentColor" stroke="none" />
    </Svg>
  ),
  Airplay: (p: P) => (
    <Svg {...p}>
      <path d="M6.5 16.5H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-1.5" />
      <path d="m12 14 5 6H7l5-6Z" fill="currentColor" stroke="none" />
    </Svg>
  ),
  Refresh: (p: P) => (
    <Svg {...p}>
      <path d="M20 12a8 8 0 1 1-2.3-5.7" />
      <path d="M20 4v4.5h-4.5" />
    </Svg>
  ),
  Paste: (p: P) => (
    <Svg {...p}>
      <rect x="6" y="5" width="12" height="16" rx="2.5" />
      <path d="M9 5V3.8A.8.8 0 0 1 9.8 3h4.4a.8.8 0 0 1 .8.8V5" />
      <path d="M9 11h6M9 15h4" />
    </Svg>
  ),
  Flag: (p: P) => (
    <Svg {...p}>
      <path d="M5 21V4.5" />
      <path d="M5 5c3-1.6 5.5-1.6 8 0s5 1.6 7 .4V14c-2 1.2-4.5 1.2-7-.4s-5.5-1.6-8 0Z" fill={p.filled ? 'currentColor' : 'none'} />
    </Svg>
  ),
  Check: (p: P) => (
    <Svg {...p}>
      <path d="m5 12.5 4.3 4.3L19 7.5" />
    </Svg>
  ),
  X: (p: P) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
  Copy: (p: P) => (
    <Svg {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9" />
    </Svg>
  ),
  External: (p: P) => (
    <Svg {...p}>
      <path d="M14 4h6v6M20 4l-9 9" />
      <path d="M19 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4.5" />
    </Svg>
  ),
  Phone: (p: P) => (
    <Svg {...p}>
      <rect x="7" y="2.5" width="10" height="19" rx="2.5" />
      <path d="M11 18.5h2" />
    </Svg>
  ),
  Tablet: (p: P) => (
    <Svg {...p}>
      <rect x="4" y="3" width="16" height="18" rx="2.5" />
      <path d="M11 18h2" />
    </Svg>
  ),
  Desktop: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="4" width="18" height="12" rx="2.5" />
      <path d="M8 20h8M12 16v4" />
    </Svg>
  ),
  Qr: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <path d="M14 14h3v3h-3zM20 14h1v1M17 20h1v1M20 18v3h-3" />
    </Svg>
  ),
  Sun: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </Svg>
  ),
  Moon: (p: P) => (
    <Svg {...p}>
      <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" fill={p.filled ? 'currentColor' : 'none'} />
    </Svg>
  ),
  Heart: (p: P) => (
    <Svg {...p} fill={p.filled ? 'currentColor' : 'none'}>
      <path d="M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7.5 2.5c0 5.4-7.5 10-7.5 10Z" />
    </Svg>
  ),
  Bolt: (p: P) => (
    <Svg {...p} fill={p.filled ? 'currentColor' : 'none'}>
      <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11H12Z" />
    </Svg>
  ),
  Info: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5.5M12 7.8v.4" />
    </Svg>
  ),
  Warn: (p: P) => (
    <Svg {...p}>
      <path d="M12 3.5 21 19.5H3Z" />
      <path d="M12 9.5v4.5M12 16.8v.4" />
    </Svg>
  ),
  Trash: (p: P) => (
    <Svg {...p}>
      <path d="M4 7h16M9.5 7V4.8A.8.8 0 0 1 10.3 4h3.4a.8.8 0 0 1 .8.8V7M6 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h7.2a1.5 1.5 0 0 0 1.5-1.3L18 7" />
    </Svg>
  ),
  Plus: (p: P) => (
    <Svg {...p}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  ),
  Link: (p: P) => (
    <Svg {...p}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </Svg>
  ),
  Clock: (p: P) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ),
  Eye: (p: P) => (
    <Svg {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </Svg>
  ),
  EyeOff: (p: P) => (
    <Svg {...p}>
      <path d="M3 3l18 18M10.6 6.2A9.7 9.7 0 0 1 12 6c6 0 9.5 6 9.5 6a17 17 0 0 1-3.2 3.7M6.6 6.6C4 8.4 2.5 12 2.5 12s3.5 6.5 9.5 6.5a8.9 8.9 0 0 0 3.6-.8" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    </Svg>
  ),
  Keyboard: (p: P) => (
    <Svg {...p}>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M7 10h.5M11 10h.5M15 10h.5M7 14h10" />
    </Svg>
  ),
  Bars: ({ level = 3, busy = false, ...p }: P & { level?: 0 | 1 | 2 | 3; busy?: boolean }) => {
    return (
      <Svg {...p} strokeWidth="0" fill="currentColor" className={`tb-bars${busy ? ' is-busy' : ''} ${p.className ?? ''}`}>
        <rect x="3" y="14" width="4.5" height="7" rx="1.2" opacity={level >= 1 ? 1 : 0.25} />
        <rect x="9.75" y="9" width="4.5" height="12" rx="1.2" opacity={level >= 2 ? 1 : 0.25} />
        <rect x="16.5" y="4" width="4.5" height="17" rx="1.2" opacity={level >= 3 ? 1 : 0.25} />
      </Svg>
    );
  },
  Signal: (p: P) => (
    <Svg {...p}>
      <path d="M12 20v-6M8.5 9.5a5 5 0 0 1 7 0M5.5 6.5a9 9 0 0 1 13 0" />
      <circle cx="12" cy="13" r="1.2" fill="currentColor" stroke="none" />
    </Svg>
  ),
};
