"""Dependencias compartidas por los routers."""

from __future__ import annotations

from datetime import date

from fastapi import Depends, HTTPException, Path
from sqlalchemy.orm import Session

from . import clock
from .db import dependencia_sesion
from .models import Account, Subscription


def dependencia_hoy() -> date:
    """El dia de hoy en Europe/Paris.

    Es una dependencia y no una llamada directa para que los tests puedan
    congelar la fecha con app.dependency_overrides.
    """
    return clock.hoy()


def cuenta_de_la_ruta(
    account_id: int = Path(..., ge=1),
    session: Session = Depends(dependencia_sesion),
) -> Account:
    cuenta = session.get(Account, account_id)
    if cuenta is None:
        raise HTTPException(status_code=404, detail="No existe esa cuenta")
    return cuenta


def suscripcion_de_la_ruta(
    subscription_id: int = Path(..., ge=1),
    session: Session = Depends(dependencia_sesion),
) -> Subscription:
    sub = session.get(Subscription, subscription_id)
    if sub is None:
        raise HTTPException(status_code=404, detail="No existe esa suscripcion")
    return sub
