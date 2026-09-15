from decimal import Decimal, InvalidOperation
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.product import Product
from app.models.stock_movement import StockMovement, StockMovementType


STOCK_QUANTUM = Decimal("0.001")
ZERO_STOCK = Decimal("0.000")


class InventoryError(ValueError):
    """Base error for inventory business-rule violations."""


class ProductNotFoundError(InventoryError):
    pass


class StockTrackingDisabledError(InventoryError):
    pass


class InvalidInitialStockQuantityError(InventoryError):
    pass


def _normalize_quantity(value: Decimal | int | str) -> Decimal:
    try:
        quantity = Decimal(str(value)).quantize(STOCK_QUANTUM)
    except (InvalidOperation, ValueError) as exc:
        raise InvalidInitialStockQuantityError(
            "La cantidad inicial debe ser un número válido",
        ) from exc

    if quantity <= ZERO_STOCK:
        raise InvalidInitialStockQuantityError(
            "La cantidad inicial debe ser mayor que cero",
        )

    return quantity


def get_expected_stock(db: Session, product_id: UUID) -> Decimal:
    """Reconstruct the expected stock by summing all movements for a product."""
    statement = select(func.sum(StockMovement.quantity_delta)).where(
        StockMovement.product_id == product_id,
    )
    total = db.scalar(statement)

    if total is None:
        return ZERO_STOCK

    return Decimal(total).quantize(STOCK_QUANTUM)


def register_initial_stock(
    db: Session,
    product_id: UUID,
    quantity: Decimal | int | str,
    *,
    note: str | None = None,
    actor_user_id: UUID | None = None,
) -> tuple[StockMovement, Decimal]:
    """Register physical initial stock as an auditable INITIAL_STOCK movement."""
    product = db.get(Product, product_id)
    if product is None:
        raise ProductNotFoundError("Producto no encontrado")

    if not product.track_stock:
        raise StockTrackingDisabledError(
            "El producto no controla stock",
        )

    normalized_quantity = _normalize_quantity(quantity)

    movement = StockMovement(
        product_id=product.id,
        movement_type=StockMovementType.INITIAL_STOCK,
        quantity_delta=normalized_quantity,
        note=note.strip() if note and note.strip() else None,
        actor_user_id=actor_user_id,
    )
    db.add(movement)
    db.commit()
    db.refresh(movement)

    return movement, get_expected_stock(db, product.id)
