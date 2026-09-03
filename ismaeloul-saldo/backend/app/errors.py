"""Errores de validacion con la misma forma que los de FastAPI.

El frontend pinta el error junto al campo que lo provoca, asi que todo error
de entrada tiene que decir a que campo pertenece. Devolvemos la misma
estructura que RequestValidationError para que el cliente tenga un solo
camino de codigo.
"""

from __future__ import annotations

from fastapi import HTTPException

from .money import DivisaInvalida, ImporteInvalido, normalizar_divisa, parsear


def error_campo(
    campo: str,
    mensaje: str,
    tipo: str = "valor_invalido",
    donde: str = "body",
) -> HTTPException:
    return HTTPException(
        status_code=422,
        detail=[{"loc": [donde, campo], "msg": mensaje, "type": tipo}],
    )


def parsear_importe(texto: str, divisa: str, campo: str) -> int:
    """Parsea un importe escrito por el usuario o devuelve un error de campo."""
    try:
        return parsear(texto, divisa)
    except ImporteInvalido as exc:
        raise error_campo(campo, str(exc), "importe_invalido") from exc


def validar_divisa(codigo: str, campo: str = "currency") -> str:
    try:
        return normalizar_divisa(codigo)
    except DivisaInvalida as exc:
        raise error_campo(campo, str(exc), "divisa_invalida") from exc


def exigir_misma_divisa(
    declarada: str | None, divisa_cuenta: str, campo: str = "divisa"
) -> None:
    """Corta cualquier operacion que mezcle divisas.

    La cuenta tiene UNA divisa fija. Si el cliente declara otra, es un error
    del cliente y no se aplica nada.
    """
    if declarada is None:
        return
    if validar_divisa(declarada, campo) != divisa_cuenta:
        raise error_campo(
            campo,
            f"La cuenta esta en {divisa_cuenta}: no se pueden mezclar divisas",
            "divisa_distinta",
        )
