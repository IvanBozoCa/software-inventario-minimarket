from decimal import Decimal

import pytest

from app.models.category import Category
from app.models.product import Product
from app.services.pricing import (
    InvalidMarginError,
    MarginSource,
    WarningCode,
    analyze_product,
    gross_margin,
    markup_on_cost,
    price_for_margin,
    validate_margin,
    validate_margin_pair,
)


def test_gross_margin_is_computed_over_sale_price():
    # (1000 - 700) / 1000
    assert gross_margin(1000, 700) == Decimal("0.3000")
    assert gross_margin(0, 700) is None


def test_markup_is_computed_over_cost_and_differs_from_margin():
    # (1000 - 700) / 700
    assert markup_on_cost(1000, 700) == Decimal("0.4286")
    assert markup_on_cost(1000, 0) is None


def test_price_for_margin_uses_cost_over_one_minus_margin():
    # 700 / (1 - 0.30) = 1000
    assert price_for_margin(700, Decimal("0.30")) == Decimal("1000.00")
    # 1190 / (1 - 0.25) = 1586.666... -> no se redondea a precios "comerciales"
    assert price_for_margin(1190, Decimal("0.25")) == Decimal("1586.67")


def test_margins_at_or_above_100_percent_are_rejected():
    with pytest.raises(InvalidMarginError):
        validate_margin(Decimal("1"), "margen")
    with pytest.raises(InvalidMarginError):
        validate_margin(Decimal("1.5"), "margen")
    with pytest.raises(InvalidMarginError):
        validate_margin(Decimal("-0.1"), "margen")
    with pytest.raises(InvalidMarginError):
        validate_margin_pair(Decimal("0.4"), Decimal("0.3"))
    assert validate_margin_pair(None, Decimal("0.3")) == (None, Decimal("0.3000"))


def _product(**kwargs) -> Product:
    defaults = dict(name="Arroz 1 kg", sale_price_clp=1500)
    defaults.update(kwargs)
    return Product(**defaults)


def test_no_range_without_cost():
    category = Category(name="Abarrotes", min_margin=Decimal("0.2"), upper_margin=Decimal("0.35"))
    analysis = analyze_product(_product(), category)

    assert analysis.range_available is False
    assert analysis.price_at_min_margin is None
    assert analysis.current_gross_margin is None
    assert {w.code for w in analysis.warnings} == {WarningCode.COST_MISSING}
    assert analysis.needs_review is False


def test_no_range_without_margins():
    analysis = analyze_product(_product(last_unit_cost_clp=Decimal("1000")), None)

    assert analysis.range_available is False
    assert analysis.current_gross_margin == Decimal("0.3333")
    assert {w.code for w in analysis.warnings} == {WarningCode.MARGINS_MISSING}


def test_range_uses_category_margins_and_product_override():
    category = Category(name="Abarrotes", min_margin=Decimal("0.2"), upper_margin=Decimal("0.35"))
    product = _product(
        last_unit_cost_clp=Decimal("1000"),
        extra_supply_cost_clp=Decimal("50"),
        upper_margin=Decimal("0.40"),
    )
    analysis = analyze_product(product, category)

    assert analysis.total_unit_cost_clp == Decimal("1050.00")
    assert analysis.min_margin == Decimal("0.2")
    assert analysis.min_margin_source == MarginSource.CATEGORY
    assert analysis.upper_margin == Decimal("0.40")
    assert analysis.upper_margin_source == MarginSource.PRODUCT
    assert analysis.price_at_min_margin == Decimal("1312.50")
    assert analysis.price_at_upper_margin == Decimal("1750.00")
    assert analysis.range_available is True
    assert analysis.warnings == []


def test_warns_when_price_below_cost():
    product = _product(sale_price_clp=900, last_unit_cost_clp=Decimal("1000"), min_margin=Decimal("0.1"), upper_margin=Decimal("0.2"))
    analysis = analyze_product(product, None)

    codes = {w.code for w in analysis.warnings}
    assert WarningCode.PRICE_BELOW_COST in codes
    assert WarningCode.MARGIN_BELOW_MIN not in codes
    assert analysis.needs_review is True


def test_warns_when_margin_below_minimum():
    product = _product(sale_price_clp=1100, last_unit_cost_clp=Decimal("1000"), min_margin=Decimal("0.2"), upper_margin=Decimal("0.3"))
    analysis = analyze_product(product, None)

    assert analysis.current_gross_margin == Decimal("0.0909")
    assert {w.code for w in analysis.warnings} == {WarningCode.MARGIN_BELOW_MIN}
    assert analysis.needs_review is True
