/* Varios dispositivos a la vez (docs/multidispositivo.md §2 y §3): la
   pregunta al cambiar de canal, seguir al otro dispositivo y la cápsula de
   «qué se ve en el otro». Un solo sitio para los plazos que comparten el
   servidor (`viewerAwayMs`), la web y, después, la app nativa. */

const SECOND = 1000;
const MINUTE = 60 * SECOND;

export const MULTI_TIMINGS = {
  /** La cápsula sale si la sesión del otro dura esto (no parpadea en un traspaso o un salto de fuente). */
  capsuleShowMs: 1.5 * SECOND,
  /** Y se va si deja de verse durante esto. */
  capsuleHideMs: 1.5 * SECOND,
  /** «Cambiar en los dos» se recuerda este rato mientras sigan juntos los mismos dispositivos. */
  rememberBothMs: 5 * MINUTE,
  /** Sin SSE, plazo para refrescar `playbackStatus` antes de decidir. */
  freshStatusMs: 1.5 * SECOND,
  /** Toast y cápsula inmersiva del aviso de traspaso. */
  handoffNoticeMs: 8 * SECOND,
  /** El servidor marca `away` a un visor sin latido en este tiempo (el latido es cada 15 s). */
  viewerAwayMs: 20 * SECOND,
  /** Un visor en pausa más de esto deja de contar para la pregunta y la cápsula. */
  pausedStaleMs: 10 * MINUTE,
  /** Seguir encadenado (§2.4.3): como mucho estos saltos… */
  followHops: 3,
  /** …dentro de este rato desde el primer `follow`. */
  followWindowMs: 10 * SECOND,
} as const;
