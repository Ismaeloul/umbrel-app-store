"""Esquema de la base de datos.

Notas de diseno que el codigo de negocio da por hechas:

* Todo importe es un entero en la unidad menor de la divisa de su cuenta.
  Nunca hay flotantes ni decimales en la base.
* El precio de una suscripcion NO vive en `subscriptions`: se lee siempre de
  `subscription_prices`, y cambiar de precio anade una fila nueva.
* `transactions` tiene un indice unico parcial sobre (subscription_id, fecha)
  restringido a tipo = 'cargo'. Es la garantia dura de que un mismo cobro no
  se aplica dos veces aunque el materializador se ejecute de mas.
"""

from __future__ import annotations

from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

CICLOS = ("mensual", "anual")
ESTADOS_SUSCRIPCION = ("activa", "cancelada", "perdida")
TIPOS_TRANSACCION = ("recarga", "cargo", "ajuste")

CLAVE_ULTIMA_MATERIALIZACION = "ultima_materializacion"


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    region: Mapped[str] = mapped_column(String(2), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    balance_minor: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    balance_updated_on: Mapped[date] = mapped_column(Date, nullable=False)
    notas: Mapped[str] = mapped_column(Text, nullable=False, default="")
    activa: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    subscriptions: Mapped[list["Subscription"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )
    transactions: Mapped[list["Transaction"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # El saldo jamas puede quedar negativo: lo defiende tambien la base.
        CheckConstraint("balance_minor >= 0", name="ck_accounts_saldo_no_negativo"),
    )


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    nombre: Mapped[str] = mapped_column(String(200), nullable=False)
    ciclo: Mapped[str] = mapped_column(String(10), nullable=False)
    # Siempre la fecha del proximo cobro FUTURO. El materializador la avanza.
    proximo_cobro: Mapped[date] = mapped_column(Date, nullable=False)
    anchor_dia: Mapped[int] = mapped_column(Integer, nullable=False)
    anchor_mes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fin_prueba: Mapped[date | None] = mapped_column(Date, nullable=True)
    estado: Mapped[str] = mapped_column(String(10), nullable=False, default="activa")
    cancelada_en: Mapped[date | None] = mapped_column(Date, nullable=True)
    perdida_en: Mapped[date | None] = mapped_column(Date, nullable=True)

    account: Mapped[Account] = relationship(back_populates="subscriptions")
    precios: Mapped[list["SubscriptionPrice"]] = relationship(
        back_populates="subscription",
        cascade="all, delete-orphan",
        order_by="SubscriptionPrice.vigente_desde",
    )

    __table_args__ = (
        CheckConstraint(
            "ciclo IN ('mensual', 'anual')", name="ck_subscriptions_ciclo"
        ),
        CheckConstraint(
            "estado IN ('activa', 'cancelada', 'perdida')",
            name="ck_subscriptions_estado",
        ),
        CheckConstraint(
            "anchor_dia BETWEEN 1 AND 31", name="ck_subscriptions_anchor_dia"
        ),
        CheckConstraint(
            "anchor_mes IS NULL OR anchor_mes BETWEEN 1 AND 12",
            name="ck_subscriptions_anchor_mes",
        ),
        # Un ciclo anual sin mes de anclaje no sabria en que mes cobrar.
        CheckConstraint(
            "ciclo <> 'anual' OR anchor_mes IS NOT NULL",
            name="ck_subscriptions_anual_con_mes",
        ),
    )


class SubscriptionPrice(Base):
    __tablename__ = "subscription_prices"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    subscription_id: Mapped[int] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    vigente_desde: Mapped[date] = mapped_column(Date, nullable=False)

    subscription: Mapped[Subscription] = relationship(back_populates="precios")

    __table_args__ = (
        CheckConstraint("amount_minor > 0", name="ck_prices_importe_positivo"),
        # Dos precios distintos vigentes el mismo dia harian ambiguo el cobro.
        Index(
            "ux_precio_sub_vigencia",
            "subscription_id",
            "vigente_desde",
            unique=True,
        ),
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(
        ForeignKey("accounts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    fecha: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    tipo: Mapped[str] = mapped_column(String(10), nullable=False)
    # Con signo: las recargas suman, los cargos restan, los ajustes cualquiera.
    amount_minor: Mapped[int] = mapped_column(Integer, nullable=False)
    concepto: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    subscription_id: Mapped[int | None] = mapped_column(
        ForeignKey("subscriptions.id", ondelete="SET NULL"), nullable=True, index=True
    )

    account: Mapped[Account] = relationship(back_populates="transactions")

    __table_args__ = (
        CheckConstraint(
            "tipo IN ('recarga', 'cargo', 'ajuste')", name="ck_transactions_tipo"
        ),
        # La red de seguridad contra cobros duplicados. Indice PARCIAL: solo
        # aplica a los cargos, para no estorbar a recargas ni ajustes (que no
        # llevan subscription_id) ni a un mismo cargo reactivado en otra fecha.
        Index(
            "ux_cargo_suscripcion_fecha",
            "subscription_id",
            "fecha",
            unique=True,
            sqlite_where=text("tipo = 'cargo'"),
        ),
    )


class AppState(Base):
    __tablename__ = "app_state"

    clave: Mapped[str] = mapped_column(String(60), primary_key=True)
    valor: Mapped[str] = mapped_column(Text, nullable=False)
