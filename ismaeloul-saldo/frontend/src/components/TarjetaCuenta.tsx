import { Link } from 'react-router-dom'

import type { CuentaResumen } from '../api/tipos'
import { formatearFecha } from '../lib/fechas'
import { PALETA, llenadoDeMargen, urgenciaDe } from '../lib/urgencia'
import { Saldo } from './Saldo'

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-apagado">{etiqueta}</p>
      <p className="cifras truncate text-sm text-texto">{valor}</p>
    </div>
  )
}

export function TarjetaCuenta({ resumen }: { resumen: CuentaResumen }) {
  const { cuenta, metricas, suscripciones_activas } = resumen
  const urgencia = urgenciaDe(metricas.dias_restantes)
  const paleta = PALETA[urgencia]
  const llenado = llenadoDeMargen(metricas.dias_restantes)

  const tiempo =
    metricas.meses_restantes === null
      ? 'Sin agotarse'
      : metricas.meses_restantes === 0
        ? `${metricas.dias_restantes} dias`
        : `${metricas.meses_restantes} ${metricas.meses_restantes === 1 ? 'mes' : 'meses'}`

  return (
    <Link
      to={`/cuentas/${cuenta.id}`}
      className={`tarjeta block border-l-4 p-5 transition-colors hover:border-apagado ${paleta.borde}`}
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm text-tenue">{cuenta.email}</p>
          <p className="mt-0.5 text-xs text-apagado">
            {cuenta.region} · {suscripciones_activas}{' '}
            {suscripciones_activas === 1 ? 'suscripcion' : 'suscripciones'}
          </p>
        </div>
        <span className={`etiqueta shrink-0 ${paleta.fondo} ${paleta.texto}`}>
          {tiempo}
        </span>
      </div>

      <Saldo
        minor={cuenta.balance_minor}
        divisa={cuenta.currency}
        exponente={cuenta.exponente}
      />

      <div
        className="mt-4 h-1.5 overflow-hidden rounded-full bg-elevada"
        role="img"
        aria-label={`Margen restante: ${tiempo}`}
      >
        <div
          className={`h-full rounded-full ${paleta.barra}`}
          style={{ width: `${llenado * 100}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3">
        <Dato
          etiqueta="Se agota"
          valor={
            metricas.fecha_agotamiento
              ? formatearFecha(metricas.fecha_agotamiento)
              : 'No en 24 meses'
          }
        />
        <Dato
          etiqueta="Recargar"
          valor={
            metricas.estado_recarga === 'recarga_ya'
              ? 'Ya'
              : metricas.fecha_recarga
                ? formatearFecha(metricas.fecha_recarga)
                : 'Sin prisa'
          }
        />
      </div>
    </Link>
  )
}
