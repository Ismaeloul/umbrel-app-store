"""Motor de proyeccion.

Python puro: no importa SQLAlchemy ni FastAPI y no mira el reloj. Recibe el
saldo, la fecha de inicio y la lista de suscripciones, y devuelve que va a
pasar con ese saldo mes a mes.

La regla que le da sentido a todo: cuando un cargo no cabe, esa suscripcion se
da por perdida ESE dia y deja de generar cargos; las demas siguen su curso con
lo que quede. El saldo no baja nunca de cero.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from .dates import siguiente_cobro, sumar_meses

ESTADOS_QUE_NO_PROYECTAN = frozenset({"cancelada", "perdida"})


@dataclass(frozen=True)
class Precio:
    amount_minor: int
    vigente_desde: date


@dataclass(frozen=True)
class SuscripcionProyectable:
    """Una suscripcion vista por el motor, sin nada de la capa de base."""

    id: int
    nombre: str
    ciclo: str
    proximo_cobro: date
    anchor_dia: int
    anchor_mes: int | None = None
    precios: tuple[Precio, ...] = ()
    fin_prueba: date | None = None
    estado: str = "activa"

    def precio_en(self, fecha: date) -> int:
        """Precio vigente ese dia segun el historico de subscription_prices."""
        if not self.precios:
            raise ValueError(
                f"La suscripcion {self.nombre!r} no tiene ningun precio"
            )
        ordenados = sorted(self.precios, key=lambda p: p.vigente_desde)
        vigente = ordenados[0]
        for precio in ordenados:
            if precio.vigente_desde <= fecha:
                vigente = precio
            else:
                break
        return vigente.amount_minor


@dataclass(frozen=True)
class CargoProyectado:
    fecha: date
    subscription_id: int
    nombre: str
    amount_minor: int
    saldo_restante_minor: int


@dataclass(frozen=True)
class Impago:
    """El cargo que no se podria pagar y hunde la suscripcion."""

    fecha: date
    subscription_id: int
    nombre: str
    amount_minor: int
    saldo_disponible_minor: int


@dataclass(frozen=True)
class Proyeccion:
    saldo_inicial_minor: int
    fecha_inicio: date
    horizonte_fin: date
    cargos: tuple[CargoProyectado, ...] = ()
    primer_impago: Impago | None = None
    perdidas_previstas: dict[int, date] = field(default_factory=dict)
    saldo_final_minor: int = 0

    def cargo_de(self, subscription_id: int, fecha: date) -> CargoProyectado | None:
        for cargo in self.cargos:
            if cargo.subscription_id == subscription_id and cargo.fecha == fecha:
                return cargo
        return None


def proyectar(
    saldo_actual_minor: int,
    fecha_inicio: date,
    suscripciones: list[SuscripcionProyectable],
    horizonte_meses: int = 24,
) -> Proyeccion:
    """Simula los cargos futuros hasta agotar el horizonte."""
    horizonte_fin = sumar_meses(fecha_inicio, horizonte_meses)
    saldo = int(saldo_actual_minor)

    # Estado vivo de la simulacion: la proxima fecha de cobro de cada
    # suscripcion que sigue generando cargos.
    pendientes: dict[int, tuple[SuscripcionProyectable, date]] = {}
    for sub in suscripciones:
        if sub.estado in ESTADOS_QUE_NO_PROYECTAN:
            continue
        fecha = sub.proximo_cobro
        # Un cobro anterior a la fecha de inicio es trabajo del
        # materializador, no de la proyeccion: lo adelantamos al ciclo que
        # cae dentro del horizonte para no contarlo dos veces.
        while fecha < fecha_inicio:
            fecha = siguiente_cobro(fecha, sub.ciclo, sub.anchor_dia, sub.anchor_mes)
        pendientes[sub.id] = (sub, fecha)

    cargos: list[CargoProyectado] = []
    perdidas: dict[int, date] = {}
    primer_impago: Impago | None = None

    while pendientes:
        # Orden cronologico estricto; el id desempata para que la proyeccion
        # sea siempre la misma ante dos cobros el mismo dia.
        sub_id, (sub, fecha) = min(
            pendientes.items(), key=lambda par: (par[1][1], par[0])
        )
        if fecha > horizonte_fin:
            break

        importe = sub.precio_en(fecha)
        if importe <= saldo:
            saldo -= importe
            cargos.append(
                CargoProyectado(
                    fecha=fecha,
                    subscription_id=sub_id,
                    nombre=sub.nombre,
                    amount_minor=importe,
                    saldo_restante_minor=saldo,
                )
            )
            pendientes[sub_id] = (
                sub,
                siguiente_cobro(fecha, sub.ciclo, sub.anchor_dia, sub.anchor_mes),
            )
            continue

        # No cabe: esta suscripcion se pierde aqui y sale de la simulacion.
        perdidas[sub_id] = fecha
        if primer_impago is None:
            primer_impago = Impago(
                fecha=fecha,
                subscription_id=sub_id,
                nombre=sub.nombre,
                amount_minor=importe,
                saldo_disponible_minor=saldo,
            )
        del pendientes[sub_id]

    return Proyeccion(
        saldo_inicial_minor=int(saldo_actual_minor),
        fecha_inicio=fecha_inicio,
        horizonte_fin=horizonte_fin,
        cargos=tuple(cargos),
        primer_impago=primer_impago,
        perdidas_previstas=perdidas,
        saldo_final_minor=saldo,
    )
