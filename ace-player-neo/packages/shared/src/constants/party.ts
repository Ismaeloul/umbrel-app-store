/* «Ver juntos» (docs/ver-juntos.md, D36): límites y tiempos de las salas.
   Los usan el servidor (topes y caducidades) y la web (la sincronización),
   así que viven aquí y no en cada lado. */

export const PARTY = {
  /** Caracteres del código de una sala (base64url de 12 bytes: 96 bits). */
  codeLength: 16,
  /** Salas abiertas a la vez en todo el servidor. */
  maxRooms: 4,
  /** Personas en una sala. */
  maxMembers: 8,
  /** Largo de un nombre visible. */
  nameMaxChars: 24,
  /** Largo de un mensaje del chat. */
  chatMaxChars: 500,
  /** Mensajes que guarda la sala (los que ve quien entra tarde). */
  chatHistory: 100,
  /** Mensajes por persona y minuto. */
  chatPerMinute: 30,
  /** Cada cuánto manda cada uno su posición y si está cargando. */
  statusIntervalMs: 5_000,
  /** Sin estado ni conexión en este tiempo, la persona se da por ida. */
  memberTimeoutMs: 30_000,
  /** Una sala vacía se cierra pasado este tiempo. */
  emptyRoomTtlMs: 10 * 60_000,
  /** Una sala se cierra sola a las 12 horas. */
  maxRoomAgeMs: 12 * 60 * 60_000,
  /** Lo que la sala espera a alguien que carga antes de seguir sin él. */
  holdMaxMs: 20_000,
  /** Un aviso de «cargando» tiene que durar esto antes de parar a los demás. */
  bufferingGraceMs: 800,
  /**
   * La sala sigue cuando quien cargaba lleva esto diciendo «ya no cargo» (§16).
   * Antes seguía con el primer aviso y, en el iPhone, se paraba otra vez enseguida.
   */
  resumeSettleMs: 700,
  /**
   * Al esperar a alguien, la sala se para donde se atascó él si va hasta esto por detrás (§16):
   * los demás retroceden un poco en pausa. Más atrasado, la sala se para donde va y él se pone al día.
   */
  holdRewindMaxS: 8,
  /** Con dos esperas o más en este tiempo por la misma persona, su margen sube a `repeatBufferingGraceMs`. */
  repeatHoldWindowMs: 60_000,
  /** El margen de quien se atasca a menudo: sus atascos cortos no paran la sala. */
  repeatBufferingGraceMs: 2_500,
  /** Con más desfase que esto, el reproductor salta a la posición de la sala. */
  driftSeekS: 1.0,
  /** Por encima de esto (y por debajo del salto) se corrige acelerando o frenando un poco. */
  driftRateS: 0.25,
  /** Velocidad para alcanzar o esperar a la sala sin saltar. */
  driftRate: 0.05,
  /**
   * Latido SSE de la sala: el comentario `: ping` y, a quien lo pide (`ping=1`), `party.ping`.
   * Cada 10 s: el cliente da el SSE por muerto si pasa más del doble sin ninguna trama.
   */
  heartbeatMs: 10_000,
  /** Títulos en la lista de la sala (§11). */
  queueMax: 30,
  /** Al acabar, lo siguiente empieza tras esta cuenta atrás (el líder la puede cancelar). */
  upNextMs: 10_000,
  /** Entre dos avisos de «está escribiendo» de la misma persona (los de en medio no salen). */
  typingIntervalMs: 2_000,
  /** Lo que se ve «Ana está escribiendo…» tras su último aviso. */
  typingShowMs: 4_000,
  /** En «Esperando a todos» (§13), segundos de vídeo por delante que cuentan como «listo» (el 100 %). */
  lobbyBufferS: 8,
} as const;
