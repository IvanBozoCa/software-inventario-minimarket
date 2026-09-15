from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.stock_movement import StockMovementType


class InitialStockCreate(BaseModel):
    product_id: UUID
    quantity: Decimal = Field(gt=0, max_digits=14, decimal_places=3)
    note: str | None = Field(default=None, max_length=500)


class InitialStockRead(BaseModel):
    movement_id: UUID
    product_id: UUID
    movement_type: StockMovementType
    quantity_delta: Decimal
    expected_stock: Decimal
    note: str | None
    created_at: datetime


class ProductStockRead(BaseModel):
    product_id: UUID
    expected_stock: Decimal
    track_stock: bool
