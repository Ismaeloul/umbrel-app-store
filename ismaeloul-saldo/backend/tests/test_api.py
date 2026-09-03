"""Tests de los endpoints REST."""

from __future__ import annotations

from datetime import date

from .conftest import HOY


def crear_cuenta_eur(cliente, **extra) -> dict:
    cuerpo = {
        "email": "cuenta@ejemplo.es",
        "region": "ES",
        "currency": "EUR",
        "saldo_inicial": "0",
    }
    cuerpo.update(extra)
    respuesta = cliente.post("/api/accounts", json=cuerpo)
    assert respuesta.status_code == 201, respuesta.text
    return respuesta.json()


def campos_con_error(respuesta) -> list[str]:
    return [d["loc"][-1] for d in respuesta.json()["detail"]]


# --- Metadatos ------------------------------------------------------------


def test_las_divisas_traen_su_exponente(cliente):
    divisas = {d["codigo"]: d for d in cliente.get("/api/divisas").json()}

    assert divisas["EUR"]["exponente"] == 2
    assert divisas["JPY"]["exponente"] == 0
    assert divisas["KWD"]["exponente"] == 3
    assert divisas["EUR"]["simbolo"] == "€"


# --- Cuentas --------------------------------------------------------------


def test_crear_y_leer_una_cuenta(cliente):
    cuenta = crear_cuenta_eur(
        cliente, saldo_inicial="50,00", notas="La de siempre", email="yo@ejemplo.es"
    )

    assert cuenta["balance_minor"] == 50_00
    assert cuenta["currency"] == "EUR"
    assert cuenta["exponente"] == 2
    assert cuenta["activa"] is True
    assert cuenta["balance_updated_on"] == HOY.isoformat()

    detalle = cliente.get(f"/api/accounts/{cuenta['id']}").json()
    assert detalle["cuenta"]["notas"] == "La de siempre"
    assert detalle["suscripciones"] == []
    # El saldo inicial queda en el historial para que cuadre con el saldo.
    assert [(t["tipo"], t["amount_minor"]) for t in detalle["transacciones"]] == [
        ("recarga", 50_00)
    ]


def test_una_cuenta_en_yenes_no_admite_decimales(cliente):
    cuenta = cliente.post(
        "/api/accounts",
        json={
            "email": "jp@ejemplo.jp",
            "region": "JP",
            "currency": "JPY",
            "saldo_inicial": "1500",
        },
    ).json()

    assert cuenta["currency"] == "JPY"
    assert cuenta["exponente"] == 0
    # 1500 yenes son 1500 unidades menores, no 150000.
    assert cuenta["balance_minor"] == 1500

    malo = cliente.post(
        "/api/accounts",
        json={
            "email": "otro@ejemplo.jp",
            "region": "JP",
            "currency": "JPY",
            "saldo_inicial": "15,5",
        },
    )
    assert malo.status_code == 422
    assert campos_con_error(malo) == ["saldo_inicial"]
    assert "no admite decimales" in malo.json()["detail"][0]["msg"]


def test_la_divisa_de_una_cuenta_no_se_puede_cambiar(cliente):
    cuenta = crear_cuenta_eur(cliente)

    respuesta = cliente.patch(
        f"/api/accounts/{cuenta['id']}", json={"currency": "USD"}
    )

    assert respuesta.status_code == 422
    assert campos_con_error(respuesta) == ["currency"]

    # La misma divisa no molesta.
    assert (
        cliente.patch(
            f"/api/accounts/{cuenta['id']}", json={"currency": "EUR"}
        ).status_code
        == 200
    )


def test_una_divisa_inventada_se_rechaza(cliente):
    respuesta = cliente.post(
        "/api/accounts",
        json={
            "email": "x@ejemplo.es",
            "region": "ES",
            "currency": "XX",
            "saldo_inicial": "0",
        },
    )

    assert respuesta.status_code == 422


def test_archivar_no_borra_y_saca_la_cuenta_del_panel(cliente):
    cuenta = crear_cuenta_eur(cliente)

    cliente.post(f"/api/accounts/{cuenta['id']}/archivar")

    assert cliente.get("/api/accounts").json() == []
    con_archivadas = cliente.get(
        "/api/accounts", params={"incluir_archivadas": True}
    ).json()
    assert [c["cuenta"]["id"] for c in con_archivadas] == [cuenta["id"]]
    # La fila sigue ahi.
    assert cliente.get(f"/api/accounts/{cuenta['id']}").status_code == 200

    cliente.post(f"/api/accounts/{cuenta['id']}/desarchivar")
    assert len(cliente.get("/api/accounts").json()) == 1


def test_las_notas_se_guardan_y_persisten(cliente):
    cuenta = crear_cuenta_eur(cliente)

    texto = "Cuenta de la region de Japon.\nRecargar con tarjetas regalo."
    respuesta = cliente.put(
        f"/api/accounts/{cuenta['id']}/notas", json={"notas": texto}
    )

    assert respuesta.status_code == 200
    assert respuesta.json()["notas"] == texto
    assert cliente.get(f"/api/accounts/{cuenta['id']}").json()["cuenta"]["notas"] == texto


def test_una_cuenta_que_no_existe_da_404(cliente):
    assert cliente.get("/api/accounts/999").status_code == 404
    assert cliente.get("/api/subscriptions/999").status_code == 404


# --- Recargas y reconciliacion --------------------------------------------


def test_una_recarga_suma_al_saldo_y_deja_transaccion(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="10,00")

    respuesta = cliente.post(
        f"/api/accounts/{cuenta['id']}/recargas",
        json={"importe": "25,50", "fecha": "2026-09-03", "concepto": "Tarjeta regalo"},
    )

    assert respuesta.status_code == 201
    assert respuesta.json()["amount_minor"] == 25_50
    assert respuesta.json()["tipo"] == "recarga"

    detalle = cliente.get(f"/api/accounts/{cuenta['id']}").json()
    assert detalle["cuenta"]["balance_minor"] == 35_50


def test_una_recarga_de_cero_o_negativa_se_rechaza(cliente):
    cuenta = crear_cuenta_eur(cliente)

    for importe in ["0", "-5,00"]:
        respuesta = cliente.post(
            f"/api/accounts/{cuenta['id']}/recargas",
            json={"importe": importe, "fecha": "2026-09-03"},
        )
        assert respuesta.status_code == 422
        assert campos_con_error(respuesta) == ["importe"]


def test_reconciliar_con_saldo_menor_crea_un_ajuste_negativo(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="50,00")

    respuesta = cliente.post(
        f"/api/accounts/{cuenta['id']}/reconciliaciones",
        json={
            "saldo_real": "45,00",
            "fecha": "2026-09-03",
            "concepto": "En la tienda pone 45,00",
        },
    )

    cuerpo = respuesta.json()
    assert respuesta.status_code == 200
    assert cuerpo["saldo_anterior_minor"] == 50_00
    assert cuerpo["ajuste_minor"] == -5_00
    assert cuerpo["saldo_minor"] == 45_00
    assert cuerpo["transaccion"]["tipo"] == "ajuste"
    assert cuerpo["transaccion"]["amount_minor"] == -5_00


def test_reconciliar_con_saldo_mayor_crea_un_ajuste_positivo(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="45,00")

    cuerpo = cliente.post(
        f"/api/accounts/{cuenta['id']}/reconciliaciones",
        json={
            "saldo_real": "60,00",
            "fecha": "2026-09-03",
            "concepto": "Habia una promocion",
        },
    ).json()

    assert cuerpo["ajuste_minor"] == 15_00
    assert cuerpo["saldo_minor"] == 60_00
    assert cuerpo["transaccion"]["amount_minor"] == 15_00


def test_reconciliar_sin_diferencia_no_ensucia_el_historial(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="45,00")

    cuerpo = cliente.post(
        f"/api/accounts/{cuenta['id']}/reconciliaciones",
        json={"saldo_real": "45,00", "fecha": "2026-09-03", "concepto": "Cuadra"},
    ).json()

    assert cuerpo["ajuste_minor"] == 0
    assert cuerpo["transaccion"] is None
    detalle = cliente.get(f"/api/accounts/{cuenta['id']}").json()
    assert [t["tipo"] for t in detalle["transacciones"]] == ["recarga"]


def test_el_concepto_de_una_reconciliacion_es_obligatorio(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="45,00")

    respuesta = cliente.post(
        f"/api/accounts/{cuenta['id']}/reconciliaciones",
        json={"saldo_real": "40,00", "fecha": "2026-09-03", "concepto": ""},
    )

    assert respuesta.status_code == 422
    assert campos_con_error(respuesta) == ["concepto"]


# --- Mezcla de divisas ----------------------------------------------------


def test_ninguna_operacion_puede_mezclar_divisas(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="50,00")
    cid = cuenta["id"]

    peticiones = [
        cliente.post(
            f"/api/accounts/{cid}/recargas",
            json={"importe": "10,00", "fecha": "2026-09-03", "divisa": "USD"},
        ),
        cliente.post(
            f"/api/accounts/{cid}/reconciliaciones",
            json={
                "saldo_real": "10,00",
                "fecha": "2026-09-03",
                "concepto": "x",
                "divisa": "JPY",
            },
        ),
        cliente.post(
            f"/api/accounts/{cid}/subscriptions",
            json={
                "nombre": "Mezcla",
                "ciclo": "mensual",
                "proximo_cobro": "2026-10-05",
                "precio": "9,99",
                "divisa": "GBP",
            },
        ),
    ]

    for respuesta in peticiones:
        assert respuesta.status_code == 422, respuesta.text
        assert respuesta.json()["detail"][0]["type"] == "divisa_distinta"

    # Y nada de eso ha tocado el saldo.
    assert (
        cliente.get(f"/api/accounts/{cid}").json()["cuenta"]["balance_minor"] == 50_00
    )


# --- Suscripciones --------------------------------------------------------


def test_alta_de_suscripcion_con_fecha_pasada_rechazada(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="50,00")

    respuesta = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={
            "nombre": "Tarde",
            "ciclo": "mensual",
            "proximo_cobro": "2026-09-02",
            "precio": "9,99",
        },
    )

    assert respuesta.status_code == 422
    assert campos_con_error(respuesta) == ["proximo_cobro"]
    assert respuesta.json()["detail"][0]["type"] == "fecha_pasada"


def test_alta_con_la_fecha_de_hoy_se_acepta(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="50,00")

    respuesta = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={
            "nombre": "Hoy mismo",
            "ciclo": "mensual",
            "proximo_cobro": HOY.isoformat(),
            "precio": "9,99",
        },
    )

    assert respuesta.status_code == 201


def test_alta_sin_fecha_ninguna_se_rechaza(cliente):
    cuenta = crear_cuenta_eur(cliente)

    respuesta = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={"nombre": "Sin fecha", "ciclo": "mensual", "precio": "9,99"},
    )

    assert respuesta.status_code == 422
    assert campos_con_error(respuesta) == ["proximo_cobro"]


def test_una_prueba_gratuita_fija_el_primer_cobro_en_fin_prueba(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="50,00")

    sub = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={
            "nombre": "Con prueba",
            "ciclo": "mensual",
            "fin_prueba": "2026-09-23",
            "precio": "9,99",
        },
    ).json()

    assert sub["proximo_cobro"] == "2026-09-23"
    assert sub["fin_prueba"] == "2026-09-23"
    # Los anclajes salen de la fecha de fin de prueba.
    assert sub["anchor_dia"] == 23
    assert sub["en_prueba"] is True


def test_una_prueba_con_fin_en_el_pasado_se_rechaza_en_su_campo(cliente):
    cuenta = crear_cuenta_eur(cliente)

    respuesta = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={
            "nombre": "Prueba vieja",
            "ciclo": "mensual",
            "fin_prueba": "2026-08-01",
            "precio": "9,99",
        },
    )

    assert respuesta.status_code == 422
    assert campos_con_error(respuesta) == ["fin_prueba"]


def test_un_ciclo_desconocido_se_rechaza(cliente):
    cuenta = crear_cuenta_eur(cliente)

    respuesta = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={
            "nombre": "Rara",
            "ciclo": "trimestral",
            "proximo_cobro": "2026-10-05",
            "precio": "9,99",
        },
    )

    assert respuesta.status_code == 422
    assert campos_con_error(respuesta) == ["ciclo"]


def test_cambiar_el_precio_anade_una_fila_al_historico(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="100,00")
    sub = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={
            "nombre": "Musica",
            "ciclo": "mensual",
            "proximo_cobro": "2026-10-05",
            "precio": "10,00",
        },
    ).json()

    actualizada = cliente.post(
        f"/api/subscriptions/{sub['id']}/precio",
        json={"precio": "12,00", "vigente_desde": "2026-11-01"},
    ).json()

    assert [(p["amount_minor"], p["vigente_desde"]) for p in actualizada["precios"]] == [
        (10_00, HOY.isoformat()),
        (12_00, "2026-11-01"),
    ]
    # Hoy sigue costando lo de antes.
    assert actualizada["precio_actual_minor"] == 10_00

    # Y la proyeccion aplica cada precio en su fecha.
    proyeccion = cliente.get(f"/api/accounts/{cuenta['id']}").json()["proyeccion"]
    por_fecha = {c["fecha"]: c["amount_minor"] for c in proyeccion}
    assert por_fecha["2026-10-05"] == 10_00
    assert por_fecha["2026-11-05"] == 12_00


def test_dos_precios_el_mismo_dia_se_rechazan(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="100,00")
    sub = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={
            "nombre": "Musica",
            "ciclo": "mensual",
            "proximo_cobro": "2026-10-05",
            "precio": "10,00",
        },
    ).json()

    respuesta = cliente.post(
        f"/api/subscriptions/{sub['id']}/precio",
        json={"precio": "12,00", "vigente_desde": HOY.isoformat()},
    )

    assert respuesta.status_code == 422
    assert campos_con_error(respuesta) == ["vigente_desde"]


def test_cancelar_una_suscripcion_la_saca_de_la_proyeccion(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="100,00")
    sub = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={
            "nombre": "Sobra",
            "ciclo": "mensual",
            "proximo_cobro": "2026-10-05",
            "precio": "10,00",
        },
    ).json()

    cancelada = cliente.post(f"/api/subscriptions/{sub['id']}/cancelar").json()

    assert cancelada["estado"] == "cancelada"
    assert cancelada["cancelada_en"] == HOY.isoformat()
    assert cliente.get(f"/api/accounts/{cuenta['id']}").json()["proyeccion"] == []

    # Cancelar dos veces es un error de estado, no un 500.
    assert cliente.post(f"/api/subscriptions/{sub['id']}/cancelar").status_code == 422


def test_editar_una_suscripcion_rederiva_los_anclajes(cliente):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="100,00")
    sub = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={
            "nombre": "Musica",
            "ciclo": "mensual",
            "proximo_cobro": "2026-10-05",
            "precio": "10,00",
        },
    ).json()

    editada = cliente.patch(
        f"/api/subscriptions/{sub['id']}",
        json={"nombre": "Musica Plus", "proximo_cobro": "2026-10-31"},
    ).json()

    assert editada["nombre"] == "Musica Plus"
    assert editada["anchor_dia"] == 31


# --- Panel principal ------------------------------------------------------


def test_el_panel_ordena_por_menor_tiempo_restante(cliente):
    holgada = crear_cuenta_eur(
        cliente, email="holgada@ejemplo.es", saldo_inicial="500,00"
    )
    justa = crear_cuenta_eur(cliente, email="justa@ejemplo.es", saldo_inicial="5,00")
    sin_nada = crear_cuenta_eur(cliente, email="tranquila@ejemplo.es")

    for cuenta_id in (holgada["id"], justa["id"]):
        cliente.post(
            f"/api/accounts/{cuenta_id}/subscriptions",
            json={
                "nombre": "Musica",
                "ciclo": "mensual",
                "proximo_cobro": "2026-10-05",
                "precio": "10,00",
            },
        )

    panel = cliente.get("/api/accounts").json()

    assert [c["cuenta"]["email"] for c in panel] == [
        "justa@ejemplo.es",
        "holgada@ejemplo.es",
        # La que no se agota nunca va al final.
        "tranquila@ejemplo.es",
    ]
    assert panel[-1]["metricas"]["estado_recarga"] == "sin_urgencia"
    assert panel[0]["suscripciones_activas"] == 1


# --- Flujo completo -------------------------------------------------------


def test_flujo_completo_de_una_cuenta(cliente):
    """El recorrido de la app de punta a punta, con las cifras a mano."""
    cuenta = crear_cuenta_eur(cliente, email="yo@ejemplo.es", saldo_inicial="0")
    cid = cuenta["id"]

    cliente.post(
        f"/api/accounts/{cid}/subscriptions",
        json={
            "nombre": "YouTube Premium",
            "ciclo": "mensual",
            "proximo_cobro": "2026-10-05",
            "precio": "11,99",
        },
    )
    cliente.post(
        f"/api/accounts/{cid}/subscriptions",
        json={
            "nombre": "Almacenamiento",
            "ciclo": "anual",
            "proximo_cobro": "2026-12-01",
            "precio": "59,99",
        },
    )
    prueba = cliente.post(
        f"/api/accounts/{cid}/subscriptions",
        json={
            "nombre": "Revista",
            "ciclo": "mensual",
            "fin_prueba": "2026-09-23",
            "precio": "9,99",
        },
    ).json()

    cliente.post(
        f"/api/accounts/{cid}/recargas",
        json={"importe": "50,00", "fecha": HOY.isoformat(), "concepto": "Tarjeta"},
    )

    detalle = cliente.get(f"/api/accounts/{cid}").json()
    metricas = detalle["metricas"]

    assert detalle["cuenta"]["balance_minor"] == 50_00

    # La prueba sale etiquetada, con su importe y con el saldo que la cubre.
    assert metricas["proxima_prueba"] == {
        "subscription_id": prueba["id"],
        "nombre": "Revista",
        "fecha": "2026-09-23",
        "amount_minor": 9_99,
        "saldo_alcanza": True,
    }

    # La linea temporal, cargo a cargo, con el saldo que queda tras cada uno.
    assert [
        (c["fecha"], c["nombre"], c["amount_minor"], c["saldo_restante_minor"])
        for c in detalle["proyeccion"]
    ] == [
        ("2026-09-23", "Revista", 9_99, 40_01),
        ("2026-10-05", "YouTube Premium", 11_99, 28_02),
        ("2026-10-23", "Revista", 9_99, 18_03),
        ("2026-11-05", "YouTube Premium", 11_99, 6_04),
    ]

    # El primer cargo impagable es el que marca el agotamiento.
    assert metricas["fecha_agotamiento"] == "2026-11-23"
    assert metricas["meses_restantes"] == 2
    assert metricas["dias_restantes"] == 81
    assert metricas["estado_recarga"] == "programada"
    assert metricas["fecha_recarga"] == "2026-10-23"

    # Y todo lo que se cae, en orden.
    assert [
        (r["nombre"], r["fecha_perdida_prevista"]) for r in metricas["en_riesgo"]
    ] == [
        ("Revista", "2026-11-23"),
        ("Almacenamiento", "2026-12-01"),
        ("YouTube Premium", "2026-12-05"),
    ]

    # Reconciliar deja el ajuste en el historial.
    cliente.post(
        f"/api/accounts/{cid}/reconciliaciones",
        json={
            "saldo_real": "48,00",
            "fecha": HOY.isoformat(),
            "concepto": "La tienda dice 48,00",
        },
    )
    detalle = cliente.get(f"/api/accounts/{cid}").json()
    assert detalle["cuenta"]["balance_minor"] == 48_00
    assert [(t["tipo"], t["amount_minor"]) for t in detalle["transacciones"]] == [
        ("ajuste", -2_00),
        ("recarga", 50_00),
    ]
    assert detalle["hoy"] == HOY.isoformat()
    assert detalle["horizonte_meses"] == 24


def test_una_suscripcion_perdida_se_puede_reactivar_desde_la_api(cliente, reloj):
    cuenta = crear_cuenta_eur(cliente, saldo_inicial="5,00")
    sub = cliente.post(
        f"/api/accounts/{cuenta['id']}/subscriptions",
        json={
            "nombre": "Cara",
            "ciclo": "mensual",
            "proximo_cobro": "2026-09-10",
            "precio": "10,00",
        },
    ).json()

    # No se puede reactivar algo que no esta perdido.
    assert (
        cliente.post(
            f"/api/subscriptions/{sub['id']}/reactivar",
            json={"proximo_cobro": "2026-10-10"},
        ).status_code
        == 422
    )
