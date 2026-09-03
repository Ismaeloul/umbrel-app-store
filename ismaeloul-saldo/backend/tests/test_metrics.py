"""Metricas derivadas: cuanto tiempo queda de verdad y cuando hay que recargar."""

from __future__ import annotations

from datetime import date

from app.metrics import RECARGA_PROGRAMADA, RECARGA_YA, SIN_URGENCIA, calcular_metricas
from app.projection import proyectar

from .factories import suscripcion


def test_escenario_clave_una_anual_manda_sobre_la_media_mensual():
    """El caso que justifica no dividir el saldo entre un gasto medio.

    Con 80,00 EUR y una mensual de 10,00 el saldo daria para 8 cobros. Pero
    hay una anual de 60,00 que cae dentro de tres meses y no cabe: los meses
    que quedan de verdad son 3, no 8.
    """
    hoy = date(2026, 1, 15)
    mensual = suscripcion(1, date(2026, 2, 15), nombre="Mensual", precio=10_00)
    anual = suscripcion(
        2, date(2026, 4, 20), nombre="Anual", ciclo="anual", precio=60_00
    )

    # Comprobamos primero la premisa: sola, la mensual aguantaria 8 cobros.
    solo_mensual = proyectar(80_00, hoy, [mensual], horizonte_meses=24)
    assert len(solo_mensual.cargos) == 8

    m = calcular_metricas(hoy, 80_00, [mensual, anual])

    assert m.fecha_agotamiento == date(2026, 4, 20)
    assert m.meses_restantes == 3
    assert m.dias_restantes == 95
    assert m.proyeccion.primer_impago is not None
    assert m.proyeccion.primer_impago.nombre == "Anual"


def test_sin_suscripciones_activas_no_hay_urgencia():
    m = calcular_metricas(date(2026, 1, 15), 100_00, [])

    assert m.estado_recarga == SIN_URGENCIA
    assert m.fecha_agotamiento is None
    assert m.meses_restantes is None
    assert m.dias_restantes is None
    assert m.fecha_recarga is None
    assert m.en_riesgo == ()


def test_solo_canceladas_y_perdidas_tampoco_generan_urgencia():
    hoy = date(2026, 1, 15)
    m = calcular_metricas(
        hoy,
        1_00,
        [
            suscripcion(1, date(2026, 2, 1), estado="cancelada", precio=50_00),
            suscripcion(2, date(2026, 2, 2), estado="perdida", precio=50_00),
        ],
    )

    assert m.estado_recarga == SIN_URGENCIA
    assert m.fecha_agotamiento is None


def test_agotamiento_en_diez_dias_es_recarga_ya_y_sin_fecha_pasada():
    hoy = date(2026, 5, 1)
    sub = suscripcion(1, date(2026, 5, 11), precio=50_00)

    m = calcular_metricas(hoy, 0, [sub])

    assert m.fecha_agotamiento == date(2026, 5, 11)
    assert m.dias_restantes == 10
    assert m.estado_recarga == RECARGA_YA
    # Un mes antes del agotamiento ya ha pasado: no se ensena fecha ninguna.
    assert m.fecha_recarga is None


def test_recarga_programada_es_un_mes_antes_del_agotamiento():
    hoy = date(2026, 1, 15)
    sub = suscripcion(1, date(2026, 2, 15), precio=10_00)

    m = calcular_metricas(hoy, 30_00, [sub])

    assert m.fecha_agotamiento == date(2026, 5, 15)
    assert m.meses_restantes == 4
    assert m.estado_recarga == RECARGA_PROGRAMADA
    assert m.fecha_recarga == date(2026, 4, 15)


def test_en_riesgo_va_ordenado_por_fecha_de_perdida():
    hoy = date(2026, 1, 10)
    barata = suscripcion(1, date(2026, 2, 5), nombre="Barata", precio=5_00)
    cara = suscripcion(2, date(2026, 2, 20), nombre="Cara", precio=30_00)

    m = calcular_metricas(hoy, 95_00, [barata, cara])

    assert [(r.nombre, r.fecha_perdida_prevista) for r in m.en_riesgo] == [
        ("Cara", date(2026, 4, 20)),
        ("Barata", date(2026, 9, 5)),
    ]
    assert m.en_riesgo[0].amount_minor == 30_00


# --- Pruebas gratuitas ----------------------------------------------------


def test_proxima_prueba_es_la_mas_cercana_y_dice_si_el_saldo_alcanza():
    hoy = date(2026, 1, 1)
    primera = suscripcion(
        1,
        date(2026, 1, 21),
        nombre="Primera",
        fin_prueba=date(2026, 1, 21),
        precio=9_99,
    )
    segunda = suscripcion(
        2,
        date(2026, 2, 10),
        nombre="Segunda",
        fin_prueba=date(2026, 2, 10),
        precio=5_00,
    )

    m = calcular_metricas(hoy, 100_00, [primera, segunda])

    assert m.proxima_prueba is not None
    assert m.proxima_prueba.nombre == "Primera"
    assert m.proxima_prueba.fecha == date(2026, 1, 21)
    assert m.proxima_prueba.amount_minor == 9_99
    assert m.proxima_prueba.saldo_alcanza is True


def test_prueba_sin_saldo_para_el_primer_cobro_queda_marcada_en_riesgo():
    hoy = date(2026, 1, 1)
    sub = suscripcion(
        1,
        date(2026, 1, 21),
        nombre="Prueba",
        fin_prueba=date(2026, 1, 21),
        precio=9_99,
    )

    m = calcular_metricas(hoy, 5_00, [sub])

    assert m.proxima_prueba is not None
    assert m.proxima_prueba.saldo_alcanza is False
    assert [(r.nombre, r.fecha_perdida_prevista) for r in m.en_riesgo] == [
        ("Prueba", date(2026, 1, 21))
    ]
    assert m.fecha_agotamiento == date(2026, 1, 21)


def test_una_prueba_ya_pasada_no_cuenta_como_proxima():
    hoy = date(2026, 3, 1)
    sub = suscripcion(
        1,
        date(2026, 3, 15),
        fin_prueba=date(2026, 1, 15),
        precio=9_99,
    )

    m = calcular_metricas(hoy, 100_00, [sub])

    assert m.proxima_prueba is None


def test_sin_pruebas_no_hay_proxima_prueba():
    m = calcular_metricas(
        date(2026, 1, 1), 100_00, [suscripcion(1, date(2026, 1, 10))]
    )

    assert m.proxima_prueba is None
