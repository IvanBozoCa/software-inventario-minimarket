from datetime import datetime
from decimal import Decimal
from enum import Enum as PythonEnum
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.sale import SaleItemType, SaleStatus


class ScanResultType(str, PythonEnum):
    ADDED = "ADDED"
    UNKNOWN_BARCODE = "UNKNOWN_BARCODE"
    MANUAL_PRICE_REQUIRED = "MANUAL_PRICE_REQUIRED"


class SaleItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sale_id: UUID
    product_id: UUID | None
    item_type: SaleItemType
    description_snapshot: str
    quantity: Decimal
    unit_price_clp: int
    line_total_clp: int
    created_at: datetime


class SaleRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    status: SaleStatus
    subtotal_clp: int
    total_clp: int
    created_at: datetime
    updated_at: datetime
    items: list[SaleItemRead]


class ScanBarcodeRequest(BaseModel):
    barcode: str = Field(min_length=1, max_length=64)

    @field_validator("barcode")
    @classmethod
    def normalize_barcode(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El código de barras no puede estar vacío")
        return value


class AddProductRequest(BaseModel):
    product_id: UUID
    quantity: Decimal = Field(default=Decimal("1.000"), gt=0)


class AddFreeAmountRequest(BaseModel):
    amount_clp: int = Field(gt=0)
    description: str = Field(default="Monto libre", min_length=1, max_length=200)

    @field_validator("description")
    @classmethod
    def normalize_description(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("La descripción no puede estar vacía")
        return value


class ScanBarcodeResponse(BaseModel):
    result: ScanResultType
    message: str
    added_item_id: UUID | None = None
    sale: SaleRead
