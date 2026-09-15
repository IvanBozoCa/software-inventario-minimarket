from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum as PythonEnum
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Numeric, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.product import Product


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class StockMovementType(str, PythonEnum):
    INITIAL_STOCK = "INITIAL_STOCK"
    PURCHASE = "PURCHASE"
    SALE = "SALE"
    SALE_REVERSAL = "SALE_REVERSAL"
    WASTE = "WASTE"
    RETURN = "RETURN"
    ADJUSTMENT = "ADJUSTMENT"


class StockMovement(Base):
    __tablename__ = "stock_movements"
    __table_args__ = (
        CheckConstraint(
            "quantity_delta != 0",
            name="ck_stock_movements_quantity_non_zero",
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

    movement_type: Mapped[StockMovementType] = mapped_column(
        Enum(
            StockMovementType,
            native_enum=False,
            create_constraint=True,
            name="stock_movement_type",
        ),
        nullable=False,
        index=True,
    )

    quantity_delta: Mapped[Decimal] = mapped_column(
        Numeric(14, 3),
        nullable=False,
    )

    note: Mapped[str | None] = mapped_column(
        String(500),
        nullable=True,
    )

    actor_user_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        nullable=True,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        index=True,
    )

    product: Mapped[Product] = relationship("Product")
