from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.product import PriceMode, SaleMode


class ProductCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    barcode: str | None = Field(default=None, max_length=64)
    category_id: UUID | None = None
    sale_mode: SaleMode = SaleMode.UNIT
    price_mode: PriceMode = PriceMode.FIXED
    sale_price_clp: int | None = Field(default=None, ge=0)
    track_stock: bool = True
    track_expiration: bool = False
    is_returnable: bool = False
    age_restricted: bool = False
    active: bool = True

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre del producto no puede estar vacío")
        return value

    @field_validator("barcode")
    @classmethod
    def normalize_barcode(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None

    @model_validator(mode="after")
    def validate_fixed_price(self) -> "ProductCreate":
        if self.price_mode == PriceMode.FIXED and self.sale_price_clp is None:
            raise ValueError("Un producto con precio fijo requiere sale_price_clp")
        return self


class ProductUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    barcode: str | None = Field(default=None, max_length=64)
    category_id: UUID | None = None
    sale_mode: SaleMode | None = None
    price_mode: PriceMode | None = None
    sale_price_clp: int | None = Field(default=None, ge=0)
    track_stock: bool | None = None
    track_expiration: bool | None = None
    is_returnable: bool | None = None
    age_restricted: bool | None = None
    active: bool | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("El nombre del producto no puede estar vacío")
        return value

    @field_validator("barcode")
    @classmethod
    def normalize_barcode(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        return value or None


class ProductRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    barcode: str | None
    category_id: UUID | None
    sale_mode: SaleMode
    price_mode: PriceMode
    sale_price_clp: int | None
    track_stock: bool
    track_expiration: bool
    is_returnable: bool
    age_restricted: bool
    active: bool
    created_at: datetime
    updated_at: datetime
