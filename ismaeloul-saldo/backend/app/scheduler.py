"""Tarea diaria: materializa los cobros y avisa de lo que aprieta.

Se ejecuta al arrancar la aplicacion y una vez al dia con APScheduler, en
Europe/Paris.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

from apscheduler.schedulers.background import BackgroundScheduler
from apscheduler.triggers.cron import CronTrigger
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import db
from .clock import hoy as hoy_real
from .config import TIMEZONE, settings
from .mapping import a_proyectable, suscripciones_de
from .materializer import ResumenMaterializacion, materializar
from .metrics import calcular_metricas
from .models import Account
from .money import formatear
from .notify import notify

log = logging.getLogger(__name__)

# Umbrales del informe diario.
DIAS_MARGEN_CRITICO = 30
DIAS_AVISO_PRUEBA = 7


@dataclass
class InformeDiario:
    hoy: date
    materializacion: ResumenMaterializacion
    cuentas_con_poco_margen: list[str] = field(default_factory=list)
    pruebas_que_vencen: list[str] = field(default_factory=list)
    perdidas_hoy: list[str] = field(default_factory=list)

    @property
    def avisos(self) -> list[str]:
        return [
            *self.perdidas_hoy,
            *self.pruebas_que_vencen,
            *self.cuentas_con_poco_margen,
        ]


def tarea_diaria(session: Session, hoy: date) -> InformeDiario:
    """Materializa lo vencido y deja en el log lo que hay que mirar hoy."""
    resumen = materializar(session, hoy)
    informe = InformeDiario(hoy=hoy, materializacion=resumen)

    for perdida in resumen.perdidas:
        if perdida.fecha == hoy:
            informe.perdidas_hoy.append(
                f"Perdida hoy: {perdida.nombre}. No habia saldo para el cobro de "
                f"{formatear(perdida.amount_minor, _divisa(session, perdida.account_id))}."
            )

    cuentas = session.scalars(
        select(Account).where(Account.activa.is_(True)).order_by(Account.id)
    )
    for cuenta in cuentas:
        suscripciones = suscripciones_de(session, cuenta.id)
        metricas = calcular_metricas(
            hoy,
            cuenta.balance_minor,
            [a_proyectable(sub) for sub in suscripciones],
        )

        if (
            metricas.dias_restantes is not None
            and metricas.dias_restantes <= DIAS_MARGEN_CRITICO
        ):
            informe.cuentas_con_poco_margen.append(
                f"{cuenta.email}: quedan {metricas.dias_restantes} dias de saldo "
                f"({formatear(cuenta.balance_minor, cuenta.currency)}). "
                f"Primer cobro impagable el {metricas.fecha_agotamiento}."
            )

        prueba = metricas.proxima_prueba
        if prueba is not None and 0 <= (prueba.fecha - hoy).days <= DIAS_AVISO_PRUEBA:
            estado = (
                "el saldo alcanza"
                if prueba.saldo_alcanza
                else "NO hay saldo: se va a perder"
            )
            informe.pruebas_que_vencen.append(
                f"{cuenta.email}: la prueba de {prueba.nombre} pasa a cobro el "
                f"{prueba.fecha} por {formatear(prueba.amount_minor, cuenta.currency)}; "
                f"{estado}."
            )

    for aviso in informe.avisos:
        notify(aviso)

    log.info(
        "tarea diaria terminada",
        extra={
            "hoy": hoy.isoformat(),
            "cargos": len(resumen.cargos),
            "perdidas": len(resumen.perdidas),
            "avisos": len(informe.avisos),
        },
    )
    return informe


def _divisa(session: Session, account_id: int) -> str:
    cuenta = session.get(Account, account_id)
    return cuenta.currency if cuenta else "EUR"


def ejecutar_tarea_diaria() -> None:
    """Envoltorio con su propia sesion, para el scheduler y el arranque."""
    with db.sesion() as session:
        tarea_diaria(session, hoy_real())


def arrancar_scheduler() -> BackgroundScheduler:
    scheduler = BackgroundScheduler(timezone=TIMEZONE)
    scheduler.add_job(
        ejecutar_tarea_diaria,
        CronTrigger(hour=settings.hora_tarea_diaria, minute=0, timezone=TIMEZONE),
        id="tarea_diaria",
        replace_existing=True,
        # Si el NAS estuvo apagado, no queremos diez ejecuciones seguidas:
        # una sola se pone al dia igual, porque el materializador procesa
        # todo lo pendiente hasta hoy.
        coalesce=True,
        max_instances=1,
        misfire_grace_time=3600,
    )
    scheduler.start()
    log.info(
        "scheduler arrancado",
        extra={"hora": settings.hora_tarea_diaria, "zona_horaria": TIMEZONE},
    )
    return scheduler
