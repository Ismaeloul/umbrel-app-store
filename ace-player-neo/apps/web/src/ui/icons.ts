/* Set de iconos propio (docs/diseno/opcion-A/iconos.js): trazo 1,8 px, puntas
   redondas y rejilla de 24. Se pintan en línea (sin sprite ni petición) con
   el componente Icon. Los añadidos para la app van al final, con el mismo
   trazo. Nada de iconos de marcas ni de escudos. */

export const ICONS = {
  agenda:
    '<rect x="3.5" y="5" width="17" height="15.5" rx="4"/><path d="M3.5 10h17M8 3v4M16 3v4"/><circle cx="12" cy="15.2" r="2.1"/>',
  biblioteca:
    '<rect x="3.5" y="9" width="17" height="11.5" rx="3.5"/><path d="M6 5.8h12M8.5 2.8h7"/><path d="M10.5 12.6v4.3l3.7-2.15z"/>',
  buscar: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="M15.6 15.6l4.6 4.6"/>',
  ajustes:
    '<path d="M4 7.5h9M17.5 7.5H20M4 16.5h2.5M11 16.5h9"/><circle cx="15.2" cy="7.5" r="2.3"/><circle cx="8.8" cy="16.5" r="2.3"/>',
  play: '<path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.4-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/>',
  pause:
    '<rect x="6.5" y="5" width="4" height="14" rx="1.3"/><rect x="13.5" y="5" width="4" height="14" rx="1.3"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/>',
  vol: '<path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"/><path d="M15 9.2a4 4 0 0 1 0 5.6M17.6 6.6a7.6 7.6 0 0 1 0 10.8"/>',
  mute: '<path d="M4 9.5h3.2L11.5 6v12l-4.3-3.5H4z"/><path d="M15.5 9.5l5 5M20.5 9.5l-5 5"/>',
  back: '<path d="M5 12.5a7.5 7.5 0 1 0 2.4-5.5"/><path d="M4.4 4.2v4.3h4.3"/>',
  full: '<path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15"/>',
  pip: '<rect x="3" y="5" width="18" height="14" rx="3.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1.4" fill="currentColor" stroke="none"/>',
  more: '<circle cx="5.5" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.7" fill="currentColor" stroke="none"/>',
  star: '<path d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"/>',
  'star-f':
    '<path fill="currentColor" d="M12 3.8l2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5 2.7 1-5.6-4.1-3.9 5.6-.8z"/>',
  copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="3"/><path d="M15.5 8.5V6.5a2.5 2.5 0 0 0-2.5-2.5H6.5A2.5 2.5 0 0 0 4 6.5V13a2.5 2.5 0 0 0 2.5 2.5h2"/>',
  paste:
    '<rect x="5" y="4.5" width="14" height="16" rx="3"/><path d="M9 4.5V3.8A1.3 1.3 0 0 1 10.3 2.5h3.4A1.3 1.3 0 0 1 15 3.8v.7M9 11h6M9 15h4"/>',
  flag: '<path d="M5.5 21V4.5M5.5 4.5h11.2l-2.2 4 2.2 4H5.5"/>',
  refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.6 4.3v4.6H15"/>',
  check: '<path d="M5 12.5l4.3 4.3L19 7"/>',
  learn: '<circle cx="12" cy="12" r="8.5"/><path d="M8.3 12.2l2.6 2.6 5-5.3"/>',
  'chev-d': '<path d="M6 9.5l6 6 6-6"/>',
  'chev-u': '<path d="M6 14.5l6-6 6 6"/>',
  'chev-l': '<path d="M14.5 6l-6 6 6 6"/>',
  'chev-r': '<path d="M9.5 6l6 6-6 6"/>',
  tv: '<rect x="3" y="5.5" width="18" height="12.5" rx="3"/><path d="M8.5 21h7"/>',
  motor: '<path d="M13.2 2.8L5.6 13.2h5.6l-1 8 7.6-10.4h-5.6z"/>',
  nerd: '<path d="M4 4.5v15h16"/><path d="M7.5 15l3.3-4.2 3 2.4 4.7-6"/>',
  hash: '<path d="M9.5 4l-2 16M16.5 4l-2 16M4.5 9h15.5M4 15h15.5"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.8" cy="6.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.8" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="4.8" cy="17.5" r="1.2" fill="currentColor" stroke="none"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  eye: '<path d="M2.8 12s3.4-6.2 9.2-6.2 9.2 6.2 9.2 6.2-3.4 6.2-9.2 6.2S2.8 12 2.8 12z"/><circle cx="12" cy="12" r="2.8"/>',
  'eye-off':
    '<path d="M4 4l16 16M10 5.9c.6-.1 1.3-.1 2-.1 5.8 0 9.2 6.2 9.2 6.2a16 16 0 0 1-2.6 3.4M6.5 7.6A15.6 15.6 0 0 0 2.8 12s3.4 6.2 9.2 6.2c1.5 0 2.8-.4 4-1"/>',
  panel: '<rect x="3" y="4.5" width="18" height="15" rx="3.5"/><path d="M14.5 4.5v15"/>',
  x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  pencil: '<path d="M4.5 19.5l.9-4 10-10a2 2 0 0 1 2.9 0l.2.2a2 2 0 0 1 0 2.9l-10 10z"/>',
  trash:
    '<path d="M4.5 7h15M9.5 7V5a1.5 1.5 0 0 1 1.5-1.5h2A1.5 1.5 0 0 1 14.5 5v2M6.5 7l.9 11.2A2 2 0 0 0 9.4 20h5.2a2 2 0 0 0 2-1.8L17.5 7"/>',
  kbd: '<rect x="2.5" y="6" width="19" height="12" rx="3"/><path d="M6.5 10h1M10.5 10h1M14.5 10h1M8 14h8"/>',
  // --- Añadidos de la app (mismo trazo) ---
  sol: '<circle cx="12" cy="12" r="3.8"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
  luna: '<path d="M19.5 14.6A7.8 7.8 0 0 1 9.4 4.5a7.8 7.8 0 1 0 10.1 10.1z"/>',
  pantalla: '<rect x="3" y="4.5" width="18" height="12" rx="3"/><path d="M9 20h6M12 16.5V20"/>',
  movil: '<rect x="6.5" y="2.8" width="11" height="18.4" rx="3"/><path d="M10.5 18h3"/>',
  qr: '<rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="14" y="3.5" width="6.5" height="6.5" rx="1.5"/><rect x="3.5" y="14" width="6.5" height="6.5" rx="1.5"/><path d="M14 14h2.5v2.5M20.5 14v6.5H14M17.5 17.5v3"/>',
  externo:
    '<path d="M13.5 4.5h6v6M19.5 4.5l-8 8"/><path d="M17.5 14v3.5a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2H10"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5"/><circle cx="12" cy="7.8" r="1.1" fill="currentColor" stroke="none"/>',
  aviso:
    '<path d="M10.3 4.3a2 2 0 0 1 3.4 0l7.4 12.6a2 2 0 0 1-1.7 3H4.6a2 2 0 0 1-1.7-3z"/><path d="M12 9.5v4.5"/><circle cx="12" cy="17" r="1.1" fill="currentColor" stroke="none"/>',
  ayuda:
    '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.6a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.9v.4"/><circle cx="12" cy="17" r="1.1" fill="currentColor" stroke="none"/>',
  senal: '<path d="M5 19v-3M9.5 19v-6.5M14 19V9.5M18.5 19V5"/>',
  directo:
    '<circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/><path d="M7.4 7.4a6.5 6.5 0 0 0 0 9.2M16.6 7.4a6.5 6.5 0 0 1 0 9.2"/>',
  subir: '<path d="M12 19V5M6 11l6-6 6 6"/>',
} as const satisfies Record<string, string>;

export type IconName = keyof typeof ICONS;

export const ICON_NAMES = Object.keys(ICONS) as IconName[];
