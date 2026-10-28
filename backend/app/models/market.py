from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal
from enum import Enum as PythonEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.product import ContentUnit, Product


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class MarketSourceType(str, PythonEnum):
    LOCAL_STORE = "LOCAL_STORE"
    SUPERMARKET_WEB = "SUPERMARKET_WEB"
    PUBLIC_AGENCY = "PUBLIC_AGENCY"
    OTHER = "OTHER"


class MarketScope(str, PythonEnum):
    """Cobertura geográfica de una fuente de precios."""

    PICHILEMU = "PICHILEMU"
    OHIGGINS = "OHIGGINS"
    NATIONAL = "NATIONAL"
    WEB = "WEB"


class MatchType(str, PythonEnum):
    EXACT = "EXACT"
    EQUIVALENT = "EQUIVALENT"


class PriceType(str, PythonEnum):
    REGULAR = "REGULAR"
    PROMO = "PROMO"


class ObservationStatus(str, PythonEnum):
    VALID = "VALID"
    INVALID = "INVALID"


class MarketSource(Base):
    """Tienda, sitio o institución donde se observó un precio."""

    __tablename__ = "market_sources"
    __table_args__ = (
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_market_sources_name_not_blank",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    name: Mapped[str] = mapped_column(String(160), nullable=False, unique=True)
    source_type: Mapped[MarketSourceType] = mapped_column(
        Enum(
            MarketSourceType,
            native_enum=False,
            create_constraint=True,
            name="market_source_type",
        ),
        nullable=False,
    )
    scope: Mapped[MarketScope] = mapped_column(
        Enum(
            MarketScope,
            native_enum=False,
            create_constraint=True,
            name="market_scope",
        ),
        nullable=False,
    )
    locality: Mapped[str | None] = mapped_column(String(120), nullable=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )


class MarketReference(Base):
    """Producto observado en una fuente de mercado.

    Se mantiene separado del inventario propio. Puede asociarse a un producto
    del minimarket como coincidencia exacta o como producto equivalente.
    """

    __tablename__ = "market_references"
    __table_args__ = (
        CheckConstraint(
            "length(trim(product_name)) > 0",
            name="ck_market_references_name_not_blank",
        ),
        CheckConstraint(
            "(product_id IS NULL AND match_type IS NULL) OR "
            "(product_id IS NOT NULL AND match_type IS NOT NULL)",
            name="ck_market_references_match_requires_product",
        ),
        CheckConstraint(
            "content_amount IS NULL OR content_amount > 0",
            name="ck_market_references_content_amount_positive",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    source_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("market_sources.id"),
        nullable=False,
        index=True,
    )
    product_name: Mapped[str] = mapped_column(String(200), nullable=False, index=True)
    brand: Mapped[str | None] = mapped_column(String(120), nullable=True)
    variant: Mapped[str | None] = mapped_column(String(120), nullable=True)
    content_amount: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 3),
        nullable=True,
    )
    content_unit: Mapped[ContentUnit | None] = mapped_column(
        Enum(
            ContentUnit,
            native_enum=False,
            create_constraint=True,
            name="market_content_unit",
        ),
        nullable=True,
    )
    product_url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    product_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("products.id"),
        nullable=True,
        index=True,
    )
    match_type: Mapped[MatchType | None] = mapped_column(
        Enum(
            MatchType,
            native_enum=False,
            create_constraint=True,
            name="market_match_type",
        ),
        nullable=True,
    )
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )

    source: Mapped[MarketSource] = relationship("MarketSource")
    product: Mapped[Product | None] = relationship("Product")
    observations: Mapped[list["MarketObservation"]] = relationship(
        "MarketObservation",
        back_populates="reference",
        order_by="MarketObservation.observed_on",
    )


class MarketObservation(Base):
    """Precio observado en una fecha. Nunca se borra: se invalida o corrige."""

    __tablename__ = "market_observations"
    __table_args__ = (
        CheckConstraint("price_clp > 0", name="ck_market_observations_price_positive"),
        CheckConstraint(
            "price_type = 'PROMO' OR (promo_valid_from IS NULL AND promo_valid_until IS NULL)",
            name="ck_market_observations_promo_dates_only_for_promo",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    reference_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("market_references.id"),
        nullable=False,
        index=True,
    )
    price_clp: Mapped[int] = mapped_column(Integer, nullable=False)
    price_type: Mapped[PriceType] = mapped_column(
        Enum(
            PriceType,
            native_enum=False,
            create_constraint=True,
            name="market_price_type",
        ),
        nullable=False,
    )
    promo_valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    promo_valid_until: Mapped[date | None] = mapped_column(Date, nullable=True)
    observed_on: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    url: Mapped[str | None] = mapped_column(String(500), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(1000), nullable=True)
    status: Mapped[ObservationStatus] = mapped_column(
        Enum(
            ObservationStatus,
            native_enum=False,
            create_constraint=True,
            name="market_observation_status",
        ),
        nullable=False,
        default=ObservationStatus.VALID,
    )
    invalid_reason: Mapped[str | None] = mapped_column(String(500), nullable=True)
    replaced_by_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("market_observations.id"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )
    invalidated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    reference: Mapped[MarketReference] = relationship(
        "MarketReference",
        back_populates="observations",
    )


class AppSetting(Base):
    """Configuración simple clave/valor (p. ej. días de vigencia de referencias)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(String(500), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )
