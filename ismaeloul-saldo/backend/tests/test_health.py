from __future__ import annotations

from .conftest import HOY


def test_health_responde_ok(cliente):
    respuesta = cliente.get("/api/health")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["estado"] == "ok"
    assert cuerpo["zona_horaria"] == "Europe/Paris"
    assert cuerpo["ultima_materializacion"] is None


def test_health_refleja_la_ultima_materializacion(cliente, session):
    from app.materializer import materializar

    materializar(session, HOY)

    assert cliente.get("/api/health").json()["ultima_materializacion"] == HOY.isoformat()


def test_ruta_desconocida_de_api_no_devuelve_el_index(cliente):
    assert cliente.get("/api/no-existe").status_code == 404
