from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.product import ContentUnit, PriceMode, SaleMode, StockUnit


def _clean_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _check_margins(min_margin: Decimal | None, upper_margin: Decimal | None) -> None:
    if (
        min_margin is not None
        and upper_margin is not None
        and upper_margin < min_margin
    ):
        raise ValueError(
            "El margen superior de referencia no puede ser menor que el margen mínimo"
        )


# Margen expresado como proporción (0,25 = 25 %). Debe ser menor que 1 para
# que costo / (1 − margen) sea válido.
def margin_field():
    return Field(default=None, ge=0, lt=1, max_digits=6, decimal_places=4)


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
    brand: str | None = Field(default=None, max_length=120)
    variant: str | None = Field(default=None, max_length=120)
    content_amount: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=3)
    content_unit: ContentUnit | None = None
    stock_unit: StockUnit = StockUnit.UNIT
    last_unit_cost_clp: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    extra_supply_cost_clp: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    cost_source: str | None = Field(default=None, max_length=200)
    min_margin: Decimal | None = margin_field()
    upper_margin: Decimal | None = margin_field()
    initial_quantity: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=3)

    @field_validator("brand", "variant", "cost_source")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return _clean_optional_text(value)

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
        if (self.content_amount is None) != (self.content_unit is None):
            raise ValueError("El contenido requiere cantidad y unidad")
        _check_margins(self.min_margin, self.upper_margin)
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
    brand: str | None = Field(default=None, max_length=120)
    variant: str | None = Field(default=None, max_length=120)
    content_amount: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=3)
    content_unit: ContentUnit | None = None
    stock_unit: StockUnit | None = None
    min_margin: Decimal | None = margin_field()
    upper_margin: Decimal | None = margin_field()
    price_note: str | None = Field(default=None, max_length=500)

    @field_validator("brand", "variant", "price_note")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return _clean_optional_text(value)

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
    brand: str | None
    variant: str | None
    content_amount: Decimal | None
    content_unit: ContentUnit | None
    stock_unit: StockUnit
    last_unit_cost_clp: Decimal | None
    extra_supply_cost_clp: Decimal | None
    min_margin: Decimal | None
    upper_margin: Decimal | None
    created_at: datetime
    updated_at: datetime


class ProductCostUpdate(BaseModel):
    last_unit_cost_clp: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    extra_supply_cost_clp: Decimal | None = Field(default=None, ge=0, max_digits=12, decimal_places=2)
    source: str | None = Field(default=None, max_length=200)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("source", "note")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return _clean_optional_text(value)


class ProductPriceUpdate(BaseModel):
    sale_price_clp: int = Field(ge=0)
    note: str | None = Field(default=None, max_length=500)

    @field_validator("note")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        return _clean_optional_text(value)


class ProductStockUpdate(BaseModel):
    quantity: Decimal = Field(ge=0, max_digits=14, decimal_places=3)
    note: str | None = Field(default=None, max_length=500)
