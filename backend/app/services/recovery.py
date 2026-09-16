from __future__ import annotations

from uuid import UUID

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models.payment import Payment, PaymentMethod, PaymentStatus
from app.models.sale import Sale, SaleStatus


class RecoveryError(ValueError):
    """Base error for interrupted-sale recovery rules."""


class SaleNotFoundError(RecoveryError):
    pass


class SaleNotRecoverableError(RecoveryError):
    pass


class RecoveryConflictError(RecoveryError):
    pass


def list_recoverable_sales(db: Session) -> list[Sale]:
    """Return meaningful interrupted sales that need a user decision.

    Empty DRAFT rows are ignored because no sale content can be lost. A DRAFT
    with a positive total or any PAYMENT_PENDING sale is recoverable.
    """

    statement = (
        select(Sale)
        .where(
            or_(
                Sale.status == SaleStatus.PAYMENT_PENDING,
                and_(
                    Sale.status == SaleStatus.DRAFT,
                    Sale.total_clp > 0,
                ),
            )
        )
        .order_by(Sale.created_at.asc())
    )
    return list(db.scalars(statement))


def get_pending_card_payment(db: Session, sale_id: UUID) -> Payment | None:
    payments = list(
        db.scalars(
            select(Payment)
            .where(
                Payment.sale_id == sale_id,
                Payment.method == PaymentMethod.CARD,
                Payment.status == PaymentStatus.PENDING,
            )
            .order_by(Payment.created_at.asc())
        )
    )

    if len(payments) > 1:
        raise RecoveryConflictError(
            "La venta tiene más de un pago con tarjeta pendiente y necesita revisión administrativa"
        )

    return payments[0] if payments else None


def discard_recoverable_sale(db: Session, sale_id: UUID) -> Sale:
    sale = db.get(Sale, sale_id)
    if sale is None:
        raise SaleNotFoundError("Venta no encontrada")

    if sale.status not in (SaleStatus.DRAFT, SaleStatus.PAYMENT_PENDING):
        raise SaleNotRecoverableError("La venta ya no está pendiente de recuperación")

    if sale.status == SaleStatus.PAYMENT_PENDING:
        payment = get_pending_card_payment(db, sale.id)
        if payment is None:
            raise RecoveryConflictError(
                "La venta espera un pago con tarjeta, pero no existe un pago pendiente asociado"
            )
        payment.status = PaymentStatus.CANCELLED

    sale.status = SaleStatus.CANCELLED

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(sale)
    return sale
