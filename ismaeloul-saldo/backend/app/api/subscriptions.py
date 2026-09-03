"""Suscripciones: alta, edicion, cambio de precio, cancelacion y reactivacion."""

from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ..dates import derivar_anchors
from ..db import dependencia_sesion
from ..deps import cuenta_de_la_ruta, dependencia_hoy, suscripcion_de_la_ruta
from ..errors import error_campo, exigir_misma_divisa, parsear_importe
from ..models import Account, Subscription, SubscriptionPrice
from ..operations import (
    OperacionInvalida,
    cancelar_suscripcion,
    reactivar_suscripcion,
)
from ..presenter import suscripcion_out
from ..schemas import (
    PrecioCambiar,
    Reactivar,
    SuscripcionCrear,
    SuscripcionEditar,
    SuscripcionOut,
)

log = logging.getLogger(__name__)

router = APIRouter(tags=["suscripciones"])


def _exigir_fecha_futura(fecha: date, hoy: date, campo: str) -> None:
    if fecha < hoy:
        raise error_campo(
            campo,
            "La fecha del proximo cobro tiene que ser hoy o posterior",
            "fecha_pasada",
        )


@router.post(
    "/accounts/{account_id}/subscriptions",
    response_model=SuscripcionOut,
    status_code=201,
)
def crear_suscripcion(
    datos: SuscripcionCrear,
    cuenta: Account = Depends(cuenta_de_la_ruta),
    session: Session = Depends(dependencia_sesion),
    hoy: date = Depends(dependencia_hoy),
) -> SuscripcionOut:
    exigir_misma_divisa(datos.divisa, cuenta.currency)

    # Con prueba gratuita, el primer cobro real cae el dia que termina, y de
    # esa fecha salen los anclajes.
    primera_fecha = datos.primera_fecha
    if primera_fecha is None:
        raise error_campo(
            "proximo_cobro",
            "Hace falta la fecha del proximo cobro (o la de fin de prueba)",
            "campo_requerido",
        )
    _exigir_fecha_futura(
        primera_fecha, hoy, "fin_prueba" if datos.fin_prueba else "proximo_cobro"
    )

    precio = parsear_importe(datos.precio, cuenta.currency, "precio")
    if precio <= 0:
        raise error_campo("precio", "El precio tiene que ser mayor que cero")

    anchor_dia, anchor_mes = derivar_anchors(primera_fecha, datos.ciclo)
    sub = Subscription(
        account_id=cuenta.id,
        nombre=datos.nombre.strip(),
        ciclo=datos.ciclo,
        proximo_cobro=primera_fecha,
        anchor_dia=anchor_dia,
        anchor_mes=anchor_mes,
        fin_prueba=datos.fin_prueba,
        estado="activa",
    )
    session.add(sub)
    session.flush()
    session.add(
        SubscriptionPrice(
            subscription_id=sub.id,
            amount_minor=precio,
            # Vigente desde hoy: cubre cualquier cobro futuro de esta alta.
            vigente_desde=hoy,
        )
    )
    session.flush()

    log.info(
        "suscripcion creada",
        extra={
            "account_id": cuenta.id,
            "subscription_id": sub.id,
            "suscripcion": sub.nombre,
            "ciclo": sub.ciclo,
            "proximo_cobro": sub.proximo_cobro.isoformat(),
            "precio_minor": precio,
        },
    )
    return suscripcion_out(sub, hoy)


@router.get("/subscriptions/{subscription_id}", response_model=SuscripcionOut)
def ver_suscripcion(
    sub: Subscription = Depends(suscripcion_de_la_ruta),
    hoy: date = Depends(dependencia_hoy),
) -> SuscripcionOut:
    return suscripcion_out(sub, hoy)


@router.patch("/subscriptions/{subscription_id}", response_model=SuscripcionOut)
def editar_suscripcion(
    datos: SuscripcionEditar,
    sub: Subscription = Depends(suscripcion_de_la_ruta),
    hoy: date = Depends(dependencia_hoy),
) -> SuscripcionOut:
    if datos.nombre is not None:
        sub.nombre = datos.nombre.strip()
    if datos.ciclo is not None:
        sub.ciclo = datos.ciclo
    if datos.fin_prueba is not None:
        sub.fin_prueba = datos.fin_prueba

    nueva_fecha = datos.fin_prueba or datos.proximo_cobro
    if nueva_fecha is not None:
        _exigir_fecha_futura(
            nueva_fecha, hoy, "fin_prueba" if datos.fin_prueba else "proximo_cobro"
        )
        sub.proximo_cobro = nueva_fecha

    # Mover la fecha a mano o cambiar de ciclo redefine el ancla: si no, el
    # siguiente cobro volveria al dia viejo.
    if nueva_fecha is not None or datos.ciclo is not None:
        sub.anchor_dia, sub.anchor_mes = derivar_anchors(sub.proximo_cobro, sub.ciclo)

    return suscripcion_out(sub, hoy)


@router.post("/subscriptions/{subscription_id}/precio", response_model=SuscripcionOut)
def cambiar_precio(
    datos: PrecioCambiar,
    sub: Subscription = Depends(suscripcion_de_la_ruta),
    session: Session = Depends(dependencia_sesion),
    hoy: date = Depends(dependencia_hoy),
) -> SuscripcionOut:
    """Cambiar de precio ANADE una fila al historico; no actualiza ninguna."""
    cuenta = session.get(Account, sub.account_id)
    assert cuenta is not None
    exigir_misma_divisa(datos.divisa, cuenta.currency)

    importe = parsear_importe(datos.precio, cuenta.currency, "precio")
    if importe <= 0:
        raise error_campo("precio", "El precio tiene que ser mayor que cero")

    desde = datos.vigente_desde or hoy
    ya_existe = next(
        (p for p in sub.precios if p.vigente_desde == desde), None
    )
    if ya_existe is not None:
        raise error_campo(
            "vigente_desde",
            "Ya hay un precio que entra en vigor ese mismo dia",
            "precio_duplicado",
        )

    session.add(
        SubscriptionPrice(
            subscription_id=sub.id, amount_minor=importe, vigente_desde=desde
        )
    )
    session.flush()
    session.refresh(sub)

    log.info(
        "precio cambiado",
        extra={
            "subscription_id": sub.id,
            "suscripcion": sub.nombre,
            "precio_minor": importe,
            "vigente_desde": desde.isoformat(),
        },
    )
    return suscripcion_out(sub, hoy)


@router.post("/subscriptions/{subscription_id}/cancelar", response_model=SuscripcionOut)
def cancelar(
    sub: Subscription = Depends(suscripcion_de_la_ruta),
    hoy: date = Depends(dependencia_hoy),
) -> SuscripcionOut:
    try:
        cancelar_suscripcion(sub, hoy)
    except OperacionInvalida as exc:
        raise error_campo("estado", str(exc), "estado_invalido") from exc
    return suscripcion_out(sub, hoy)


@router.post(
    "/subscriptions/{subscription_id}/reactivar", response_model=SuscripcionOut
)
def reactivar(
    datos: Reactivar,
    sub: Subscription = Depends(suscripcion_de_la_ruta),
    hoy: date = Depends(dependencia_hoy),
) -> SuscripcionOut:
    try:
        reactivar_suscripcion(sub, datos.proximo_cobro, hoy)
    except OperacionInvalida as exc:
        campo = "proximo_cobro" if "pasado" in str(exc) else "estado"
        raise error_campo(campo, str(exc), "estado_invalido") from exc

    log.info(
        "suscripcion reactivada",
        extra={
            "subscription_id": sub.id,
            "suscripcion": sub.nombre,
            "proximo_cobro": sub.proximo_cobro.isoformat(),
        },
    )
    return suscripcion_out(sub, hoy)
