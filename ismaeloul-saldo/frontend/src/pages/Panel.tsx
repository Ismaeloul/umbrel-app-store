import { motion } from 'framer-motion'
import { useState } from 'react'

import { api } from '../api/cliente'
import type { CuentaResumen } from '../api/tipos'
import { TarjetaCuenta } from '../components/TarjetaCuenta'
import { FormularioCuenta } from '../components/formularios'
import { Dialogo, Esqueleto, Vacio } from '../components/ui'
import { listaEscalonada, pagina } from '../lib/animacion'
import { useRecurso } from '../lib/hooks'

function EsqueletoTarjeta() {
  return (
    <div className="tarjeta space-y-5 p-5">
      <div className="space-y-2">
        <Esqueleto className="h-3.5 w-44" />
        <Esqueleto className="h-3 w-28" />
      </div>
      <Esqueleto className="h-10 w-52" />
      <Esqueleto className="h-1.5 w-full" />
      <div className="grid grid-cols-2 gap-3">
        <Esqueleto className="h-8" />
        <Esqueleto className="h-8" />
      </div>
    </div>
  )
}

export function Panel() {
  const [nueva, setNueva] = useState(false)
  const { datos, cargando, error, recargar } = useRecurso<CuentaResumen[]>(
    () => api.listarCuentas(),
    [],
  )

  return (
    <motion.div
      variants={pagina}
      initial="oculto"
      animate="visible"
      exit="salida"
      className="mx-auto max-w-2xl px-4 pb-28 pt-8"
    >
      <header className="mb-7">
        <h1 className="text-[1.75rem] font-semibold leading-none tracking-tight">
          Saldo
        </h1>
        <p className="mt-1.5 text-sm text-tenue">
          Cuanto te dura el prepago de cada cuenta
        </p>
      </header>

      {error && (
        <div className="mb-4 rounded-tarjeta border border-rojo/40 bg-rojo/5 p-4">
          <p className="text-sm text-rojo">{error}</p>
          <button type="button" className="boton-secundario mt-3" onClick={recargar}>
            Reintentar
          </button>
        </div>
      )}

      {cargando && !datos && (
        <div className="space-y-4">
          <EsqueletoTarjeta />
          <EsqueletoTarjeta />
        </div>
      )}

      {datos && datos.length === 0 && (
        <Vacio titulo="Todavia no hay ninguna cuenta">
          Crea la primera con su divisa y su saldo, y anade lo que tengas
          suscrito. La app te dira cuando recargar antes de que falle un cobro.
        </Vacio>
      )}

      {datos && datos.length > 0 && (
        <motion.div
          variants={listaEscalonada}
          initial="oculto"
          animate="visible"
          className="space-y-4"
        >
          {datos.map((resumen) => (
            <TarjetaCuenta key={resumen.cuenta.id} resumen={resumen} />
          ))}
        </motion.div>
      )}

      {/* Boton flotante abajo: se llega con el pulgar sin cambiar de mano. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40
                   bg-gradient-to-t from-fondo via-fondo/90 to-transparent pt-8"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto max-w-2xl px-4">
          <button
            type="button"
            className="boton-principal pointer-events-auto w-full shadow-lg shadow-black/40"
            onClick={() => setNueva(true)}
          >
            Nueva cuenta
          </button>
        </div>
      </div>

      <Dialogo titulo="Nueva cuenta" abierto={nueva} onCerrar={() => setNueva(false)}>
        <FormularioCuenta
          onHecho={() => {
            setNueva(false)
            recargar()
          }}
          onCancelar={() => setNueva(false)}
        />
      </Dialogo>
    </motion.div>
  )
}
