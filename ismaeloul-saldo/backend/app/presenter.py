"""Traduccion de filas y metricas a los modelos de salida de la API."""

from __future__ import annotations

from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import HORIZONTE_MESES
from .mapping import a_proyectable, suscripciones_de
from .metrics import Metricas, calcular_metricas
from .models import Account, Subscription, Transaction
from .money import exponente
from .schemas import (
    CargoProyectadoOut,
    CuentaDetalleOut,
    CuentaOut,
    CuentaResumenOut,
    EnRiesgoOut,
    MetricasOut,
    PrecioOut,
    PruebaProximaOut,
    SuscripcionOut,
    TransaccionOut,
)


def cuenta_out(cuenta: Account) -> CuentaOut:
    return CuentaOut(
        id=cuenta.id,
        email=cuenta.email,
        region=cuenta.region,
        currency=cuenta.currency,
        exponente=exponente(cuenta.currency),
        balance_minor=cuenta.balance_minor,
        balance_updated_on=cuenta.balance_updated_on,
        notas=cuenta.notas,
        activa=cuenta.activa,
    )


def suscripcion_out(sub: Subscription, hoy: date) -> SuscripcionOut:
    proyectable = a_proyectable(sub)
    return SuscripcionOut(
        id=sub.id,
        account_id=sub.account_id,
        nombre=sub.nombre,
        ciclo=sub.ciclo,
        proximo_cobro=sub.proximo_cobro,
        anchor_dia=sub.anchor_dia,
        anchor_mes=sub.anchor_mes,
        fin_prueba=sub.fin_prueba,
        estado=sub.estado,
        cancelada_en=sub.cancelada_en,
        perdida_en=sub.perdida_en,
        precio_actual_minor=proyectable.precio_en(hoy),
        # En prueba mientras no haya llegado el dia del primer cobro real.
        en_prueba=(
            sub.estado == "activa"
            and sub.fin_prueba is not None
            and sub.fin_prueba >= hoy
        ),
        precios=[
            PrecioOut(amount_minor=p.amount_minor, vigente_desde=p.vigente_desde)
            for p in sorted(sub.precios, key=lambda p: p.vigente_desde)
        ],
    )


def metricas_out(m: Metricas) -> MetricasOut:
    return MetricasOut(
        fecha_agotamiento=m.fecha_agotamiento,
        meses_restantes=m.meses_restantes,
        dias_restantes=m.dias_restantes,
        fecha_recarga=m.fecha_recarga,
        estado_recarga=m.estado_recarga,
        proxima_prueba=(
            PruebaProximaOut(
                subscription_id=m.proxima_prueba.subscription_id,
                nombre=m.proxima_prueba.nombre,
                fecha=m.proxima_prueba.fecha,
                amount_minor=m.proxima_prueba.amount_minor,
                saldo_alcanza=m.proxima_prueba.saldo_alcanza,
            )
            if m.proxima_prueba
            else None
        ),
        en_riesgo=[
            EnRiesgoOut(
                subscription_id=r.subscription_id,
                nombre=r.nombre,
                fecha_perdida_prevista=r.fecha_perdida_prevista,
                amount_minor=r.amount_minor,
            )
            for r in m.en_riesgo
        ],
    )


def metricas_de(
    session: Session,
    cuenta: Account,
    hoy: date,
    horizonte_meses: int = HORIZONTE_MESES,
) -> Metricas:
    proyectables = [a_proyectable(sub) for sub in suscripciones_de(session, cuenta.id)]
    return calcular_metricas(
        hoy, cuenta.balance_minor, proyectables, horizonte_meses
    )


def transacciones_de(session: Session, account_id: int) -> list[Transaction]:
    """Historial de una cuenta, lo mas reciente primero."""
    return list(
        session.scalars(
            select(Transaction)
            .where(Transaction.account_id == account_id)
            .order_by(Transaction.fecha.desc(), Transaction.id.desc())
        )
    )


def resumen_out(
    session: Session, cuenta: Account, hoy: date, horizonte_meses: int = HORIZONTE_MESES
) -> CuentaResumenOut:
    suscripciones = suscripciones_de(session, cuenta.id)
    metricas = calcular_metricas(
        hoy,
        cuenta.balance_minor,
        [a_proyectable(sub) for sub in suscripciones],
        horizonte_meses,
    )
    return CuentaResumenOut(
        cuenta=cuenta_out(cuenta),
        metricas=metricas_out(metricas),
        suscripciones_activas=sum(1 for s in suscripciones if s.estado == "activa"),
    )


def detalle_out(
    session: Session, cuenta: Account, hoy: date, horizonte_meses: int = HORIZONTE_MESES
) -> CuentaDetalleOut:
    suscripciones = suscripciones_de(session, cuenta.id)
    metricas = calcular_metricas(
        hoy,
        cuenta.balance_minor,
        [a_proyectable(sub) for sub in suscripciones],
        horizonte_meses,
    )
    return CuentaDetalleOut(
        cuenta=cuenta_out(cuenta),
        metricas=metricas_out(metricas),
        suscripciones=[suscripcion_out(sub, hoy) for sub in suscripciones],
        proyeccion=[
            CargoProyectadoOut(
                fecha=c.fecha,
                subscription_id=c.subscription_id,
                nombre=c.nombre,
                amount_minor=c.amount_minor,
                saldo_restante_minor=c.saldo_restante_minor,
            )
            for c in metricas.proyeccion.cargos
        ],
        transacciones=[
            TransaccionOut.model_validate(t)
            for t in transacciones_de(session, cuenta.id)
        ],
        hoy=hoy,
        horizonte_meses=horizonte_meses,
    )


def orden_del_panel(resumen: CuentaResumenOut) -> tuple[int, int]:
    """Menor tiempo restante primero; las que no se agotan, al final."""
    dias = resumen.metricas.dias_restantes
    return (1, 0) if dias is None else (0, dias)
