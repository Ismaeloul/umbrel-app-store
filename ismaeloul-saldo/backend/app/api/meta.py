"""Metadatos que el frontend necesita para no adivinar nada."""

from __future__ import annotations

from fastapi import APIRouter

from ..config import HORIZONTE_MESES
from ..money import divisas_conocidas
from ..schemas import DivisaOut

router = APIRouter(tags=["meta"])


@router.get("/divisas", response_model=list[DivisaOut])
def listar_divisas() -> list[DivisaOut]:
    """Divisas con su exponente ISO 4217, para formatear y validar en cliente."""
    return [DivisaOut(**d) for d in divisas_conocidas()]


@router.get("/config")
def configuracion() -> dict:
    return {"horizonte_meses": HORIZONTE_MESES}
