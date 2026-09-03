"""Motor SQLAlchemy y creacion idempotente del esquema."""

from __future__ import annotations

import logging
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
from sqlalchemy.orm import Session, sessionmaker

from .config import settings
from .models import Base

log = logging.getLogger(__name__)

_engine: Engine | None = None
_SessionFactory: sessionmaker[Session] | None = None


def _preparar_conexion(dbapi_connection, _record) -> None:
    cursor = dbapi_connection.cursor()
    # Sin esto SQLite ignora las claves ajenas y el ON DELETE.
    cursor.execute("PRAGMA foreign_keys=ON")
    # WAL: el scheduler escribe mientras la API lee, sin bloquearse.
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()


def crear_engine(db_url: str | None = None) -> Engine:
    url = db_url or settings.db_url
    if url.startswith("sqlite") and ":memory:" not in url:
        ruta = Path(url.split("///", 1)[1])
        ruta.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(url, future=True)
    event.listen(engine, "connect", _preparar_conexion)
    return engine


def inicializar(db_url: str | None = None) -> Engine:
    """Crea el engine y el esquema. Se puede llamar varias veces sin dano."""
    global _engine, _SessionFactory
    engine = crear_engine(db_url)
    Base.metadata.create_all(engine)
    _engine = engine
    _SessionFactory = sessionmaker(bind=engine, expire_on_commit=False, future=True)
    log.info("esquema listo", extra={"db_url": engine.url.render_as_string()})
    return engine


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError("La base de datos no se ha inicializado todavia")
    return _engine


def crear_sesion() -> Session:
    if _SessionFactory is None:
        raise RuntimeError("La base de datos no se ha inicializado todavia")
    return _SessionFactory()


@contextmanager
def sesion() -> Iterator[Session]:
    """Sesion con commit al salir bien y rollback si algo revienta."""
    s = crear_sesion()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()


def dependencia_sesion() -> Iterator[Session]:
    """Dependencia de FastAPI. Confirma al terminar el endpoint sin error."""
    s = crear_sesion()
    try:
        yield s
        s.commit()
    except Exception:
        s.rollback()
        raise
    finally:
        s.close()
