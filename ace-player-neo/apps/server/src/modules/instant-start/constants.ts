/* Plazos de «Arranque instantáneo» (D24). Todos son relativos al saque del
   partido de un equipo favorito. */

const SECOND = 1000;
const MINUTE = 60 * SECOND;

/** A T-10 min se resuelve otra vez el partido (IPTV primero): lista fresca al pulsar «Ver». */
export const INSTANT_START_REFRESH_LEAD_MS = 10 * MINUTE;
/** A T-3 min se abre la mejor fuente sin visor (si la casa está libre). */
export const INSTANT_START_PREWARM_LEAD_MS = 3 * MINUTE;
/** Pasado el saque, se sigue intentando preparar (casa ocupada, plaza IPTV recién soltada…) hasta aquí. */
export const INSTANT_START_LATE_START_MS = 5 * MINUTE;
/** Si nadie pulsa «Ver», la preparación se suelta a los 10 min del saque. */
export const INSTANT_START_RELEASE_AFTER_MS = 10 * MINUTE;
/** Cada cuánto se mira la agenda (la preparación tarda como mucho esto en soltarse o empezar). */
export const INSTANT_START_TICK_MS = 30 * SECOND;
/** Primera vuelta tras arrancar (la agenda y el precalentado van antes). */
export const INSTANT_START_FIRST_RUN_MS = 20 * SECOND;
/** Fallos al preparar un mismo partido antes de dejarlo estar. */
export const INSTANT_START_MAX_FAILURES = 2;
/** Lo que se recuerda de cada partido se olvida pasado este rato desde el saque. */
export const INSTANT_START_MEMORY_MS = 3 * 60 * MINUTE;
