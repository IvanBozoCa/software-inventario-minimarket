from decimal import Decimal
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.stock_movement import StockMovement


ZERO_STOCK = Decimal("0.000")


def get_expected_stock(db: Session, product_id: UUID) -> Decimal:
    """Reconstruct the expected stock by summing all movements for a product."""
    statement = select(func.sum(StockMovement.quantity_delta)).where(
        StockMovement.product_id == product_id,
    )
    total = db.scalar(statement)

    if total is None:
        return ZERO_STOCK

    return Decimal(total).quantize(Decimal("0.001"))
