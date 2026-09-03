"""Configuracion del proceso, leida del entorno una sola vez al importar."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

# Toda la logica de fechas de la app vive en este huso. Se aplica tanto al
# reloj (que dia es "hoy") como al disparador diario de APScheduler.
TIMEZONE = "Europe/Paris"

# Horizonte por defecto del motor de proyeccion, en meses.
HORIZONTE_MESES = 24


def _env_int(nombre: str, por_defecto: int) -> int:
    bruto = os.environ.get(nombre, "").strip()
    if not bruto:
        return por_defecto
    try:
        return int(bruto)
    except ValueError:
        return por_defecto


@dataclass(frozen=True)
class Settings:
    port: int
    data_dir: Path
    static_dir: Path
    hora_tarea_diaria: int

    @property
    def db_path(self) -> Path:
        return self.data_dir / "saldo.db"

    @property
    def db_url(self) -> str:
        return f"sqlite+pysqlite:///{self.db_path.as_posix()}"


def cargar_settings() -> Settings:
    # SALDO_DATA_DIR existe para los tests y el arranque en local; en el
    # contenedor el valor efectivo siempre es /app/data, montado como volumen.
    data_dir = Path(os.environ.get("SALDO_DATA_DIR", "./data")).resolve()
    static_dir = Path(os.environ.get("SALDO_STATIC_DIR", "./static")).resolve()
    return Settings(
        port=_env_int("PORT", 8080),
        data_dir=data_dir,
        static_dir=static_dir,
        hora_tarea_diaria=_env_int("SALDO_HORA_TAREA", 3),
    )


settings = cargar_settings()
