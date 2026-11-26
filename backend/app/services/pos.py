"""Caja en el celular: registrar una venta completa en una sola llamada.

El carro vive en el celular; al cobrar se envía todo junto. El servidor usa
sus propios precios (no los del celular), descuenta el stock, registra el pago
y deja la venta a nombre de quien la hizo. `client_ref` lo genera el celular:
si la señal se corta y se reintenta, la venta no se duplica.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.models.payment import Payment, PaymentMethod, PaymentStatus
from app.models.product import Product, SaleMode, StockUnit
from app.models.sale import Sale, SaleItem, SaleItemType, SaleStatus
from app.models.stock_movement import StockMovement, StockMovementType
from app.services.users import CurrentUser

# Horario del negocio: los días y horas se cuentan en Chile continental.
BUSINESS_TZ = ZoneInfo("America/Santiago")
MAX_ITEMS = 200
MAX_LINE_TOTAL = 10_000_000


class PosError(ValueError):
    """Error de la venta con mensaje para mostrar en la caja."""


class PriceChangedError(PosError):
    def __init__(self, message: str, changes: list[dict[str, object]]):
        super().__init__(message)
        self.changes = changes


@dataclass
class LineIn:
    product_id: UUID | None
    quantity: Decimal
    unit_price_clp: int | None = None
    description: str | None = None


@dataclass
class CheckoutIn:
    client_ref: str
    lines: list[LineIn]
    payment_method: PaymentMethod
    cash_received_clp: int | None = None
    expected_total_clp: int | None = None


@dataclass
class CheckoutResult:
    sale: Sale
    created: bool
    warnings: list[str] = field(default_factory=list)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def product_label(product: Product) -> str:
    parts = [product.name, product.brand, product.variant]
    if product.content_amount is not None and product.content_unit is not None:
        amount = f"{Decimal(product.content_amount).normalize():f}".replace(".", ",")
        unit = {"G": "g", "KG": "kg", "ML": "ml", "L": "L", "UNIT": "u."}.get(product.content_unit.value, "")
        parts.append(f"{amount} {unit}".strip())
    return " ".join(part for part in parts if part)[:200]


def _quantity(value: Decimal, product: Product | None) -> Decimal:
    if value <= 0:
        raise PosError("La cantidad debe ser mayor que cero")
    if value > Decimal("10000"):
        raise PosError("La cantidad es demasiado grande")
    whole = product is None or (product.stock_unit == StockUnit.UNIT and product.sale_mode != SaleMode.WEIGHT)
    if whole and value != value.to_integral_value():
        name = product.name if product else "El monto libre"
        raise PosError(f"{name} se vende por unidad: la cantidad no puede tener decimales")
    return value.quantize(Decimal("0.001"))


def _line_total(quantity: Decimal, unit_price: int) -> int:
    return int((quantity * unit_price).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def existing_sale(db: Session, client_ref: str) -> Sale | None:
    return db.scalar(
        select(Sale).options(selectinload(Sale.items)).where(Sale.client_ref == client_ref)
    )


def checkout(db: Session, data: CheckoutIn, seller: CurrentUser) -> CheckoutResult:
    previous = existing_sale(db, data.client_ref)
    if previous is not None:
        # Reintento de una venta ya registrada: se devuelve tal cual.
        return CheckoutResult(sale=previous, created=False)

    if not data.lines:
        raise PosError("El carro está vacío")
    if len(data.lines) > MAX_ITEMS:
        raise PosError(f"Una venta puede tener como máximo {MAX_ITEMS} líneas")

    product_ids = {line.product_id for line in data.lines if line.product_id is not None}
    products = {
        product.id: product
        for product in db.scalars(select(Product).where(Product.id.in_(product_ids))).all()
    } if product_ids else {}

    sale = Sale(
        status=SaleStatus.COMPLETED,
        seller_id=seller.id,
        seller_name=seller.name,
        client_ref=data.client_ref,
    )
    warnings: list[str] = []
    price_changes: list[dict[str, object]] = []
    sold: dict[UUID, Decimal] = defaultdict(Decimal)
    total = 0

    for line in data.lines:
        if line.product_id is None:
            # Monto libre (pan, verdura, "varios"): precio escrito en la caja.
            if line.unit_price_clp is None or line.unit_price_clp <= 0:
                raise PosError("Escribe el monto de la línea libre")
            quantity = _quantity(line.quantity, None)
            description = (line.description or "").strip() or "Varios"
            unit_price = line.unit_price_clp
            item_type = SaleItemType.FREE_AMOUNT
            product = None
        else:
            product = products.get(line.product_id)
            if product is None:
                raise PosError("Uno de los productos del carro ya no existe. Quítalo y vuelve a escanearlo.")
            if not product.active:
                raise PosError(f"{product.name} está desactivado y no se puede vender")
            quantity = _quantity(line.quantity, product)
            description = product_label(product)
            item_type = SaleItemType.PRODUCT
            if product.sale_price_clp is not None:
                unit_price = product.sale_price_clp
                if line.unit_price_clp is not None and line.unit_price_clp != unit_price:
                    price_changes.append(
                        {"product_id": str(product.id), "name": product.name, "price_clp": unit_price}
                    )
            else:
                # Producto sin precio en SIM: vale el precio que se escribió en la caja.
                if line.unit_price_clp is None or line.unit_price_clp <= 0:
                    raise PosError(f"{product.name} no tiene precio: escríbelo en la caja")
                unit_price = line.unit_price_clp
                warnings.append(f"{product.name} se vendió a un precio escrito en la caja (no tiene precio en SIM)")
            if product.track_stock:
                sold[product.id] += quantity

        line_total = _line_total(quantity, unit_price)
        if line_total > MAX_LINE_TOTAL:
            raise PosError(f"El total de «{description}» es demasiado alto. Revisa la cantidad.")
        total += line_total
        sale.items.append(
            SaleItem(
                product_id=product.id if product else None,
                item_type=item_type,
                description_snapshot=description,
                quantity=quantity,
                unit_price_clp=unit_price,
                line_total_clp=line_total,
            )
        )

    if price_changes:
        raise PriceChangedError(
            "Cambió el precio de algún producto desde que abriste la caja. Revisa el carro.", price_changes
        )
    if data.expected_total_clp is not None and data.expected_total_clp != total:
        raise PriceChangedError(
            f"El total calculado es {total} y la caja mostraba {data.expected_total_clp}. Revisa el carro.", []
        )
    if total <= 0:
        raise PosError("El total de la venta debe ser mayor que cero")

    cash_received = None
    change = None
    if data.payment_method == PaymentMethod.CASH and data.cash_received_clp is not None:
        if data.cash_received_clp < total:
            raise PosError("El efectivo recibido no alcanza para el total")
        cash_received = data.cash_received_clp
        change = data.cash_received_clp - total

    now = utc_now()
    sale.subtotal_clp = total
    sale.total_clp = total
    sale.completed_at = now
    db.add(sale)
    db.flush()

    db.add(
        Payment(
            sale_id=sale.id,
            method=data.payment_method,
            status=PaymentStatus.CONFIRMED,
            amount_clp=total,
            cash_received_clp=cash_received,
            change_clp=change,
            confirmed_at=now,
        )
    )
    for product_id, quantity in sold.items():
        db.add(
            StockMovement(
                product_id=product_id,
                movement_type=StockMovementType.SALE,
                quantity_delta=-quantity,
                note=f"Venta de {seller.name}",
                actor_user_id=seller.id,
            )
        )
    db.flush()
    for product_id, stock in stock_by_product(db, list(sold)).items():
        if stock < 0:
            warnings.append(
                f"{products[product_id].name} quedó con cantidad negativa ({stock.normalize():f}). Revisa el conteo."
            )
    db.commit()
    db.refresh(sale)
    return CheckoutResult(sale=sale, created=True, warnings=warnings)


def void_sale(db: Session, sale_id: UUID, reason: str, admin: CurrentUser) -> Sale:
    sale = db.scalar(select(Sale).options(selectinload(Sale.items)).where(Sale.id == sale_id))
    if sale is None or sale.completed_at is None:
        raise PosError("Venta no encontrada")
    if sale.status == SaleStatus.VOIDED:
        raise PosError("Esta venta ya estaba anulada")
    reason = reason.strip()
    if not reason:
        raise PosError("Escribe el motivo de la anulación")

    for item in sale.items:
        if item.product_id is None:
            continue
        product = db.get(Product, item.product_id)
        if product is not None and product.track_stock:
            db.add(
                StockMovement(
                    product_id=item.product_id,
                    movement_type=StockMovementType.SALE_REVERSAL,
                    quantity_delta=Decimal(item.quantity),
                    note=f"Anulación: {reason}"[:500],
                    actor_user_id=admin.id,
                )
            )
    for payment in db.scalars(select(Payment).where(Payment.sale_id == sale.id)).all():
        payment.status = PaymentStatus.CANCELLED
    sale.status = SaleStatus.VOIDED
    sale.voided_at = utc_now()
    sale.void_reason = reason[:300]
    sale.voided_by_name = admin.name
    db.commit()
    db.refresh(sale)
    return sale


def day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=BUSINESS_TZ)
    return start.astimezone(timezone.utc), (start + timedelta(days=1)).astimezone(timezone.utc)


def today() -> date:
    return datetime.now(BUSINESS_TZ).date()


def list_sales(
    db: Session, day: date, seller_id: UUID | None = None
) -> list[tuple[Sale, PaymentMethod | None]]:
    start, end = day_bounds(day)
    query = (
        select(Sale)
        .options(selectinload(Sale.items))
        .where(Sale.completed_at >= start, Sale.completed_at < end)
        .order_by(Sale.completed_at.desc())
    )
    if seller_id is not None:
        query = query.where(Sale.seller_id == seller_id)
    sales = db.scalars(query).all()
    methods: dict[UUID, PaymentMethod] = {}
    if sales:
        for payment in db.scalars(select(Payment).where(Payment.sale_id.in_([sale.id for sale in sales]))).all():
            methods[payment.sale_id] = payment.method
    return [(sale, methods.get(sale.id)) for sale in sales]


def payment_method_of(db: Session, sale_id: UUID) -> PaymentMethod | None:
    return db.scalar(select(Payment.method).where(Payment.sale_id == sale_id).limit(1))


def stock_by_product(db: Session, product_ids: list[UUID]) -> dict[UUID, Decimal]:
    if not product_ids:
        return {}
    rows = db.execute(
        select(StockMovement.product_id, func.coalesce(func.sum(StockMovement.quantity_delta), 0))
        .where(StockMovement.product_id.in_(product_ids))
        .group_by(StockMovement.product_id)
    ).all()
    return {product_id: Decimal(total) for product_id, total in rows}
