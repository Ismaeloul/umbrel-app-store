"""Reglas de fechas de cobro, compartidas por el motor y el materializador.

El anclaje (anchor_dia, anchor_mes) se deriva de la primera fecha de cobro y no
se mueve. Es lo que evita la deriva: una mensual anclada al 31 cobra el 28 en
febrero, pero en marzo vuelve al 31, no se queda en el 28.
"""

from __future__ import annotations

import calendar
from datetime import date

CICLO_MENSUAL = "mensual"
CICLO_ANUAL = "anual"


class CicloInvalido(ValueError):
    pass


def ultimo_dia_del_mes(anio: int, mes: int) -> int:
    return calendar.monthrange(anio, mes)[1]


def dia_ajustado(anio: int, mes: int, dia_anchor: int) -> date:
    """El dia del anclaje en ese mes, recortado al ultimo dia si no existe."""
    return date(anio, mes, min(dia_anchor, ultimo_dia_del_mes(anio, mes)))


def derivar_anchors(fecha: date, ciclo: str) -> tuple[int, int | None]:
    """Anclaje que corresponde a la primera fecha de cobro introducida."""
    if ciclo == CICLO_MENSUAL:
        return fecha.day, None
    if ciclo == CICLO_ANUAL:
        return fecha.day, fecha.month
    raise CicloInvalido(f"Ciclo desconocido: {ciclo!r}")


def siguiente_cobro(
    fecha_actual: date, ciclo: str, anchor_dia: int, anchor_mes: int | None
) -> date:
    """Fecha del cobro siguiente al de `fecha_actual`, sin arrastrar ajustes."""
    if ciclo == CICLO_MENSUAL:
        anio, mes = fecha_actual.year, fecha_actual.month + 1
        if mes == 13:
            anio, mes = anio + 1, 1
        return dia_ajustado(anio, mes, anchor_dia)

    if ciclo == CICLO_ANUAL:
        if anchor_mes is None:
            raise CicloInvalido("Un ciclo anual necesita anchor_mes")
        return dia_ajustado(fecha_actual.year + 1, anchor_mes, anchor_dia)

    raise CicloInvalido(f"Ciclo desconocido: {ciclo!r}")


def sumar_meses(fecha: date, meses: int) -> date:
    """Desplaza meses recortando el dia. Para horizontes y fecha de recarga.

    No sirve para avanzar un ciclo de cobro: eso es `siguiente_cobro`, que
    parte del anclaje y no del dia recortado.
    """
    total = fecha.year * 12 + (fecha.month - 1) + meses
    anio, mes = divmod(total, 12)
    return dia_ajustado(anio, mes + 1, fecha.day)


def meses_completos(desde: date, hasta: date) -> int:
    """Meses enteros que caben entre dos fechas. Nunca negativo."""
    if hasta <= desde:
        return 0
    meses = (hasta.year - desde.year) * 12 + (hasta.month - desde.month)
    if hasta.day < desde.day:
        meses -= 1
    return max(meses, 0)
