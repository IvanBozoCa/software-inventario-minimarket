from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum as PythonEnum
from uuid import UUID, uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SaleMode(str, PythonEnum):
    UNIT = "UNIT"
    WEIGHT = "WEIGHT"
    FREE_AMOUNT = "FREE_AMOUNT"


class PriceMode(str, PythonEnum):
    FIXED = "FIXED"
    FREE = "FREE"


class Product(Base):
    __tablename__ = "products"
    __table_args__ = (
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_products_name_not_blank",
        ),
        CheckConstraint(
            "sale_price_clp IS NULL OR sale_price_clp >= 0",
            name="ck_products_sale_price_non_negative",
        ),
        CheckConstraint(
            "price_mode != 'FIXED' OR sale_price_clp IS NOT NULL",
            name="ck_products_fixed_price_required",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        index=True,
    )
    barcode: Mapped[str | None] = mapped_column(
        String(64),
        nullable=True,
        unique=True,
        index=True,
    )
    category_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("categories.id"),
        nullable=True,
        index=True,
    )
    sale_mode: Mapped[SaleMode] = mapped_column(
        Enum(
            SaleMode,
            native_enum=False,
            create_constraint=True,
            name="sale_mode",
        ),
        nullable=False,
        default=SaleMode.UNIT,
    )
    price_mode: Mapped[PriceMode] = mapped_column(
        Enum(
            PriceMode,
            native_enum=False,
            create_constraint=True,
            name="price_mode",
        ),
        nullable=False,
        default=PriceMode.FIXED,
    )
    sale_price_clp: Mapped[int | None] = mapped_column(
        Integer,
        nullable=True,
    )
    track_stock: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )
    track_expiration: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    is_returnable: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    age_restricted: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
    )
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
    )
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

    category: Mapped["Category | None"] = relationship(
        "Category",
        back_populates="products",
    )
