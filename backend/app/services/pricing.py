"""Cálculos de rentabilidad para apoyar decisiones de precio.

Todos los márgenes se expresan como proporción entre 0 y 1 calculada sobre el
precio de venta (margen bruto). El recargo sobre el costo (markup) se calcula
por separado y nunca se llama "margen".

Los resultados son información para decidir: este módulo nunca modifica el
precio de venta de un producto.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from enum import Enum

from app.models.category import Category
from app.models.price_history import ProductCostChange, ProductPriceChange
from app.models.product import Product

MONEY_QUANTUM = Decimal("0.01")
RATIO_QUANTUM = Decimal("0.0001")
ONE = Decimal("1")
ZERO = Decimal("0")


class InvalidMarginError(ValueError):
    pass


class MarginSource(str, Enum):
    PRODUCT = "PRODUCT"
    CATEGORY = "CATEGORY"


class WarningCode(str, Enum):
    COST_MISSING = "COST_MISSING"
    PRICE_MISSING = "PRICE_MISSING"
    MARGINS_MISSING = "MARGINS_MISSING"
    PRICE_BELOW_COST = "PRICE_BELOW_COST"
    MARGIN_BELOW_MIN = "MARGIN_BELOW_MIN"
    COST_INCREASED = "COST_INCREASED"


# Advertencias que indican que el precio actual debería revisarse.
REVIEW_WARNINGS = {
    WarningCode.PRICE_BELOW_COST,
    WarningCode.MARGIN_BELOW_MIN,
    WarningCode.COST_INCREASED,
}


@dataclass
class PricingWarning:
    code: WarningCode
    message: str


@dataclass
class PricingAnalysis:
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
    warnings: list[PricingWarning] = field(default_factory=list)

    @property
    def needs_review(self) -> bool:
        return any(warning.code in REVIEW_WARNINGS for warning in self.warnings)


def _to_decimal(value: Decimal | int | float | str) -> Decimal:
    return value if isinstance(value, Decimal) else Decimal(str(value))


def validate_margin(value: Decimal | None, label: str) -> Decimal | None:
    if value is None:
        return None
    margin = _to_decimal(value)
    if margin < ZERO:
        raise InvalidMarginError(f"El {label} no puede ser negativo")
    if margin >= ONE:
        raise InvalidMarginError(
            f"El {label} debe ser menor que 100 % (no se puede dividir por cero)",
        )
    return margin.quantize(RATIO_QUANTUM)


def validate_margin_pair(
    min_margin: Decimal | None,
    upper_margin: Decimal | None,
) -> tuple[Decimal | None, Decimal | None]:
    min_value = validate_margin(min_margin, "margen mínimo")
    upper_value = validate_margin(upper_margin, "margen superior")
    if min_value is not None and upper_value is not None and upper_value < min_value:
        raise InvalidMarginError(
            "El margen superior de referencia no puede ser menor que el margen mínimo",
        )
    return min_value, upper_value


def gross_margin(price: Decimal | int, cost: Decimal | int) -> Decimal | None:
    """Margen bruto sobre el precio de venta: (precio − costo) / precio."""
    price_value = _to_decimal(price)
    if price_value <= ZERO:
        return None
    return ((price_value - _to_decimal(cost)) / price_value).quantize(
        RATIO_QUANTUM,
        rounding=ROUND_HALF_UP,
    )


def markup_on_cost(price: Decimal | int, cost: Decimal | int) -> Decimal | None:
    """Recargo sobre el costo: (precio − costo) / costo. No es margen."""
    cost_value = _to_decimal(cost)
    if cost_value <= ZERO:
        return None
    return ((_to_decimal(price) - cost_value) / cost_value).quantize(
        RATIO_QUANTUM,
        rounding=ROUND_HALF_UP,
    )


def price_for_margin(cost: Decimal | int, margin: Decimal) -> Decimal:
    """Precio que logra el margen objetivo: costo / (1 − margen).

    El resultado no se redondea a precios "comerciales"; solo se expresa con
    dos decimales para mostrar el valor exacto calculado.
    """
    validated = validate_margin(margin, "margen")
    assert validated is not None
    return (_to_decimal(cost) / (ONE - validated)).quantize(
        MONEY_QUANTUM,
        rounding=ROUND_HALF_UP,
    )


def total_unit_cost(product: Product) -> Decimal | None:
    if product.last_unit_cost_clp is None:
        return None
    total = _to_decimal(product.last_unit_cost_clp)
    if product.extra_supply_cost_clp is not None:
        total += _to_decimal(product.extra_supply_cost_clp)
    return total.quantize(MONEY_QUANTUM)


def effective_margins(
    product: Product,
    category: Category | None,
) -> tuple[Decimal | None, MarginSource | None, Decimal | None, MarginSource | None]:
    def pick(product_value, category_value):
        if product_value is not None:
            return _to_decimal(product_value), MarginSource.PRODUCT
        if category_value is not None:
            return _to_decimal(category_value), MarginSource.CATEGORY
        return None, None

    min_value, min_source = pick(
        product.min_margin,
        category.min_margin if category is not None else None,
    )
    upper_value, upper_source = pick(
        product.upper_margin,
        category.upper_margin if category is not None else None,
    )
    return min_value, min_source, upper_value, upper_source


def _format_percent(value: Decimal) -> str:
    return f"{(value * 100).quantize(Decimal('0.1'), rounding=ROUND_HALF_UP)} %".replace(".", ",")


def _format_clp(value: Decimal | int) -> str:
    rounded = int(_to_decimal(value).quantize(ONE, rounding=ROUND_HALF_UP))
    return "$" + f"{rounded:,}".replace(",", ".")


def _cost_increase_warning(
    sale_price: int | None,
    cost_changes: list[ProductCostChange],
    price_changes: list[ProductPriceChange],
) -> PricingWarning | None:
    """Advierte si el último cambio de costo fue un alza que redujo el margen
    y el precio no se ha revisado desde entonces."""
    if sale_price is None or not cost_changes:
        return None

    latest = max(cost_changes, key=lambda change: change.changed_at)
    if latest.previous_unit_cost_clp is None or latest.new_unit_cost_clp is None:
        return None

    previous_total = _to_decimal(latest.previous_unit_cost_clp) + _to_decimal(
        latest.previous_extra_cost_clp or 0,
    )
    new_total = _to_decimal(latest.new_unit_cost_clp) + _to_decimal(
        latest.new_extra_cost_clp or 0,
    )
    if new_total <= previous_total:
        return None

    price_reviewed_after = any(
        change.changed_at > latest.changed_at for change in price_changes
    )
    if price_reviewed_after:
        return None

    previous_margin = gross_margin(sale_price, previous_total)
    current_margin = gross_margin(sale_price, new_total)
    if previous_margin is None or current_margin is None:
        return None

    return PricingWarning(
        WarningCode.COST_INCREASED,
        (
            f"El costo subió de {_format_clp(previous_total)} a {_format_clp(new_total)} "
            f"y el margen bruto bajó de {_format_percent(previous_margin)} a "
            f"{_format_percent(current_margin)}. El precio de venta no se ha revisado desde entonces."
        ),
    )


def analyze_product(
    product: Product,
    category: Category | None,
    *,
    cost_changes: list[ProductCostChange] | None = None,
    price_changes: list[ProductPriceChange] | None = None,
) -> PricingAnalysis:
    cost_changes = cost_changes or []
    price_changes = price_changes or []

    total_cost = total_unit_cost(product)
    min_margin, min_source, upper_margin, upper_source = effective_margins(
        product,
        category,
    )
    sale_price = product.sale_price_clp

    warnings: list[PricingWarning] = []

    if total_cost is None:
        warnings.append(
            PricingWarning(
                WarningCode.COST_MISSING,
                "Falta el costo unitario de compra: la recomendación de precio por rentabilidad está pendiente.",
            )
        )
    if sale_price is None:
        warnings.append(
            PricingWarning(
                WarningCode.PRICE_MISSING,
                "El producto no tiene precio de venta registrado.",
            )
        )
    if min_margin is None or upper_margin is None:
        missing = []
        if min_margin is None:
            missing.append("margen mínimo")
        if upper_margin is None:
            missing.append("margen superior")
        warnings.append(
            PricingWarning(
                WarningCode.MARGINS_MISSING,
                "Define el "
                + " y el ".join(missing)
                + " en la categoría o en el producto para calcular el rango de precios.",
            )
        )

    price_at_min = (
        price_for_margin(total_cost, min_margin)
        if total_cost is not None and min_margin is not None
        else None
    )
    price_at_upper = (
        price_for_margin(total_cost, upper_margin)
        if total_cost is not None and upper_margin is not None
        else None
    )

    current_margin = None
    current_markup = None
    if total_cost is not None and sale_price is not None:
        current_margin = gross_margin(sale_price, total_cost)
        current_markup = markup_on_cost(sale_price, total_cost)

        if sale_price < total_cost:
            warnings.append(
                PricingWarning(
                    WarningCode.PRICE_BELOW_COST,
                    f"El precio actual ({_format_clp(sale_price)}) es menor que el costo unitario registrado ({_format_clp(total_cost)}).",
                )
            )
        elif (
            current_margin is not None
            and min_margin is not None
            and current_margin < min_margin
        ):
            warnings.append(
                PricingWarning(
                    WarningCode.MARGIN_BELOW_MIN,
                    f"El margen bruto actual ({_format_percent(current_margin)}) está bajo el margen mínimo configurado ({_format_percent(min_margin)}).",
                )
            )

    increase_warning = _cost_increase_warning(sale_price, cost_changes, price_changes)
    if increase_warning is not None:
        warnings.append(increase_warning)

    return PricingAnalysis(
        sale_price_clp=sale_price,
        unit_cost_clp=(
            _to_decimal(product.last_unit_cost_clp)
            if product.last_unit_cost_clp is not None
            else None
        ),
        extra_supply_cost_clp=(
            _to_decimal(product.extra_supply_cost_clp)
            if product.extra_supply_cost_clp is not None
            else None
        ),
        total_unit_cost_clp=total_cost,
        min_margin=min_margin,
        min_margin_source=min_source,
        upper_margin=upper_margin,
        upper_margin_source=upper_source,
        price_at_min_margin=price_at_min,
        price_at_upper_margin=price_at_upper,
        current_gross_margin=current_margin,
        current_markup=current_markup,
        range_available=price_at_min is not None and price_at_upper is not None,
        warnings=warnings,
    )
