"""Punto de entrada: FastAPI sirve la API bajo /api y el frontend compilado.

Un solo proceso, un solo puerto. El frontend llama siempre a rutas relativas
/api/..., asi que la app funciona igual detras del proxy inverso de Umbrel.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI

from . import db
from .api.health import router as health_router
from .config import settings
from .logging_conf import configurar_logging
from .static import montar_frontend

log = logging.getLogger(__name__)


@asynccontextmanager
async def ciclo_de_vida(app: FastAPI):
    db.inicializar()
    log.info(
        "saldo arrancando",
        extra={"puerto": settings.port, "data_dir": str(settings.data_dir)},
    )
    yield
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
    app.include_router(api)

    # El comodin de la SPA se registra el ultimo: asi no le roba ninguna ruta
    # a la API, que ya esta declarada por encima.
    montar_frontend(app, settings.static_dir)
    return app


app = crear_app()
