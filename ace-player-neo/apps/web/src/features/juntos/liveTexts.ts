/* Textos de la sala en directo (directo §14). Van aparte de texts.ts para no
   chocar con los cambios de la sala en general. */

export const LIVE_TEXT = {
  sourcesFailed: 'No se han podido cargar las fuentes.',
  retry: 'Reintentar',
  searchMore: 'Buscar más fuentes',
  searching: 'Buscando las fuentes…',
  noSources: 'No hay fuentes buenas ahora mismo.',
  looseChannel: 'Suena un canal suelto: estas son sus fuentes.',
  checking: 'Comprobando las AceStream…',
  /** «2 conexiones · 1 con señal» */
  groupCount: (total: number, live: number) =>
    `${total} ${total === 1 ? 'conexión' : 'conexiones'} · ${live} con señal`,
  weakFold: (n: number) => `Ver ${n} ${n === 1 ? 'floja' : 'flojas'}`,
  restFold: (failed: number, checking: number) =>
    [failed ? `${failed} sin señal` : null, checking ? `${checking} comprobándose` : null]
      .filter(Boolean)
      .join(' · '),
  foreignFold: (n: number) => `${n} de otro país`,
  yourList: 'tu lista',
  peers: (n: number) => `${n} ${n === 1 ? 'par' : 'pares'}`,
  mbit: (value: string) => `${value} Mb/s`,
  iptv: 'IPTV',
  engine: 'AceStream',
  reclaim: 'Recuperar el mando',
  reclaimDone: 'Vuelves a ser el líder.',
  matchesLoading: 'Cargando partidos…',
  matchesFailed: 'No se ha podido cargar la agenda.',
} as const;
