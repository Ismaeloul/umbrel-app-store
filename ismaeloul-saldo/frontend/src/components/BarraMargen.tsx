// La barra de margen: se llena al aparecer para que el ojo lea de golpe
// cuanto queda, y cambia de color en los umbrales de 30 y 60 dias.

import { motion } from 'framer-motion'

import { DURACION } from '../lib/animacion'
import { usaMenosMovimiento } from '../lib/hooks'
import { PALETA, llenadoDeMargen, urgenciaDe } from '../lib/urgencia'

export function BarraMargen({
  diasRestantes,
  etiqueta,
  gruesa = false,
}: {
  diasRestantes: number | null
  etiqueta: string
  gruesa?: boolean
}) {
  const reducido = usaMenosMovimiento()
  const paleta = PALETA[urgenciaDe(diasRestantes)]
  const ancho = `${llenadoDeMargen(diasRestantes) * 100}%`

  return (
    <div
      className={`overflow-hidden rounded-full bg-elevada ${gruesa ? 'h-2' : 'h-1.5'}`}
      role="img"
      aria-label={etiqueta}
    >
      <motion.div
        className={`h-full rounded-full ${paleta.barra}`}
        initial={reducido ? false : { width: 0 }}
        animate={{ width: ancho }}
        transition={{ duration: DURACION.lenta, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  )
}
