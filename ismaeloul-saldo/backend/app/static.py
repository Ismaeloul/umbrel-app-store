"""Servido del frontend compilado como estaticos, con fallback de SPA."""

from __future__ import annotations

import logging
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

log = logging.getLogger(__name__)


def montar_frontend(app: FastAPI, static_dir: Path) -> None:
    index = static_dir / "index.html"

    if not index.is_file():
        # En desarrollo el frontend lo sirve Vite en otro puerto; aqui solo
        # dejamos un aviso claro en vez de un 404 desconcertante.
        log.warning("sin frontend compilado", extra={"static_dir": str(static_dir)})

        @app.get("/{ruta:path}", include_in_schema=False)
        def sin_frontend(ruta: str) -> JSONResponse:
            return JSONResponse(
                {
                    "detalle": "Frontend no compilado. La API vive en /api.",
                    "static_dir": str(static_dir),
                },
                status_code=404,
            )

        return

    assets = static_dir / "assets"
    if assets.is_dir():
        app.mount("/assets", StaticFiles(directory=assets), name="assets")

    @app.get("/{ruta:path}", include_in_schema=False)
    def spa(request: Request, ruta: str) -> FileResponse:
        if ruta.startswith("api/"):
            raise HTTPException(status_code=404, detail="Ruta de API desconocida")
        candidato = (static_dir / ruta).resolve() if ruta else index
        # resolve() + is_relative_to cierra el paso a ../../etc/passwd.
        if (
            ruta
            and candidato.is_file()
            and candidato.is_relative_to(static_dir.resolve())
        ):
            return FileResponse(candidato)
        # Cualquier otra ruta es una ruta de React Router: devolvemos el index.
        return FileResponse(index)
