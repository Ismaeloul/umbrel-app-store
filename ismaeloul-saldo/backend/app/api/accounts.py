"""Cuentas: alta, edicion, archivado, notas, recargas y reconciliacion."""

from __future__ import annotations

import logging
from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import dependencia_sesion
from ..deps import cuenta_de_la_ruta, dependencia_hoy
from ..errors import error_campo, exigir_misma_divisa, parsear_importe, validar_divisa
from ..models import Account, Transaction
from ..presenter import (
    cuenta_out,
    detalle_out,
    orden_del_panel,
    resumen_out,
    transacciones_de,
)
from ..schemas import (
    CuentaCrear,
    CuentaDetalleOut,
    CuentaEditar,
    CuentaOut,
    CuentaResumenOut,
    NotasEditar,
    ReconciliacionCrear,
    ReconciliacionOut,
    RecargaCrear,
    TransaccionOut,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/accounts", tags=["cuentas"])


@router.get("", response_model=list[CuentaResumenOut])
def listar_cuentas(
    incluir_archivadas: bool = Query(default=False),
    session: Session = Depends(dependencia_sesion),
    hoy: date = Depends(dependencia_hoy),
) -> list[CuentaResumenOut]:
    consulta = select(Account).order_by(Account.id)
    if not incluir_archivadas:
        consulta = consulta.where(Account.activa.is_(True))

    resumenes = [
        resumen_out(session, cuenta, hoy) for cuenta in session.scalars(consulta)
    ]
    # El panel principal ensena primero lo que antes se queda sin saldo.
    resumenes.sort(key=orden_del_panel)
    return resumenes


@router.post("", response_model=CuentaOut, status_code=201)
def crear_cuenta(
    datos: CuentaCrear,
    session: Session = Depends(dependencia_sesion),
    hoy: date = Depends(dependencia_hoy),
) -> CuentaOut:
    divisa = validar_divisa(datos.currency)
    saldo = parsear_importe(datos.saldo_inicial, divisa, "saldo_inicial")
    if saldo < 0:
        raise error_campo("saldo_inicial", "El saldo no puede ser negativo")

    cuenta = Account(
        email=datos.email,
        region=datos.region,
        currency=divisa,
        balance_minor=saldo,
        balance_updated_on=hoy,
        notas=datos.notas,
        activa=True,
    )
    session.add(cuenta)
    session.flush()

    if saldo > 0:
        # Para que el historial cuadre con el saldo desde el primer dia.
        session.add(
            Transaction(
                account_id=cuenta.id,
                fecha=hoy,
                tipo="recarga",
                amount_minor=saldo,
                concepto="Saldo inicial",
            )
        )

    log.info(
        "cuenta creada",
        extra={"account_id": cuenta.id, "email": cuenta.email, "divisa": divisa},
    )
    return cuenta_out(cuenta)


@router.get("/{account_id}", response_model=CuentaDetalleOut)
def detalle_cuenta(
    cuenta: Account = Depends(cuenta_de_la_ruta),
    session: Session = Depends(dependencia_sesion),
    hoy: date = Depends(dependencia_hoy),
) -> CuentaDetalleOut:
    return detalle_out(session, cuenta, hoy)


@router.patch("/{account_id}", response_model=CuentaOut)
def editar_cuenta(
    datos: CuentaEditar,
    cuenta: Account = Depends(cuenta_de_la_ruta),
) -> CuentaOut:
    if datos.currency is not None and validar_divisa(datos.currency) != cuenta.currency:
        raise error_campo(
            "currency",
            "La divisa de una cuenta no se puede cambiar despues de crearla",
            "divisa_inmutable",
        )

    if datos.email is not None:
        cuenta.email = datos.email.strip()
    if datos.region is not None:
        cuenta.region = datos.region
    if datos.notas is not None:
        cuenta.notas = datos.notas
    return cuenta_out(cuenta)


@router.put("/{account_id}/notas", response_model=CuentaOut)
def guardar_notas(
    datos: NotasEditar,
    cuenta: Account = Depends(cuenta_de_la_ruta),
) -> CuentaOut:
    """Endpoint propio del guardado automatico del panel de notas."""
    cuenta.notas = datos.notas
    return cuenta_out(cuenta)


@router.post("/{account_id}/archivar", response_model=CuentaOut)
def archivar_cuenta(cuenta: Account = Depends(cuenta_de_la_ruta)) -> CuentaOut:
    """Archivado logico: no se borra ninguna fila, nunca."""
    cuenta.activa = False
    log.info("cuenta archivada", extra={"account_id": cuenta.id})
    return cuenta_out(cuenta)


@router.post("/{account_id}/desarchivar", response_model=CuentaOut)
def desarchivar_cuenta(cuenta: Account = Depends(cuenta_de_la_ruta)) -> CuentaOut:
    cuenta.activa = True
    return cuenta_out(cuenta)


@router.get("/{account_id}/transacciones", response_model=list[TransaccionOut])
def listar_transacciones(
    cuenta: Account = Depends(cuenta_de_la_ruta),
    session: Session = Depends(dependencia_sesion),
) -> list[TransaccionOut]:
    return [
        TransaccionOut.model_validate(t) for t in transacciones_de(session, cuenta.id)
    ]


@router.post("/{account_id}/recargas", response_model=TransaccionOut, status_code=201)
def registrar_recarga(
    datos: RecargaCrear,
    cuenta: Account = Depends(cuenta_de_la_ruta),
    session: Session = Depends(dependencia_sesion),
) -> TransaccionOut:
    exigir_misma_divisa(datos.divisa, cuenta.currency)
    importe = parsear_importe(datos.importe, cuenta.currency, "importe")
    if importe <= 0:
        raise error_campo("importe", "La recarga tiene que ser mayor que cero")

    movimiento = Transaction(
        account_id=cuenta.id,
        fecha=datos.fecha,
        tipo="recarga",
        amount_minor=importe,
        concepto=datos.concepto.strip() or "Recarga",
    )
    session.add(movimiento)
    cuenta.balance_minor += importe
    cuenta.balance_updated_on = datos.fecha
    session.flush()

    log.info(
        "recarga registrada",
        extra={
            "account_id": cuenta.id,
            "importe_minor": importe,
            "saldo_minor": cuenta.balance_minor,
            "divisa": cuenta.currency,
        },
    )
    return TransaccionOut.model_validate(movimiento)


@router.post("/{account_id}/reconciliaciones", response_model=ReconciliacionOut)
def reconciliar(
    datos: ReconciliacionCrear,
    cuenta: Account = Depends(cuenta_de_la_ruta),
    session: Session = Depends(dependencia_sesion),
) -> ReconciliacionOut:
    """Cuadra el saldo de la app con el que se ve de verdad en la tienda."""
    exigir_misma_divisa(datos.divisa, cuenta.currency)
    saldo_real = parsear_importe(datos.saldo_real, cuenta.currency, "saldo_real")
    if saldo_real < 0:
        raise error_campo("saldo_real", "El saldo no puede ser negativo")

    saldo_anterior = cuenta.balance_minor
    diferencia = saldo_real - saldo_anterior

    movimiento = None
    if diferencia != 0:
        movimiento = Transaction(
            account_id=cuenta.id,
            fecha=datos.fecha,
            tipo="ajuste",
            amount_minor=diferencia,
            concepto=datos.concepto.strip(),
        )
        session.add(movimiento)
        cuenta.balance_minor = saldo_real
        cuenta.balance_updated_on = datos.fecha
        session.flush()

    log.info(
        "reconciliacion",
        extra={
            "account_id": cuenta.id,
            "saldo_anterior_minor": saldo_anterior,
            "saldo_minor": cuenta.balance_minor,
            "ajuste_minor": diferencia,
            "divisa": cuenta.currency,
        },
    )
    return ReconciliacionOut(
        ajuste_minor=diferencia,
        saldo_anterior_minor=saldo_anterior,
        saldo_minor=cuenta.balance_minor,
        transaccion=(
            TransaccionOut.model_validate(movimiento) if movimiento else None
        ),
    )
