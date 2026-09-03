"""Punto de entrada: FastAPI sirve la API bajo /api y el frontend compilado.

Un solo proceso, un solo puerto. El frontend llama siempre a rutas relativas
/api/..., asi que la app funciona igual detras del proxy inverso de Umbrel.
"""

from __future__ import annotations

import logging
import os
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from . import db
from .api.accounts import router as accounts_router
from .api.health import router as health_router
from .api.meta import router as meta_router
from .api.subscriptions import router as subscriptions_router
from .config import settings
from .logging_conf import configurar_logging
from .scheduler import arrancar_scheduler, ejecutar_tarea_diaria
from .static import montar_frontend

log = logging.getLogger(__name__)

# Los tests montan la app sin scheduler ni materializacion de arranque: no
# quieren hilos de fondo ni que se toque el reloj real.
CON_TAREAS_DE_FONDO = os.environ.get("SALDO_TAREAS_DE_FONDO", "1") != "0"


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    db.inicializar()
    log.info(
        "saldo arrancando",
        extra={"puerto": settings.port, "data_dir": str(settings.data_dir)},
    )

    scheduler = None
    if CON_TAREAS_DE_FONDO:
        # Al arrancar, ponerse al dia: el NAS ha podido estar apagado.
        try:
            ejecutar_tarea_diaria()
        except Exception:
            log.exception("fallo la materializacion de arranque")
        scheduler = arrancar_scheduler()

    yield

    if scheduler is not None:
        scheduler.shutdown(wait=False)
    log.info("saldo parando")


def crear_app() -> FastAPI:
    # Antes de nada, para que hasta los avisos del montaje salgan en JSON.
    configurar_logging()

    app = FastAPI(
        title="Saldo",
        description="Control de saldo prepago y suscripciones de tiendas de apps",
        version="0.1.0",
        lifespan=ciclo_de_vida,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
    )

    api = APIRouter(prefix="/api")
    api.include_router(health_router)
    api.include_router(meta_router)
    api.include_router(accounts_router)
    api.include_router(subscriptions_router)
    app.include_router(api)

    # El comodin de la SPA se registra el ultimo: asi no le roba ninguna ruta
    # a la API, que ya esta declarada por encima.
    montar_frontend(app, settings.static_dir)
    return app


app = crear_app()
