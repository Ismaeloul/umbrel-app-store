import { motion } from 'framer-motion'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'

import { api } from '../api/cliente'
import type { CuentaDetalle, Suscripcion } from '../api/tipos'
import { BarraMargen } from '../components/BarraMargen'
import { Historial } from '../components/Historial'
import { LineaTemporal } from '../components/LineaTemporal'
import { ListaSuscripciones } from '../components/ListaSuscripciones'
import { PanelNotas } from '../components/PanelNotas'
import { Saldo } from '../components/Saldo'
import { tiempoRestante } from '../components/TarjetaCuenta'
import {
  FormularioCuenta,
  FormularioPrecio,
  FormularioReactivar,
  FormularioReconciliacion,
  FormularioRecarga,
  FormularioSuscripcion,
} from '../components/formularios'
import { Aviso, Dialogo, Esqueleto } from '../components/ui'
import { listaEscalonada, elementoDeLista, pagina } from '../lib/animacion'
import { formatearImporte } from '../lib/dinero'
import { formatearFecha } from '../lib/fechas'
import { useRecurso } from '../lib/hooks'
import { banderaDe } from '../lib/region'
import { PALETA, urgenciaDe } from '../lib/urgencia'

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
  tono = 'text-texto',
}: {
  etiqueta: string
  valor: string
  tono?: string
}) {
  return (
    <div className="tarjeta px-3 py-3.5">
      <p className="text-[10px] uppercase tracking-[0.08em] text-apagado">
        {etiqueta}
      </p>
      {/* 15px: "23 nov 2026" cabe en una linea en un tercio de 390 px. */}
      <p
        className={`cifras mt-1.5 text-[0.9375rem] font-semibold leading-tight ${tono}`}
      >
        {valor}
      </p>
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
      <div className="mx-auto max-w-2xl space-y-5 px-4 pt-8">
        <Esqueleto className="h-3.5 w-24" />
        <Esqueleto className="h-4 w-48" />
        <Esqueleto className="h-16 w-64" />
        <Esqueleto className="h-2 w-full" />
        <div className="grid grid-cols-3 gap-3">
          <Esqueleto className="h-20" />
          <Esqueleto className="h-20" />
          <Esqueleto className="h-20" />
        </div>
        <Esqueleto className="h-64" />
      </div>
    )
  }

  if (!datos) return null

  const { cuenta, metricas, suscripciones, proyeccion, transacciones } = datos
  const paleta = PALETA[urgenciaDe(metricas.dias_restantes)]
  const riesgoPorId = Object.fromEntries(
    metricas.en_riesgo.map((r) => [r.subscription_id, r.fecha_perdida_prevista]),
  )
  const prueba = metricas.proxima_prueba
  const importe = (minor: number) =>
    formatearImporte(minor, cuenta.currency, cuenta.exponente)

  return (
    <motion.div
      variants={pagina}
      initial="oculto"
      animate="visible"
      exit="salida"
      className="mx-auto max-w-2xl px-4 pb-32 pt-6"
    >
      <header>
        <Link
          to="/"
          className="-ml-1 inline-flex items-center gap-1 rounded-lg px-1 py-1
                     text-sm text-tenue transition-colors hover:text-texto"
        >
          <span aria-hidden>&larr;</span> Cuentas
        </Link>

        <div className="mt-5 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-tenue">{cuenta.email}</p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-apagado">
              <span aria-label={`Region ${cuenta.region}`}>
                {banderaDe(cuenta.region)}
              </span>
              <span>{cuenta.currency}</span>
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

        {/* El saldo domina la pantalla, con un halo del color del margen. */}
        <div className="relative mt-5">
          <div
            aria-hidden
            className={`pointer-events-none absolute -left-6 -top-8 h-32 w-56 rounded-full
                        opacity-[0.07] blur-3xl ${paleta.barra}`}
          />
          <div className="relative">
            <Saldo
              minor={cuenta.balance_minor}
              divisa={cuenta.currency}
              exponente={cuenta.exponente}
              tamano="gigante"
            />
            <p className="mt-2.5 text-xs text-apagado">
              Actualizado el {formatearFecha(cuenta.balance_updated_on)}
            </p>
          </div>
        </div>

        <div className="mt-5">
          <BarraMargen
            gruesa
            diasRestantes={metricas.dias_restantes}
            etiqueta={`Margen restante: ${tiempoRestante(
              metricas.meses_restantes,
              metricas.dias_restantes,
            )}`}
          />
        </div>
      </header>

      <motion.div
        variants={listaEscalonada}
        initial="oculto"
        animate="visible"
        className="mt-6 space-y-4"
      >
        {/* El aviso de prueba en riesgo manda sobre el de recarga. */}
        {prueba && !prueba.saldo_alcanza && (
          <motion.div variants={elementoDeLista}>
            <Aviso tono="rojo" titulo={`Riesgo de perder ${prueba.nombre}`}>
              La prueba pasa a cobro el {formatearFecha(prueba.fecha)} por{' '}
              {importe(prueba.amount_minor)} y el saldo proyectado no llega.
              Recarga antes de esa fecha.
            </Aviso>
          </motion.div>
        )}

        {prueba && prueba.saldo_alcanza && (
          <motion.div variants={elementoDeLista}>
            <Aviso tono="menta" titulo={`${prueba.nombre} esta en prueba`}>
              Pasa a cobro el {formatearFecha(prueba.fecha)} por{' '}
              {importe(prueba.amount_minor)}. El saldo alcanza.
            </Aviso>
          </motion.div>
        )}

        {metricas.estado_recarga === 'recarga_ya' && (
          <motion.div variants={elementoDeLista}>
            <Aviso tono="ambar" titulo="Recarga ya">
              {metricas.fecha_agotamiento
                ? `El primer cobro que no se podra pagar cae el ${formatearFecha(
                    metricas.fecha_agotamiento,
                  )}.`
                : 'El saldo se queda corto.'}
            </Aviso>
          </motion.div>
        )}

        <motion.div variants={elementoDeLista} className="grid grid-cols-3 gap-3">
          <Metrica
            etiqueta="Te queda"
            valor={
              metricas.meses_restantes === null
                ? '24+ meses'
                : tiempoRestante(metricas.meses_restantes, metricas.dias_restantes)
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
        </motion.div>

        <motion.div variants={elementoDeLista}>
          <div className="mb-3 mt-2 flex items-center justify-between">
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
        </motion.div>

        <motion.div variants={elementoDeLista}>
          <LineaTemporal
            cuenta={cuenta}
            metricas={metricas}
            proyeccion={proyeccion}
            horizonteMeses={datos.horizonte_meses}
          />
        </motion.div>

        <motion.div variants={elementoDeLista}>
          <PanelNotas cuenta={cuenta} />
        </motion.div>

        <motion.div variants={elementoDeLista}>
          <Historial cuenta={cuenta} transacciones={transacciones} />
        </motion.div>
      </motion.div>

      {/* Acciones principales fijas abajo: se llega con una mano. */}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-40
                   bg-gradient-to-t from-fondo via-fondo/90 to-transparent pt-8"
        style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
      >
        <div className="mx-auto flex max-w-2xl gap-2 px-4">
          <button
            type="button"
            className="boton-principal pointer-events-auto flex-1 shadow-lg shadow-black/40"
            onClick={() => setPanel({ tipo: 'recarga' })}
          >
            Recargar
          </button>
          <button
            type="button"
            className="boton-secundario pointer-events-auto flex-1 shadow-lg shadow-black/40"
            onClick={() => setPanel({ tipo: 'reconciliar' })}
          >
            Reconciliar
          </button>
        </div>
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
        <FormularioSuscripcion cuenta={cuenta} onHecho={hecho} onCancelar={cerrar} />
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
    </motion.div>
  )
}
