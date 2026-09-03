"""Operaciones de dominio sobre suscripciones y cuentas.

Todo lo que cambia el estado de una suscripcion o el saldo de una cuenta pasa
por aqui, para que la API y los tests hagan exactamente lo mismo.
"""

from __future__ import annotations

from datetime import date

from .dates import derivar_anchors
from .models import Subscription


class OperacionInvalida(ValueError):
    """La operacion no se puede hacer con el estado actual de los datos."""


def reactivar_suscripcion(
    sub: Subscription, nuevo_proximo_cobro: date, hoy: date
) -> Subscription:
    """Devuelve una suscripcion perdida al ciclo normal.

    Los anclajes se derivan de la fecha nueva, como en un alta: si no, el
    ciclo volveria al dia antiguo y la fecha que acaba de introducir el
    usuario se perderia en el siguiente cobro.
    """
    if sub.estado != "perdida":
        raise OperacionInvalida(
            "Solo se pueden reactivar suscripciones perdidas"
        )
    if nuevo_proximo_cobro < hoy:
        raise OperacionInvalida(
            "La fecha del proximo cobro no puede estar en el pasado"
        )

    anchor_dia, anchor_mes = derivar_anchors(nuevo_proximo_cobro, sub.ciclo)
    sub.proximo_cobro = nuevo_proximo_cobro
    sub.anchor_dia = anchor_dia
    sub.anchor_mes = anchor_mes
    sub.estado = "activa"
    sub.perdida_en = None
    return sub


def cancelar_suscripcion(sub: Subscription, hoy: date) -> Subscription:
    if sub.estado == "cancelada":
        raise OperacionInvalida("La suscripcion ya estaba cancelada")
    sub.estado = "cancelada"
    sub.cancelada_en = hoy
    return sub
