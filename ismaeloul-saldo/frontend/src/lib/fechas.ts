// Fechas en es-ES.
//
// Las fechas llegan como "YYYY-MM-DD" y son fechas de calendario, no
// instantes: se construyen a mano para que el navegador no las interprete
// como UTC y las desplace un dia.

function aFecha(iso: string): Date {
  const [anio, mes, dia] = iso.split('-').map(Number)
  return new Date(anio, mes - 1, dia)
}

const corta = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})

const larga = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
})

const conDia = new Intl.DateTimeFormat('es-ES', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
})

export function formatearFecha(iso: string): string {
  return corta.format(aFecha(iso)).replace('.', '')
}

export function formatearFechaLarga(iso: string): string {
  return larga.format(aFecha(iso))
}

export function formatearFechaConDia(iso: string): string {
  return conDia.format(aFecha(iso))
}

export function diasEntre(desdeIso: string, hastaIso: string): number {
  const unDia = 24 * 60 * 60 * 1000
  return Math.round((aFecha(hastaIso).getTime() - aFecha(desdeIso).getTime()) / unDia)
}

export function hoyIso(): string {
  const ahora = new Date()
  const mes = String(ahora.getMonth() + 1).padStart(2, '0')
  const dia = String(ahora.getDate()).padStart(2, '0')
  return `${ahora.getFullYear()}-${mes}-${dia}`
}

/** "en 12 dias", "manana", "hoy", "hace 3 dias". */
export function cuandoCae(desdeIso: string, hastaIso: string): string {
  const dias = diasEntre(desdeIso, hastaIso)
  if (dias === 0) return 'hoy'
  if (dias === 1) return 'manana'
  if (dias === -1) return 'ayer'
  return dias > 0 ? `en ${dias} dias` : `hace ${Math.abs(dias)} dias`
}
