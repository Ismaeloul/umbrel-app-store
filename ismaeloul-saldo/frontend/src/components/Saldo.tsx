// El saldo: el elemento visual dominante de cada tarjeta.
//
// Al cambiar (una recarga, un cobro, una reconciliacion) el numero recorre la
// distancia en vez de saltar, para que se vea CUANTO ha cambiado. Al montar
// no se anima: nadie quiere ver su saldo contando desde cero cada vez que
// abre la app.

import { animate, useMotionValue } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

import { DURACION } from '../lib/animacion'
import { partirImporte } from '../lib/dinero'
import { usaMenosMovimiento } from '../lib/hooks'

function useImporteAnimado(destino: number, animar: boolean): number {
  const valor = useMotionValue(destino)
  const [mostrado, setMostrado] = useState(destino)
  const anterior = useRef(destino)

  useEffect(() => {
    if (anterior.current === destino) return
    if (!animar) {
      anterior.current = destino
      setMostrado(destino)
      return
    }
    const control = animate(valor, destino, {
      duration: DURACION.lenta,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setMostrado(Math.round(v)),
      onComplete: () => setMostrado(destino),
    })
    anterior.current = destino
    return () => control.stop()
  }, [destino, animar, valor])

  return mostrado
}

interface Props {
  minor: number
  divisa: string
  exponente: number
  tamano?: 'tarjeta' | 'gigante'
}

const TAMANOS = {
  tarjeta: {
    entero: 'text-[2.5rem] leading-none',
    decimales: 'text-xl',
    divisa: 'text-base',
  },
  gigante: {
    entero: 'text-6xl leading-none sm:text-7xl',
    decimales: 'text-2xl sm:text-3xl',
    divisa: 'text-xl sm:text-2xl',
  },
} as const

export function Saldo({ minor, divisa, exponente, tamano = 'tarjeta' }: Props) {
  const reducido = usaMenosMovimiento()
  const animado = useImporteAnimado(minor, !reducido)
  const { entero, decimales } = partirImporte(animado, exponente)
  const escala = TAMANOS[tamano]

  return (
    <p
      className="cifras flex items-baseline gap-1 font-semibold tracking-tight"
      aria-label={`Saldo: ${entero}${decimales ? `,${decimales}` : ''} ${divisa}`}
    >
      <span className={escala.entero}>{entero}</span>
      {decimales && (
        <span className={`${escala.decimales} text-tenue`}>,{decimales}</span>
      )}
      <span className={`${escala.divisa} ml-1.5 font-medium text-apagado`}>
        {divisa}
      </span>
    </p>
  )
}
