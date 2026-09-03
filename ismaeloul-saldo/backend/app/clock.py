"""Unico punto del backend que consulta el reloj real.

La logica de negocio (motor de proyeccion, materializador, metricas) recibe
"hoy" siempre por parametro, para poder congelarlo en los tests.
"""

from __future__ import annotations

from datetime import date, datetime
from zoneinfo import ZoneInfo

from .config import TIMEZONE


def ahora() -> datetime:
    return datetime.now(ZoneInfo(TIMEZONE))


def hoy() -> date:
    return ahora().date()
