// Cliente HTTP de la app.
//
// TODAS las rutas son relativas a /api. Ni un host, ni un puerto, ni un
// "localhost": el frontend y la API salen por el mismo origen, asi que esto
// funciona igual en desarrollo, en el contenedor y detras del proxy de Umbrel.

import type {
  Cuenta,
  CuentaDetalle,
  CuentaNueva,
  CuentaResumen,
  Divisa,
  Reconciliacion,
  Suscripcion,
  SuscripcionNueva,
  Transaccion,
} from './tipos'

const BASE = '/api'

/** Error de validacion: trae el mensaje pegado al campo que lo provoca. */
export class ErrorDeValidacion extends Error {
  readonly campos: Record<string, string>

  constructor(campos: Record<string, string>) {
    super(Object.values(campos)[0] ?? 'Hay algun dato mal')
    this.name = 'ErrorDeValidacion'
    this.campos = campos
  }
}

export class ErrorDeApi extends Error {
  readonly estado: number

  constructor(estado: number, mensaje: string) {
    super(mensaje)
    this.name = 'ErrorDeApi'
    this.estado = estado
  }
}

interface DetalleValidacion {
  loc: (string | number)[]
  msg: string
  type?: string
}

function camposDeError(detalle: DetalleValidacion[]): Record<string, string> {
  const campos: Record<string, string> = {}
  for (const item of detalle) {
    // El ultimo tramo de `loc` que sea texto es el nombre del campo.
    const nombre = [...item.loc].reverse().find((t) => typeof t === 'string')
    campos[String(nombre ?? 'general')] = item.msg
  }
  return campos
}

async function peticion<T>(ruta: string, opciones: RequestInit = {}): Promise<T> {
  let respuesta: Response
  try {
    respuesta = await fetch(`${BASE}${ruta}`, {
      headers: opciones.body ? { 'Content-Type': 'application/json' } : undefined,
      ...opciones,
    })
  } catch {
    throw new ErrorDeApi(0, 'No se puede hablar con el servidor')
  }

  if (respuesta.status === 204) return undefined as T

  const cuerpo = await respuesta.json().catch(() => null)

  if (respuesta.ok) return cuerpo as T

  if (respuesta.status === 422 && Array.isArray(cuerpo?.detail)) {
    throw new ErrorDeValidacion(camposDeError(cuerpo.detail))
  }
  const mensaje =
    typeof cuerpo?.detail === 'string' ? cuerpo.detail : 'Algo ha ido mal'
  throw new ErrorDeApi(respuesta.status, mensaje)
}

const json = (datos: unknown): RequestInit => ({ body: JSON.stringify(datos) })

export const api = {
  divisas: () => peticion<Divisa[]>('/divisas'),

  listarCuentas: (incluirArchivadas = false) =>
    peticion<CuentaResumen[]>(
      `/accounts${incluirArchivadas ? '?incluir_archivadas=true' : ''}`,
    ),

  crearCuenta: (datos: CuentaNueva) =>
    peticion<Cuenta>('/accounts', { method: 'POST', ...json(datos) }),

  verCuenta: (id: number) => peticion<CuentaDetalle>(`/accounts/${id}`),

  editarCuenta: (id: number, datos: Partial<CuentaNueva>) =>
    peticion<Cuenta>(`/accounts/${id}`, { method: 'PATCH', ...json(datos) }),

  guardarNotas: (id: number, notas: string) =>
    peticion<Cuenta>(`/accounts/${id}/notas`, { method: 'PUT', ...json({ notas }) }),

  archivarCuenta: (id: number) =>
    peticion<Cuenta>(`/accounts/${id}/archivar`, { method: 'POST' }),

  desarchivarCuenta: (id: number) =>
    peticion<Cuenta>(`/accounts/${id}/desarchivar`, { method: 'POST' }),

  recargar: (id: number, datos: { importe: string; fecha: string; concepto: string }) =>
    peticion<Transaccion>(`/accounts/${id}/recargas`, {
      method: 'POST',
      ...json(datos),
    }),

  reconciliar: (
    id: number,
    datos: { saldo_real: string; fecha: string; concepto: string },
  ) =>
    peticion<Reconciliacion>(`/accounts/${id}/reconciliaciones`, {
      method: 'POST',
      ...json(datos),
    }),

  crearSuscripcion: (cuentaId: number, datos: SuscripcionNueva) =>
    peticion<Suscripcion>(`/accounts/${cuentaId}/subscriptions`, {
      method: 'POST',
      ...json(datos),
    }),

  editarSuscripcion: (id: number, datos: Partial<SuscripcionNueva>) =>
    peticion<Suscripcion>(`/subscriptions/${id}`, { method: 'PATCH', ...json(datos) }),

  cambiarPrecio: (id: number, datos: { precio: string; vigente_desde?: string }) =>
    peticion<Suscripcion>(`/subscriptions/${id}/precio`, {
      method: 'POST',
      ...json(datos),
    }),

  cancelarSuscripcion: (id: number) =>
    peticion<Suscripcion>(`/subscriptions/${id}/cancelar`, { method: 'POST' }),

  reactivarSuscripcion: (id: number, proximo_cobro: string) =>
    peticion<Suscripcion>(`/subscriptions/${id}/reactivar`, {
      method: 'POST',
      ...json({ proximo_cobro }),
    }),
}
