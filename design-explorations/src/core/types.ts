/* Tipos del prototipo. Siguen la forma de los contratos reales de `@ace/shared`
   (docs/fuentes/api-contratos.md) para que los datos falsos tengan la misma
   anatomía que los de verdad. Donde el prototipo necesita algo que la API no
   da (goles, colores de club), se marca con «Solo prototipo». */

export type Hash = string; // 40 hex

// ---------------------------------------------------------------- Fútbol

export interface Team {
  id: string;
  name: string;
  short: string; // 3 letras, «RMA»
  /** Colores del club (Solo prototipo: en la app real llegan de ESPN). */
  primary: string;
  secondary: string;
  /** Forma del escudo generado. */
  crest: 'shield' | 'round' | 'hex' | 'square';
}

export interface Competition {
  id: string;
  name: string;
  country: string;
  /** Orden de prioridad en la agenda (menor = antes). */
  rank: number;
  short: string;
}

export interface FootballChannelRef {
  id: string;
  name: string;
}

/** `FootballMatch` real + lo que el prototipo necesita para simular. */
export interface Match {
  id: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  start: number; // epoch ms
  title: string;
  home: string; // Team.id
  away: string; // Team.id
  competition: string; // Competition.id
  country: string;
  channels: FootballChannelRef[];
  round?: string; // «Jornada 6», «Fase liga · J2» (Solo prototipo)
  venue?: string; // Solo prototipo
  /** Goles previstos: el reloj simulado los va «metiendo». Solo prototipo. */
  goals: GoalEvent[];
  /** Resultado final para partidos ya terminados. */
  finalScore?: [number, number];
}

export interface GoalEvent {
  minute: number; // minuto de partido
  side: 'home' | 'away';
  scorer: string;
  kind?: 'pen' | 'og';
}

export type MatchState = 'pre' | 'in' | 'post';

/** Marcador calculado en un instante (equivale a `LiveScore` + minuto). */
export interface LiveScore {
  home: number;
  away: number;
  state: MatchState;
  /** Minuto «54'» o «45+2'». Vacío si no ha empezado. */
  clock: string;
  minute: number;
  /** «1ª parte», «Descanso», «2ª parte», «Final», «Empieza en 24 min». */
  detail: string;
  half: 0 | 1 | 2 | 3; // 0 pre, 1 primera, 2 segunda, 3 final ; descanso = 1 con detail
  halftime: boolean;
  /** 0..1 progreso del partido, para anillos y barras. */
  progress: number;
  /** ms hasta el saque (negativo si ya empezó). */
  untilKickoffMs: number;
  goals: GoalEvent[]; // los que ya han entrado
}

// ---------------------------------------------------------------- Fuentes

export type SourceState = 'queued' | 'checking' | 'working' | 'weak' | 'failed';
export type SourceOrigin = 'saved' | 'm3u' | 'favorites' | 'history' | 'acestream' | 'manual';

export interface Source {
  id: Hash;
  title: string; // «M+ LaLiga FHD»
  /** Lista de la que sale (Solo prototipo: nombre legible; en la API es `listaId`). */
  listaId: string | null;
  listaName: string | null;
  origin: SourceOrigin;
  matchedChannel: string;
  ih: boolean;
  score: number; // 0..100 parecido con el canal
  /** Lo que dice el comprobador. */
  state: SourceState;
  reason: string;
  peers: number;
  speedDown: number; // KB/s
  streamKbps: number;
  videoCodec: string;
  audioCodecs: string[];
  resolution: string; // «1080p» «720p» «576i» (Solo prototipo, derivado de kbps)
  attempts: number;
  retryAt: number | null;
  checkedAt: number | null;
  availability: number | null;
  learned: 'correct' | 'incorrect' | null;
  quarantined: boolean;
  playableOn: { web: boolean; ios: boolean };
  /** Resultado previsto de la comprobación (Solo prototipo, oculto). */
  fate: 'working' | 'weak' | 'failed';
  /** Segundos que tarda el comprobador en dar veredicto (Solo prototipo). */
  probeS: number;
}

// ---------------------------------------------------------------- Biblioteca

export type ItemType = 'fav' | 'recent' | 'web';

export interface Item {
  id: Hash;
  title: string;
  alias?: string;
  type: ItemType;
  category: string;
  date: string; // ISO
  fromWebSync: boolean;
  ih: boolean;
  /** Directorio de origen (Solo prototipo). */
  listaId?: string;
}

export interface Directory {
  id: string;
  name: string;
  url: string;
  type: 'm3u' | 'html';
  count: number;
  syncedAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  /** Estado de actualización simulado. */
  syncing?: boolean;
  syncProgress?: number; // 0..1
}

// ---------------------------------------------------------------- Dispositivos y sesiones

export interface Device {
  id: string;
  name: string;
  platform: 'ios' | 'ipados' | 'macos' | 'other';
  createdAt: string;
  lastSeenAt: string | null;
  revokedAt: string | null;
}

export interface SessionViewer {
  client: 'web' | 'ios' | 'legacy';
  deviceId: string | null;
  deviceName: string;
  platform: 'web' | 'ios' | 'legacy';
  playing: boolean | null;
  lastBeatAt: string;
  viewerId: string;
}

export interface SessionSummary {
  id: string;
  hash: Hash;
  mode: 'progressive' | 'hls';
  openedAt: string;
  viewers: SessionViewer[];
  title: string;
  protocol: 'mpegts' | 'hls' | 'hls-fmp4';
}

// ---------------------------------------------------------------- Sistema

export type EngineStatus = 'online' | 'offline' | 'restarting' | 'unknown';

export interface DiagnosticEntry {
  id: string;
  at: string;
  cause: 'engine' | 'source' | 'network' | 'codec' | 'client' | 'state';
  code: string;
  message: string;
  channel?: string;
}

export interface Preferences {
  onboardingComplete: boolean;
  country: string;
  leagues: string[];
  teams: string[];
  nationalities: string[];
}

export type PlaybackMode = 'stable' | 'balanced' | 'low';
export type Theme = 'sistema' | 'claro' | 'oscuro';

// ---------------------------------------------------------------- Reproductor

/** Estados de conexión: los mismos que `apps/web/src/player/machine.ts`. */
export type ConnState =
  | 'idle'
  | 'pidiendo'
  | 'conectando'
  | 'precarga'
  | 'arrancando'
  | 'activa'
  | 'reconectando'
  | 'error';

export type MediaPhase = 'playing' | 'paused' | 'buffering' | 'seeking' | 'blocked';

export type PlayerPhase =
  | 'idle'
  | 'cargando'
  | 'buffer'
  | 'reproduciendo'
  | 'pausado'
  | 'bloqueado'
  | 'buscando'
  | 'reconectando'
  | 'error';

export interface PlayerTarget {
  kind: 'match' | 'channel';
  /** Match.id o Item.id */
  id: string;
  title: string;
  subtitle: string;
  /** Fuente en pantalla. */
  sourceId: Hash | null;
}

export interface PlayerState {
  conn: ConnState;
  media: MediaPhase;
  target: PlayerTarget | null;
  /** Segundos por detrás del directo. */
  behindS: number;
  /** Colchón disponible para retroceder (segundos). */
  bufferS: number;
  /** Intentos de reconexión hechos. */
  reconnects: number;
  /** Mensaje de error si `conn === 'error'`. */
  errorCode: string | null;
  /** Volumen 0..1 y silencio. */
  volume: number;
  muted: boolean;
  /** Grande (expandido) o mini. */
  expanded: boolean;
  /** Pantalla completa / inmersivo. */
  fullscreen: boolean;
  /** Estadísticas del motor (stream.stats). */
  stats: { peers: number; speedDown: number; speedUp: number; status: string };
  /** Tiempo hasta el primer fotograma en la última conexión. */
  ttffMs: number | null;
  /** Otro dispositivo se ha quedado el mando (playback.handoff). */
  handoff: { byDevice: string; title: string } | null;
  /** Quién más está viendo la misma sesión. */
  sharedWith: string[];
  /** Fuente anterior si hubo cambio automático (para el aviso). */
  autoSwitchedFrom: string | null;
  startedAt: number | null;
}
