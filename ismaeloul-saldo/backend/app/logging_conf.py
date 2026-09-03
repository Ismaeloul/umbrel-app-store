"""Logging estructurado (una linea JSON por evento) a stdout."""

from __future__ import annotations

import json
import logging
import sys
from datetime import datetime
from zoneinfo import ZoneInfo

from .config import TIMEZONE

_CAMPOS_LOGRECORD = frozenset(
    vars(logging.LogRecord("", 0, "", 0, "", (), None)).keys()
) | {"message", "asctime", "taskName"}


class FormateadorJSON(logging.Formatter):
    """Vuelca el registro como JSON, incluyendo los extra= del llamante."""

    def format(self, record: logging.LogRecord) -> str:
        evento = {
            "ts": datetime.fromtimestamp(
                record.created, ZoneInfo(TIMEZONE)
            ).isoformat(timespec="milliseconds"),
            "nivel": record.levelname,
            "logger": record.name,
            "mensaje": record.getMessage(),
        }
        for clave, valor in record.__dict__.items():
            if clave not in _CAMPOS_LOGRECORD:
                evento[clave] = valor
        if record.exc_info:
            evento["excepcion"] = self.formatException(record.exc_info)
        return json.dumps(evento, ensure_ascii=False, default=str)


def configurar_logging(nivel: int = logging.INFO) -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(FormateadorJSON())

    raiz = logging.getLogger()
    raiz.handlers.clear()
    raiz.addHandler(handler)
    raiz.setLevel(nivel)

    # uvicorn trae sus propios handlers de texto plano: se los quitamos para
    # que todo el proceso salga en el mismo formato.
    for nombre in ("uvicorn", "uvicorn.access", "uvicorn.error", "apscheduler"):
        logger = logging.getLogger(nombre)
        logger.handlers.clear()
        logger.propagate = True
