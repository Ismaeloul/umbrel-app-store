// Formularios de la app.
//
// Todos comparten la misma regla: si el backend rechaza algo, el error se
// pinta junto a su campo y NO se borra nada de lo que hay escrito.

import type { FormEvent, ReactNode } from 'react'
import { useState } from 'react'

import { ErrorDeValidacion, api } from '../api/cliente'
import type { Ciclo, Cuenta, Divisa, Suscripcion } from '../api/tipos'
import { formatearImporte } from '../lib/dinero'
import { hoyIso } from '../lib/fechas'
import { useRecurso } from '../lib/hooks'
import { Campo } from './ui'

type Errores = Record<string, string>

function useEnvio(alTerminar: () => void) {
  const [errores, setErrores] = useState<Errores>({})
  const [enviando, setEnviando] = useState(false)

  const enviar = (accion: () => Promise<unknown>) => async (e: FormEvent) => {
    e.preventDefault()
    setEnviando(true)
    setErrores({})
    try {
      await accion()
      alTerminar()
    } catch (fallo) {
      if (fallo instanceof ErrorDeValidacion) setErrores(fallo.campos)
      else setErrores({ general: (fallo as Error).message })
    } finally {
      setEnviando(false)
    }
  }

  return { errores, enviando, enviar }
}

function Pie({
  errores,
  enviando,
  texto,
  onCancelar,
}: {
  errores: Errores
  enviando: boolean
  texto: string
  onCancelar: () => void
}) {
  return (
    <>
      {errores.general && (
        <p role="alert" className="text-sm text-rojo">
          {errores.general}
        </p>
      )}
      <div className="flex gap-2 pt-2">
        <button type="button" className="boton-secundario flex-1" onClick={onCancelar}>
          Cancelar
        </button>
        <button type="submit" className="boton-principal flex-1" disabled={enviando}>
          {enviando ? 'Guardando...' : texto}
        </button>
      </div>
    </>
  )
}

function Formulario({
  onSubmit,
  children,
}: {
  onSubmit: (e: FormEvent) => void
  children: ReactNode
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {children}
    </form>
  )
}

// --- Cuenta ---------------------------------------------------------------

export function FormularioCuenta({
  cuenta,
  onHecho,
  onCancelar,
}: {
  cuenta?: Cuenta
  onHecho: () => void
  onCancelar: () => void
}) {
  const [email, setEmail] = useState(cuenta?.email ?? '')
  const [region, setRegion] = useState(cuenta?.region ?? 'ES')
  const [divisa, setDivisa] = useState(cuenta?.currency ?? 'EUR')
  const [saldo, setSaldo] = useState('0')
  const [notas, setNotas] = useState(cuenta?.notas ?? '')
  const { errores, enviando, enviar } = useEnvio(onHecho)

  const { datos: divisas } = useRecurso<Divisa[]>(() => api.divisas(), [])
  const exponente = divisas?.find((d) => d.codigo === divisa)?.exponente ?? 2

  const guardar = () =>
    cuenta
      ? api.editarCuenta(cuenta.id, { email, region, notas })
      : api.crearCuenta({
          email,
          region,
          currency: divisa,
          saldo_inicial: saldo,
          notas,
        })

  return (
    <Formulario onSubmit={enviar(guardar)}>
      <Campo etiqueta="Cuenta" error={errores.email}>
        {(props) => (
          <input
            {...props}
            className="campo"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="micuenta@ejemplo.com"
            autoComplete="off"
          />
        )}
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Region" error={errores.region} ayuda="Codigo de pais">
          {(props) => (
            <input
              {...props}
              className="campo uppercase"
              value={region}
              maxLength={2}
              onChange={(e) => setRegion(e.target.value.toUpperCase())}
              placeholder="ES"
            />
          )}
        </Campo>

        <Campo
          etiqueta="Divisa"
          error={errores.currency}
          ayuda={cuenta ? 'No se puede cambiar' : `${exponente} decimales`}
        >
          {(props) => (
            <select
              {...props}
              className="campo"
              value={divisa}
              disabled={Boolean(cuenta)}
              onChange={(e) => setDivisa(e.target.value)}
            >
              {(divisas ?? [{ codigo: divisa, exponente: 2, simbolo: divisa }]).map(
                (d) => (
                  <option key={d.codigo} value={d.codigo}>
                    {d.codigo} · {d.simbolo}
                  </option>
                ),
              )}
            </select>
          )}
        </Campo>
      </div>

      {!cuenta && (
        <Campo
          etiqueta="Saldo inicial"
          error={errores.saldo_inicial}
          ayuda={
            exponente === 0
              ? 'Sin decimales en esta divisa'
              : `Hasta ${exponente} decimales, con coma`
          }
        >
          {(props) => (
            <input
              {...props}
              className="campo cifras"
              inputMode="decimal"
              value={saldo}
              onChange={(e) => setSaldo(e.target.value)}
            />
          )}
        </Campo>
      )}

      <Campo etiqueta="Notas" error={errores.notas}>
        {(props) => (
          <textarea
            {...props}
            className="campo min-h-24 resize-y"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Como se recarga, que contenido desbloquea..."
          />
        )}
      </Campo>

      <Pie
        errores={errores}
        enviando={enviando}
        texto={cuenta ? 'Guardar' : 'Crear cuenta'}
        onCancelar={onCancelar}
      />
    </Formulario>
  )
}

// --- Suscripcion ----------------------------------------------------------

export function FormularioSuscripcion({
  cuenta,
  onHecho,
  onCancelar,
}: {
  cuenta: Cuenta
  onHecho: () => void
  onCancelar: () => void
}) {
  const [nombre, setNombre] = useState('')
  const [ciclo, setCiclo] = useState<Ciclo>('mensual')
  const [conPrueba, setConPrueba] = useState(false)
  const [fecha, setFecha] = useState(hoyIso())
  const [precio, setPrecio] = useState('')
  const { errores, enviando, enviar } = useEnvio(onHecho)

  const crear = () =>
    api.crearSuscripcion(cuenta.id, {
      nombre,
      ciclo,
      precio,
      ...(conPrueba ? { fin_prueba: fecha } : { proximo_cobro: fecha }),
    })

  return (
    <Formulario onSubmit={enviar(crear)}>
      <Campo etiqueta="Nombre" error={errores.nombre}>
        {(props) => (
          <input
            {...props}
            className="campo"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="YouTube Premium"
          />
        )}
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Ciclo" error={errores.ciclo}>
          {(props) => (
            <select
              {...props}
              className="campo"
              value={ciclo}
              onChange={(e) => setCiclo(e.target.value as Ciclo)}
            >
              <option value="mensual">Mensual</option>
              <option value="anual">Anual</option>
            </select>
          )}
        </Campo>

        <Campo
          etiqueta="Precio"
          error={errores.precio}
          ayuda={`En ${cuenta.currency}`}
        >
          {(props) => (
            <input
              {...props}
              className="campo cifras"
              inputMode="decimal"
              value={precio}
              onChange={(e) => setPrecio(e.target.value)}
              placeholder={cuenta.exponente === 0 ? '1200' : '11,99'}
            />
          )}
        </Campo>
      </div>

      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-borde bg-fondo p-3">
        <input
          type="checkbox"
          checked={conPrueba}
          onChange={(e) => setConPrueba(e.target.checked)}
          className="h-4 w-4 accent-[#4FE0A0]"
        />
        <span className="text-sm">Empieza con prueba gratuita</span>
      </label>

      <Campo
        etiqueta={conPrueba ? 'Fin de la prueba' : 'Proximo cobro'}
        error={conPrueba ? errores.fin_prueba : errores.proximo_cobro}
        ayuda={
          conPrueba
            ? 'El dia que la prueba pasa a cobro'
            : 'Hoy o una fecha futura'
        }
      >
        {(props) => (
          <input
            {...props}
            type="date"
            className="campo cifras"
            value={fecha}
            min={hoyIso()}
            onChange={(e) => setFecha(e.target.value)}
          />
        )}
      </Campo>

      <Pie
        errores={errores}
        enviando={enviando}
        texto="Anadir"
        onCancelar={onCancelar}
      />
    </Formulario>
  )
}

// --- Precio ---------------------------------------------------------------

export function FormularioPrecio({
  cuenta,
  suscripcion,
  onHecho,
  onCancelar,
}: {
  cuenta: Cuenta
  suscripcion: Suscripcion
  onHecho: () => void
  onCancelar: () => void
}) {
  const [precio, setPrecio] = useState('')
  const [desde, setDesde] = useState(hoyIso())
  const { errores, enviando, enviar } = useEnvio(onHecho)

  return (
    <Formulario
      onSubmit={enviar(() =>
        api.cambiarPrecio(suscripcion.id, { precio, vigente_desde: desde }),
      )}
    >
      <p className="text-sm text-tenue">
        Ahora cuesta{' '}
        <span className="cifras text-texto">
          {formatearImporte(
            suscripcion.precio_actual_minor,
            cuenta.currency,
            cuenta.exponente,
          )}
        </span>
        . El precio nuevo se anade al historico: los cargos anteriores
        mantienen el suyo.
      </p>

      <Campo etiqueta="Precio nuevo" error={errores.precio}>
        {(props) => (
          <input
            {...props}
            className="campo cifras"
            inputMode="decimal"
            value={precio}
            onChange={(e) => setPrecio(e.target.value)}
            autoFocus
          />
        )}
      </Campo>

      <Campo etiqueta="En vigor desde" error={errores.vigente_desde}>
        {(props) => (
          <input
            {...props}
            type="date"
            className="campo cifras"
            value={desde}
            onChange={(e) => setDesde(e.target.value)}
          />
        )}
      </Campo>

      <Pie
        errores={errores}
        enviando={enviando}
        texto="Cambiar precio"
        onCancelar={onCancelar}
      />
    </Formulario>
  )
}

// --- Recarga --------------------------------------------------------------

export function FormularioRecarga({
  cuenta,
  onHecho,
  onCancelar,
}: {
  cuenta: Cuenta
  onHecho: () => void
  onCancelar: () => void
}) {
  const [importe, setImporte] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [concepto, setConcepto] = useState('Recarga')
  const { errores, enviando, enviar } = useEnvio(onHecho)

  return (
    <Formulario
      onSubmit={enviar(() => api.recargar(cuenta.id, { importe, fecha, concepto }))}
    >
      <Campo
        etiqueta="Importe"
        error={errores.importe}
        ayuda={`Se suma al saldo, en ${cuenta.currency}`}
      >
        {(props) => (
          <input
            {...props}
            className="campo cifras text-2xl"
            inputMode="decimal"
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            placeholder={cuenta.exponente === 0 ? '3000' : '25,00'}
            autoFocus
          />
        )}
      </Campo>

      <Campo etiqueta="Fecha" error={errores.fecha}>
        {(props) => (
          <input
            {...props}
            type="date"
            className="campo cifras"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        )}
      </Campo>

      <Campo etiqueta="Concepto" error={errores.concepto}>
        {(props) => (
          <input
            {...props}
            className="campo"
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            placeholder="Tarjeta regalo"
          />
        )}
      </Campo>

      <Pie
        errores={errores}
        enviando={enviando}
        texto="Registrar recarga"
        onCancelar={onCancelar}
      />
    </Formulario>
  )
}

// --- Reconciliacion -------------------------------------------------------

export function FormularioReconciliacion({
  cuenta,
  onHecho,
  onCancelar,
}: {
  cuenta: Cuenta
  onHecho: () => void
  onCancelar: () => void
}) {
  const [saldoReal, setSaldoReal] = useState('')
  const [fecha, setFecha] = useState(hoyIso())
  const [concepto, setConcepto] = useState('')
  const { errores, enviando, enviar } = useEnvio(onHecho)

  return (
    <Formulario
      onSubmit={enviar(() =>
        api.reconciliar(cuenta.id, { saldo_real: saldoReal, fecha, concepto }),
      )}
    >
      <p className="text-sm text-tenue">
        La app cree que tienes{' '}
        <span className="cifras text-texto">
          {formatearImporte(
            cuenta.balance_minor,
            cuenta.currency,
            cuenta.exponente,
          )}
        </span>
        . Escribe lo que ves de verdad en la tienda y la diferencia se anota
        como ajuste.
      </p>

      <Campo etiqueta="Saldo real" error={errores.saldo_real}>
        {(props) => (
          <input
            {...props}
            className="campo cifras text-2xl"
            inputMode="decimal"
            value={saldoReal}
            onChange={(e) => setSaldoReal(e.target.value)}
            autoFocus
          />
        )}
      </Campo>

      <Campo etiqueta="Fecha" error={errores.fecha}>
        {(props) => (
          <input
            {...props}
            type="date"
            className="campo cifras"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        )}
      </Campo>

      <Campo
        etiqueta="Motivo"
        error={errores.concepto}
        ayuda="Obligatorio: por que no cuadraba"
      >
        {(props) => (
          <input
            {...props}
            className="campo"
            value={concepto}
            onChange={(e) => setConcepto(e.target.value)}
            placeholder="Promocion de la tienda"
          />
        )}
      </Campo>

      <Pie
        errores={errores}
        enviando={enviando}
        texto="Reconciliar"
        onCancelar={onCancelar}
      />
    </Formulario>
  )
}

// --- Reactivar ------------------------------------------------------------

export function FormularioReactivar({
  suscripcion,
  onHecho,
  onCancelar,
}: {
  suscripcion: Suscripcion
  onHecho: () => void
  onCancelar: () => void
}) {
  const [fecha, setFecha] = useState(hoyIso())
  const { errores, enviando, enviar } = useEnvio(onHecho)

  return (
    <Formulario
      onSubmit={enviar(() => api.reactivarSuscripcion(suscripcion.id, fecha))}
    >
      <p className="text-sm text-tenue">
        {suscripcion.nombre} vuelve al ciclo normal desde la fecha que pongas.
        El dia del mes se toma de ella.
      </p>

      <Campo
        etiqueta="Proximo cobro"
        error={errores.proximo_cobro ?? errores.estado}
        ayuda="Hoy o una fecha futura"
      >
        {(props) => (
          <input
            {...props}
            type="date"
            className="campo cifras"
            value={fecha}
            min={hoyIso()}
            onChange={(e) => setFecha(e.target.value)}
          />
        )}
      </Campo>

      <Pie
        errores={errores}
        enviando={enviando}
        texto="Reactivar"
        onCancelar={onCancelar}
      />
    </Formulario>
  )
}
