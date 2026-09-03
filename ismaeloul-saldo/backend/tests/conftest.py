"""Fixtures comunes.

Se toca el entorno ANTES de importar nada de `app`, porque `app.config` lee
las variables una sola vez al importarse. Asi ningun test escribe en el
./data real.
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

_TMP = Path(tempfile.mkdtemp(prefix="saldo-tests-"))
os.environ["SALDO_DATA_DIR"] = str(_TMP / "data")
os.environ["SALDO_STATIC_DIR"] = str(_TMP / "static")

import pytest  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402

from app import db as db_module  # noqa: E402


@pytest.fixture()
def engine(tmp_path: Path):
    """Base de datos de fichero nueva y vacia para cada test."""
    ruta = (tmp_path / "test.db").as_posix()
    return db_module.inicializar(f"sqlite+pysqlite:///{ruta}")


@pytest.fixture()
def session(engine) -> Session:
    fabrica = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    with fabrica() as s:
        yield s
