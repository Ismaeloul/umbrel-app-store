"""Metricas derivadas de la proyeccion, por cuenta.

Lo importante aqui es como se cuenta el tiempo que queda: contra el PRIMER
cargo impagable, nunca dividiendo el saldo entre un gasto mensual medio. Una
anual que cae dentro de tres meses puede tumbar una cuenta que "de media"
aguantaria ocho.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from .dates import meses_completos, sumar_meses
from .projection import (
    ESTADOS_QUE_NO_PROYECTAN,
    Proyeccion,
    SuscripcionProyectable,
    proyectar,
)

RECARGA_YA = "recarga_ya"
RECARGA_PROGRAMADA = "programada"
SIN_URGENCIA = "sin_urgencia"


@dataclass(frozen=True)
class PruebaProxima:
    subscription_id: int
    nombre: str
    fecha: date
    amount_minor: int
    saldo_alcanza: bool


@dataclass(frozen=True)
class SuscripcionEnRiesgo:
    subscription_id: int
    nombre: str
    fecha_perdida_prevista: date
    amount_minor: int


@dataclass(frozen=True)
class Metricas:
    hoy: date
    saldo_minor: int
    fecha_agotamiento: date | None
    meses_restantes: int | None
    dias_restantes: int | None
    fecha_recarga: date | None
    estado_recarga: str
    proxima_prueba: PruebaProxima | None
    en_riesgo: tuple[SuscripcionEnRiesgo, ...]
    proyeccion: Proyeccion


def _prueba_mas_proxima(
    hoy: date,
    suscripciones: list[SuscripcionProyectable],
    proyeccion: Proyeccion,
) -> PruebaProxima | None:
    candidatas = [
        sub
        for sub in suscripciones
        if sub.estado not in ESTADOS_QUE_NO_PROYECTAN
        and sub.fin_prueba is not None
        and sub.fin_prueba >= hoy
    ]
    if not candidatas:
        return None

    sub = min(candidatas, key=lambda s: (s.fin_prueba, s.id))
    fecha = sub.fin_prueba
    assert fecha is not None
    # Alcanza si la simulacion llego a cobrarlo: si no aparece en los cargos
    # proyectados es que el saldo no daba y la prueba se pierde.
    return PruebaProxima(
        subscription_id=sub.id,
        nombre=sub.nombre,
        fecha=fecha,
        amount_minor=sub.precio_en(fecha),
        saldo_alcanza=proyeccion.cargo_de(sub.id, fecha) is not None,
    )


def calcular_metricas(
    hoy: date,
    saldo_minor: int,
    suscripciones: list[SuscripcionProyectable],
    horizonte_meses: int = 24,
) -> Metricas:
    proyeccion = proyectar(saldo_minor, hoy, suscripciones, horizonte_meses)

    fecha_agotamiento = (
        proyeccion.primer_impago.fecha if proyeccion.primer_impago else None
    )

    if fecha_agotamiento is None:
        meses_restantes = None
        dias_restantes = None
        fecha_recarga = None
        estado_recarga = SIN_URGENCIA
    else:
        meses_restantes = meses_completos(hoy, fecha_agotamiento)
        dias_restantes = (fecha_agotamiento - hoy).days
        candidata = sumar_meses(fecha_agotamiento, -1)
        if candidata <= hoy:
            # Ya vamos tarde: no tiene sentido ensenar una fecha pasada.
            fecha_recarga = None
            estado_recarga = RECARGA_YA
        else:
            fecha_recarga = candidata
            estado_recarga = RECARGA_PROGRAMADA

    por_id = {sub.id: sub for sub in suscripciones}
    en_riesgo = tuple(
        SuscripcionEnRiesgo(
            subscription_id=sub_id,
            nombre=por_id[sub_id].nombre,
            fecha_perdida_prevista=fecha,
            amount_minor=por_id[sub_id].precio_en(fecha),
        )
        for sub_id, fecha in sorted(
            proyeccion.perdidas_previstas.items(), key=lambda par: (par[1], par[0])
        )
    )

    return Metricas(
        hoy=hoy,
        saldo_minor=saldo_minor,
        fecha_agotamiento=fecha_agotamiento,
        meses_restantes=meses_restantes,
        dias_restantes=dias_restantes,
        fecha_recarga=fecha_recarga,
        estado_recarga=estado_recarga,
        proxima_prueba=_prueba_mas_proxima(hoy, suscripciones, proyeccion),
        en_riesgo=en_riesgo,
        proyeccion=proyeccion,
    )
