from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from enum import Enum as PythonEnum
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.product import PriceMode, Product, SaleMode
from app.models.sale import Sale, SaleItem, SaleItemType, SaleStatus


ONE_ITEM = Decimal("1.000")


class SaleError(ValueError):
    """Base error for sale business-rule violations."""


class SaleNotFoundError(SaleError):
    pass


class SaleNotDraftError(SaleError):
    pass


class SaleItemNotFoundError(SaleError):
    pass


class InvalidFreeAmountError(SaleError):
    pass


class ScanOutcome(str, PythonEnum):
    ADDED = "ADDED"
    UNKNOWN_BARCODE = "UNKNOWN_BARCODE"
    MANUAL_PRICE_REQUIRED = "MANUAL_PRICE_REQUIRED"


def _get_sale_or_raise(db: Session, sale_id: UUID) -> Sale:
    sale = db.get(Sale, sale_id)
    if sale is None:
        raise SaleNotFoundError("Venta no encontrada")
    return sale


def _get_draft_sale_or_raise(db: Session, sale_id: UUID) -> Sale:
    sale = _get_sale_or_raise(db, sale_id)
    if sale.status != SaleStatus.DRAFT:
        raise SaleNotDraftError("La venta ya no está en borrador")
    return sale


def _line_total(quantity: Decimal, unit_price_clp: int) -> int:
    return int(
        (quantity * Decimal(unit_price_clp)).quantize(
            Decimal("1"),
            rounding=ROUND_HALF_UP,
        )
    )


def _recalculate_sale(sale: Sale) -> None:
    total = sum(item.line_total_clp for item in sale.items)
    sale.subtotal_clp = total
    sale.total_clp = total


def create_draft_sale(db: Session) -> Sale:
    sale = Sale(
        status=SaleStatus.DRAFT,
        subtotal_clp=0,
        total_clp=0,
    )
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale


def get_sale(db: Session, sale_id: UUID) -> Sale:
    return _get_sale_or_raise(db, sale_id)


def scan_product_by_barcode(
    db: Session,
    sale_id: UUID,
    barcode: str,
) -> tuple[ScanOutcome, Sale, SaleItem | None]:
    sale = _get_draft_sale_or_raise(db, sale_id)
    normalized_barcode = barcode.strip()

    product = db.scalar(
        select(Product).where(
            Product.barcode == normalized_barcode,
            Product.active.is_(True),
        )
    )

    if product is None:
        return ScanOutcome.UNKNOWN_BARCODE, sale, None

    if (
        product.price_mode != PriceMode.FIXED
        or product.sale_price_clp is None
        or product.sale_mode == SaleMode.FREE_AMOUNT
    ):
        return ScanOutcome.MANUAL_PRICE_REQUIRED, sale, None

    existing_item = next(
        (
            item
            for item in sale.items
            if item.item_type == SaleItemType.PRODUCT
            and item.product_id == product.id
            and item.unit_price_clp == product.sale_price_clp
            and item.description_snapshot == product.name
        ),
        None,
    )

    if existing_item is not None:
        existing_item.quantity = Decimal(existing_item.quantity) + ONE_ITEM
        existing_item.line_total_clp = _line_total(
            Decimal(existing_item.quantity),
            existing_item.unit_price_clp,
        )
        item = existing_item
    else:
        item = SaleItem(
            sale=sale,
            product_id=product.id,
            item_type=SaleItemType.PRODUCT,
            description_snapshot=product.name,
            quantity=ONE_ITEM,
            unit_price_clp=product.sale_price_clp,
            line_total_clp=product.sale_price_clp,
        )

    _recalculate_sale(sale)
    db.commit()
    db.refresh(sale)
    return ScanOutcome.ADDED, sale, item


def add_free_amount(
    db: Session,
    sale_id: UUID,
    amount_clp: int,
    *,
    description: str = "Monto libre",
) -> tuple[Sale, SaleItem]:
    sale = _get_draft_sale_or_raise(db, sale_id)

    if amount_clp <= 0:
        raise InvalidFreeAmountError("El monto debe ser mayor que cero")

    normalized_description = description.strip()
    if not normalized_description:
        raise InvalidFreeAmountError("La descripción no puede estar vacía")

    item = SaleItem(
        sale=sale,
        product_id=None,
        item_type=SaleItemType.FREE_AMOUNT,
        description_snapshot=normalized_description,
        quantity=ONE_ITEM,
        unit_price_clp=amount_clp,
        line_total_clp=amount_clp,
    )
    _recalculate_sale(sale)

    db.commit()
    db.refresh(sale)
    return sale, item


def delete_draft_item(
    db: Session,
    sale_id: UUID,
    item_id: UUID,
) -> Sale:
    sale = _get_draft_sale_or_raise(db, sale_id)
    item = db.get(SaleItem, item_id)

    if item is None or item.sale_id != sale.id:
        raise SaleItemNotFoundError("Línea de venta no encontrada")

    sale.items.remove(item)
    _recalculate_sale(sale)

    db.commit()
    db.refresh(sale)
    return sale
