from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, Numeric, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Category(Base):
    __tablename__ = "categories"
    __table_args__ = (
        CheckConstraint(
            "length(trim(name)) > 0",
            name="ck_categories_name_not_blank",
        ),
        CheckConstraint(
            "min_margin IS NULL OR (min_margin >= 0 AND min_margin < 1)",
            name="ck_categories_min_margin_range",
        ),
        CheckConstraint(
            "upper_margin IS NULL OR (upper_margin >= 0 AND upper_margin < 1)",
            name="ck_categories_upper_margin_range",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid4,
    )
    name: Mapped[str] = mapped_column(
        String(120),
        nullable=False,
        unique=True,
        index=True,
    )
    # Márgenes configurados por el administrador (proporción 0..1 sobre el
    # precio de venta). Sin valores predeterminados.
    min_margin: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
    upper_margin: Mapped[Decimal | None] = mapped_column(Numeric(6, 4), nullable=True)
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

    products: Mapped[list["Product"]] = relationship(
        "Product",
        back_populates="category",
    )
