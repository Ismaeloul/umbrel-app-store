import type { Cuenta, Suscripcion } from '../api/tipos'
import { formatearImporte } from '../lib/dinero'
import { formatearFecha } from '../lib/fechas'
import { Etiqueta } from './ui'

const CICLOS: Record<Suscripcion['ciclo'], string> = {
  mensual: 'al mes',
  anual: 'al ano',
}

function Fila({
  cuenta,
  suscripcion,
  enRiesgo,
  onCambiarPrecio,
  onCancelar,
  onReactivar,
}: {
  cuenta: Cuenta
  suscripcion: Suscripcion
  enRiesgo?: string
  onCambiarPrecio: (s: Suscripcion) => void
  onCancelar: (s: Suscripcion) => void
  onReactivar: (s: Suscripcion) => void
}) {
  const perdida = suscripcion.estado === 'perdida'

  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-medium">{suscripcion.nombre}</p>
          <p className="cifras mt-0.5 text-xs text-apagado">
            {formatearImporte(
              suscripcion.precio_actual_minor,
              cuenta.currency,
              cuenta.exponente,
            )}{' '}
            {CICLOS[suscripcion.ciclo]}
          </p>
        </div>
        <span className="cifras shrink-0 text-right text-xs text-tenue">
          {perdida
            ? formatearFecha(suscripcion.perdida_en ?? suscripcion.proximo_cobro)
            : formatearFecha(suscripcion.proximo_cobro)}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {perdida && (
          <Etiqueta tono="rojo">
            Perdida el{' '}
            {formatearFecha(suscripcion.perdida_en ?? suscripcion.proximo_cobro)}
          </Etiqueta>
        )}
        {suscripcion.estado === 'cancelada' && (
          <Etiqueta>
            Cancelada el{' '}
            {formatearFecha(suscripcion.cancelada_en ?? suscripcion.proximo_cobro)}
          </Etiqueta>
        )}
        {suscripcion.en_prueba && suscripcion.fin_prueba && (
          <Etiqueta tono="menta">
            En prueba · cobra el {formatearFecha(suscripcion.fin_prueba)}
          </Etiqueta>
        )}
        {enRiesgo && (
          <Etiqueta tono="ambar">Se perdera el {formatearFecha(enRiesgo)}</Etiqueta>
        )}
      </div>

      <div className="mt-3 flex gap-2">
        {perdida ? (
          <button
            type="button"
            className="boton-secundario px-3 py-1.5 text-xs"
            onClick={() => onReactivar(suscripcion)}
          >
            Reactivar
          </button>
        ) : (
          <>
            <button
              type="button"
              className="boton-secundario px-3 py-1.5 text-xs"
              onClick={() => onCambiarPrecio(suscripcion)}
            >
              Cambiar precio
            </button>
            {suscripcion.estado === 'activa' && (
              <button
                type="button"
                className="boton-fantasma px-3 py-1.5 text-xs"
                onClick={() => onCancelar(suscripcion)}
              >
                Cancelar
              </button>
            )}
          </>
        )}
      </div>
    </li>
  )
}

export function ListaSuscripciones({
  cuenta,
  suscripciones,
  riesgoPorId,
  onCambiarPrecio,
  onCancelar,
  onReactivar,
}: {
  cuenta: Cuenta
  suscripciones: Suscripcion[]
  riesgoPorId: Record<number, string>
  onCambiarPrecio: (s: Suscripcion) => void
  onCancelar: (s: Suscripcion) => void
  onReactivar: (s: Suscripcion) => void
}) {
  const activas = suscripciones.filter((s) => s.estado === 'activa')
  const perdidas = suscripciones.filter((s) => s.estado === 'perdida')
  const canceladas = suscripciones.filter((s) => s.estado === 'cancelada')

  const acciones = { onCambiarPrecio, onCancelar, onReactivar }

  const bloque = (titulo: string, lista: Suscripcion[], nota?: string) =>
    lista.length > 0 && (
      <section className="tarjeta overflow-hidden">
        <div className="border-b border-borde px-5 py-4">
          <h2 className="text-sm font-semibold text-tenue">
            {titulo}{' '}
            <span className="cifras font-normal text-apagado">
              ({lista.length})
            </span>
          </h2>
          {nota && <p className="mt-1 text-xs text-apagado">{nota}</p>}
        </div>
        <ul className="divide-y divide-borde">
          {lista.map((s) => (
            <Fila
              key={s.id}
              cuenta={cuenta}
              suscripcion={s}
              enRiesgo={riesgoPorId[s.id]}
              {...acciones}
            />
          ))}
        </ul>
      </section>
    )

  return (
    <div className="space-y-4">
      {activas.length === 0 && perdidas.length === 0 && canceladas.length === 0 ? (
        <div className="tarjeta p-8 text-center">
          <p className="font-medium">Esta cuenta no tiene suscripciones</p>
          <p className="mt-2 text-sm text-tenue">
            Anade la primera para saber cuanto te dura el saldo.
          </p>
        </div>
      ) : (
        <>
          {bloque('Activas', activas)}
          {bloque(
            'Perdidas',
            perdidas,
            'Fallo el cobro por falta de saldo y dejaron de cobrarse.',
          )}
          {bloque('Canceladas', canceladas)}
        </>
      )}
    </div>
  )
}
