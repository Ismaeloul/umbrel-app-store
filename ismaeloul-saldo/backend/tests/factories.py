"""Ayudas para construir escenarios de prueba sin repetir boilerplate."""

from __future__ import annotations

from datetime import date

from sqlalchemy.orm import Session

from app.dates import derivar_anchors
from app.models import Account, Subscription, SubscriptionPrice
from app.projection import Precio, SuscripcionProyectable

# Fecha muy anterior a cualquier escenario: el precio "de siempre".
DESDE_SIEMPRE = date(2000, 1, 1)


def suscripcion(
    id: int,
    proximo_cobro: date,
    *,
    nombre: str | None = None,
    ciclo: str = "mensual",
    precio: int = 1000,
    precios: tuple[Precio, ...] | None = None,
    fin_prueba: date | None = None,
    estado: str = "activa",
    anchor_dia: int | None = None,
    anchor_mes: int | None = None,
) -> SuscripcionProyectable:
    """Suscripcion para el motor de proyeccion, sin tocar la base de datos."""
    derivado_dia, derivado_mes = derivar_anchors(proximo_cobro, ciclo)
    return SuscripcionProyectable(
        id=id,
        nombre=nombre or f"Suscripcion {id}",
        ciclo=ciclo,
        proximo_cobro=proximo_cobro,
        anchor_dia=anchor_dia if anchor_dia is not None else derivado_dia,
        anchor_mes=anchor_mes if anchor_mes is not None else derivado_mes,
        precios=precios if precios is not None else (Precio(precio, DESDE_SIEMPRE),),
        fin_prueba=fin_prueba,
        estado=estado,
    )


# --- Fabricas contra la base de datos -------------------------------------


def crear_cuenta(
    session: Session,
    *,
    email: str = "cuenta@ejemplo.es",
    region: str = "ES",
    currency: str = "EUR",
    saldo_minor: int = 0,
    balance_updated_on: date = date(2026, 1, 1),
    notas: str = "",
    activa: bool = True,
) -> Account:
    cuenta = Account(
        email=email,
        region=region,
        currency=currency,
        balance_minor=saldo_minor,
        balance_updated_on=balance_updated_on,
        notas=notas,
        activa=activa,
    )
    session.add(cuenta)
    session.commit()
    return cuenta


def crear_suscripcion(
    session: Session,
    cuenta: Account,
    proximo_cobro: date,
    *,
    nombre: str = "Suscripcion",
    ciclo: str = "mensual",
    precio: int = 1000,
    vigente_desde: date = DESDE_SIEMPRE,
    fin_prueba: date | None = None,
    estado: str = "activa",
) -> Subscription:
    anchor_dia, anchor_mes = derivar_anchors(proximo_cobro, ciclo)
    sub = Subscription(
        account_id=cuenta.id,
        nombre=nombre,
        ciclo=ciclo,
        proximo_cobro=proximo_cobro,
        anchor_dia=anchor_dia,
        anchor_mes=anchor_mes,
        fin_prueba=fin_prueba,
        estado=estado,
    )
    session.add(sub)
    session.flush()
    session.add(
        SubscriptionPrice(
            subscription_id=sub.id,
            amount_minor=precio,
            vigente_desde=vigente_desde,
        )
    )
    session.commit()
    return sub
