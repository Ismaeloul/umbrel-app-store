/* Umbrales del reproductor web. Son los de la 0.6.59 (reproductor.md §2.3 y
   §4, inventario §24), con nombre, en un solo sitio. Los que son solo del
   navegador viven aquí; los que comparte la app iOS (perfiles, política de
   reconexión, recuperación de hls.js) salen de @ace/shared. */

/** Vigilante: un «tic» cada 1,5 s (index.html:5231). */
export const WATCHDOG_TICK_MS = 1500;

/**
 * Conectando sin imagen: tics hasta reconectar. 20 tics (30 s) por defecto;
 * 40 (60 s) si el motor ya baja a más de 50 KB/s; 36 (54 s) con HLS nativo
 * (el remux del iPhone), index.html:5233-5244.
 */
export const CONNECT_LIMIT_TICKS = { normal: 20, downloading: 40, native: 36 } as const;
export const DOWNLOADING_KBPS = 50;

/** Imagen parada: 3 tics (4,5 s) → rebuffer (no con HLS nativo). */
export const FROZEN_REBUFFER_TICKS = 3;
/** HLS nativo parado 4 tics (6 s) y 6 s o más por detrás → empujón al directo. */
export const FROZEN_LIVE_PUSH_TICKS = 4;
export const LIVE_PUSH_MIN_BEHIND_S = 6;
/** Parado 20 tics (30 s), o 16 (24 s) con HLS nativo → reconexión. */
export const FROZEN_RECONNECT_TICKS = { normal: 20, native: 16 } as const;
/** Gracia tras reconectar: 4 tics (6 s) sin contar la imagen parada. */
export const GRACE_TICKS = 4;
/** Lo que tiene que avanzar el cabezal para contar como «avanza». */
export const ADVANCE_EPSILON_S = 0.2;

/** Colchón: se mira cada 250 ms (index.html:4390). */
export const BUFFER_CHECK_MS = 250;
/** Pasados 20 s basta con 1,5 s (arranque) o 2 s (rebuffer). */
export const BUFFER_FALLBACK_AFTER_MS = 20_000;
export const BUFFER_FALLBACK_S = { initial: 1.5, rebuild: 2 } as const;
/** Tope del colchón inicial: 55 s con mpegts.js y 50 s con hls.js. */
export const INITIAL_MAX_WAIT_MS = { mpegts: 55_000, hls: 50_000 } as const;
/** Tope del rebuffer antes de reconectar. */
export const REBUFFER_MAX_WAIT_MS = 45_000;
/** «Señal irregular…» sale como mucho una vez por canal cada 60 s. */
export const REBUFFER_NOTICE_MS = 60_000;

/** «Ya en directo» para decidir si el botón salta (player-controller.js:398). */
export const LIVE_TOLERANCE_S = 1.25;
/**
 * Para PINTAR «en directo» se deja algo más de margen: el colchón oscila un
 * par de segundos con la red y el botón no debe parpadear entre «Directo» e
 * «Ir al directo · −2 s» cada medio segundo. Saltar sigue usando 1,25 s.
 */
export const LIVE_DISPLAY_S = 3;

/**
 * Presupuesto de reconexiones (P4): se cuentan las de los últimos 3 minutos.
 * En la 0.6.59 el contador volvía a 0 con cualquier avance de 0,2 s, así que
 * una señal que daba un segundo de imagen entre cortes reconectaba sin fin y
 * nunca pasaba a otra fuente.
 */
export const RECONNECT_WINDOW_MS = 180_000;

/** Aviso «sigue» al backend cada 2 min como poco (index.html:4466-4472). */
export const OUTCOME_KEEPALIVE_MS = 120_000;

/** Repintado de directo y colchón mientras suena (index.html:6042-6044). */
export const METER_MS = 500;

/** Controles: se esconden a los 3,2 s sin mover el ratón (solo si suena de verdad). */
export const CONTROLS_HIDE_MS = 3200;
/** Clic simple frente a doble clic en el vídeo. */
export const CLICK_DELAY_MS = 190;

/** Retroceso de la tecla J y del botón −30. */
export const BACK_SECONDS = 30;
/** Plazo de los saltos (directo y −30) a que llegue `seeked`. */
export const SEEK_TIMEOUT_MS = 2200;

/** Demo: la «señal» aparece a los 1,8 s y las estadísticas cambian cada 1,5 s. */
export const DEMO_SIGNAL_MS = 1800;
export const DEMO_STATS_MS = 1500;
