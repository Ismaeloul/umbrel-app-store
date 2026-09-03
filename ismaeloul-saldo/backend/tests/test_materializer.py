"""Materializador: los cobros vencidos se convierten en transacciones reales."""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import func, select

from app.materializer import materializar, ultima_materializacion
from app.models import Transaction
from app.operations import OperacionInvalida, reactivar_suscripcion

from .factories import crear_cuenta, crear_suscripcion


def cargos_de(session, cuenta) -> list[Transaction]:
    return list(
        session.scalars(
            select(Transaction)
            .where(Transaction.account_id == cuenta.id)
            .where(Transaction.tipo == "cargo")
            .order_by(Transaction.fecha, Transaction.id)
        )
    )


def cuantas_transacciones(session) -> int:
    return session.scalar(select(func.count()).select_from(Transaction))


# --- Ponerse al dia -------------------------------------------------------


def test_ponerse_al_dia_aplica_los_pendientes_en_orden(session):
    """Diez dias sin materializar y tres cobros pendientes."""
    cuenta = crear_cuenta(session, saldo_minor=100_00)
    crear_suscripcion(
        session, cuenta, date(2026, 3, 3), nombre="Musica", precio=10_00
    )
    crear_suscripcion(
        session, cuenta, date(2026, 3, 7), nombre="Nube", precio=5_00
    )
    crear_suscripcion(
        session,
        cuenta,
        date(2026, 3, 10),
        nombre="Anual",
        ciclo="anual",
        precio=20_00,
    )

    resumen = materializar(session, date(2026, 3, 11))

    assert [(c.fecha, c.nombre, c.amount_minor) for c in resumen.cargos] == [
        (date(2026, 3, 3), "Musica", 10_00),
        (date(2026, 3, 7), "Nube", 5_00),
        (date(2026, 3, 10), "Anual", 20_00),
    ]
    assert cuenta.balance_minor == 65_00
    assert cuenta.balance_updated_on == date(2026, 3, 10)
    assert resumen.perdidas == []
    assert ultima_materializacion(session) == date(2026, 3, 11)

    # Los cargos quedan con importe negativo y colgando de su suscripcion.
    movimientos = cargos_de(session, cuenta)
    assert [m.amount_minor for m in movimientos] == [-10_00, -5_00, -20_00]
    assert all(m.subscription_id is not None for m in movimientos)


def test_los_ciclos_avanzan_al_periodo_siguiente(session):
    cuenta = crear_cuenta(session, saldo_minor=100_00)
    mensual = crear_suscripcion(session, cuenta, date(2026, 1, 31), precio=1_00)
    anual = crear_suscripcion(
        session, cuenta, date(2026, 2, 10), ciclo="anual", precio=2_00
    )

    materializar(session, date(2026, 3, 1))

    # Ha cobrado el 31 de enero y el 28 de febrero (el 31 no existe), y el
    # ciclo VUELVE al 31 en marzo en vez de quedarse pegado al 28.
    assert mensual.proximo_cobro == date(2026, 3, 31)
    assert anual.proximo_cobro == date(2027, 2, 10)


def test_no_toca_los_cobros_que_aun_no_han_vencido(session):
    cuenta = crear_cuenta(session, saldo_minor=100_00)
    crear_suscripcion(session, cuenta, date(2026, 3, 20), precio=10_00)

    resumen = materializar(session, date(2026, 3, 11))

    assert resumen.cargos == []
    assert cuenta.balance_minor == 100_00


def test_no_procesa_cuentas_archivadas(session):
    archivada = crear_cuenta(session, saldo_minor=100_00, activa=False)
    crear_suscripcion(session, archivada, date(2026, 3, 3), precio=10_00)

    resumen = materializar(session, date(2026, 3, 11))

    assert resumen.cargos == []
    assert resumen.cuentas_procesadas == 0
    assert archivada.balance_minor == 100_00


def test_no_cobra_canceladas_ni_perdidas(session):
    cuenta = crear_cuenta(session, saldo_minor=100_00)
    crear_suscripcion(
        session, cuenta, date(2026, 3, 3), precio=10_00, estado="cancelada"
    )
    crear_suscripcion(
        session, cuenta, date(2026, 3, 4), precio=10_00, estado="perdida"
    )

    resumen = materializar(session, date(2026, 3, 11))

    assert resumen.cargos == []
    assert cuenta.balance_minor == 100_00


# --- Orden cronologico y saldo insuficiente -------------------------------


def test_el_orden_es_cronologico_no_por_suscripcion(session):
    """El orden decide quien cobra y quien se pierde cuando el saldo no da.

    La cara vence la ultima aunque se diera de alta la primera: para cuando
    le toca, las dos baratas ya se han llevado lo suyo y no queda bastante.
    """
    cuenta = crear_cuenta(session, saldo_minor=15_00)
    cara = crear_suscripcion(
        session, cuenta, date(2026, 3, 10), nombre="Cara", precio=10_00
    )
    barata = crear_suscripcion(
        session, cuenta, date(2026, 3, 5), nombre="Barata", precio=4_00
    )
    media = crear_suscripcion(
        session, cuenta, date(2026, 3, 8), nombre="Media", precio=3_00
    )

    resumen = materializar(session, date(2026, 3, 11))

    assert [(c.fecha, c.nombre) for c in resumen.cargos] == [
        (date(2026, 3, 5), "Barata"),
        (date(2026, 3, 8), "Media"),
    ]
    assert [(p.fecha, p.nombre) for p in resumen.perdidas] == [
        (date(2026, 3, 10), "Cara")
    ]
    assert cara.estado == "perdida"
    assert cara.perdida_en == date(2026, 3, 10)
    assert barata.estado == "activa"
    assert media.estado == "activa"
    assert cuenta.balance_minor == 8_00


def test_saldo_insuficiente_no_crea_transaccion_y_las_demas_siguen(session):
    cuenta = crear_cuenta(session, saldo_minor=8_00)
    cara = crear_suscripcion(
        session, cuenta, date(2026, 3, 10), nombre="Cara", precio=10_00
    )
    barata = crear_suscripcion(
        session, cuenta, date(2026, 3, 5), nombre="Barata", precio=4_00
    )

    resumen = materializar(session, date(2026, 4, 6))

    # La cara no genera ninguna transaccion, ni siquiera de importe cero.
    assert not [m for m in cargos_de(session, cuenta) if m.subscription_id == cara.id]
    assert cara.estado == "perdida"
    assert cara.perdida_en == date(2026, 3, 10)

    # La barata sigue su curso y cobra tambien el mes siguiente.
    assert [c.fecha for c in resumen.cargos] == [
        date(2026, 3, 5),
        date(2026, 4, 5),
    ]
    assert barata.estado == "activa"
    assert barata.proximo_cobro == date(2026, 5, 5)
    assert cuenta.balance_minor == 0


def test_el_saldo_nunca_queda_negativo(session):
    cuenta = crear_cuenta(session, saldo_minor=1_00)
    crear_suscripcion(session, cuenta, date(2026, 3, 5), precio=99_00)

    materializar(session, date(2026, 3, 11))

    assert cuenta.balance_minor == 1_00


# --- Idempotencia ---------------------------------------------------------


def test_dos_ejecuciones_el_mismo_dia_no_duplican_nada(session):
    cuenta = crear_cuenta(session, saldo_minor=100_00)
    crear_suscripcion(session, cuenta, date(2026, 3, 3), precio=10_00)
    crear_suscripcion(session, cuenta, date(2026, 3, 7), precio=5_00)

    primera = materializar(session, date(2026, 3, 11))
    saldo_tras_la_primera = cuenta.balance_minor
    transacciones_tras_la_primera = cuantas_transacciones(session)

    segunda = materializar(session, date(2026, 3, 11))

    assert len(primera.cargos) == 2
    assert segunda.cargos == []
    assert cuenta.balance_minor == saldo_tras_la_primera == 85_00
    assert cuantas_transacciones(session) == transacciones_tras_la_primera == 2


def test_la_restriccion_unique_bloquea_un_cargo_repetido(session):
    """Red de seguridad: aunque se fuerce el ciclo hacia atras, no se cobra dos veces."""
    cuenta = crear_cuenta(session, saldo_minor=100_00)
    sub = crear_suscripcion(session, cuenta, date(2026, 3, 3), precio=10_00)

    materializar(session, date(2026, 3, 11))
    assert cuenta.balance_minor == 90_00

    # Alguien (o un bug) retrocede el ciclo a un cobro ya aplicado.
    sub.proximo_cobro = date(2026, 3, 3)
    session.commit()

    resumen = materializar(session, date(2026, 3, 11))

    assert resumen.ya_aplicados == 1
    assert resumen.cargos == []
    assert cuantas_transacciones(session) == 1
    assert cuenta.balance_minor == 90_00
    # Y el ciclo queda otra vez donde debia.
    assert sub.proximo_cobro == date(2026, 4, 3)


# --- Varias cuentas y divisas ---------------------------------------------


def test_cada_cuenta_se_mueve_en_su_propia_divisa(session):
    euros = crear_cuenta(
        session, email="es@ejemplo.es", currency="EUR", saldo_minor=50_00
    )
    yenes = crear_cuenta(
        session, email="jp@ejemplo.jp", region="JP", currency="JPY", saldo_minor=1500
    )
    crear_suscripcion(session, euros, date(2026, 3, 5), precio=10_00)
    crear_suscripcion(session, yenes, date(2026, 3, 5), precio=500)

    resumen = materializar(session, date(2026, 3, 11))

    assert resumen.cuentas_procesadas == 2
    # 50,00 EUR - 10,00 EUR en centimos; 1500 JPY - 500 JPY en yenes enteros.
    assert euros.balance_minor == 40_00
    assert yenes.balance_minor == 1000
    assert resumen.total_cobrado_por_cuenta == {euros.id: 10_00, yenes.id: 500}


def test_una_cuenta_sin_saldo_no_frena_a_las_demas(session):
    seca = crear_cuenta(session, email="seca@ejemplo.es", saldo_minor=0)
    llena = crear_cuenta(session, email="llena@ejemplo.es", saldo_minor=50_00)
    crear_suscripcion(session, seca, date(2026, 3, 5), precio=10_00)
    crear_suscripcion(session, llena, date(2026, 3, 5), precio=10_00)

    resumen = materializar(session, date(2026, 3, 11))

    assert len(resumen.perdidas) == 1
    assert len(resumen.cargos) == 1
    assert llena.balance_minor == 40_00


# --- Reactivacion ---------------------------------------------------------


def test_reactivar_una_perdida_la_devuelve_al_ciclo_normal(session):
    cuenta = crear_cuenta(session, saldo_minor=8_00)
    cara = crear_suscripcion(
        session, cuenta, date(2026, 3, 10), nombre="Cara", precio=10_00
    )

    materializar(session, date(2026, 3, 11))
    assert cara.estado == "perdida"

    # Recargamos y la reactivamos con una fecha nueva.
    cuenta.balance_minor = 50_00
    reactivar_suscripcion(cara, date(2026, 5, 20), hoy=date(2026, 4, 6))
    session.commit()

    assert cara.estado == "activa"
    assert cara.perdida_en is None
    # Los anclajes se rederivan de la fecha nueva.
    assert cara.anchor_dia == 20

    resumen = materializar(session, date(2026, 5, 21))

    assert [c.fecha for c in resumen.cargos] == [date(2026, 5, 20)]
    assert cara.proximo_cobro == date(2026, 6, 20)
    assert cuenta.balance_minor == 40_00


def test_no_se_reactiva_una_suscripcion_que_no_esta_perdida(session):
    cuenta = crear_cuenta(session, saldo_minor=50_00)
    sub = crear_suscripcion(session, cuenta, date(2026, 5, 10))

    with pytest.raises(OperacionInvalida, match="perdidas"):
        reactivar_suscripcion(sub, date(2026, 6, 1), hoy=date(2026, 4, 1))


def test_no_se_reactiva_con_una_fecha_pasada(session):
    cuenta = crear_cuenta(session, saldo_minor=0)
    sub = crear_suscripcion(
        session, cuenta, date(2026, 3, 10), precio=10_00, estado="perdida"
    )

    with pytest.raises(OperacionInvalida, match="pasado"):
        reactivar_suscripcion(sub, date(2026, 3, 1), hoy=date(2026, 4, 1))
