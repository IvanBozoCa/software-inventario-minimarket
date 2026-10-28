from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, ForeignKey, Integer, Numeric, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.product import Product


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class ProductCostChange(Base):
    """Historial de costos de compra del minimarket (append-only)."""

    __tablename__ = "product_cost_changes"
    __table_args__ = (
        CheckConstraint(
            "new_unit_cost_clp IS NULL OR new_unit_cost_clp >= 0",
            name="ck_product_cost_changes_new_cost_non_negative",
        ),
        CheckConstraint(
            "new_extra_cost_clp IS NULL OR new_extra_cost_clp >= 0",
            name="ck_product_cost_changes_new_extra_non_negative",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("products.id"),
        nullable=False,
        index=True,
    )
    previous_unit_cost_clp: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    new_unit_cost_clp: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    previous_extra_cost_clp: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    new_extra_cost_clp: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    source: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        index=True,
    )

    product: Mapped[Product] = relationship("Product")


class ProductPriceChange(Base):
    """Historial de precios de venta propios del minimarket (append-only)."""

    __tablename__ = "product_price_changes"
    __table_args__ = (
        CheckConstraint(
            "new_price_clp IS NULL OR new_price_clp >= 0",
            name="ck_product_price_changes_new_price_non_negative",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    product_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("products.id"),
        nullable=False,
        index=True,
    )
    previous_price_clp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_price_clp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(String(500), nullable=True)
    changed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        index=True,
    )

    product: Mapped[Product] = relationship("Product")
