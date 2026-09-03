import type { Cuenta, Transaccion } from '../api/tipos'
import { formatearImporte } from '../lib/dinero'
import { formatearFecha } from '../lib/fechas'

const NOMBRES: Record<Transaccion['tipo'], string> = {
  recarga: 'Recarga',
  cargo: 'Cobro',
  ajuste: 'Ajuste',
}

export function Historial({
  cuenta,
  transacciones,
}: {
  cuenta: Cuenta
  transacciones: Transaccion[]
}) {
  return (
    <section className="tarjeta overflow-hidden">
      <h2 className="border-b border-borde px-5 py-4 text-sm font-semibold text-tenue">
        Historial
      </h2>

      {transacciones.length === 0 ? (
        <p className="px-5 py-6 text-sm text-apagado">
          Todavia no hay movimientos.
        </p>
      ) : (
        <ul className="divide-y divide-borde">
          {transacciones.map((movimiento) => (
            <li
              key={movimiento.id}
              className="flex items-center gap-3 px-5 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm">{movimiento.concepto}</p>
                <p className="cifras mt-0.5 text-xs text-apagado">
                  {NOMBRES[movimiento.tipo]} · {formatearFecha(movimiento.fecha)}
                </p>
              </div>
              <span
                className={`cifras shrink-0 text-sm font-medium ${
                  movimiento.amount_minor >= 0 ? 'text-menta' : 'text-texto'
                }`}
              >
                {formatearImporte(
                  movimiento.amount_minor,
                  cuenta.currency,
                  cuenta.exponente,
                  { conSigno: true },
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
