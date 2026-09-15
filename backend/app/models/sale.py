from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from enum import Enum as PythonEnum
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Integer, Numeric, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.product import Product


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class SaleStatus(str, PythonEnum):
    DRAFT = "DRAFT"
    PAYMENT_PENDING = "PAYMENT_PENDING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    VOIDED = "VOIDED"


class SaleItemType(str, PythonEnum):
    PRODUCT = "PRODUCT"
    FREE_AMOUNT = "FREE_AMOUNT"


class Sale(Base):
    __tablename__ = "sales"
    __table_args__ = (
        CheckConstraint("subtotal_clp >= 0", name="ck_sales_subtotal_non_negative"),
        CheckConstraint("total_clp >= 0", name="ck_sales_total_non_negative"),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    status: Mapped[SaleStatus] = mapped_column(
        Enum(
            SaleStatus,
            native_enum=False,
            create_constraint=True,
            name="sale_status",
        ),
        nullable=False,
        default=SaleStatus.DRAFT,
        index=True,
    )
    subtotal_clp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_clp: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        index=True,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        onupdate=utc_now,
    )

    items: Mapped[list[SaleItem]] = relationship(
        "SaleItem",
        back_populates="sale",
        cascade="all, delete-orphan",
        order_by="SaleItem.created_at",
    )


class SaleItem(Base):
    __tablename__ = "sale_items"
    __table_args__ = (
        CheckConstraint(
            "length(trim(description_snapshot)) > 0",
            name="ck_sale_items_description_not_blank",
        ),
        CheckConstraint("quantity > 0", name="ck_sale_items_quantity_positive"),
        CheckConstraint(
            "unit_price_clp >= 0",
            name="ck_sale_items_unit_price_non_negative",
        ),
        CheckConstraint(
            "line_total_clp >= 0",
            name="ck_sale_items_line_total_non_negative",
        ),
        CheckConstraint(
            "(item_type = 'PRODUCT' AND product_id IS NOT NULL) OR "
            "(item_type = 'FREE_AMOUNT' AND product_id IS NULL)",
            name="ck_sale_items_product_reference_by_type",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    sale_id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("sales.id"),
        nullable=False,
        index=True,
    )
    product_id: Mapped[UUID | None] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("products.id"),
        nullable=True,
        index=True,
    )
    item_type: Mapped[SaleItemType] = mapped_column(
        Enum(
            SaleItemType,
            native_enum=False,
            create_constraint=True,
            name="sale_item_type",
        ),
        nullable=False,
    )
    description_snapshot: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 3),
        nullable=False,
        default=Decimal("1.000"),
    )
    unit_price_clp: Mapped[int] = mapped_column(Integer, nullable=False)
    line_total_clp: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
    )

    sale: Mapped[Sale] = relationship("Sale", back_populates="items")
    product: Mapped[Product | None] = relationship("Product")
