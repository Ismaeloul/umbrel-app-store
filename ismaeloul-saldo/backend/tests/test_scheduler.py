"""Tarea diaria: materializa y deja por escrito lo que hay que mirar hoy."""

from __future__ import annotations

from datetime import date

import pytest

from app import notify as notify_module
from app.scheduler import tarea_diaria

from .factories import crear_cuenta, crear_suscripcion

HOY = date(2026, 9, 3)


@pytest.fixture()
def avisos():
    """Engancha un canal a notify() para leer lo que se anuncia."""
    recogidos: list[str] = []
    notify_module.limpiar_canales()
    notify_module.registrar_canal(recogidos.append)
    yield recogidos
    notify_module.limpiar_canales()


def test_la_tarea_diaria_materializa_y_avisa_de_todo_lo_que_aprieta(session, avisos):
    apretada = crear_cuenta(
        session, email="apretada@ejemplo.es", saldo_minor=10_00
    )
    crear_suscripcion(session, apretada, HOY, nombre="Musica", precio=10_00)

    con_prueba = crear_cuenta(
        session, email="prueba@ejemplo.es", saldo_minor=100_00
    )
    crear_suscripcion(
        session,
        con_prueba,
        date(2026, 9, 8),
        nombre="Revista",
        precio=9_99,
        fin_prueba=date(2026, 9, 8),
    )

    seca = crear_cuenta(session, email="seca@ejemplo.es", saldo_minor=0)
    crear_suscripcion(session, seca, HOY, nombre="Cara", precio=10_00)

    informe = tarea_diaria(session, HOY)

    # Ha cobrado lo que cabia y ha perdido lo que no.
    assert [(c.nombre, c.amount_minor) for c in informe.materializacion.cargos] == [
        ("Musica", 10_00)
    ]
    assert [p.nombre for p in informe.materializacion.perdidas] == ["Cara"]
    assert apretada.balance_minor == 0

    # Y lo ha contado todo.
    assert any("Cara" in a for a in informe.perdidas_hoy)
    assert any("Revista" in a and "2026-09-08" in a for a in informe.pruebas_que_vencen)
    assert any(
        "apretada@ejemplo.es" in a and "30 dias" in a
        for a in informe.cuentas_con_poco_margen
    )

    # Los avisos han salido por notify(), y las perdidas van primero.
    assert len(avisos) == len(informe.avisos)
    assert "Perdida hoy" in avisos[0]


def test_una_cuenta_holgada_no_genera_ningun_aviso(session, avisos):
    cuenta = crear_cuenta(session, saldo_minor=1000_00)
    crear_suscripcion(session, cuenta, date(2026, 10, 5), precio=1_00)

    informe = tarea_diaria(session, HOY)

    assert informe.avisos == []
    assert avisos == []


def test_una_prueba_a_mas_de_una_semana_todavia_no_avisa(session, avisos):
    cuenta = crear_cuenta(session, saldo_minor=100_00)
    crear_suscripcion(
        session,
        cuenta,
        date(2026, 9, 20),
        nombre="Lejana",
        precio=9_99,
        fin_prueba=date(2026, 9, 20),
    )

    informe = tarea_diaria(session, HOY)

    assert informe.pruebas_que_vencen == []


def test_avisa_de_una_prueba_que_no_se_va_a_poder_pagar(session, avisos):
    cuenta = crear_cuenta(session, saldo_minor=1_00)
    crear_suscripcion(
        session,
        cuenta,
        date(2026, 9, 8),
        nombre="Revista",
        precio=9_99,
        fin_prueba=date(2026, 9, 8),
    )

    informe = tarea_diaria(session, HOY)

    assert len(informe.pruebas_que_vencen) == 1
    assert "se va a perder" in informe.pruebas_que_vencen[0]


def test_dos_ejecuciones_el_mismo_dia_no_cobran_dos_veces(session, avisos):
    cuenta = crear_cuenta(session, saldo_minor=100_00)
    crear_suscripcion(session, cuenta, HOY, precio=10_00)

    tarea_diaria(session, HOY)
    saldo = cuenta.balance_minor
    segunda = tarea_diaria(session, HOY)

    assert saldo == 90_00
    assert cuenta.balance_minor == 90_00
    assert segunda.materializacion.cargos == []


def test_un_canal_que_falla_no_tumba_la_tarea(session):
    notify_module.limpiar_canales()

    def canal_roto(_mensaje: str) -> None:
        raise RuntimeError("el canal esta caido")

    notify_module.registrar_canal(canal_roto)
    try:
        cuenta = crear_cuenta(session, saldo_minor=0)
        crear_suscripcion(session, cuenta, HOY, nombre="Cara", precio=10_00)

        informe = tarea_diaria(session, HOY)

        assert len(informe.perdidas_hoy) == 1
    finally:
        notify_module.limpiar_canales()
