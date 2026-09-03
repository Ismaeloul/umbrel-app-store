"""Modelos Pydantic de entrada y salida.

Convencion de dinero en la API: los importes VIAJAN como enteros en la unidad
menor (`*_minor`) y siempre acompanados de la divisa de la cuenta y su
exponente. Los importes que ESCRIBE el usuario entran como texto y los parsea
el backend con la tabla de exponentes, para que el cliente no tenga que
adivinar cuantos decimales admite cada divisa.
"""

from __future__ import annotations

from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .models import CICLOS


class Base(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# --- Metadatos ------------------------------------------------------------


class DivisaOut(Base):
    codigo: str
    exponente: int
    simbolo: str


# --- Cuentas --------------------------------------------------------------


class CuentaCrear(BaseModel):
    email: str = Field(min_length=1, max_length=320)
    region: str = Field(min_length=2, max_length=2)
    currency: str = Field(min_length=3, max_length=3)
    # Texto porque los decimales dependen de la divisa. Lo parsea el backend.
    saldo_inicial: str = "0"
    notas: str = ""

    @field_validator("email", "notas")
    @classmethod
    def sin_espacios_sobrantes(cls, v: str) -> str:
        return v.strip()

    @field_validator("region")
    @classmethod
    def region_en_mayusculas(cls, v: str) -> str:
        codigo = v.strip().upper()
        if not codigo.isalpha():
            raise ValueError("La region es un codigo de pais de dos letras")
        return codigo


class CuentaEditar(BaseModel):
    email: str | None = Field(default=None, min_length=1, max_length=320)
    region: str | None = Field(default=None, min_length=2, max_length=2)
    notas: str | None = None
    # La divisa es fija: si llega, se rechaza explicitamente.
    currency: str | None = None

    @field_validator("region")
    @classmethod
    def region_en_mayusculas(cls, v: str | None) -> str | None:
        return v.strip().upper() if v else v


class NotasEditar(BaseModel):
    notas: str


class CuentaOut(Base):
    id: int
    email: str
    region: str
    currency: str
    exponente: int
    balance_minor: int
    balance_updated_on: date
    notas: str
    activa: bool


# --- Suscripciones --------------------------------------------------------


class SuscripcionCrear(BaseModel):
    nombre: str = Field(min_length=1, max_length=200)
    ciclo: str
    # Uno de los dos es obligatorio. Con fin_prueba, el primer cobro real cae
    # ese dia y de ahi salen los anclajes.
    proximo_cobro: date | None = None
    fin_prueba: date | None = None
    precio: str
    divisa: str | None = None

    @field_validator("ciclo")
    @classmethod
    def ciclo_conocido(cls, v: str) -> str:
        if v not in CICLOS:
            raise ValueError(f"El ciclo debe ser uno de: {', '.join(CICLOS)}")
        return v

    @property
    def primera_fecha(self) -> date | None:
        return self.fin_prueba or self.proximo_cobro


class SuscripcionEditar(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=200)
    ciclo: str | None = None
    proximo_cobro: date | None = None
    fin_prueba: date | None = None

    @field_validator("ciclo")
    @classmethod
    def ciclo_conocido(cls, v: str | None) -> str | None:
        if v is not None and v not in CICLOS:
            raise ValueError(f"El ciclo debe ser uno de: {', '.join(CICLOS)}")
        return v


class PrecioCambiar(BaseModel):
    precio: str
    vigente_desde: date | None = None
    divisa: str | None = None


class Reactivar(BaseModel):
    proximo_cobro: date


class PrecioOut(Base):
    amount_minor: int
    vigente_desde: date


class SuscripcionOut(Base):
    id: int
    account_id: int
    nombre: str
    ciclo: str
    proximo_cobro: date
    anchor_dia: int
    anchor_mes: int | None
    fin_prueba: date | None
    estado: str
    cancelada_en: date | None
    perdida_en: date | None
    precio_actual_minor: int
    en_prueba: bool
    precios: list[PrecioOut]


# --- Movimientos ----------------------------------------------------------


class RecargaCrear(BaseModel):
    importe: str
    fecha: date
    concepto: str = "Recarga"
    divisa: str | None = None


class ReconciliacionCrear(BaseModel):
    saldo_real: str
    fecha: date
    # Obligatorio: un ajuste sin motivo escrito es un agujero en el historial.
    concepto: str = Field(min_length=1, max_length=300)
    divisa: str | None = None


class TransaccionOut(Base):
    id: int
    account_id: int
    fecha: date
    tipo: str
    amount_minor: int
    concepto: str
    subscription_id: int | None


class ReconciliacionOut(BaseModel):
    ajuste_minor: int
    saldo_anterior_minor: int
    saldo_minor: int
    transaccion: TransaccionOut | None


# --- Proyeccion y metricas ------------------------------------------------


class CargoProyectadoOut(BaseModel):
    fecha: date
    subscription_id: int
    nombre: str
    amount_minor: int
    saldo_restante_minor: int


class PruebaProximaOut(BaseModel):
    subscription_id: int
    nombre: str
    fecha: date
    amount_minor: int
    saldo_alcanza: bool


class EnRiesgoOut(BaseModel):
    subscription_id: int
    nombre: str
    fecha_perdida_prevista: date
    amount_minor: int


class MetricasOut(BaseModel):
    fecha_agotamiento: date | None
    meses_restantes: int | None
    dias_restantes: int | None
    fecha_recarga: date | None
    estado_recarga: str
    proxima_prueba: PruebaProximaOut | None
    en_riesgo: list[EnRiesgoOut]


class CuentaResumenOut(BaseModel):
    """Lo que necesita una tarjeta del panel principal."""

    cuenta: CuentaOut
    metricas: MetricasOut
    suscripciones_activas: int


class CuentaDetalleOut(BaseModel):
    cuenta: CuentaOut
    metricas: MetricasOut
    suscripciones: list[SuscripcionOut]
    proyeccion: list[CargoProyectadoOut]
    transacciones: list[TransaccionOut]
    hoy: date
    horizonte_meses: int
