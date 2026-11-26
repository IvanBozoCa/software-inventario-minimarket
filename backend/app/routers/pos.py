"""Caja en el celular: catálogo para escanear, cobrar, ventas del día y anular."""

from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import current_user, require_admin
from app.models.category import Category
from app.models.payment import Payment, PaymentMethod
from app.models.product import Product
from app.models.sale import Sale, SaleStatus
from app.schemas.pos import (
    CatalogItem,
    DaySalesRead,
    PosSaleRead,
    SaleCreate,
    SaleLineRead,
    SellerTotal,
    VoidPayload,
)
from app.services import pos
from app.services.users import CurrentUser

router = APIRouter(prefix="/pos", tags=["pos"])


def _read(sale: Sale, payment: Payment | None, warnings: list[str] | None = None) -> PosSaleRead:
    return PosSaleRead(
        id=sale.id,
        status=sale.status,
        total_clp=sale.total_clp,
        payment_method=payment.method if payment else None,
        cash_received_clp=payment.cash_received_clp if payment else None,
        change_clp=payment.change_clp if payment else None,
        seller_id=sale.seller_id,
        seller_name=sale.seller_name,
        completed_at=sale.completed_at,
        voided_at=sale.voided_at,
        void_reason=sale.void_reason,
        voided_by_name=sale.voided_by_name,
        lines=[
            SaleLineRead(
                product_id=item.product_id,
                description=item.description_snapshot,
                quantity=item.quantity,
                unit_price_clp=item.unit_price_clp,
                line_total_clp=item.line_total_clp,
            )
            for item in sale.items
        ],
        warnings=warnings or [],
    )


def _payment(db: Session, sale_id: UUID) -> Payment | None:
    return db.scalar(select(Payment).where(Payment.sale_id == sale_id).limit(1))


@router.get("/catalog", response_model=list[CatalogItem])
def catalog(db: Session = Depends(get_db)) -> list[CatalogItem]:
    """Productos activos con lo necesario para escanear y cobrar sin más consultas."""
    rows = db.execute(
        select(Product, Category.name)
        .outerjoin(Category, Category.id == Product.category_id)
        .where(Product.active.is_(True))
        .order_by(Product.name)
    ).all()
    stock = pos.stock_by_product(db, [product.id for product, _ in rows if product.track_stock])
    return [
        CatalogItem(
            id=product.id,
            label=pos.product_label(product),
            name=product.name,
            brand=product.brand,
            variant=product.variant,
            barcode=product.barcode,
            category_name=category_name,
            sale_price_clp=product.sale_price_clp,
            sale_mode=product.sale_mode,
            stock_unit=product.stock_unit,
            track_stock=product.track_stock,
            quantity=stock.get(product.id) if product.track_stock else None,
        )
        for product, category_name in rows
    ]


@router.post("/sales", response_model=PosSaleRead, status_code=status.HTTP_201_CREATED)
def create_sale(
    payload: SaleCreate,
    response: Response,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
):
    try:
        result = pos.checkout(
            db,
            pos.CheckoutIn(
                client_ref=payload.client_ref,
                lines=[
                    pos.LineIn(
                        product_id=line.product_id,
                        quantity=line.quantity,
                        unit_price_clp=line.unit_price_clp,
                        description=line.description,
                    )
                    for line in payload.lines
                ],
                payment_method=payload.payment_method,
                cash_received_clp=payload.cash_received_clp,
                expected_total_clp=payload.expected_total_clp,
            ),
            user,
        )
    except pos.PriceChangedError as error:
        db.rollback()
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={"detail": str(error), "price_changes": error.changes},
        )
    except pos.PosError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    if not result.created:
        response.status_code = status.HTTP_200_OK
    return _read(result.sale, _payment(db, result.sale.id), result.warnings)


@router.get("/sales", response_model=DaySalesRead)
def day_sales(
    day: date | None = Query(default=None, description="Día en hora de Chile (AAAA-MM-DD); hoy si se omite"),
    seller_id: UUID | None = None,
    db: Session = Depends(get_db),
    user: CurrentUser = Depends(current_user),
) -> DaySalesRead:
    day = day or pos.today()
    # Un vendedor solo ve sus propias ventas.
    if not user.is_admin:
        seller_id = user.id
    sales = pos.list_sales(db, day, seller_id)
    payments = {
        payment.sale_id: payment
        for payment in db.scalars(select(Payment).where(Payment.sale_id.in_([sale.id for sale, _ in sales]))).all()
    } if sales else {}

    by_method = {method.value: 0 for method in PaymentMethod}
    sellers: dict[UUID | None, SellerTotal] = {}
    count = total = voided = 0
    for sale, method in sales:
        if sale.status == SaleStatus.VOIDED:
            voided += 1
            continue
        count += 1
        total += sale.total_clp
        if method is not None:
            by_method[method.value] += sale.total_clp
        entry = sellers.setdefault(
            sale.seller_id,
            SellerTotal(seller_id=sale.seller_id, seller_name=sale.seller_name or "Sin vendedor", count=0, total_clp=0),
        )
        entry.count += 1
        entry.total_clp += sale.total_clp

    return DaySalesRead(
        day=day,
        count=count,
        total_clp=total,
        by_method=by_method,
        sellers=sorted(sellers.values(), key=lambda item: item.total_clp, reverse=True),
        voided_count=voided,
        sales=[_read(sale, payments.get(sale.id)) for sale, _ in sales],
    )


@router.post("/sales/{sale_id}/void", response_model=PosSaleRead)
def void(
    sale_id: UUID,
    payload: VoidPayload,
    db: Session = Depends(get_db),
    admin: CurrentUser = Depends(require_admin),
) -> PosSaleRead:
    try:
        sale = pos.void_sale(db, sale_id, payload.reason, admin)
    except pos.PosError as error:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error
    return _read(sale, _payment(db, sale.id))
