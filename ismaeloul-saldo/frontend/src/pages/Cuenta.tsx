import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { api } from '../api/cliente'
import type { CuentaDetalle, Suscripcion } from '../api/tipos'
import { Historial } from '../components/Historial'
import { LineaTemporal } from '../components/LineaTemporal'
import { ListaSuscripciones } from '../components/ListaSuscripciones'
import { PanelNotas } from '../components/PanelNotas'
import { Saldo } from '../components/Saldo'
import {
  FormularioCuenta,
  FormularioPrecio,
  FormularioReactivar,
  FormularioReconciliacion,
  FormularioRecarga,
  FormularioSuscripcion,
} from '../components/formularios'
import { Aviso, Dialogo, Esqueleto } from '../components/ui'
import { formatearImporte } from '../lib/dinero'
import { formatearFecha } from '../lib/fechas'
import { useRecurso } from '../lib/hooks'
import { PALETA, llenadoDeMargen, urgenciaDe } from '../lib/urgencia'

type Panel =
  | { tipo: 'ninguno' }
  | { tipo: 'recarga' }
  | { tipo: 'reconciliar' }
  | { tipo: 'suscripcion' }
  | { tipo: 'editar' }
  | { tipo: 'precio'; suscripcion: Suscripcion }
  | { tipo: 'reactivar'; suscripcion: Suscripcion }

function Metrica({
  etiqueta,
  valor,
  tono = '',
}: {
  etiqueta: string
  valor: string
  tono?: string
}) {
  return (
    <div className="tarjeta p-4">
      <p className="text-[11px] uppercase tracking-wide text-apagado">{etiqueta}</p>
      <p className={`cifras mt-1 text-lg font-semibold ${tono}`}>{valor}</p>
    </div>
  )
}

export function Cuenta() {
  const { id } = useParams<{ id: string }>()
  const cuentaId = Number(id)
  const [panel, setPanel] = useState<Panel>({ tipo: 'ninguno' })

  const { datos, cargando, error, recargar } = useRecurso<CuentaDetalle>(
    () => api.verCuenta(cuentaId),
    [cuentaId],
  )

  const cerrar = () => setPanel({ tipo: 'ninguno' })
  const hecho = () => {
    cerrar()
    recargar()
  }

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10">
        <p className="text-sm text-rojo">{error}</p>
        <Link to="/" className="boton-secundario mt-4">
          Volver al panel
        </Link>
      </div>
    )
  }

  if (cargando && !datos) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 pt-6">
        <Esqueleto className="h-4 w-24" />
        <Esqueleto className="h-20 w-64" />
        <div className="grid grid-cols-3 gap-3">
          <Esqueleto className="h-20" />
          <Esqueleto className="h-20" />
          <Esqueleto className="h-20" />
        </div>
        <Esqueleto className="h-56" />
      </div>
    )
  }

  if (!datos) return null

  const { cuenta, metricas, suscripciones, proyeccion, transacciones } = datos
  const urgencia = urgenciaDe(metricas.dias_restantes)
  const paleta = PALETA[urgencia]
  const riesgoPorId = Object.fromEntries(
    metricas.en_riesgo.map((r) => [r.subscription_id, r.fecha_perdida_prevista]),
  )
  const prueba = metricas.proxima_prueba

  return (
    <div className="mx-auto max-w-2xl px-4 pb-16 pt-6">
      <header className="mb-6">
        <Link to="/" className="text-sm text-tenue hover:text-texto">
          &larr; Cuentas
        </Link>

        <div className="mt-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-tenue">{cuenta.email}</p>
            <p className="mt-0.5 text-xs text-apagado">
              {cuenta.region} · {cuenta.currency}
            </p>
          </div>
          <button
            type="button"
            className="boton-fantasma shrink-0 px-2 py-1 text-xs"
            onClick={() => setPanel({ tipo: 'editar' })}
          >
            Editar
          </button>
        </div>

        <div className="mt-3">
          <Saldo
            minor={cuenta.balance_minor}
            divisa={cuenta.currency}
            exponente={cuenta.exponente}
            tamano="gigante"
          />
          <p className="mt-2 text-xs text-apagado">
            Actualizado el {formatearFecha(cuenta.balance_updated_on)}
          </p>
        </div>

        <div className="mt-4 h-2 overflow-hidden rounded-full bg-elevada">
          <div
            className={`h-full rounded-full ${paleta.barra}`}
            style={{ width: `${llenadoDeMargen(metricas.dias_restantes) * 100}%` }}
          />
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            className="boton-principal flex-1"
            onClick={() => setPanel({ tipo: 'recarga' })}
          >
            Recargar
          </button>
          <button
            type="button"
            className="boton-secundario flex-1"
            onClick={() => setPanel({ tipo: 'reconciliar' })}
          >
            Reconciliar
          </button>
        </div>
      </header>

      <div className="space-y-4">
        {/* Los avisos de prueba mandan sobre el de recarga. */}
        {prueba && !prueba.saldo_alcanza && (
          <Aviso tono="rojo" titulo={`Riesgo de perder ${prueba.nombre}`}>
            La prueba pasa a cobro el {formatearFecha(prueba.fecha)} por{' '}
            {formatearImporte(
              prueba.amount_minor,
              cuenta.currency,
              cuenta.exponente,
            )}{' '}
            y el saldo proyectado no llega. Recarga antes de esa fecha.
          </Aviso>
        )}

        {prueba && prueba.saldo_alcanza && (
          <Aviso tono="menta" titulo={`${prueba.nombre} esta en prueba`}>
            Pasa a cobro el {formatearFecha(prueba.fecha)} por{' '}
            {formatearImporte(
              prueba.amount_minor,
              cuenta.currency,
              cuenta.exponente,
            )}
            . El saldo alcanza.
          </Aviso>
        )}

        {metricas.estado_recarga === 'recarga_ya' && (
          <Aviso tono="ambar" titulo="Recarga ya">
            {metricas.fecha_agotamiento
              ? `El primer cobro que no se podra pagar cae el ${formatearFecha(
                  metricas.fecha_agotamiento,
                )}.`
              : 'El saldo se queda corto.'}
          </Aviso>
        )}

        <div className="grid grid-cols-3 gap-3">
          <Metrica
            etiqueta="Te queda"
            valor={
              metricas.meses_restantes === null
                ? '24+ meses'
                : metricas.meses_restantes === 0
                  ? `${metricas.dias_restantes} dias`
                  : `${metricas.meses_restantes} ${
                      metricas.meses_restantes === 1 ? 'mes' : 'meses'
                    }`
            }
            tono={paleta.texto}
          />
          <Metrica
            etiqueta="Se agota"
            valor={
              metricas.fecha_agotamiento
                ? formatearFecha(metricas.fecha_agotamiento)
                : '—'
            }
          />
          <Metrica
            etiqueta="Recargar"
            valor={
              metricas.estado_recarga === 'recarga_ya'
                ? 'Ya'
                : metricas.fecha_recarga
                  ? formatearFecha(metricas.fecha_recarga)
                  : '—'
            }
          />
        </div>

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-tenue">Suscripciones</h2>
          <button
            type="button"
            className="boton-secundario px-3 py-1.5 text-xs"
            onClick={() => setPanel({ tipo: 'suscripcion' })}
          >
            Anadir
          </button>
        </div>

        <ListaSuscripciones
          cuenta={cuenta}
          suscripciones={suscripciones}
          riesgoPorId={riesgoPorId}
          onCambiarPrecio={(s) => setPanel({ tipo: 'precio', suscripcion: s })}
          onReactivar={(s) => setPanel({ tipo: 'reactivar', suscripcion: s })}
          onCancelar={async (s) => {
            await api.cancelarSuscripcion(s.id)
            recargar()
          }}
        />

        <LineaTemporal
          cuenta={cuenta}
          metricas={metricas}
          proyeccion={proyeccion}
          horizonteMeses={datos.horizonte_meses}
        />

        <PanelNotas cuenta={cuenta} />

        <Historial cuenta={cuenta} transacciones={transacciones} />
      </div>

      <Dialogo
        titulo="Registrar recarga"
        abierto={panel.tipo === 'recarga'}
        onCerrar={cerrar}
      >
        <FormularioRecarga cuenta={cuenta} onHecho={hecho} onCancelar={cerrar} />
      </Dialogo>

      <Dialogo
        titulo="Reconciliar saldo"
        abierto={panel.tipo === 'reconciliar'}
        onCerrar={cerrar}
      >
        <FormularioReconciliacion
          cuenta={cuenta}
          onHecho={hecho}
          onCancelar={cerrar}
        />
      </Dialogo>

      <Dialogo
        titulo="Nueva suscripcion"
        abierto={panel.tipo === 'suscripcion'}
        onCerrar={cerrar}
      >
        <FormularioSuscripcion
          cuenta={cuenta}
          onHecho={hecho}
          onCancelar={cerrar}
        />
      </Dialogo>

      <Dialogo
        titulo="Editar cuenta"
        abierto={panel.tipo === 'editar'}
        onCerrar={cerrar}
      >
        <FormularioCuenta cuenta={cuenta} onHecho={hecho} onCancelar={cerrar} />
      </Dialogo>

      <Dialogo
        titulo="Cambiar precio"
        abierto={panel.tipo === 'precio'}
        onCerrar={cerrar}
      >
        {panel.tipo === 'precio' && (
          <FormularioPrecio
            cuenta={cuenta}
            suscripcion={panel.suscripcion}
            onHecho={hecho}
            onCancelar={cerrar}
          />
        )}
      </Dialogo>

      <Dialogo
        titulo="Reactivar suscripcion"
        abierto={panel.tipo === 'reactivar'}
        onCerrar={cerrar}
      >
        {panel.tipo === 'reactivar' && (
          <FormularioReactivar
            suscripcion={panel.suscripcion}
            onHecho={hecho}
            onCancelar={cerrar}
          />
        )}
      </Dialogo>
    </div>
  )
}
