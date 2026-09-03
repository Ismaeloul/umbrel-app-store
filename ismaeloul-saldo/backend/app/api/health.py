"""Sonda de vida. La usan el healthcheck de Compose y el curl de despliegue."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..clock import hoy
from ..config import TIMEZONE
from ..db import dependencia_sesion
from ..models import CLAVE_ULTIMA_MATERIALIZACION, AppState

router = APIRouter(tags=["health"])


@router.get("/health")
def health(session: Session = Depends(dependencia_sesion)) -> dict:
    ultima = session.scalar(
        select(AppState.valor).where(
            AppState.clave == CLAVE_ULTIMA_MATERIALIZACION
        )
    )
    return {
        "estado": "ok",
        "hoy": hoy().isoformat(),
        "zona_horaria": TIMEZONE,
        "ultima_materializacion": ultima,
    }
