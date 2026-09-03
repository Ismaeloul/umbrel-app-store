"""Ayudas para construir suscripciones de prueba sin repetir boilerplate."""

from __future__ import annotations

from datetime import date

from app.dates import derivar_anchors
from app.projection import Precio, SuscripcionProyectable

# Fecha muy anterior a cualquier escenario: el precio "de siempre".
DESDE_SIEMPRE = date(2000, 1, 1)


def suscripcion(
    id: int,
    proximo_cobro: date,
    *,
    nombre: str | None = None,
    ciclo: str = "mensual",
    precio: int = 1000,
    precios: tuple[Precio, ...] | None = None,
    fin_prueba: date | None = None,
    estado: str = "activa",
    anchor_dia: int | None = None,
    anchor_mes: int | None = None,
) -> SuscripcionProyectable:
    derivado_dia, derivado_mes = derivar_anchors(proximo_cobro, ciclo)
    return SuscripcionProyectable(
        id=id,
        nombre=nombre or f"Suscripcion {id}",
        ciclo=ciclo,
        proximo_cobro=proximo_cobro,
        anchor_dia=anchor_dia if anchor_dia is not None else derivado_dia,
        anchor_mes=anchor_mes if anchor_mes is not None else derivado_mes,
        precios=precios if precios is not None else (Precio(precio, DESDE_SIEMPRE),),
        fin_prueba=fin_prueba,
        estado=estado,
    )
