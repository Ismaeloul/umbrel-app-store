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
  /** El anfitrión al que se le ha ido la corona (no es co-líder). */
  hostNotLeader: (leader: string) => `Has creado la sala · ahora manda ${leader}`,
  /** El nombre accesible de «Poner» en Fuentes: qué fuente es. */
  putSource: (number: number, channel: string, origin: string, meta: string) =>
    `Poner la ${number}: ${channel}, ${origin}${meta ? `, ${meta}` : ''}`,
  /** El de «Poner» en Partidos y en los canales favoritos. */
  putWhat: (what: string) => `Poner ${what}`,
  reclaim: 'Recuperar el mando',
  reclaimDone: 'Vuelves a ser el líder.',
  matchesLoading: 'Cargando partidos…',
  /** Fuentes o Partidos mientras se baja su código (se cargan al abrirlos). */
  panelLoading: 'Cargando…',
  matchesFailed: 'No se ha podido cargar la agenda.',
} as const;
