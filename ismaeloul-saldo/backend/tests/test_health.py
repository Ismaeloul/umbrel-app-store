from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import crear_app


def test_health_responde_ok():
    with TestClient(crear_app()) as cliente:
        respuesta = cliente.get("/api/health")

    assert respuesta.status_code == 200
    cuerpo = respuesta.json()
    assert cuerpo["estado"] == "ok"
    assert cuerpo["zona_horaria"] == "Europe/Paris"
    assert cuerpo["ultima_materializacion"] is None


def test_ruta_desconocida_de_api_no_devuelve_el_index():
    with TestClient(crear_app()) as cliente:
        respuesta = cliente.get("/api/no-existe")

    assert respuesta.status_code == 404
