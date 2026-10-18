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
  /** Con más desfase que esto, el reproductor salta a la posición de la sala. */
  driftSeekS: 1.0,
  /** Por encima de esto (y por debajo del salto) se corrige acelerando o frenando un poco. */
  driftRateS: 0.25,
  /** Velocidad para alcanzar o esperar a la sala sin saltar. */
  driftRate: 0.05,
  /** Latido SSE de la sala (comentario `: ping`). */
  heartbeatMs: 15_000,
} as const;
