// Animaciones de la app.
//
// Dos reglas: ninguna pasa de 300 ms, y ninguna es decorativa. Cada una
// explica algo — de donde sale una tarjeta, que numero ha cambiado, cuanto
// margen queda. Con prefers-reduced-motion todas se quedan en nada, porque
// MotionConfig va en modo "user" y los componentes consultan el hook.

import type { Transition, Variants } from 'framer-motion'

export const DURACION = {
  rapida: 0.16,
  normal: 0.22,
  lenta: 0.3,
} as const

export const SUAVE: Transition = {
  duration: DURACION.normal,
  ease: [0.22, 1, 0.36, 1],
}

/** Lista que va soltando sus hijos de uno en uno. */
export const listaEscalonada: Variants = {
  oculto: {},
  visible: {
    transition: { staggerChildren: 0.045, delayChildren: 0.02 },
  },
}

export const elementoDeLista: Variants = {
  oculto: { opacity: 0, y: 14 },
  visible: { opacity: 1, y: 0, transition: SUAVE },
}

/** Cambio de pantalla: la nueva entra desde abajo, muy poco. */
export const pagina: Variants = {
  oculto: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: SUAVE },
  salida: { opacity: 0, y: -6, transition: { duration: DURACION.rapida } },
}

/** Hoja inferior en el movil, tarjeta centrada en pantalla ancha. */
export const hoja: Variants = {
  oculto: { opacity: 0, y: 32, scale: 0.98 },
  visible: { opacity: 1, y: 0, scale: 1, transition: SUAVE },
  salida: { opacity: 0, y: 20, scale: 0.98, transition: { duration: DURACION.rapida } },
}

export const velo: Variants = {
  oculto: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: DURACION.rapida } },
  salida: { opacity: 0, transition: { duration: DURACION.rapida } },
}
