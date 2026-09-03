import { useState } from 'react'

import { api } from '../api/cliente'
import type { CuentaResumen } from '../api/tipos'
import { FormularioCuenta } from '../components/formularios'
import { TarjetaCuenta } from '../components/TarjetaCuenta'
import { Dialogo, Esqueleto, Vacio } from '../components/ui'
import { useRecurso } from '../lib/hooks'

function EsqueletoTarjeta() {
  return (
    <div className="tarjeta space-y-4 p-5">
      <Esqueleto className="h-4 w-40" />
      <Esqueleto className="h-10 w-48" />
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
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Saldo</h1>
          <p className="text-sm text-tenue">Tus cuentas prepago</p>
        </div>
        <button
          type="button"
          className="boton-principal"
          onClick={() => setNueva(true)}
        >
          Nueva cuenta
        </button>
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
          suscrito.
        </Vacio>
      )}

      {datos && datos.length > 0 && (
        <div className="space-y-4">
          {datos.map((resumen) => (
            <TarjetaCuenta key={resumen.cuenta.id} resumen={resumen} />
          ))}
        </div>
      )}

      <Dialogo
        titulo="Nueva cuenta"
        abierto={nueva}
        onCerrar={() => setNueva(false)}
      >
        <FormularioCuenta
          onHecho={() => {
            setNueva(false)
            recargar()
          }}
          onCancelar={() => setNueva(false)}
        />
      </Dialogo>
    </div>
  )
}
