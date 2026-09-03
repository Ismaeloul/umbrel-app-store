"""Motor de proyeccion: que pasa con el saldo mes a mes."""

from __future__ import annotations

from datetime import date

from app.projection import Precio, proyectar

from .factories import DESDE_SIEMPRE, suscripcion


def fechas(proyeccion) -> list[date]:
    return [cargo.fecha for cargo in proyeccion.cargos]


def test_sin_suscripciones_no_hay_cargos():
    p = proyectar(50_00, date(2026, 1, 1), [])

    assert p.cargos == ()
    assert p.primer_impago is None
    assert p.perdidas_previstas == {}
    assert p.saldo_final_minor == 50_00


def test_mensual_simple_va_restando_del_saldo():
    p = proyectar(
        100_00,
        date(2026, 1, 1),
        [suscripcion(1, date(2026, 1, 10), precio=10_00)],
        horizonte_meses=3,
    )

    assert fechas(p) == [
        date(2026, 1, 10),
        date(2026, 2, 10),
        date(2026, 3, 10),
    ]
    assert [c.saldo_restante_minor for c in p.cargos] == [90_00, 80_00, 70_00]
    assert p.primer_impago is None
    assert p.saldo_final_minor == 70_00


def test_el_horizonte_corta_la_proyeccion():
    """El ultimo cargo cae dentro del horizonte; el siguiente ya no entra."""
    corta = proyectar(
        1000_00,
        date(2026, 1, 1),
        [suscripcion(1, date(2026, 1, 15), precio=1_00)],
        horizonte_meses=2,
    )
    larga = proyectar(
        1000_00,
        date(2026, 1, 1),
        [suscripcion(1, date(2026, 1, 15), precio=1_00)],
        horizonte_meses=24,
    )

    assert corta.horizonte_fin == date(2026, 3, 1)
    assert fechas(corta) == [date(2026, 1, 15), date(2026, 2, 15)]

    assert larga.horizonte_fin == date(2028, 1, 1)
    assert len(larga.cargos) == 24
    assert larga.cargos[-1].fecha == date(2027, 12, 15)


def test_mensual_con_anchor_31_dentro_de_la_proyeccion():
    p = proyectar(
        1000_00,
        date(2026, 1, 1),
        [suscripcion(1, date(2026, 1, 31), precio=1_00)],
        horizonte_meses=4,
    )

    assert fechas(p) == [
        date(2026, 1, 31),
        date(2026, 2, 28),
        # Marzo VUELVE al 31: el recorte de febrero no se arrastra.
        date(2026, 3, 31),
        date(2026, 4, 30),
    ]


def test_anual_con_anchor_29_de_febrero_a_cuatro_anos():
    p = proyectar(
        1000_00,
        date(2024, 1, 1),
        [suscripcion(1, date(2024, 2, 29), ciclo="anual", precio=50_00)],
        horizonte_meses=60,
    )

    assert fechas(p) == [
        date(2024, 2, 29),
        date(2025, 2, 28),
        date(2026, 2, 28),
        date(2027, 2, 28),
        # 2028 vuelve a ser bisiesto y el cobro vuelve al 29.
        date(2028, 2, 29),
    ]


def test_cambio_de_precio_a_mitad_de_proyeccion():
    """El precio se lee del historico: antes del cambio uno, despues otro."""
    sub = suscripcion(
        1,
        date(2026, 1, 10),
        precios=(
            Precio(10_00, DESDE_SIEMPRE),
            Precio(15_00, date(2026, 3, 1)),
        ),
    )

    p = proyectar(1000_00, date(2026, 1, 1), [sub], horizonte_meses=4)

    assert [(c.fecha, c.amount_minor) for c in p.cargos] == [
        (date(2026, 1, 10), 10_00),
        (date(2026, 2, 10), 10_00),
        # El 1 de marzo entra en vigor el precio nuevo.
        (date(2026, 3, 10), 15_00),
        (date(2026, 4, 10), 15_00),
    ]


def test_un_cargo_anterior_al_historico_usa_el_precio_mas_antiguo():
    sub = suscripcion(
        1,
        date(2026, 1, 10),
        precios=(Precio(9_99, date(2026, 6, 1)),),
    )

    p = proyectar(100_00, date(2026, 1, 1), [sub], horizonte_meses=1)

    assert p.cargos[0].amount_minor == 9_99


def test_excluye_canceladas_y_perdidas():
    p = proyectar(
        100_00,
        date(2026, 1, 1),
        [
            suscripcion(1, date(2026, 1, 10), estado="cancelada"),
            suscripcion(2, date(2026, 1, 11), estado="perdida"),
            suscripcion(3, date(2026, 1, 12), precio=5_00),
        ],
        horizonte_meses=1,
    )

    assert {c.subscription_id for c in p.cargos} == {3}


def test_dos_cobros_el_mismo_dia_se_ordenan_de_forma_estable():
    p = proyectar(
        100_00,
        date(2026, 1, 1),
        [
            suscripcion(7, date(2026, 1, 10), precio=1_00),
            suscripcion(3, date(2026, 1, 10), precio=2_00),
        ],
        horizonte_meses=1,
    )

    assert [c.subscription_id for c in p.cargos] == [3, 7]


# --- Impagos y perdidas ---------------------------------------------------


def test_borde_exacto_paga_justo_uno_y_falla_en_el_siguiente():
    p = proyectar(
        10_00,
        date(2026, 3, 1),
        [suscripcion(1, date(2026, 3, 10), precio=10_00)],
        horizonte_meses=6,
    )

    assert fechas(p) == [date(2026, 3, 10)]
    assert p.cargos[0].saldo_restante_minor == 0
    assert p.primer_impago is not None
    assert p.primer_impago.fecha == date(2026, 4, 10)
    assert p.primer_impago.amount_minor == 10_00
    assert p.primer_impago.saldo_disponible_minor == 0
    assert p.saldo_final_minor == 0


def test_perdida_parcial_la_cara_cae_y_la_barata_sigue():
    """Una cara se pierde en el mes 3; la barata sigue hasta el mes 7."""
    barata = suscripcion(1, date(2026, 2, 5), nombre="Barata", precio=5_00)
    cara = suscripcion(2, date(2026, 2, 20), nombre="Cara", precio=30_00)

    p = proyectar(95_00, date(2026, 1, 10), [barata, cara], horizonte_meses=24)

    assert p.perdidas_previstas == {
        2: date(2026, 4, 20),
        1: date(2026, 9, 5),
    }
    assert p.primer_impago is not None
    assert p.primer_impago.nombre == "Cara"
    assert p.primer_impago.fecha == date(2026, 4, 20)

    # La cara deja de generar cargos el dia que se pierde; la barata sigue
    # cobrando con lo que queda.
    cargos_cara = [c.fecha for c in p.cargos if c.subscription_id == 2]
    cargos_barata = [c.fecha for c in p.cargos if c.subscription_id == 1]
    assert cargos_cara == [date(2026, 2, 20), date(2026, 3, 20)]
    assert cargos_barata == [
        date(2026, 2, 5),
        date(2026, 3, 5),
        date(2026, 4, 5),
        date(2026, 5, 5),
        date(2026, 6, 5),
        date(2026, 7, 5),
        date(2026, 8, 5),
    ]

    assert p.saldo_final_minor == 0
    assert all(c.saldo_restante_minor >= 0 for c in p.cargos)


def test_el_saldo_nunca_queda_negativo():
    p = proyectar(
        3_00,
        date(2026, 1, 1),
        [
            suscripcion(1, date(2026, 1, 5), precio=2_00),
            suscripcion(2, date(2026, 1, 6), precio=2_00),
            suscripcion(3, date(2026, 1, 7), precio=2_00),
        ],
        horizonte_meses=6,
    )

    assert all(c.saldo_restante_minor >= 0 for c in p.cargos)
    assert p.saldo_final_minor >= 0
    # La primera cabe, las otras dos no y se pierden ese mismo dia.
    assert [c.subscription_id for c in p.cargos] == [1]
    assert p.perdidas_previstas == {
        2: date(2026, 1, 6),
        3: date(2026, 1, 7),
        1: date(2026, 2, 5),
    }


# --- Pruebas gratuitas ----------------------------------------------------


def test_prueba_gratuita_no_cobra_hasta_el_fin_de_la_prueba():
    """Con fin_prueba a 20 dias, el primer cargo cae exactamente ese dia."""
    hoy = date(2026, 1, 1)
    fin = date(2026, 1, 21)
    sub = suscripcion(1, fin, fin_prueba=fin, precio=9_99)

    p = proyectar(100_00, hoy, [sub], horizonte_meses=3)

    assert p.cargos[0].fecha == fin
    assert p.cargos[0].amount_minor == 9_99
    # Ni un cargo antes de la fecha, ni ninguno de importe cero.
    assert all(c.fecha >= fin for c in p.cargos)
    assert all(c.amount_minor > 0 for c in p.cargos)


def test_prueba_que_termina_el_31_de_enero_respeta_la_regla_de_febrero():
    fin = date(2026, 1, 31)
    sub = suscripcion(1, fin, fin_prueba=fin, precio=1_00)

    p = proyectar(1000_00, date(2026, 1, 5), [sub], horizonte_meses=4)

    assert fechas(p) == [
        date(2026, 1, 31),
        date(2026, 2, 28),
        date(2026, 3, 31),
        date(2026, 4, 30),
    ]


def test_prueba_sin_saldo_para_el_primer_cobro_se_pierde_ese_dia():
    fin = date(2026, 1, 21)
    sub = suscripcion(1, fin, nombre="Prueba", fin_prueba=fin, precio=9_99)

    p = proyectar(5_00, date(2026, 1, 1), [sub], horizonte_meses=3)

    assert p.cargos == ()
    assert p.primer_impago is not None
    assert p.primer_impago.fecha == fin
    assert p.primer_impago.nombre == "Prueba"
    assert p.perdidas_previstas == {1: fin}


def test_un_cobro_vencido_no_se_proyecta_como_si_fuese_futuro():
    """Los cobros vencidos son cosa del materializador, no de la proyeccion."""
    p = proyectar(
        100_00,
        date(2026, 3, 1),
        [suscripcion(1, date(2026, 1, 10), precio=10_00)],
        horizonte_meses=2,
    )

    assert fechas(p) == [date(2026, 3, 10), date(2026, 4, 10)]
