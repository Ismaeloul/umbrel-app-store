import { useEffect, useRef, useState } from 'react'

import { api } from '../api/cliente'
import type { Cuenta } from '../api/tipos'
import { useDebounce } from '../lib/hooks'

type Estado = 'guardado' | 'escribiendo' | 'guardando' | 'error'

const RETRASO_MS = 700

const LEYENDA: Record<Estado, string> = {
  guardado: 'Guardado',
  escribiendo: 'Sin guardar',
  guardando: 'Guardando...',
  error: 'No se ha podido guardar',
}

export function PanelNotas({ cuenta }: { cuenta: Cuenta }) {
  const [texto, setTexto] = useState(cuenta.notas)
  const [estado, setEstado] = useState<Estado>('guardado')
  // Lo ultimo que confirmo el servidor, para no reenviar lo mismo.
  const confirmado = useRef(cuenta.notas)

  // Al cambiar de cuenta se recarga el texto; mientras se escribe, no, para
  // no pisar lo que el usuario esta tecleando.
  useEffect(() => {
    setTexto(cuenta.notas)
    confirmado.current = cuenta.notas
    setEstado('guardado')
  }, [cuenta.id])

  useDebounce(texto, RETRASO_MS, async (valor) => {
    if (valor === confirmado.current) return
    setEstado('guardando')
    try {
      await api.guardarNotas(cuenta.id, valor)
      confirmado.current = valor
      setEstado('guardado')
    } catch {
      // El texto se queda intacto en el textarea: no se pierde nada.
      setEstado('error')
    }
  })

  // Si quedan cambios sin confirmar, el navegador avisa antes de cerrar.
  useEffect(() => {
    if (estado === 'guardado') return
    const avisar = (evento: BeforeUnloadEvent) => evento.preventDefault()
    window.addEventListener('beforeunload', avisar)
    return () => window.removeEventListener('beforeunload', avisar)
  }, [estado])

  const color =
    estado === 'error'
      ? 'text-rojo'
      : estado === 'guardado'
        ? 'text-menta'
        : 'text-tenue'

  return (
    <section className="tarjeta p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-tenue">Notas</h2>
        <span className={`text-xs ${color}`} role="status" aria-live="polite">
          {LEYENDA[estado]}
        </span>
      </div>

      <textarea
        value={texto}
        onChange={(e) => {
          setTexto(e.target.value)
          setEstado('escribiendo')
        }}
        className="campo min-h-40 resize-y leading-relaxed"
        placeholder="Como se recarga esta cuenta, que contenido desbloquea, donde compras las tarjetas..."
        aria-label="Notas de la cuenta"
      />

      {estado === 'error' && (
        <button
          type="button"
          className="boton-secundario mt-3 w-full"
          onClick={async () => {
            setEstado('guardando')
            try {
              await api.guardarNotas(cuenta.id, texto)
              confirmado.current = texto
              setEstado('guardado')
            } catch {
              setEstado('error')
            }
          }}
        >
          Reintentar
        </button>
      )}
    </section>
  )
}
