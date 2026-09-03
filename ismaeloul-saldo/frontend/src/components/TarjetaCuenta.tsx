import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'

import type { CuentaResumen } from '../api/tipos'
import { elementoDeLista } from '../lib/animacion'
import { formatearFecha } from '../lib/fechas'
import { banderaDe } from '../lib/region'
import { PALETA, urgenciaDe } from '../lib/urgencia'
import { BarraMargen } from './BarraMargen'
import { Saldo } from './Saldo'

export function tiempoRestante(
  meses: number | null,
  dias: number | null,
): string {
  if (meses === null) return 'Sin agotarse'
  if (meses === 0) return `${dias} ${dias === 1 ? 'dia' : 'dias'}`
  return `${meses} ${meses === 1 ? 'mes' : 'meses'}`
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[10px] uppercase tracking-[0.08em] text-apagado">
        {etiqueta}
      </p>
      <p className="cifras mt-0.5 truncate text-sm text-tenue">{valor}</p>
    </div>
  )
}

export function TarjetaCuenta({ resumen }: { resumen: CuentaResumen }) {
  const { cuenta, metricas, suscripciones_activas } = resumen
  const paleta = PALETA[urgenciaDe(metricas.dias_restantes)]
  const tiempo = tiempoRestante(metricas.meses_restantes, metricas.dias_restantes)

  return (
    <motion.div variants={elementoDeLista}>
      <Link
        to={`/cuentas/${cuenta.id}`}
        className={`tarjeta block border-l-[3px] p-5 transition-colors
                    hover:bg-elevada/40 active:bg-elevada/60 ${paleta.borde}`}
      >
        <div className="mb-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-tenue">{cuenta.email}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-apagado">
              <span aria-label={`Region ${cuenta.region}`}>
                {banderaDe(cuenta.region)}
              </span>
              <span>
                {suscripciones_activas}{' '}
                {suscripciones_activas === 1 ? 'suscripcion' : 'suscripciones'}
              </span>
            </p>
          </div>
          <span
            className={`etiqueta cifras shrink-0 ${paleta.fondo} ${paleta.texto}`}
          >
            {tiempo}
          </span>
        </div>

        <Saldo
          minor={cuenta.balance_minor}
          divisa={cuenta.currency}
          exponente={cuenta.exponente}
        />

        <div className="mt-5">
          <BarraMargen
            diasRestantes={metricas.dias_restantes}
            etiqueta={`Margen restante: ${tiempo}`}
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
    </motion.div>
  )
}
