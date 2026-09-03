// Piezas de interfaz compartidas.

import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode } from 'react'
import { useEffect, useId, useRef } from 'react'

import { hoja, velo } from '../lib/animacion'

export function Etiqueta({
  children,
  tono = 'neutro',
}: {
  children: ReactNode
  tono?: 'neutro' | 'menta' | 'ambar' | 'rojo'
}) {
  const tonos = {
    neutro: 'bg-elevada text-tenue',
    menta: 'bg-menta/10 text-menta',
    ambar: 'bg-ambar/10 text-ambar',
    rojo: 'bg-rojo/10 text-rojo',
  } as const
  return <span className={`etiqueta ${tonos[tono]}`}>{children}</span>
}

export function Campo({
  etiqueta,
  error,
  ayuda,
  children,
}: {
  etiqueta: string
  error?: string
  ayuda?: string
  children: (props: { id: string; 'aria-invalid': boolean }) => ReactNode
}) {
  const id = useId()
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium text-tenue">
        {etiqueta}
      </label>
      {children({ id, 'aria-invalid': Boolean(error) })}
      {ayuda && !error && <p className="text-xs text-apagado">{ayuda}</p>}
      {/* El error va pegado al campo y no borra lo que hay escrito. */}
      {error && (
        <p role="alert" className="text-xs text-rojo">
          {error}
        </p>
      )}
    </div>
  )
}

export function Dialogo({
  titulo,
  abierto,
  onCerrar,
  children,
}: {
  titulo: string
  abierto: boolean
  onCerrar: () => void
  children: ReactNode
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!abierto) return
    const alPulsar = (evento: KeyboardEvent) => {
      if (evento.key === 'Escape') onCerrar()
    }
    document.addEventListener('keydown', alPulsar)
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
    return () => {
      document.removeEventListener('keydown', alPulsar)
      document.body.style.overflow = ''
    }
  }, [abierto, onCerrar])

  return (
    <AnimatePresence>
      {abierto && (
        <motion.div
          key="velo"
          variants={velo}
          initial="oculto"
          animate="visible"
          exit="salida"
          // Sube desde abajo en el movil, donde se llega con el pulgar; en
          // pantalla ancha aparece centrado.
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/70
                     backdrop-blur-sm sm:items-center sm:p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onCerrar()
          }}
        >
          <motion.div
            ref={panel}
            variants={hoja}
            role="dialog"
            aria-modal="true"
            aria-label={titulo}
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-3xl
                       border border-borde bg-superficie p-5 sm:rounded-3xl"
            style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
          >
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold tracking-tight">{titulo}</h2>
              <button
                type="button"
                onClick={onCerrar}
                className="boton-fantasma -mr-2 px-2 py-1"
                aria-label="Cerrar"
              >
                Cerrar
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Esqueleto({ className = '' }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={`animate-brillo rounded-lg bg-[linear-gradient(90deg,#1B2027_25%,#252C35_50%,#1B2027_75%)]
                  bg-[length:200%_100%] ${className}`}
    />
  )
}

export function Aviso({
  tono,
  titulo,
  children,
}: {
  tono: 'menta' | 'ambar' | 'rojo'
  titulo: string
  children?: ReactNode
}) {
  const tonos = {
    menta: 'border-menta/30 bg-menta/5',
    ambar: 'border-ambar/30 bg-ambar/5',
    rojo: 'border-rojo/40 bg-rojo/5',
  } as const
  const textos = {
    menta: 'text-menta',
    ambar: 'text-ambar',
    rojo: 'text-rojo',
  } as const
  return (
    <div className={`rounded-tarjeta border p-4 ${tonos[tono]}`}>
      <p className={`text-sm font-semibold ${textos[tono]}`}>{titulo}</p>
      {children && <div className="mt-1 text-sm text-tenue">{children}</div>}
    </div>
  )
}

export function Vacio({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="tarjeta p-8 text-center">
      <p className="font-medium text-texto">{titulo}</p>
      {children && <div className="mt-2 text-sm text-tenue">{children}</div>}
    </div>
  )
}
