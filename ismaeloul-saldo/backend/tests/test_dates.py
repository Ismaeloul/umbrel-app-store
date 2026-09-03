"""Reglas de fechas de cobro: anclajes, meses cortos y anos bisiestos."""

from __future__ import annotations

from datetime import date

import pytest

from app.dates import (
    CicloInvalido,
    derivar_anchors,
    dia_ajustado,
    meses_completos,
    siguiente_cobro,
    sumar_meses,
    ultimo_dia_del_mes,
)


def test_ultimo_dia_del_mes():
    assert ultimo_dia_del_mes(2026, 2) == 28
    assert ultimo_dia_del_mes(2028, 2) == 29
    assert ultimo_dia_del_mes(2026, 4) == 30
    assert ultimo_dia_del_mes(2026, 12) == 31


def test_dia_ajustado_recorta_al_ultimo_dia():
    assert dia_ajustado(2026, 2, 31) == date(2026, 2, 28)
    assert dia_ajustado(2028, 2, 31) == date(2028, 2, 29)
    assert dia_ajustado(2026, 4, 31) == date(2026, 4, 30)
    assert dia_ajustado(2026, 5, 31) == date(2026, 5, 31)


def test_derivar_anchors():
    assert derivar_anchors(date(2026, 3, 31), "mensual") == (31, None)
    assert derivar_anchors(date(2024, 2, 29), "anual") == (29, 2)
    with pytest.raises(CicloInvalido):
        derivar_anchors(date(2026, 1, 1), "semanal")


def test_mensual_con_anchor_31_no_arrastra_el_ajuste():
    """El caso que la app existe para no equivocar.

    Enero 31 -> febrero 28 (no existe el 31) -> marzo VUELVE al 31, no se
    queda pegado al 28. En abril baja al 30 y en mayo vuelve otra vez al 31.
    """
    anchor = 31
    fechas = [date(2026, 1, 31)]
    for _ in range(5):
        fechas.append(siguiente_cobro(fechas[-1], "mensual", anchor, None))

    assert fechas == [
        date(2026, 1, 31),
        date(2026, 2, 28),
        date(2026, 3, 31),
        date(2026, 4, 30),
        date(2026, 5, 31),
        date(2026, 6, 30),
    ]


def test_mensual_con_anchor_31_en_febrero_bisiesto():
    assert siguiente_cobro(date(2028, 1, 31), "mensual", 31, None) == date(2028, 2, 29)
    assert siguiente_cobro(date(2028, 2, 29), "mensual", 31, None) == date(2028, 3, 31)


def test_mensual_cambia_de_ano():
    assert siguiente_cobro(date(2026, 12, 15), "mensual", 15, None) == date(2027, 1, 15)


def test_anual_con_anchor_29_de_febrero_a_cuatro_anos():
    fechas = [date(2024, 2, 29)]
    for _ in range(4):
        fechas.append(siguiente_cobro(fechas[-1], "anual", 29, 2))

    assert fechas == [
        date(2024, 2, 29),
        date(2025, 2, 28),
        date(2026, 2, 28),
        date(2027, 2, 28),
        # Vuelve al 29 en cuanto el ano es bisiesto otra vez.
        date(2028, 2, 29),
    ]


def test_anual_sin_anchor_mes_es_un_error():
    with pytest.raises(CicloInvalido):
        siguiente_cobro(date(2026, 3, 1), "anual", 1, None)


def test_ciclo_desconocido_es_un_error():
    with pytest.raises(CicloInvalido):
        siguiente_cobro(date(2026, 3, 1), "trimestral", 1, None)


def test_sumar_meses_recorta_el_dia():
    assert sumar_meses(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert sumar_meses(date(2026, 3, 31), -1) == date(2026, 2, 28)
    assert sumar_meses(date(2026, 1, 15), 24) == date(2028, 1, 15)
    assert sumar_meses(date(2026, 1, 15), -1) == date(2025, 12, 15)


def test_meses_completos():
    assert meses_completos(date(2026, 1, 15), date(2026, 4, 15)) == 3
    assert meses_completos(date(2026, 1, 15), date(2026, 4, 14)) == 2
    assert meses_completos(date(2026, 1, 15), date(2026, 4, 20)) == 3
    assert meses_completos(date(2026, 1, 15), date(2026, 1, 15)) == 0
    # Nunca negativo aunque la fecha objetivo ya haya pasado.
    assert meses_completos(date(2026, 5, 1), date(2026, 1, 1)) == 0
