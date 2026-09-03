import type { CargoProyectado, Cuenta, Metricas } from '../api/tipos'
import { formatearImporte } from '../lib/dinero'
import { formatearFecha } from '../lib/fechas'

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
]

function porMeses(cargos: CargoProyectado[]) {
  const grupos: { clave: string; titulo: string; cargos: CargoProyectado[] }[] = []
  for (const cargo of cargos) {
    const [anio, mes] = cargo.fecha.split('-')
    const clave = `${anio}-${mes}`
    const ultimo = grupos.at(-1)
    if (ultimo?.clave === clave) {
      ultimo.cargos.push(cargo)
    } else {
      grupos.push({
        clave,
        titulo: `${MESES[Number(mes) - 1]} de ${anio}`,
        cargos: [cargo],
      })
    }
  }
  return grupos
}

export function LineaTemporal({
  cuenta,
  metricas,
  proyeccion,
  horizonteMeses,
}: {
  cuenta: Cuenta
  metricas: Metricas
  proyeccion: CargoProyectado[]
  horizonteMeses: number
}) {
  const primeraPerdida = metricas.en_riesgo[0]

  if (proyeccion.length === 0 && !primeraPerdida) {
    return (
      <section className="tarjeta p-5">
        <h2 className="mb-2 text-sm font-semibold text-tenue">
          Proximos {horizonteMeses} meses
        </h2>
        <p className="text-sm text-apagado">
          No hay ningun cobro previsto. Anade una suscripcion para ver aqui como
          baja el saldo.
        </p>
      </section>
    )
  }

  return (
    <section className="tarjeta overflow-hidden">
      <h2 className="border-b border-borde px-5 py-4 text-sm font-semibold text-tenue">
        Proximos {horizonteMeses} meses
      </h2>

      <ol className="divide-y divide-borde">
        {porMeses(proyeccion).map((grupo) => (
          <li key={grupo.clave}>
            <p className="bg-elevada/40 px-5 py-1.5 text-[11px] uppercase tracking-wide text-apagado">
              {grupo.titulo}
            </p>
            <ul className="divide-y divide-borde/60">
              {grupo.cargos.map((cargo) => (
                <li
                  key={`${cargo.subscription_id}-${cargo.fecha}`}
                  className="flex items-center gap-3 px-5 py-3"
                >
                  <span className="cifras w-14 shrink-0 text-xs text-apagado">
                    {formatearFecha(cargo.fecha).replace(/ \d{4}$/, '')}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {cargo.nombre}
                  </span>
                  <span className="cifras shrink-0 text-sm text-tenue">
                    -
                    {formatearImporte(
                      cargo.amount_minor,
                      cuenta.currency,
                      cuenta.exponente,
                      { conSimbolo: false },
                    )}
                  </span>
                  <span className="cifras w-20 shrink-0 text-right text-sm font-medium">
                    {formatearImporte(
                      cargo.saldo_restante_minor,
                      cuenta.currency,
                      cuenta.exponente,
                      { conSimbolo: false },
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>

      {/* El cargo que rompe la cuenta: donde se acaba de verdad el saldo. */}
      {primeraPerdida && (
        <div className="border-t-2 border-dashed border-rojo/40 bg-rojo/5 px-5 py-4">
          <p className="cifras text-xs text-rojo">
            {formatearFecha(primeraPerdida.fecha_perdida_prevista)}
          </p>
          <p className="mt-1 text-sm text-texto">
            No habra saldo para el cobro de{' '}
            <span className="font-medium">{primeraPerdida.nombre}</span> (
            <span className="cifras">
              {formatearImporte(
                primeraPerdida.amount_minor,
                cuenta.currency,
                cuenta.exponente,
              )}
            </span>
            ). A partir de aqui se pierde.
          </p>
        </div>
      )}
    </section>
  )
}
