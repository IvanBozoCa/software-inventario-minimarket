from datetime import date, datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.market import MarketScope, MatchType, ObservationStatus, PriceType
from app.models.product import ContentUnit, StockUnit
from app.schemas.product import ProductRead
from app.services.pricing import MarginSource, WarningCode


class PricingWarningRead(BaseModel):
    code: WarningCode
    message: str


class PricingAnalysisRead(BaseModel):
    sale_price_clp: int | None
    unit_cost_clp: Decimal | None
    extra_supply_cost_clp: Decimal | None
    total_unit_cost_clp: Decimal | None
    min_margin: Decimal | None
    min_margin_source: MarginSource | None
    upper_margin: Decimal | None
    upper_margin_source: MarginSource | None
    price_at_min_margin: Decimal | None
    price_at_upper_margin: Decimal | None
    current_gross_margin: Decimal | None
    current_markup: Decimal | None
    range_available: bool
    needs_review: bool
    warnings: list[PricingWarningRead]


class ProductOverviewRow(BaseModel):
    id: UUID
    name: str
    brand: str | None
    variant: str | None
    content_amount: Decimal | None
    content_unit: ContentUnit | None
    category_id: UUID | None
    category_name: str | None
    active: bool
    track_stock: bool
    stock_unit: StockUnit
    quantity: Decimal | None
    sale_price_clp: int | None
    total_unit_cost_clp: Decimal | None
    current_gross_margin: Decimal | None
    cost_pending: bool
    margins_pending: bool
    market_reference_count: int
    market_references_stale: bool
    needs_review: bool


class CostChangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    previous_unit_cost_clp: Decimal | None
    new_unit_cost_clp: Decimal | None
    previous_extra_cost_clp: Decimal | None
    new_extra_cost_clp: Decimal | None
    source: str | None
    note: str | None
    changed_at: datetime


class PriceChangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    previous_price_clp: int | None
    new_price_clp: int | None
    note: str | None
    changed_at: datetime


class ObservationRead(BaseModel):
    id: UUID
    reference_id: UUID
    price_clp: int
    price_type: PriceType
    promo_valid_from: date | None
    promo_valid_until: date | None
    observed_on: date
    url: str | None
    notes: str | None
    status: ObservationStatus
    invalid_reason: str | None
    replaced_by_id: UUID | None
    created_at: datetime
    age_days: int
    stale: bool
    promo_expired: bool
    promo_current: bool
    unit_price_clp: Decimal | None
    unit_price_label: str | None


class MarketSourceBrief(BaseModel):
    id: UUID
    name: str
    scope: MarketScope
    locality: str | None


class MarketReferenceDetail(BaseModel):
    id: UUID
    source: MarketSourceBrief
    product_name: str
    brand: str | None
    variant: str | None
    content_amount: Decimal | None
    content_unit: ContentUnit | None
    product_url: str | None
    product_id: UUID | None
    match_type: MatchType | None
    notes: str | None
    active: bool
    last_observed_on: date | None
    stale: bool
    observations: list[ObservationRead]


class ComparableExtremeRead(BaseModel):
    price_clp: int
    reference_id: UUID
    source_name: str
    scope: MarketScope
    observed_on: date


class ProductMarketRead(BaseModel):
    stale_days: int
    has_references: bool
    has_stale: bool
    exact_regular_low: ComparableExtremeRead | None
    exact_regular_high: ComparableExtremeRead | None
    references: list[MarketReferenceDetail]


class StockMovementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    movement_type: str
    quantity_delta: Decimal
    note: str | None
    created_at: datetime


class ProductDetailRead(BaseModel):
    product: ProductRead
    category_name: str | None
    quantity: Decimal | None
    pricing: PricingAnalysisRead
    cost_history: list[CostChangeRead]
    price_history: list[PriceChangeRead]
    stock_movements: list[StockMovementRead]
    market: ProductMarketRead

