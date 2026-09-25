/* Iconografía propia de Consola: trazo 1,5 px a 16 px, estilo Linear/Lucide.
   Todos los iconos son SVG inline; nada descargado. */

export type IconName =
  | 'search'
  | 'command'
  | 'play'
  | 'pause'
  | 'stop'
  | 'back30'
  | 'live'
  | 'volume'
  | 'mute'
  | 'fullscreen'
  | 'fullscreen-exit'
  | 'pip'
  | 'airplay'
  | 'chevron-right'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-up'
  | 'star'
  | 'star-filled'
  | 'clock'
  | 'list'
  | 'tv'
  | 'settings'
  | 'phone'
  | 'activity'
  | 'more'
  | 'x'
  | 'check'
  | 'plus'
  | 'refresh'
  | 'flag'
  | 'clipboard'
  | 'external'
  | 'copy'
  | 'sidebar'
  | 'arrow-left'
  | 'arrow-right'
  | 'arrow-up'
  | 'calendar'
  | 'help'
  | 'eye'
  | 'eye-off'
  | 'zap'
  | 'trash'
  | 'link'
  | 'keyboard'
  | 'sun'
  | 'moon'
  | 'monitor'
  | 'edit'
  | 'ball'
  | 'grid'
  | 'qr'
  | 'shield'
  | 'radio'
  | 'skip'
  | 'info'
  | 'tablet'
  | 'hash'
  | 'at'
  | 'terminal'
  | 'layers'
  | 'heart'
  | 'wifi'
  | 'chevrons-updown';

const P: Record<IconName, string> = {
  search: 'M11 11l3.5 3.5M12.5 7a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z',
  command: 'M6 6V4.5a1.5 1.5 0 1 0-1.5 1.5H6Zm0 0v4m0-4h4m-4 4H4.5a1.5 1.5 0 1 0 1.5 1.5V10Zm0 0h4m0-4V4.5A1.5 1.5 0 1 1 11.5 6H10Zm0 0v4m0 0h1.5a1.5 1.5 0 1 1-1.5 1.5V10Z',
  play: 'M4.5 3.2v9.6c0 .5.5.8.9.5l7.4-4.8c.4-.3.4-.8 0-1L5.4 2.7c-.4-.3-.9 0-.9.5Z',
  pause: 'M5 3v10M11 3v10',
  stop: 'M4 4h8v8H4Z',
  back30: 'M3 8a5 5 0 1 0 1.5-3.6M3 3v2.5h2.5M7.5 10.5v-4l-1 .7M10 6.5h1.5a.8.8 0 0 1 0 1.6h-.5m.5 0a.9.9 0 0 1 0 1.9H10',
  live: 'M8 8m-1.5 0a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M4.5 4.5a5 5 0 0 0 0 7M11.5 4.5a5 5 0 0 1 0 7',
  volume: 'M2.5 6v4h2l3 2.5v-9L4.5 6h-2ZM10 6a3 3 0 0 1 0 4M12 4.2a5.6 5.6 0 0 1 0 7.6',
  mute: 'M2.5 6v4h2l3 2.5v-9L4.5 6h-2ZM10 6.5l3 3m0-3-3 3',
  fullscreen: 'M3 6V3h3M10 3h3v3M13 10v3h-3M6 13H3v-3',
  'fullscreen-exit': 'M6 3v3H3M10 6h3V3M13 10h-3v3M3 10h3v3',
  pip: 'M2.5 4h11v8h-11ZM8.5 8h4v3h-4Z',
  airplay: 'M4.5 11.5h-1a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-1M8 9l3.5 4.5h-7L8 9Z',
  'chevron-right': 'M6 3.5 10.5 8 6 12.5',
  'chevron-down': 'M3.5 6 8 10.5 12.5 6',
  'chevron-left': 'M10 3.5 5.5 8 10 12.5',
  'chevron-up': 'M3.5 10 8 5.5l4.5 4.5',
  star: 'M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.5l4-.6L8 2.2Z',
  'star-filled': 'M8 2.2l1.8 3.7 4 .6-2.9 2.8.7 4-3.6-1.9-3.6 1.9.7-4L2.2 6.5l4-.6L8 2.2Z',
  clock: 'M8 4.5V8l2.3 1.4M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z',
  list: 'M5.5 4h8M5.5 8h8M5.5 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  tv: 'M2.5 4.5h11v7h-11ZM5.5 14h5M8 11.5V14',
  settings: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm5-2c0-.4 0-.8-.1-1.1l1.3-1-1.2-2.1-1.6.5a5 5 0 0 0-1.9-1.1L9.2 1.5H6.8l-.3 1.7a5 5 0 0 0-1.9 1.1l-1.6-.5-1.2 2.1 1.3 1A5 5 0 0 0 3 8c0 .4 0 .8.1 1.1l-1.3 1 1.2 2.1 1.6-.5a5 5 0 0 0 1.9 1.1l.3 1.7h2.4l.3-1.7a5 5 0 0 0 1.9-1.1l1.6.5 1.2-2.1-1.3-1c.1-.3.1-.7.1-1.1Z',
  phone: 'M5 1.5h6a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM7 12.5h2',
  activity: 'M1.5 8h2.5l2-5 3 10 2-5h3.5',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  x: 'M4 4l8 8M12 4l-8 8',
  check: 'M3 8.5 6.2 11.5 13 4.5',
  plus: 'M8 3v10M3 8h10',
  refresh: 'M13 8a5 5 0 1 1-1.5-3.6M13 3v2.5h-2.5',
  flag: 'M3.5 14V2.5h8l-1.5 3 1.5 3h-8',
  clipboard: 'M5.5 3h-1a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1h-1M5.5 2h5v2h-5Z',
  external: 'M9 3h4v4M13 3 7.5 8.5M11 9.5V12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2.5',
  copy: 'M6 6h7v7H6ZM3 10V3h7',
  sidebar: 'M2.5 3.5h11v9h-11ZM6 3.5v9',
  'arrow-left': 'M13 8H3M7 4 3 8l4 4',
  'arrow-right': 'M3 8h10M9 4l4 4-4 4',
  'arrow-up': 'M8 13V3M4 7l4-4 4 4',
  calendar: 'M2.5 4.5h11v8.5h-11ZM2.5 7.5h11M5 2.5v3M11 2.5v3',
  help: 'M6.2 6.2A2 2 0 0 1 10 6.5c0 1.3-2 1.5-2 3M8 11.8h.01M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z',
  eye: 'M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  'eye-off': 'M2.5 2.5l11 11M6.6 6.6a2 2 0 0 0 2.8 2.8M4.3 4.4C2.5 5.6 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.2 0 2.2-.4 3.1-.9M7 3.6c.3 0 .7-.1 1-.1 4 0 6.5 4.5 6.5 4.5s-.6 1.1-1.7 2.2',
  zap: 'M9 1.5 3 9h4.5L7 14.5 13 7H8.5L9 1.5Z',
  trash: 'M3 4.5h10M6 4.5V3h4v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5',
  link: 'M6.5 9.5 9.5 6.5M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.5 2.5 0 0 1 4.5 9l1-1',
  keyboard: 'M2.5 4.5h11v7h-11ZM5 7h.01M8 7h.01M11 7h.01M5.5 9.5h5',
  sun: 'M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1',
  moon: 'M13 9.5A5.5 5.5 0 0 1 6.5 3a5.5 5.5 0 1 0 6.5 6.5Z',
  monitor: 'M2.5 3.5h11v7h-11ZM5.5 13.5h5M8 10.5v3',
  edit: 'M9.5 3.5l3 3-7 7h-3v-3l7-7ZM8.5 4.5l3 3',
  ball: 'M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0ZM8 5.2l2.4 1.7-.9 2.8H6.5l-.9-2.8L8 5.2ZM8 2.5v2.7M2.8 6.6l2.8.3M13.2 6.6l-2.8.3M4.6 12.4l1.9-2.7M11.4 12.4 9.5 9.7',
  grid: 'M2.5 2.5h4.5v4.5H2.5ZM9 2.5h4.5V7H9ZM2.5 9H7v4.5H2.5ZM9 9h4.5v4.5H9Z',
  qr: 'M2.5 2.5h4v4h-4ZM9.5 2.5h4v4h-4ZM2.5 9.5h4v4h-4ZM9.5 9.5h1.5v1.5H9.5ZM12 12h1.5v1.5H12ZM12 9.5h1.5M9.5 12v1.5',
  shield: 'M8 1.5 13 3.5v4c0 3-2.2 5.3-5 6.5-2.8-1.2-5-3.5-5-6.5v-4L8 1.5Z',
  radio: 'M8 8h.01M5.2 5.2a4 4 0 0 0 0 5.6M10.8 5.2a4 4 0 0 1 0 5.6M3 3a7 7 0 0 0 0 10M13 3a7 7 0 0 1 0 10',
  skip: 'M3 3.5v9l6-4.5-6-4.5ZM12.5 3.5v9',
  info: 'M8 7v4M8 4.8h.01M13.5 8a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0Z',
  tablet: 'M3 1.5h10a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1ZM8 12.5h.01',
  hash: 'M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10h11',
  at: 'M10 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0Zm0 0v1a1.5 1.5 0 0 0 3 0V8a5 5 0 1 0-2 4',
  terminal: 'M3 4.5 6.5 8 3 11.5M8 11.5h5',
  layers: 'M8 2.5 14 5.5 8 8.5 2 5.5 8 2.5ZM2 8.5l6 3 6-3M2 11.5l6 3 6-3',
  heart: 'M8 13.5S2 9.8 2 5.8A3 3 0 0 1 8 4.4a3 3 0 0 1 6 1.4c0 4-6 7.7-6 7.7Z',
  wifi: 'M1.5 6.5a9 9 0 0 1 13 0M4 9a5.5 5.5 0 0 1 8 0M6.5 11.5a2 2 0 0 1 3 0M8 13.5h.01',
  'chevrons-updown': 'M5 6l3-3 3 3M5 10l3 3 3-3',
};

export function Icon({ name, size = 16, className, style, strokeWidth = 1.5, title }: { name: IconName; size?: number; className?: string; style?: React.CSSProperties; strokeWidth?: number; title?: string }) {
  const filled = name === 'star-filled' || name === 'play' || name === 'stop';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 0 : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flex: 'none', display: 'block', ...style }}
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={P[name]} />
    </svg>
  );
}
