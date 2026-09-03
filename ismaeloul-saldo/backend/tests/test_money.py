"""Formateo y parseo con divisas de 2, 0 y 3 decimales."""

from __future__ import annotations

import pytest

from app.money import (
    DivisaInvalida,
    ImporteInvalido,
    exponente,
    formatear,
    parsear,
)


def test_exponentes_por_divisa():
    assert exponente("EUR") == 2
    assert exponente("USD") == 2
    assert exponente("GBP") == 2
    assert exponente("JPY") == 0
    assert exponente("KRW") == 0
    assert exponente("KWD") == 3
    assert exponente("BHD") == 3
    # Una divisa que no esta en ninguna lista cae en el caso general.
    assert exponente("MAD") == 2


def test_divisa_mal_formada_se_rechaza():
    with pytest.raises(DivisaInvalida):
        exponente("EURO")
    with pytest.raises(DivisaInvalida):
        exponente("")


# --- EUR: dos decimales ---------------------------------------------------


def test_eur_formatea_con_convenciones_es_es():
    assert formatear(123456, "EUR") == "1.234,56 €"
    assert formatear(5, "EUR") == "0,05 €"
    assert formatear(0, "EUR") == "0,00 €"
    assert formatear(100000000, "EUR") == "1.000.000,00 €"
    assert formatear(-123456, "EUR") == "-1.234,56 €"
    assert formatear(123456, "EUR", con_simbolo=False) == "1.234,56"


def test_eur_parsea_lo_que_escribe_el_usuario():
    assert parsear("1.234,56", "EUR") == 123456
    assert parsear("1234,56", "EUR") == 123456
    assert parsear("12,5", "EUR") == 1250
    assert parsear("12", "EUR") == 1200
    assert parsear("0,05", "EUR") == 5
    assert parsear("  1.234,56 €  ", "EUR") == 123456
    assert parsear("-1.234,56", "EUR") == -123456
    assert parsear("€ -12,00", "EUR") == -1200


def test_eur_rechaza_mas_decimales_de_los_que_tiene():
    with pytest.raises(ImporteInvalido, match="2 decimales"):
        parsear("12,345", "EUR")


# --- JPY: cero decimales --------------------------------------------------


def test_jpy_formatea_sin_parte_decimal():
    assert formatear(1500, "JPY") == "1.500 ¥"
    assert formatear(0, "JPY") == "0 ¥"
    assert formatear(1234567, "JPY") == "1.234.567 ¥"


def test_jpy_parsea_y_no_admite_decimales():
    assert parsear("1500", "JPY") == 1500
    assert parsear("1.500", "JPY") == 1500
    assert parsear("1.234.567 ¥", "JPY") == 1234567
    with pytest.raises(ImporteInvalido, match="no admite decimales"):
        parsear("15,5", "JPY")


# --- KWD: tres decimales --------------------------------------------------


def test_kwd_formatea_con_tres_decimales():
    assert formatear(1234567, "KWD") == "1.234,567 KWD"
    assert formatear(5, "KWD") == "0,005 KWD"
    assert formatear(1000, "KWD") == "1,000 KWD"


def test_kwd_parsea_con_tres_decimales():
    assert parsear("1.234,567", "KWD") == 1234567
    assert parsear("1234", "KWD") == 1234000
    assert parsear("0,5", "KWD") == 500
    # Con tres decimales, "1.234" es un importe decimal, no un millar.
    assert parsear("1.234", "KWD") == 1234


def test_kwd_rechaza_cuatro_decimales():
    with pytest.raises(ImporteInvalido, match="3 decimales"):
        parsear("1,2345", "KWD")


# --- Comunes --------------------------------------------------------------


@pytest.mark.parametrize("divisa", ["EUR", "JPY", "KWD", "USD", "KRW", "BHD"])
@pytest.mark.parametrize("minor", [0, 1, 5, 999, 1000, 123456, 100000000])
def test_ida_y_vuelta(divisa: str, minor: int):
    assert parsear(formatear(minor, divisa, con_simbolo=False), divisa) == minor


def test_texto_sin_numeros_se_rechaza():
    for basura in ["", "   ", "abc", "€"]:
        with pytest.raises(ImporteInvalido):
            parsear(basura, "EUR")
