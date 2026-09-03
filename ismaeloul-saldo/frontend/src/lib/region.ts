// La bandera de un codigo de pais ISO, sin descargar ningun icono.
//
// Se compone con los indicadores regionales de Unicode. En los sistemas que
// no dibujan banderas (Windows) salen las dos letras en cajita, que se lee
// igual de bien.

const PRIMERA_LETRA = 0x1f1e6
const A = 'A'.charCodeAt(0)

export function banderaDe(region: string): string {
  const codigo = (region ?? '').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(codigo)) return codigo
  return String.fromCodePoint(
    ...[...codigo].map((letra) => PRIMERA_LETRA + letra.charCodeAt(0) - A),
  )
}
