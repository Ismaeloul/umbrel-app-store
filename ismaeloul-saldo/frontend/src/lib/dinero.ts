// Formateo de importes.
//
// Se trabaja SIEMPRE sobre el entero de la unidad menor: la parte entera y la
// decimal se separan cortando la cadena de digitos, nunca dividiendo entre
// una potencia de diez. Intl se usa solo para agrupar los miles y para saber
// que simbolo pone el es-ES a cada divisa y en que lado.

interface Simbolo {
  texto: string
  sufijo: boolean
}

const cacheSimbolos = new Map<string, Simbolo>()

function simboloDe(divisa: string): Simbolo {
  const guardado = cacheSimbolos.get(divisa)
  if (guardado) return guardado

  let simbolo: Simbolo = { texto: divisa, sufijo: true }
  try {
    const partes = new Intl.NumberFormat('es-ES', {
      style: 'currency',
      currency: divisa,
    }).formatToParts(1)
    const indice = partes.findIndex((p) => p.type === 'currency')
    if (indice >= 0) {
      simbolo = { texto: partes[indice].value, sufijo: indice > 0 }
    }
  } catch {
    // Divisa que Intl no conoce: se queda el codigo ISO detras del numero.
  }
  cacheSimbolos.set(divisa, simbolo)
  return simbolo
}

const agrupador = new Intl.NumberFormat('es-ES')

/** Divide el entero de unidad menor en (signo, parte entera, decimales). */
function partir(minor: number, exponente: number) {
  const negativo = minor < 0
  const digitos = Math.abs(Math.trunc(minor))
    .toString()
    .padStart(exponente + 1, '0')
  return {
    negativo,
    entero: exponente > 0 ? digitos.slice(0, -exponente) : digitos,
    decimales: exponente > 0 ? digitos.slice(-exponente) : '',
  }
}

export interface OpcionesImporte {
  conSimbolo?: boolean
  /** Fuerza el signo delante incluso cuando el importe es positivo. */
  conSigno?: boolean
}

export function formatearImporte(
  minor: number,
  divisa: string,
  exponente: number,
  opciones: OpcionesImporte = {},
): string {
  const { conSimbolo = true, conSigno = false } = opciones
  const { negativo, entero, decimales } = partir(minor, exponente)

  const agrupado = agrupador.format(BigInt(entero))
  const cuerpo = decimales ? `${agrupado},${decimales}` : agrupado
  const signo = negativo ? '-' : conSigno && minor > 0 ? '+' : ''
  if (!conSimbolo) return `${signo}${cuerpo}`

  const { texto, sufijo } = simboloDe(divisa)
  return sufijo ? `${signo}${cuerpo} ${texto}` : `${signo}${texto}${cuerpo}`
}

/** Las dos mitades del saldo, para poder pintarlas a tamanos distintos. */
export function partirImporte(minor: number, exponente: number) {
  const { negativo, entero, decimales } = partir(minor, exponente)
  return {
    entero: `${negativo ? '-' : ''}${agrupador.format(BigInt(entero))}`,
    decimales,
  }
}
