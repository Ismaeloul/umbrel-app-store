"""Fixtures comunes.

Se toca el entorno ANTES de importar nada de `app`, porque `app.config` lee
las variables una sola vez al importarse. Asi ningun test escribe en el
./data real ni arranca hilos de fondo.
"""

from __future__ import annotations

import os
import tempfile
from datetime import date
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="saldo-tests-"))
os.environ["SALDO_DATA_DIR"] = str(_TMP / "data")
os.environ["SALDO_STATIC_DIR"] = str(_TMP / "static")
# Sin scheduler ni materializacion de arranque: los tests inyectan la fecha.
os.environ["SALDO_TAREAS_DE_FONDO"] = "0"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app import db as db_module  # noqa: E402
from app.db import dependencia_sesion  # noqa: E402
from app.deps import dependencia_hoy  # noqa: E402
from app.main import crear_app  # noqa: E402

# Fecha congelada por defecto en los tests de API.
HOY = date(2026, 9, 3)


class Reloj:
    """`hoy` inyectable, para poder mover el tiempo dentro de un test."""

    def __init__(self, hoy: date) -> None:
        self.hoy = hoy

    def fijar(self, nuevo: date) -> None:
        self.hoy = nuevo


@pytest.fixture()
def engine(tmp_path: Path):
    """Base de datos de fichero nueva y vacia para cada test."""
    ruta = (tmp_path / "test.db").as_posix()
    return db_module.inicializar(f"sqlite+pysqlite:///{ruta}")


@pytest.fixture()
def fabrica_sesiones(engine):
    return sessionmaker(bind=engine, expire_on_commit=False, future=True)


@pytest.fixture()
def session(fabrica_sesiones) -> Session:
    with fabrica_sesiones() as s:
        yield s


@pytest.fixture()
def reloj() -> Reloj:
    return Reloj(HOY)


@pytest.fixture()
def cliente(fabrica_sesiones, reloj):
    """Cliente HTTP contra la app real, con la base y la fecha de test."""
    app = crear_app()

    def sesion_de_test():
        s = fabrica_sesiones()
        try:
            yield s
            s.commit()
        except Exception:
            s.rollback()
            raise
        finally:
            s.close()

    app.dependency_overrides[dependencia_sesion] = sesion_de_test
    app.dependency_overrides[dependencia_hoy] = lambda: reloj.hoy

    with TestClient(app) as c:
        yield c
