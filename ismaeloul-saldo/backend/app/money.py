"""Dinero: exponentes ISO 4217, formateo y parseo.

Regla que atraviesa toda la app: un importe es SIEMPRE un entero en la unidad
menor de su divisa (centimos para el euro, yenes enteros para el yen, milesimos
para el dinar kuwaiti). Cuantos decimales tiene esa unidad menor lo dice la
tabla de exponentes, nunca una suposicion de "dos decimales".
"""

from __future__ import annotations

import re

# Divisas cuya unidad menor es la propia unidad: no tienen decimales.
_EXPONENTE_0 = frozenset(
    {
        "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG",
        "RWF", "UGX", "UYI", "VND", "VUV", "XAF", "XOF", "XPF",
    }
)
# Divisas con milesimos.
_EXPONENTE_3 = frozenset({"BHD", "IQD", "JOD", "KWD", "LYD", "OMR", "TND"})
# Unidades de cuenta con diezmilesimos.
_EXPONENTE_4 = frozenset({"CLF", "UYW"})

_EXPONENTE_POR_DEFECTO = 2

# Solo los simbolos que en es-ES se escriben de verdad como simbolo. Para el
# resto se usa el propio codigo ISO, que es lo que hace tambien el navegador.
_SIMBOLOS = {
    "EUR": "€",
    "USD": "US$",
    "GBP": "£",
    "JPY": "¥",
    "KRW": "₩",
    "CHF": "CHF",
    "CAD": "CA$",
    "AUD": "AU$",
    "BRL": "R$",
    "INR": "₹",
    "MXN": "MX$",
    "TRY": "₺",
    "PLN": "zl",
    "SEK": "SEK",
    "NOK": "NOK",
    "DKK": "DKK",
    "CNY": "CN¥",
    "RUB": "₽",
    "ILS": "₪",
    "VND": "₫",
    "NGN": "₦",
    "PHP": "₱",
    "THB": "THB",
}

_DIVISA_VALIDA = re.compile(r"^[A-Z]{3}$")

SEPARADOR_MILES = "."
SEPARADOR_DECIMAL = ","


class ImporteInvalido(ValueError):
    """El texto que ha escrito el usuario no es un importe de esa divisa."""


class DivisaInvalida(ValueError):
    """El codigo de divisa no tiene la forma de un ISO 4217."""


def normalizar_divisa(divisa: str) -> str:
    codigo = (divisa or "").strip().upper()
    if not _DIVISA_VALIDA.match(codigo):
        raise DivisaInvalida(
            f"'{divisa}' no es un codigo de divisa ISO 4217 de tres letras"
        )
    return codigo


def exponente(divisa: str) -> int:
    """Numero de decimales de la unidad menor de la divisa."""
    codigo = normalizar_divisa(divisa)
    if codigo in _EXPONENTE_0:
        return 0
    if codigo in _EXPONENTE_3:
        return 3
    if codigo in _EXPONENTE_4:
        return 4
    return _EXPONENTE_POR_DEFECTO


def simbolo(divisa: str) -> str:
    codigo = normalizar_divisa(divisa)
    return _SIMBOLOS.get(codigo, codigo)


def _agrupar_miles(digitos: str) -> str:
    grupos = []
    while len(digitos) > 3:
        grupos.insert(0, digitos[-3:])
        digitos = digitos[:-3]
    grupos.insert(0, digitos)
    return SEPARADOR_MILES.join(grupos)


def formatear(minor: int, divisa: str, *, con_simbolo: bool = True) -> str:
    """Formatea un entero de unidad menor con las convenciones de es-ES."""
    exp = exponente(divisa)
    signo = "-" if minor < 0 else ""
    absoluto = abs(int(minor))

    if exp == 0:
        cuerpo = _agrupar_miles(str(absoluto))
    else:
        texto = str(absoluto).rjust(exp + 1, "0")
        entero, decimales = texto[:-exp], texto[-exp:]
        cuerpo = f"{_agrupar_miles(entero)}{SEPARADOR_DECIMAL}{decimales}"

    if not con_simbolo:
        return f"{signo}{cuerpo}"
    return f"{signo}{cuerpo} {simbolo(divisa)}"


def _separar_partes(cuerpo: str, exp: int) -> tuple[str, str]:
    """Decide que separador es el decimal y devuelve (entero, decimales).

    Con los dos separadores presentes, el de mas a la derecha es el decimal.
    Con uno solo: la coma siempre es decimal; el punto es de miles cuando
    agrupa exactamente tres digitos y la divisa no tiene tres decimales.
    """
    tiene_coma = SEPARADOR_DECIMAL in cuerpo
    tiene_punto = SEPARADOR_MILES in cuerpo

    if tiene_coma and tiene_punto:
        decimal = (
            SEPARADOR_DECIMAL
            if cuerpo.rfind(SEPARADOR_DECIMAL) > cuerpo.rfind(SEPARADOR_MILES)
            else SEPARADOR_MILES
        )
        miles = SEPARADOR_MILES if decimal == SEPARADOR_DECIMAL else SEPARADOR_DECIMAL
        entero, _, decimales = cuerpo.rpartition(decimal)
        return entero.replace(miles, ""), decimales

    separador = SEPARADOR_DECIMAL if tiene_coma else SEPARADOR_MILES if tiene_punto else ""
    if not separador:
        return cuerpo, ""

    if cuerpo.count(separador) > 1:
        # "1.234.567": solo puede ser agrupacion de miles.
        return cuerpo.replace(separador, ""), ""

    entero, _, decimales = cuerpo.partition(separador)
    if separador == SEPARADOR_MILES and len(decimales) == 3 and exp != 3:
        return entero + decimales, ""
    return entero, decimales


def parsear(texto: str, divisa: str) -> int:
    """Convierte lo que escribe el usuario en un entero de unidad menor."""
    exp = exponente(divisa)
    bruto = (texto or "").strip()
    if not bruto:
        raise ImporteInvalido("Escribe un importe")

    # El signo puede venir detras del simbolo ("- 12,00 EUR", "€ -12,00").
    negativo = bool(re.match(r"^[^0-9]*-", bruto))
    # Fuera simbolos, codigos y espacios (incluido el fino de los miles).
    cuerpo = re.sub(r"[^0-9.,]", "", bruto)
    if not re.search(r"[0-9]", cuerpo):
        raise ImporteInvalido(f"'{texto}' no es un importe")

    entero, decimales = _separar_partes(cuerpo, exp)
    entero = entero or "0"

    if not entero.isdigit() or (decimales and not decimales.isdigit()):
        raise ImporteInvalido(f"'{texto}' no es un importe")

    if exp == 0 and decimales:
        raise ImporteInvalido(
            f"{normalizar_divisa(divisa)} no admite decimales"
        )
    if len(decimales) > exp:
        raise ImporteInvalido(
            f"{normalizar_divisa(divisa)} admite como maximo {exp} decimales"
        )

    minor = int(entero) * (10**exp) + int(decimales.ljust(exp, "0") or "0")
    return -minor if negativo else minor


def a_unidad_mayor(minor: int, divisa: str) -> float:
    """Solo para mostrar o serializar. Nunca para calcular."""
    return minor / (10 ** exponente(divisa))


def divisas_conocidas() -> list[dict[str, object]]:
    """Catalogo para el selector de divisa del frontend.

    No es exhaustivo ni pretende serlo: cualquier codigo ISO de tres letras
    vale, y el que no este aqui usa el exponente por defecto.
    """
    codigos = (
        set(_SIMBOLOS)
        | _EXPONENTE_0
        | _EXPONENTE_3
        | _EXPONENTE_4
        | {"EUR", "USD", "GBP", "MAD", "ARS", "COP", "PEN", "ZAR", "AED", "SAR"}
    )
    return [
        {"codigo": codigo, "exponente": exponente(codigo), "simbolo": simbolo(codigo)}
        for codigo in sorted(codigos)
    ]
