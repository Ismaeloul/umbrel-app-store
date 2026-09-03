"""Puente entre las filas de la base y el motor de proyeccion.

Existe para que el materializador y el motor lean el precio EXACTAMENTE con
el mismo codigo. Si la regla de precios cambia, cambia en un solo sitio.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from .models import Subscription
from .projection import Precio, SuscripcionProyectable


def a_proyectable(sub: Subscription) -> SuscripcionProyectable:
    return SuscripcionProyectable(
        id=sub.id,
        nombre=sub.nombre,
        ciclo=sub.ciclo,
        proximo_cobro=sub.proximo_cobro,
        anchor_dia=sub.anchor_dia,
        anchor_mes=sub.anchor_mes,
        precios=tuple(
            Precio(amount_minor=p.amount_minor, vigente_desde=p.vigente_desde)
            for p in sub.precios
        ),
        fin_prueba=sub.fin_prueba,
        estado=sub.estado,
    )


def precio_en(sub: Subscription, fecha) -> int:
    """Precio vigente de una suscripcion en una fecha, segun el historico."""
    return a_proyectable(sub).precio_en(fecha)


def suscripciones_de(session: Session, account_id: int) -> list[Subscription]:
    """Todas las suscripciones de una cuenta, con sus precios ya cargados."""
    return list(
        session.scalars(
            select(Subscription)
            .where(Subscription.account_id == account_id)
            .options(selectinload(Subscription.precios))
            .order_by(Subscription.id)
        )
    )


def proyectables_de(session: Session, account_id: int) -> list[SuscripcionProyectable]:
    return [a_proyectable(sub) for sub in suscripciones_de(session, account_id)]
