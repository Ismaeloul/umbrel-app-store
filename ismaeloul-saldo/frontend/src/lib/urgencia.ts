// Cuanto aprieta una cuenta, en un solo dato.
//
// Rojo si quedan 30 dias o menos, ambar si 60 o menos, verde por encima.

export type Urgencia = 'critica' | 'aviso' | 'holgada' | 'tranquila'

export const DIAS_CRITICOS = 30
export const DIAS_AVISO = 60

export function urgenciaDe(diasRestantes: number | null): Urgencia {
  if (diasRestantes === null) return 'tranquila'
  if (diasRestantes <= DIAS_CRITICOS) return 'critica'
  if (diasRestantes <= DIAS_AVISO) return 'aviso'
  return 'holgada'
}

interface Paleta {
  texto: string
  fondo: string
  borde: string
  barra: string
  punto: string
}

export const PALETA: Record<Urgencia, Paleta> = {
  critica: {
    texto: 'text-rojo',
    fondo: 'bg-rojo/10',
    borde: 'border-rojo/30',
    barra: 'bg-rojo',
    punto: 'bg-rojo',
  },
  aviso: {
    texto: 'text-ambar',
    fondo: 'bg-ambar/10',
    borde: 'border-ambar/30',
    barra: 'bg-ambar',
    punto: 'bg-ambar',
  },
  holgada: {
    texto: 'text-menta',
    fondo: 'bg-menta/10',
    borde: 'border-menta/30',
    barra: 'bg-menta',
    punto: 'bg-menta',
  },
  tranquila: {
    texto: 'text-tenue',
    fondo: 'bg-elevada',
    borde: 'border-borde',
    barra: 'bg-apagado',
    punto: 'bg-apagado',
  },
}

/**
 * Cuanto se llena la barra de margen.
 *
 * Se mide contra un ano de horizonte: por encima de eso la cuenta esta tan
 * holgada que la diferencia ya no dice nada.
 */
export function llenadoDeMargen(diasRestantes: number | null): number {
  if (diasRestantes === null) return 1
  return Math.max(0.02, Math.min(1, diasRestantes / 365))
}
