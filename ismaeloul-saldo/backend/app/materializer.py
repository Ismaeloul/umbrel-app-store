"""Materializador de cargos: convierte los cobros vencidos en transacciones.

El saldo de una cuenta baja solo con el paso del tiempo. Este modulo es lo
unico que lo hace bajar por un cobro.

Se ejecuta al arrancar la aplicacion y una vez al dia. Tiene que aguantar que
la app haya estado apagada diez dias: se pone al dia procesando todo lo
pendiente en ORDEN CRONOLOGICO ESTRICTO entre todas las suscripciones de la
cuenta, porque el orden decide que se cobra y que se pierde cuando el saldo
no da para todo.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .dates import siguiente_cobro
from .mapping import precio_en, suscripciones_de
from .models import (
    CLAVE_ULTIMA_MATERIALIZACION,
    Account,
    AppState,
    Subscription,
    Transaction,
)

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class CargoAplicado:
    account_id: int
    subscription_id: int
    nombre: str
    fecha: date
    amount_minor: int
    saldo_resultante_minor: int


@dataclass(frozen=True)
class PerdidaRegistrada:
    account_id: int
    subscription_id: int
    nombre: str
    fecha: date
    amount_minor: int
    saldo_disponible_minor: int


@dataclass
class ResumenMaterializacion:
    hoy: date
    desde: date | None = None
    cuentas_procesadas: int = 0
    cargos: list[CargoAplicado] = field(default_factory=list)
    perdidas: list[PerdidaRegistrada] = field(default_factory=list)
    # Cobros que la restriccion UNIQUE rechazo por estar ya aplicados.
    ya_aplicados: int = 0

    @property
    def total_cobrado_por_cuenta(self) -> dict[int, int]:
        totales: dict[int, int] = {}
        for cargo in self.cargos:
            totales[cargo.account_id] = (
                totales.get(cargo.account_id, 0) + cargo.amount_minor
            )
        return totales


def leer_estado(session: Session, clave: str) -> str | None:
    return session.scalar(select(AppState.valor).where(AppState.clave == clave))


def guardar_estado(session: Session, clave: str, valor: str) -> None:
    fila = session.get(AppState, clave)
    if fila is None:
        session.add(AppState(clave=clave, valor=valor))
    else:
        fila.valor = valor


def ultima_materializacion(session: Session) -> date | None:
    bruto = leer_estado(session, CLAVE_ULTIMA_MATERIALIZACION)
    return date.fromisoformat(bruto) if bruto else None


def _avanzar_ciclo(sub: Subscription) -> None:
    sub.proximo_cobro = siguiente_cobro(
        sub.proximo_cobro, sub.ciclo, sub.anchor_dia, sub.anchor_mes
    )


def _materializar_cuenta(
    session: Session, cuenta: Account, hoy: date, resumen: ResumenMaterializacion
) -> None:
    vivas = {
        sub.id: sub
        for sub in suscripciones_de(session, cuenta.id)
        if sub.estado == "activa"
    }

    while True:
        # Orden cronologico estricto entre TODAS las suscripciones de la
        # cuenta; el id desempata dos cobros del mismo dia.
        vencidas = [sub for sub in vivas.values() if sub.proximo_cobro <= hoy]
        if not vencidas:
            return

        sub = min(vencidas, key=lambda s: (s.proximo_cobro, s.id))
        fecha = sub.proximo_cobro
        importe = precio_en(sub, fecha)

        if importe > cuenta.balance_minor:
            # No cabe: se pierde aqui y deja de generar cobros. Las demas
            # suscripciones de la cuenta siguen su curso.
            sub.estado = "perdida"
            sub.perdida_en = fecha
            del vivas[sub.id]
            resumen.perdidas.append(
                PerdidaRegistrada(
                    account_id=cuenta.id,
                    subscription_id=sub.id,
                    nombre=sub.nombre,
                    fecha=fecha,
                    amount_minor=importe,
                    saldo_disponible_minor=cuenta.balance_minor,
                )
            )
            log.warning(
                "suscripcion perdida por saldo insuficiente",
                extra={
                    "account_id": cuenta.id,
                    "email": cuenta.email,
                    "subscription_id": sub.id,
                    "suscripcion": sub.nombre,
                    "fecha": fecha.isoformat(),
                    "importe_minor": importe,
                    "saldo_minor": cuenta.balance_minor,
                    "divisa": cuenta.currency,
                },
            )
            continue

        movimiento = Transaction(
            account_id=cuenta.id,
            fecha=fecha,
            tipo="cargo",
            amount_minor=-importe,
            concepto=sub.nombre,
            subscription_id=sub.id,
        )
        try:
            # SAVEPOINT: si el cargo ya existia, la restriccion UNIQUE salta
            # aqui y deshace solo este insert, no el trabajo de la cuenta.
            with session.begin_nested():
                session.add(movimiento)
                session.flush()
        except IntegrityError:
            # Ese cobro ya se aplico en una ejecucion anterior: el saldo ya
            # esta descontado. Solo hay que avanzar el ciclo.
            resumen.ya_aplicados += 1
            log.info(
                "cobro ya aplicado, no se duplica",
                extra={
                    "subscription_id": sub.id,
                    "suscripcion": sub.nombre,
                    "fecha": fecha.isoformat(),
                },
            )
            _avanzar_ciclo(sub)
            continue

        cuenta.balance_minor -= importe
        cuenta.balance_updated_on = fecha
        _avanzar_ciclo(sub)
        resumen.cargos.append(
            CargoAplicado(
                account_id=cuenta.id,
                subscription_id=sub.id,
                nombre=sub.nombre,
                fecha=fecha,
                amount_minor=importe,
                saldo_resultante_minor=cuenta.balance_minor,
            )
        )
        log.info(
            "cargo aplicado",
            extra={
                "account_id": cuenta.id,
                "subscription_id": sub.id,
                "suscripcion": sub.nombre,
                "fecha": fecha.isoformat(),
                "importe_minor": importe,
                "saldo_minor": cuenta.balance_minor,
                "divisa": cuenta.currency,
            },
        )


def materializar(session: Session, hoy: date) -> ResumenMaterializacion:
    """Aplica todos los cobros vencidos hasta `hoy` inclusive.

    Idempotente: ejecutarlo dos veces el mismo dia no duplica nada. Se apoya
    en que el ciclo avanza junto con el insert y, como red de seguridad, en
    la restriccion UNIQUE de transactions.
    """
    resumen = ResumenMaterializacion(hoy=hoy, desde=ultima_materializacion(session))

    cuentas = list(
        session.scalars(
            select(Account).where(Account.activa.is_(True)).order_by(Account.id)
        )
    )

    for cuenta in cuentas:
        try:
            _materializar_cuenta(session, cuenta, hoy, resumen)
            # Todo el proceso de una cuenta va en una sola transaccion.
            session.commit()
        except Exception:
            session.rollback()
            log.exception(
                "fallo materializando la cuenta",
                extra={"account_id": cuenta.id, "email": cuenta.email},
            )
            raise
        resumen.cuentas_procesadas += 1

    guardar_estado(session, CLAVE_ULTIMA_MATERIALIZACION, hoy.isoformat())
    session.commit()

    log.info(
        "materializacion terminada",
        extra={
            "hoy": hoy.isoformat(),
            "desde": resumen.desde.isoformat() if resumen.desde else None,
            "cuentas": resumen.cuentas_procesadas,
            "cargos": len(resumen.cargos),
            "perdidas": len(resumen.perdidas),
            "ya_aplicados": resumen.ya_aplicados,
        },
    )
    return resumen
