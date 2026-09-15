from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum as PythonEnum
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Integer, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models.sale import Sale


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class PaymentMethod(str, PythonEnum):
    CASH = "CASH"
    CARD = "CARD"


class PaymentStatus(str, PythonEnum):
    PENDING = "PENDING"
    CONFIRMED = "CONFIRMED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class Payment(Base):
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint("amount_clp > 0", name="ck_payments_amount_positive"),
        CheckConstraint(
            "cash_received_clp IS NULL OR cash_received_clp >= 0",
            name="ck_payments_cash_received_non_negative",
        ),
        CheckConstraint(
            "change_clp IS NULL OR change_clp >= 0",
            name="ck_payments_change_non_negative",
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
    method: Mapped[PaymentMethod] = mapped_column(
        Enum(
            PaymentMethod,
            native_enum=False,
            create_constraint=True,
            name="payment_method",
        ),
        nullable=False,
        index=True,
    )
    status: Mapped[PaymentStatus] = mapped_column(
        Enum(
            PaymentStatus,
            native_enum=False,
            create_constraint=True,
            name="payment_status",
        ),
        nullable=False,
        default=PaymentStatus.PENDING,
        index=True,
    )
    amount_clp: Mapped[int] = mapped_column(Integer, nullable=False)
    cash_received_clp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    change_clp: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider: Mapped[str | None] = mapped_column(String(100), nullable=True)
    external_reference: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=utc_now,
        index=True,
    )
    confirmed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    sale: Mapped[Sale] = relationship("Sale")
