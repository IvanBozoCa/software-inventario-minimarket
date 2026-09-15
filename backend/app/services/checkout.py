from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.payment import Payment, PaymentMethod, PaymentStatus
from app.models.product import Product
from app.models.sale import Sale, SaleItemType, SaleStatus
from app.models.stock_movement import StockMovement, StockMovementType


class CheckoutError(ValueError):
    """Base error for payment and sale completion rules."""


class SaleNotFoundError(CheckoutError):
    pass


class SaleNotPayableError(CheckoutError):
    pass


class EmptySaleError(CheckoutError):
    pass


class InsufficientCashError(CheckoutError):
    pass


class PaymentNotFoundError(CheckoutError):
    pass


class PaymentNotConfirmableError(CheckoutError):
    pass


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _get_sale_or_raise(db: Session, sale_id: UUID) -> Sale:
    sale = db.get(Sale, sale_id)
    if sale is None:
        raise SaleNotFoundError("Venta no encontrada")
    return sale


def _ensure_sale_has_total(sale: Sale) -> None:
    if sale.total_clp <= 0 or not sale.items:
        raise EmptySaleError("La venta no tiene productos para cobrar")


def _get_draft_sale_for_payment(db: Session, sale_id: UUID) -> Sale:
    sale = _get_sale_or_raise(db, sale_id)
    if sale.status != SaleStatus.DRAFT:
        raise SaleNotPayableError("La venta ya no está disponible para iniciar un cobro")
    _ensure_sale_has_total(sale)
    return sale


def _create_sale_stock_movements(db: Session, sale: Sale) -> None:
    for item in sale.items:
        if item.item_type != SaleItemType.PRODUCT or item.product_id is None:
            continue

        product = db.get(Product, item.product_id)
        if product is None:
            raise CheckoutError("No se encontró un producto asociado a la venta")

        if not product.track_stock:
            continue

        db.add(
            StockMovement(
                product_id=product.id,
                movement_type=StockMovementType.SALE,
                quantity_delta=-Decimal(item.quantity),
                note=f"Venta {sale.id}",
            )
        )


def complete_cash_payment(
    db: Session,
    sale_id: UUID,
    cash_received_clp: int,
) -> tuple[Sale, Payment]:
    sale = _get_draft_sale_for_payment(db, sale_id)

    if cash_received_clp < sale.total_clp:
        raise InsufficientCashError("El efectivo recibido no alcanza para cubrir el total")

    payment = Payment(
        sale_id=sale.id,
        method=PaymentMethod.CASH,
        status=PaymentStatus.CONFIRMED,
        amount_clp=sale.total_clp,
        cash_received_clp=cash_received_clp,
        change_clp=cash_received_clp - sale.total_clp,
        confirmed_at=utc_now(),
    )

    db.add(payment)
    _create_sale_stock_movements(db, sale)
    sale.status = SaleStatus.COMPLETED

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(sale)
    db.refresh(payment)
    return sale, payment


def start_card_payment(
    db: Session,
    sale_id: UUID,
    *,
    provider: str | None = None,
    external_reference: str | None = None,
) -> tuple[Sale, Payment]:
    sale = _get_draft_sale_for_payment(db, sale_id)

    payment = Payment(
        sale_id=sale.id,
        method=PaymentMethod.CARD,
        status=PaymentStatus.PENDING,
        amount_clp=sale.total_clp,
        cash_received_clp=None,
        change_clp=None,
        provider=provider.strip() if provider and provider.strip() else None,
        external_reference=(
            external_reference.strip()
            if external_reference and external_reference.strip()
            else None
        ),
    )
    sale.status = SaleStatus.PAYMENT_PENDING
    db.add(payment)

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(sale)
    db.refresh(payment)
    return sale, payment


def confirm_card_payment(
    db: Session,
    sale_id: UUID,
    payment_id: UUID,
    *,
    provider: str | None = None,
    external_reference: str | None = None,
) -> tuple[Sale, Payment]:
    sale = _get_sale_or_raise(db, sale_id)
    if sale.status != SaleStatus.PAYMENT_PENDING:
        raise SaleNotPayableError("La venta no está esperando confirmación de tarjeta")

    payment = db.get(Payment, payment_id)
    if payment is None or payment.sale_id != sale.id:
        raise PaymentNotFoundError("Pago no encontrado")

    if payment.method != PaymentMethod.CARD or payment.status != PaymentStatus.PENDING:
        raise PaymentNotConfirmableError("El pago no está pendiente de confirmación")

    if payment.amount_clp < sale.total_clp:
        raise PaymentNotConfirmableError("El pago confirmado no cubre el total de la venta")

    if provider is not None:
        payment.provider = provider.strip() or None
    if external_reference is not None:
        payment.external_reference = external_reference.strip() or None

    payment.status = PaymentStatus.CONFIRMED
    payment.confirmed_at = utc_now()
    _create_sale_stock_movements(db, sale)
    sale.status = SaleStatus.COMPLETED

    try:
        db.commit()
    except Exception:
        db.rollback()
        raise

    db.refresh(sale)
    db.refresh(payment)
    return sale, payment


def get_pending_card_payment(db: Session, sale_id: UUID) -> Payment | None:
    return db.scalar(
        select(Payment).where(
            Payment.sale_id == sale_id,
            Payment.method == PaymentMethod.CARD,
            Payment.status == PaymentStatus.PENDING,
        )
    )
