"""Convierte modelos y resultados de servicios en respuestas de la API."""

from __future__ import annotations

from datetime import date

from app.models.market import MarketObservation, MarketReference
from app.schemas.pricing import (
    MarketReferenceDetail,
    MarketSourceBrief,
    ObservationRead,
    PricingAnalysisRead,
    PricingWarningRead,
)
from app.services.market import last_observed_on, normalized_unit_price, observation_view
from app.services.pricing import PricingAnalysis


def analysis_read(analysis: PricingAnalysis) -> PricingAnalysisRead:
    return PricingAnalysisRead(
        sale_price_clp=analysis.sale_price_clp,
        unit_cost_clp=analysis.unit_cost_clp,
        extra_supply_cost_clp=analysis.extra_supply_cost_clp,
        total_unit_cost_clp=analysis.total_unit_cost_clp,
        min_margin=analysis.min_margin,
        min_margin_source=analysis.min_margin_source,
        upper_margin=analysis.upper_margin,
        upper_margin_source=analysis.upper_margin_source,
        price_at_min_margin=analysis.price_at_min_margin,
        price_at_upper_margin=analysis.price_at_upper_margin,
        current_gross_margin=analysis.current_gross_margin,
        current_markup=analysis.current_markup,
        range_available=analysis.range_available,
        needs_review=analysis.needs_review,
        warnings=[
            PricingWarningRead(code=warning.code, message=warning.message)
            for warning in analysis.warnings
        ],
    )


def observation_read(
    observation: MarketObservation,
    reference: MarketReference,
    *,
    stale_days: int,
    on: date,
) -> ObservationRead:
    view = observation_view(observation, stale_days=stale_days, on=on)
    unit = normalized_unit_price(
        observation.price_clp,
        reference.content_amount,
        reference.content_unit,
    )
    return ObservationRead(
        id=observation.id,
        reference_id=observation.reference_id,
        price_clp=observation.price_clp,
        price_type=observation.price_type,
        promo_valid_from=observation.promo_valid_from,
        promo_valid_until=observation.promo_valid_until,
        observed_on=observation.observed_on,
        url=observation.url,
        notes=observation.notes,
        status=observation.status,
        invalid_reason=observation.invalid_reason,
        replaced_by_id=observation.replaced_by_id,
        created_at=observation.created_at,
        age_days=view.age_days,
        stale=view.stale,
        promo_expired=view.promo_expired,
        promo_current=view.promo_current,
        unit_price_clp=unit[0] if unit else None,
        unit_price_label=unit[1] if unit else None,
    )


def reference_detail(
    reference: MarketReference,
    *,
    stale_days: int,
    on: date,
) -> MarketReferenceDetail:
    latest = last_observed_on(reference)
    observations = sorted(
        reference.observations,
        key=lambda item: (item.observed_on, item.created_at),
        reverse=True,
    )
    return MarketReferenceDetail(
        id=reference.id,
        source=MarketSourceBrief(
            id=reference.source.id,
            name=reference.source.name,
            scope=reference.source.scope,
            locality=reference.source.locality,
        ),
        product_name=reference.product_name,
        brand=reference.brand,
        variant=reference.variant,
        content_amount=reference.content_amount,
        content_unit=reference.content_unit,
        product_url=reference.product_url,
        product_id=reference.product_id,
        match_type=reference.match_type,
        notes=reference.notes,
        active=reference.active,
        last_observed_on=latest,
        stale=latest is not None and (on - latest).days > stale_days,
        observations=[
            observation_read(item, reference, stale_days=stale_days, on=on)
            for item in observations
        ],
    )
