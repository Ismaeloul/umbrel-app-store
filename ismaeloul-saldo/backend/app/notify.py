"""Punto de extension para los avisos.

A proposito NO hay ninguna integracion externa aqui: la app vive en una red
privada y no manda nada a ningun sitio. `notify` deja el aviso en el log
estructurado, que es donde se puede leer con `docker compose logs`.

Para enchufar un canal de verdad (Telegram, ntfy, el sistema de
notificaciones de Umbrel...) basta con sustituir el cuerpo de esta funcion o
registrar un canal con `registrar_canal`. Nada mas del codigo cambia.
"""

from __future__ import annotations

import logging
from collections.abc import Callable

log = logging.getLogger(__name__)

Canal = Callable[[str], None]

_canales: list[Canal] = []


def registrar_canal(canal: Canal) -> None:
    """Anade un destino para los avisos. Sin canales, solo se registra el log."""
    _canales.append(canal)


def limpiar_canales() -> None:
    _canales.clear()


def notify(mensaje: str) -> None:
    log.info("aviso", extra={"aviso": mensaje})
    for canal in _canales:
        try:
            canal(mensaje)
        except Exception:
            # Un canal roto no puede tumbar la tarea diaria.
            log.exception("fallo enviando el aviso por un canal")
