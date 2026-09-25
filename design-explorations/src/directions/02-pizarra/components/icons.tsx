/* Iconos propios de Pizarra: trazo 1,75, esquinas a 45°, estilo Strava/Bloomberg. */
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 18, ...rest }: P, children: React.ReactNode) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" strokeLinejoin="miter" aria-hidden="true" {...rest}>
      {children}
    </svg>
  );
}

export const IPlay = (p: P) => base(p, <path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="none" />);
export const IPause = (p: P) => base(p, <path d="M7 4.5h3.5v15H7zM13.5 4.5H17v15h-3.5z" fill="currentColor" stroke="none" />);
export const IStop = (p: P) => base(p, <path d="M6 6h12v12H6z" fill="currentColor" stroke="none" />);
export const IBack30 = (p: P) =>
  base(
    p,
    <>
      <path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" />
      <path d="M4 3.5v4.4h4.4" />
      <text x="12" y="15.5" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="currentColor" stroke="none" fontFamily="Inter Variable, system-ui">
        30
      </text>
    </>,
  );
export const IFullscreen = (p: P) => base(p, <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />);
export const IExitFullscreen = (p: P) => base(p, <path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5" />);
export const IPiP = (p: P) => base(p, <><path d="M3 5h18v14H3z" /><path d="M12 12h7v5h-7z" fill="currentColor" stroke="none" /></>);
export const IAirPlay = (p: P) => base(p, <><path d="M5 17H3V5h18v12h-2" /><path d="M12 13l5 7H7z" /></>);
export const IVolume = (p: P) => base(p, <><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" /><path d="M15.5 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11" /></>);
export const IMuted = (p: P) => base(p, <><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" /><path d="M16 9.5l5 5M21 9.5l-5 5" /></>);
export const IChevronDown = (p: P) => base(p, <path d="M6 9l6 6 6-6" />);
export const IChevronRight = (p: P) => base(p, <path d="M9 6l6 6-6 6" />);
export const IChevronLeft = (p: P) => base(p, <path d="M15 6l-6 6 6 6" />);
export const IChevronUp = (p: P) => base(p, <path d="M6 15l6-6 6 6" />);
export const IClose = (p: P) => base(p, <path d="M6 6l12 12M18 6L6 18" />);
export const IMore = (p: P) => base(p, <><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none" /></>);
export const ISearch = (p: P) => base(p, <><circle cx="11" cy="11" r="6.5" /><path d="M16 16l5 5" /></>);
export const IEye = (p: P) => base(p, <><path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.75" /></>);
export const IEyeOff = (p: P) => base(p, <><path d="M3 3l18 18" /><path d="M10.5 6.2A9.6 9.6 0 0 1 12 6c6 0 9.5 6 9.5 6a16 16 0 0 1-3.3 3.9M6.6 6.6C4 8.4 2.5 12 2.5 12s3.5 6.5 9.5 6.5c1.5 0 2.9-.4 4.1-1" /></>);
export const IRefresh = (p: P) => base(p, <><path d="M20 12a8 8 0 1 1-2.3-5.7" /><path d="M20 4v4.5h-4.5" /></>);
export const IPaste = (p: P) => base(p, <><path d="M8 5H6v15h12V5h-2" /><path d="M9 3h6v4H9z" /><path d="M9 12h6M9 15.5h4" /></>);
export const IFlag = (p: P) => base(p, <path d="M5 21V4h13l-3 4.5 3 4.5H5" />);
export const ICheck = (p: P) => base(p, <path d="M4.5 12.5l5 5 10-10" />);
export const ICopy = (p: P) => base(p, <><path d="M9 9h11v11H9z" /><path d="M5 15H4V4h11v1" /></>);
export const IExternal = (p: P) => base(p, <><path d="M14 4h6v6" /><path d="M20 4l-9 9" /><path d="M19 14v6H4V5h6" /></>);
export const IStar = (p: P & { filled?: boolean }) => {
  const { filled, ...rest } = p;
  return base(rest, <path d="M12 3.5l2.6 5.6 6.1.7-4.5 4.2 1.2 6.1L12 17l-5.4 3.1 1.2-6.1-4.5-4.2 6.1-.7z" fill={filled ? 'currentColor' : 'none'} />);
};
export const ITrash = (p: P) => base(p, <><path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14" /></>);
export const IPlus = (p: P) => base(p, <path d="M12 5v14M5 12h14" />);
export const IMinus = (p: P) => base(p, <path d="M5 12h14" />);
export const IPencil = (p: P) => base(p, <path d="M4 20l4.5-1L19 8.5 15.5 5 5 15.5z M13.5 7l3.5 3.5" />);
export const IList = (p: P) => base(p, <path d="M4 6h16M4 12h16M4 18h16" />);
export const IGrid = (p: P) => base(p, <path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />);
export const IDensity = (p: P) => base(p, <path d="M4 5h16M4 9.5h16M4 14h16M4 18.5h16" />);
export const IDensityLoose = (p: P) => base(p, <path d="M4 6h16M4 12h16M4 18h16" />);
export const IHelp = (p: P) => base(p, <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.8.4-1.1 1-1.1 1.8" /><circle cx="12" cy="17" r=".9" fill="currentColor" stroke="none" /></>);
export const IKeyboard = (p: P) => base(p, <><path d="M3 6h18v12H3z" /><path d="M6 10h1M9 10h1M12 10h1M15 10h1M18 10h0M6 14h1M9 14h6M18 14h0" /></>);
export const IBolt = (p: P) => base(p, <path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H13z" />);
export const IPhone = (p: P) => base(p, <><path d="M7 2.5h10v19H7z" /><path d="M10.5 19h3" /></>);
export const ITablet = (p: P) => base(p, <><path d="M4 3h16v18H4z" /><path d="M11 18.5h2" /></>);
export const IDesktop = (p: P) => base(p, <><path d="M3 4h18v12H3z" /><path d="M8 20h8M12 16v4" /></>);
export const ITv = (p: P) => base(p, <><path d="M3 6h18v12H3z" /><path d="M8 21h8" /></>);
export const IDevices = (p: P) => base(p, <><path d="M3 5h13v10H3z" /><path d="M16 9h5v10h-5z" /><path d="M7 19h5" /></>);
export const IGear = (p: P) => base(p, <><circle cx="12" cy="12" r="3" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1" /></>);
export const ICalendar = (p: P) => base(p, <><path d="M3 5h18v16H3z" /><path d="M3 10h18M8 3v4M16 3v4" /></>);
export const ILive = (p: P) => base(p, <><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" /><path d="M6.5 6.5a7.8 7.8 0 0 0 0 11M17.5 6.5a7.8 7.8 0 0 1 0 11" /></>);
export const IChannels = (p: P) => base(p, <><path d="M3 7h18v12H3z" /><path d="M8 3l4 4 4-4" /></>);
export const IHeart = (p: P) => base(p, <path d="M12 20s-7.5-4.6-7.5-10A4 4 0 0 1 12 7.2 4 4 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z" />);
export const IClock = (p: P) => base(p, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" /></>);
export const IWave = (p: P) => base(p, <path d="M3 12h3l2-6 3 12 3-9 2 3h5" />);
export const IHealth = (p: P) => base(p, <path d="M3 12h4l2.5-6 3 12 2.5-6h6" />);
export const IShield = (p: P) => base(p, <path d="M12 2.5l8 3v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10v-6z" />);
export const ISun = (p: P) => base(p, <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8" /></>);
export const IMoon = (p: P) => base(p, <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />);
export const IHandoff = (p: P) => base(p, <><path d="M4 8h9l-3-3M20 16h-9l3 3" /></>);
export const IUsers = (p: P) => base(p, <><circle cx="9" cy="8" r="3.5" /><path d="M3 20a6 6 0 0 1 12 0" /><circle cx="17" cy="9" r="2.5" /><path d="M15.5 14.5a5 5 0 0 1 5.5 5.5" /></>);
export const IArrowUp = (p: P) => base(p, <path d="M12 19V5M5 12l7-7 7 7" />);
export const IZap = (p: P) => base(p, <><path d="M4 12h5M15 12h5" /><path d="M9 7l3 5-3 5M15 7l-3 5 3 5" /></>);
export const IQr = (p: P) => base(p, <><path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4z" /><path d="M14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z" fill="currentColor" stroke="none" /></>);
export const ICamera = (p: P) => base(p, <><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" /></>);
export const ILink = (p: P) => base(p, <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.5 1.5" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.5-1.5" /></>);
export const ISpeaker = (p: P) => base(p, <><path d="M4 9.5v5h3.5L12 18V6L7.5 9.5z" fill="currentColor" stroke="none" /><path d="M15.5 9a4 4 0 0 1 0 6" /></>);
export const IBall = (p: P) => base(p, <><circle cx="12" cy="12" r="9" /><path d="M12 7l4.5 3.3-1.7 5.4h-5.6L7.5 10.3z" /><path d="M12 3v4M3.4 10.3l4.1 0M20.6 10.3l-4.1 0M6.5 20l2.2-4.3M17.5 20l-2.2-4.3" /></>);
