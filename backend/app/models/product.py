from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum as PythonEnum
from uuid import UUID, uuid4

from decimal import Decimal

from sqlalchemy import (
    Boolean,
    CheckConstraint,
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
from app.models.category import Category


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SaleMode(str, PythonEnum):
    UNIT = "UNIT"
    WEIGHT = "WEIGHT"
    FREE_AMOUNT = "FREE_AMOUNT"


class PriceMode(str, PythonEnum):
    FIXED = "FIXED"
    FREE = "FREE"


class StockUnit(str, PythonEnum):
    """Unidad en que se controla la cantidad disponible."""

    UNIT = "UNIT"
    KG = "KG"
    L = "L"


class ContentUnit(str, PythonEnum):
    """Unidad del contenido o presentación comercial (p. ej. 1,5 L)."""

    G = "G"
    KG = "KG"
    ML = "ML"
    L = "L"
    UNIT = "UNIT"


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
        CheckConstraint(
            "last_unit_cost_clp IS NULL OR last_unit_cost_clp >= 0",
            name="ck_products_unit_cost_non_negative",
        ),
        CheckConstraint(
            "extra_supply_cost_clp IS NULL OR extra_supply_cost_clp >= 0",
            name="ck_products_extra_cost_non_negative",
        ),
        CheckConstraint(
            "min_margin IS NULL OR (min_margin >= 0 AND min_margin < 1)",
            name="ck_products_min_margin_range",
        ),
        CheckConstraint(
            "upper_margin IS NULL OR (upper_margin >= 0 AND upper_margin < 1)",
            name="ck_products_upper_margin_range",
        ),
        CheckConstraint(
            "content_amount IS NULL OR content_amount > 0",
            name="ck_products_content_amount_positive",
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
            name="content_unit",
        ),
        nullable=True,
    )
    stock_unit: Mapped[StockUnit] = mapped_column(
        Enum(
            StockUnit,
            native_enum=False,
            create_constraint=True,
            name="stock_unit",
        ),
        nullable=False,
        default=StockUnit.UNIT,
        server_default=StockUnit.UNIT.value,
    )
    # Último costo unitario de compra confirmado (normalmente con IVA).
    last_unit_cost_clp: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    # Costo adicional de abastecimiento por unidad (p. ej. transporte),
    # registrado explícitamente y separado del costo de compra.
    extra_supply_cost_clp: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 2),
        nullable=True,
    )
    # Márgenes particulares del producto (proporción 0..1). Si son NULL se
    # usan los márgenes de la categoría.
    min_margin: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    upper_margin: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
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

    category: Mapped[Category | None] = relationship(
        "Category",
        back_populates="products",
    )
