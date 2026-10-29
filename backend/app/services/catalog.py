"""Operaciones del catálogo que deben conservar historial.

Cada cambio de costo, precio de venta o cantidad queda registrado en su propia
tabla append-only, de modo que editar o desactivar un producto nunca borra la
historia que explica cómo cambiaron sus datos.
"""

from __future__ import annotations

from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.price_history import ProductCostChange, ProductPriceChange
from app.models.product import Product
from app.models.stock_movement import StockMovement, StockMovementType
from app.services.inventory import STOCK_QUANTUM, get_expected_stock


class CatalogError(ValueError):
    pass


def _clean(text: str | None) -> str | None:
    if text is None:
        return None
    text = text.strip()
    return text or None


def _money(value: Decimal | int | None) -> Decimal | None:
    if value is None:
        return None
    return Decimal(str(value)).quantize(Decimal("0.01"))


def record_price_change(
    db: Session,
    product: Product,
    new_price: int | None,
    *,
    note: str | None = None,
) -> ProductPriceChange | None:
    """Registra el cambio de precio y lo aplica. No hace commit."""
    if product.sale_price_clp == new_price:
        return None

    change = ProductPriceChange(
        product_id=product.id,
        previous_price_clp=product.sale_price_clp,
        new_price_clp=new_price,
        note=_clean(note),
    )
    product.sale_price_clp = new_price
    db.add(change)
    return change


def record_cost_change(
    db: Session,
    product: Product,
    *,
    unit_cost: Decimal | int | None,
    extra_cost: Decimal | int | None,
    source: str | None = None,
    note: str | None = None,
) -> ProductCostChange | None:
    """Registra el cambio de costo y lo aplica. No hace commit."""
    new_unit = _money(unit_cost)
    new_extra = _money(extra_cost)
    previous_unit = _money(product.last_unit_cost_clp)
    previous_extra = _money(product.extra_supply_cost_clp)

    if new_unit == previous_unit and new_extra == previous_extra:
        return None

    change = ProductCostChange(
        product_id=product.id,
        previous_unit_cost_clp=previous_unit,
        new_unit_cost_clp=new_unit,
        previous_extra_cost_clp=previous_extra,
        new_extra_cost_clp=new_extra,
        source=_clean(source),
        note=_clean(note),
    )
    product.last_unit_cost_clp = new_unit
    product.extra_supply_cost_clp = new_extra
    db.add(change)
    return change


def record_initial_values(
    db: Session,
    product: Product,
    *,
    cost_source: str | None = None,
) -> None:
    """Abre el historial de un producto recién creado (ya con id asignado).

    Solo registra los valores que efectivamente se ingresaron; no inventa
    historia previa. No hace commit.
    """
    if product.sale_price_clp is not None:
        db.add(
            ProductPriceChange(
                product_id=product.id,
                previous_price_clp=None,
                new_price_clp=product.sale_price_clp,
                note="Precio inicial",
            )
        )
    if product.last_unit_cost_clp is not None or product.extra_supply_cost_clp is not None:
        db.add(
            ProductCostChange(
                product_id=product.id,
                previous_unit_cost_clp=None,
                new_unit_cost_clp=_money(product.last_unit_cost_clp),
                previous_extra_cost_clp=None,
                new_extra_cost_clp=_money(product.extra_supply_cost_clp),
                source=_clean(cost_source),
                note="Costo inicial",
            )
        )


def set_counted_stock(
    db: Session,
    product: Product,
    quantity: Decimal | int | str,
    *,
    note: str | None = None,
) -> StockMovement | None:
    """Fija la cantidad disponible registrando un movimiento auditable.

    Si el producto no tiene movimientos se registra como INITIAL_STOCK; si ya
    tiene, la diferencia se registra como ADJUSTMENT. No hace commit.
    """
    if not product.track_stock:
        raise CatalogError("El producto no controla stock")

    target = Decimal(str(quantity)).quantize(STOCK_QUANTUM)
    if target < 0:
        raise CatalogError("La cantidad no puede ser negativa")

    has_movements = (
        db.scalar(
            select(StockMovement.id).where(StockMovement.product_id == product.id).limit(1)
        )
        is not None
    )
    current = get_expected_stock(db, product.id) if has_movements else Decimal("0.000")
    delta = target - current
    if delta == 0:
        return None

    movement = StockMovement(
        product_id=product.id,
        movement_type=(
            StockMovementType.ADJUSTMENT if has_movements else StockMovementType.INITIAL_STOCK
        ),
        quantity_delta=delta,
        note=_clean(note),
    )
    db.add(movement)
    return movement


def stock_by_product(db: Session, product_ids: list[UUID]) -> dict[UUID, Decimal]:
    from sqlalchemy import func

    if not product_ids:
        return {}
    rows = db.execute(
        select(StockMovement.product_id, func.sum(StockMovement.quantity_delta))
        .where(StockMovement.product_id.in_(product_ids))
        .group_by(StockMovement.product_id)
    ).all()
    return {
        product_id: Decimal(total).quantize(STOCK_QUANTUM)
        for product_id, total in rows
        if total is not None
    }


def cost_history(db: Session, product_id: UUID) -> list[ProductCostChange]:
    return list(
        db.scalars(
            select(ProductCostChange)
            .where(ProductCostChange.product_id == product_id)
            .order_by(ProductCostChange.changed_at)
        ).all()
    )


def cost_histories(db: Session, product_ids: list[UUID]) -> dict[UUID, list[ProductCostChange]]:
    """Historial de costos de varios productos en una sola consulta."""
    result: dict[UUID, list[ProductCostChange]] = {product_id: [] for product_id in product_ids}
    if not product_ids:
        return result
    for change in db.scalars(
        select(ProductCostChange)
        .where(ProductCostChange.product_id.in_(product_ids))
        .order_by(ProductCostChange.changed_at)
    ).all():
        result[change.product_id].append(change)
    return result


def price_histories(db: Session, product_ids: list[UUID]) -> dict[UUID, list[ProductPriceChange]]:
    """Historial de precios de varios productos en una sola consulta."""
    result: dict[UUID, list[ProductPriceChange]] = {product_id: [] for product_id in product_ids}
    if not product_ids:
        return result
    for change in db.scalars(
        select(ProductPriceChange)
        .where(ProductPriceChange.product_id.in_(product_ids))
        .order_by(ProductPriceChange.changed_at)
    ).all():
        result[change.product_id].append(change)
    return result


def price_history(db: Session, product_id: UUID) -> list[ProductPriceChange]:
    return list(
        db.scalars(
            select(ProductPriceChange)
            .where(ProductPriceChange.product_id == product_id)
            .order_by(ProductPriceChange.changed_at)
        ).all()
    )
