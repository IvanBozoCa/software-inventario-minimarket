from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.market import MarketScope, MarketSourceType, MatchType, PriceType
from app.models.product import ContentUnit
from app.schemas.limits import MAX_PRICE_CLP


def _clean(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


class MarketSourceCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    source_type: MarketSourceType
    scope: MarketScope
    locality: str | None = Field(default=None, max_length=120)
    url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre de la fuente no puede estar vacío")
        return value

    @field_validator("locality", "url", "notes")
    @classmethod
    def normalize_optional(cls, value: str | None) -> str | None:
        return _clean(value)


class MarketSourceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    source_type: MarketSourceType | None = None
    scope: MarketScope | None = None
    locality: str | None = Field(default=None, max_length=120)
    url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)
    active: bool | None = None

    @field_validator("locality", "url", "notes")
    @classmethod
    def normalize_optional(cls, value: str | None) -> str | None:
        return _clean(value)


class MarketSourceRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    source_type: MarketSourceType
    scope: MarketScope
    locality: str | None
    url: str | None
    notes: str | None
    active: bool
    created_at: datetime


class ObservationCreate(BaseModel):
    price_clp: int = Field(gt=0, le=MAX_PRICE_CLP)
    price_type: PriceType
    promo_valid_from: date | None = None
    promo_valid_until: date | None = None
    observed_on: date
    url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)

    @field_validator("url", "notes")
    @classmethod
    def normalize_optional(cls, value: str | None) -> str | None:
        return _clean(value)

    @model_validator(mode="after")
    def validate_promo(self) -> "ObservationCreate":
        if self.price_type == PriceType.REGULAR and (
            self.promo_valid_from or self.promo_valid_until
        ):
            raise ValueError("La vigencia solo aplica a precios promocionales")
        if (
            self.promo_valid_from
            and self.promo_valid_until
            and self.promo_valid_until < self.promo_valid_from
        ):
            raise ValueError("La vigencia de la promoción termina antes de comenzar")
        if self.promo_valid_until and self.promo_valid_until < self.observed_on:
            raise ValueError(
                "La promoción no puede terminar antes de la fecha de observación"
            )
        if self.observed_on > date.today():
            raise ValueError("La fecha de observación no puede estar en el futuro")
        return self


class MarketReferenceCreate(BaseModel):
    source_id: UUID
    product_name: str = Field(min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=120)
    variant: str | None = Field(default=None, max_length=120)
    content_amount: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=3)
    content_unit: ContentUnit | None = None
    product_url: str | None = Field(default=None, max_length=500)
    product_id: UUID | None = None
    match_type: MatchType | None = None
    notes: str | None = Field(default=None, max_length=1000)
    first_observation: ObservationCreate | None = None

    @field_validator("product_name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre del producto observado no puede estar vacío")
        return value

    @field_validator("brand", "variant", "product_url", "notes")
    @classmethod
    def normalize_optional(cls, value: str | None) -> str | None:
        return _clean(value)

    @model_validator(mode="after")
    def validate_match(self) -> "MarketReferenceCreate":
        if (self.product_id is None) != (self.match_type is None):
            raise ValueError(
                "Para asociar a un producto propio indica si es coincidencia exacta o equivalente"
            )
        if (self.content_amount is None) != (self.content_unit is None):
            raise ValueError("El contenido requiere cantidad y unidad")
        return self


class MarketReferenceUpdate(BaseModel):
    product_name: str | None = Field(default=None, min_length=1, max_length=200)
    brand: str | None = Field(default=None, max_length=120)
    variant: str | None = Field(default=None, max_length=120)
    content_amount: Decimal | None = Field(default=None, gt=0, max_digits=12, decimal_places=3)
    content_unit: ContentUnit | None = None
    product_url: str | None = Field(default=None, max_length=500)
    notes: str | None = Field(default=None, max_length=1000)
    active: bool | None = None

    @field_validator("brand", "variant", "product_url", "notes")
    @classmethod
    def normalize_optional(cls, value: str | None) -> str | None:
        return _clean(value)


class MarketReferenceLink(BaseModel):
    """Asocia (o desasocia, con product_id nulo) una referencia a un producto."""

    product_id: UUID | None
    match_type: MatchType | None = None

    @model_validator(mode="after")
    def validate_match(self) -> "MarketReferenceLink":
        if (self.product_id is None) != (self.match_type is None):
            raise ValueError(
                "Para asociar a un producto propio indica si es coincidencia exacta o equivalente"
            )
        return self


class ObservationInvalidate(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class MarketImport(BaseModel):
    csv: str = Field(min_length=1, max_length=5_000_000)


class ImportResultRead(BaseModel):
    sources_created: int
    references_created: int
    observations_created: int
    duplicates_skipped: int
    errors: list[str]


class SettingsRead(BaseModel):
    market_stale_days: int


class SettingsUpdate(BaseModel):
    market_stale_days: int = Field(ge=1, le=3650)
