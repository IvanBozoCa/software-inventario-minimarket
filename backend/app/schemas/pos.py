from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.payment import PaymentMethod
from app.models.product import SaleMode, StockUnit
from app.models.sale import SaleStatus
from app.schemas.limits import MAX_PRICE_CLP


class CatalogItem(BaseModel):
    id: UUID
    label: str
    name: str
    brand: str | None
    variant: str | None
    barcode: str | None
    category_name: str | None
    sale_price_clp: int | None
    sale_mode: SaleMode
    stock_unit: StockUnit
    track_stock: bool
    quantity: Decimal | None


class LineCreate(BaseModel):
    product_id: UUID | None = None
    quantity: Decimal = Field(gt=0, le=10000, max_digits=14, decimal_places=3)
    # Precio que mostraba la caja; para montos libres y productos sin precio es el precio a cobrar.
    unit_price_clp: int | None = Field(default=None, ge=0, le=MAX_PRICE_CLP)
    description: str | None = Field(default=None, max_length=120)


class SaleCreate(BaseModel):
    client_ref: str = Field(min_length=8, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    lines: list[LineCreate] = Field(min_length=1, max_length=200)
    payment_method: PaymentMethod
    cash_received_clp: int | None = Field(default=None, ge=0, le=MAX_PRICE_CLP)
    expected_total_clp: int | None = Field(default=None, ge=0)


class SaleLineRead(BaseModel):
    product_id: UUID | None
    description: str
    quantity: Decimal
    unit_price_clp: int
    line_total_clp: int


class PosSaleRead(BaseModel):
    id: UUID
    status: SaleStatus
    total_clp: int
    payment_method: PaymentMethod | None
    cash_received_clp: int | None = None
    change_clp: int | None = None
    seller_id: UUID | None
    seller_name: str | None
    completed_at: datetime | None
    voided_at: datetime | None
    void_reason: str | None
    voided_by_name: str | None
    lines: list[SaleLineRead]
    warnings: list[str] = []


class SellerTotal(BaseModel):
    seller_id: UUID | None
    seller_name: str
    count: int
    total_clp: int


class DaySalesRead(BaseModel):
    day: date
    count: int
    total_clp: int
    by_method: dict[str, int]
    sellers: list[SellerTotal]
    voided_count: int
    sales: list[PosSaleRead]


class VoidPayload(BaseModel):
    reason: str = Field(min_length=1, max_length=300)
