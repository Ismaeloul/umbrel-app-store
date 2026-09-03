// Espejo en TypeScript de los modelos de salida del backend.
//
// Los importes viajan SIEMPRE como enteros en la unidad menor (`*_minor`)
// acompanados de la divisa de la cuenta y su exponente. Aqui no se divide
// entre 100 en ningun sitio.

export type Ciclo = 'mensual' | 'anual'
export type EstadoSuscripcion = 'activa' | 'cancelada' | 'perdida'
export type TipoTransaccion = 'recarga' | 'cargo' | 'ajuste'
export type EstadoRecarga = 'recarga_ya' | 'programada' | 'sin_urgencia'

export interface Divisa {
  codigo: string
  exponente: number
  simbolo: string
}

export interface Cuenta {
  id: number
  email: string
  region: string
  currency: string
  exponente: number
  balance_minor: number
  balance_updated_on: string
  notas: string
  activa: boolean
}

export interface Precio {
  amount_minor: number
  vigente_desde: string
}

export interface Suscripcion {
  id: number
  account_id: number
  nombre: string
  ciclo: Ciclo
  proximo_cobro: string
  anchor_dia: number
  anchor_mes: number | null
  fin_prueba: string | null
  estado: EstadoSuscripcion
  cancelada_en: string | null
  perdida_en: string | null
  precio_actual_minor: number
  en_prueba: boolean
  precios: Precio[]
}

export interface Transaccion {
  id: number
  account_id: number
  fecha: string
  tipo: TipoTransaccion
  amount_minor: number
  concepto: string
  subscription_id: number | null
}

export interface CargoProyectado {
  fecha: string
  subscription_id: number
  nombre: string
  amount_minor: number
  saldo_restante_minor: number
}

export interface PruebaProxima {
  subscription_id: number
  nombre: string
  fecha: string
  amount_minor: number
  saldo_alcanza: boolean
}

export interface EnRiesgo {
  subscription_id: number
  nombre: string
  fecha_perdida_prevista: string
  amount_minor: number
}

export interface Metricas {
  fecha_agotamiento: string | null
  meses_restantes: number | null
  dias_restantes: number | null
  fecha_recarga: string | null
  estado_recarga: EstadoRecarga
  proxima_prueba: PruebaProxima | null
  en_riesgo: EnRiesgo[]
}

export interface CuentaResumen {
  cuenta: Cuenta
  metricas: Metricas
  suscripciones_activas: number
}

export interface CuentaDetalle {
  cuenta: Cuenta
  metricas: Metricas
  suscripciones: Suscripcion[]
  proyeccion: CargoProyectado[]
  transacciones: Transaccion[]
  hoy: string
  horizonte_meses: number
}

export interface Reconciliacion {
  ajuste_minor: number
  saldo_anterior_minor: number
  saldo_minor: number
  transaccion: Transaccion | null
}

// --- Cuerpos de peticion --------------------------------------------------

export interface CuentaNueva {
  email: string
  region: string
  currency: string
  saldo_inicial: string
  notas: string
}

export interface SuscripcionNueva {
  nombre: string
  ciclo: Ciclo
  proximo_cobro?: string | null
  fin_prueba?: string | null
  precio: string
}
