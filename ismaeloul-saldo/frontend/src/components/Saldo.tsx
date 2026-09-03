// El saldo: el elemento visual dominante de cada tarjeta.

import { partirImporte } from '../lib/dinero'

interface Props {
  minor: number
  divisa: string
  exponente: number
  tamano?: 'tarjeta' | 'gigante'
}

export function Saldo({ minor, divisa, exponente, tamano = 'tarjeta' }: Props) {
  const { entero, decimales } = partirImporte(minor, exponente)

  const tamanos = {
    tarjeta: {
      entero: 'text-4xl',
      decimales: 'text-xl',
      divisa: 'text-xl',
    },
    gigante: {
      entero: 'text-6xl sm:text-7xl',
      decimales: 'text-2xl sm:text-3xl',
      divisa: 'text-2xl sm:text-3xl',
    },
  }[tamano]

  return (
    <p className="cifras flex items-baseline gap-1 font-semibold tracking-tight">
      <span className={tamanos.entero}>{entero}</span>
      {decimales && (
        <span className={`${tamanos.decimales} text-tenue`}>,{decimales}</span>
      )}
      <span className={`${tamanos.divisa} ml-1 font-normal text-tenue`}>
        {divisa}
      </span>
    </p>
  )
}
