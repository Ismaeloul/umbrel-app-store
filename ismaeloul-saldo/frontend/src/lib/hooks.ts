import { useCallback, useEffect, useRef, useState } from 'react'

/** Carga un recurso de la API y lo vuelve a pedir cuando se lo dices. */
export function useRecurso<T>(cargar: () => Promise<T>, deps: unknown[] = []) {
  const [datos, setDatos] = useState<T | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  // La funcion suele venir en linea; la guardamos para no recargar en cada
  // render solo porque cambie su identidad.
  const cargarRef = useRef(cargar)
  cargarRef.current = cargar

  useEffect(() => {
    let vivo = true
    setCargando(true)
    cargarRef
      .current()
      .then((resultado) => {
        if (!vivo) return
        setDatos(resultado)
        setError(null)
      })
      .catch((fallo: Error) => {
        if (vivo) setError(fallo.message)
      })
      .finally(() => {
        if (vivo) setCargando(false)
      })
    return () => {
      vivo = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, version])

  const recargar = useCallback(() => setVersion((v) => v + 1), [])

  return { datos, cargando, error, recargar }
}

/** Llama a `accion` cuando pasan `espera` ms sin que cambie el valor. */
export function useDebounce<T>(
  valor: T,
  espera: number,
  accion: (valor: T) => void,
  activo = true,
) {
  const accionRef = useRef(accion)
  accionRef.current = accion

  useEffect(() => {
    if (!activo) return
    const temporizador = window.setTimeout(() => accionRef.current(valor), espera)
    return () => window.clearTimeout(temporizador)
  }, [valor, espera, activo])
}

/** true si el sistema pide menos movimiento. */
export function usaMenosMovimiento(): boolean {
  const [reducido, setReducido] = useState(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  useEffect(() => {
    const consulta = window.matchMedia('(prefers-reduced-motion: reduce)')
    const alCambiar = () => setReducido(consulta.matches)
    consulta.addEventListener('change', alCambiar)
    return () => consulta.removeEventListener('change', alCambiar)
  }, [])

  return reducido
}
