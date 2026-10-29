from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.category import Category
from app.models.product import PriceMode, Product
from app.models.stock_movement import StockMovement
from app.schemas.pricing import (
    CostChangeRead,
    PriceChangeRead,
    ProductDetailRead,
    ProductMarketRead,
    ProductOverviewRow,
    StockMovementRead,
    ComparableExtremeRead,
)
from app.schemas.product import (
    ProductCostUpdate,
    ProductCreate,
    ProductPriceUpdate,
    ProductRead,
    ProductStockUpdate,
    ProductUpdate,
)
from app.services.catalog import (
    CatalogError,
    cost_history,
    price_history,
    record_cost_change,
    record_initial_values,
    record_price_change,
    set_counted_stock,
    stock_by_product,
)
from app.services.inventory import get_expected_stock
from app.services.market import (
    fold_text,
    get_stale_days,
    product_references,
    reference_counts_by_product,
    summarize_for_product,
    today,
)
from app.services.presenters import analysis_read, reference_detail
from app.services.pricing import (
    InvalidMarginError,
    WarningCode,
    analyze_product,
    validate_margin_pair,
)

router = APIRouter(prefix="/products", tags=["products"])


def _get_product_or_404(db: Session, product_id: UUID) -> Product:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Producto no encontrado",
        )
    return product


def _validate_category(db: Session, category_id: UUID | None) -> None:
    if category_id is None:
        return
    if db.get(Category, category_id) is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Categoría no encontrada",
        )


def _barcode_exists(
    db: Session,
    barcode: str | None,
    *,
    exclude_id: UUID | None = None,
) -> bool:
    if barcode is None:
        return False

    statement = select(Product.id).where(Product.barcode == barcode)
    if exclude_id is not None:
        statement = statement.where(Product.id != exclude_id)
    return db.scalar(statement) is not None


def _validate_price(price_mode: PriceMode, sale_price_clp: int | None) -> None:
    if price_mode == PriceMode.FIXED and sale_price_clp is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Un producto con precio fijo requiere sale_price_clp",
        )


@router.post("", response_model=ProductRead, status_code=status.HTTP_201_CREATED)
def create_product(
    payload: ProductCreate,
    db: Session = Depends(get_db),
) -> Product:
    _validate_category(db, payload.category_id)

    if _barcode_exists(db, payload.barcode):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un producto con ese código de barras",
        )

    data = payload.model_dump(exclude={"initial_quantity", "cost_source"})
    product = Product(**data)
    db.add(product)

    try:
        db.flush()
        record_initial_values(db, product, cost_source=payload.cost_source)
        if payload.initial_quantity is not None and product.track_stock:
            set_counted_stock(db, product, payload.initial_quantity, note="Cantidad inicial")
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No fue posible guardar el producto por un conflicto de datos",
        ) from exc
    except CatalogError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    db.refresh(product)
    return product


@router.get("", response_model=list[ProductRead])
def list_products(
    include_inactive: bool = False,
    search: str | None = None,
    db: Session = Depends(get_db),
) -> list[Product]:
    statement = select(Product)

    if not include_inactive:
        statement = statement.where(Product.active.is_(True))

    if search is not None and search.strip():
        term = search.strip()
        statement = statement.where(
            or_(
                Product.name.ilike(f"%{term}%"),
                Product.brand.ilike(f"%{term}%"),
                Product.barcode == term,
            )
        )

    statement = statement.order_by(Product.name)
    return list(db.scalars(statement).all())


@router.get("/overview", response_model=list[ProductOverviewRow])
def products_overview(
    include_inactive: bool = False,
    search: str | None = None,
    category_id: UUID | None = None,
    db: Session = Depends(get_db),
) -> list[ProductOverviewRow]:
    """Listado de inventario con indicadores para decidir qué revisar."""
    statement = select(Product)
    if not include_inactive:
        statement = statement.where(Product.active.is_(True))
    if category_id is not None:
        statement = statement.where(Product.category_id == category_id)
    products = list(db.scalars(statement.order_by(Product.name)).all())
    if search is not None and search.strip():
        # Se filtra en Python para ignorar tildes y mayúsculas en SQLite y en
        # Postgres por igual ("triton" encuentra "Tritón"). El inventario de un
        # minimarket es pequeño, así que no compensa depender de unaccent.
        term = fold_text(search)
        products = [
            product
            for product in products
            if term in fold_text(
                " ".join(filter(None, [product.name, product.brand, product.variant]))
            )
            or (product.barcode is not None and search.strip() in product.barcode)
        ]
    ids = [product.id for product in products]

    categories = {category.id: category for category in db.scalars(select(Category)).all()}
    stock = stock_by_product(db, ids)
    stale_days = get_stale_days(db)
    market_counts = reference_counts_by_product(db, ids, stale_days=stale_days, on=today())

    rows: list[ProductOverviewRow] = []
    for product in products:
        category = categories.get(product.category_id) if product.category_id else None
        analysis = analyze_product(
            product,
            category,
            cost_changes=cost_history(db, product.id),
            price_changes=price_history(db, product.id),
        )
        count, refs_stale = market_counts.get(product.id, (0, False))
        codes = {warning.code for warning in analysis.warnings}
        rows.append(
            ProductOverviewRow(
                id=product.id,
                name=product.name,
                brand=product.brand,
                variant=product.variant,
                content_amount=product.content_amount,
                content_unit=product.content_unit,
                category_id=product.category_id,
                category_name=category.name if category else None,
                active=product.active,
                track_stock=product.track_stock,
                stock_unit=product.stock_unit,
                quantity=stock.get(product.id, Decimal("0.000")) if product.track_stock else None,
                sale_price_clp=product.sale_price_clp,
                total_unit_cost_clp=analysis.total_unit_cost_clp,
                current_gross_margin=analysis.current_gross_margin,
                cost_pending=WarningCode.COST_MISSING in codes,
                margins_pending=WarningCode.MARGINS_MISSING in codes,
                market_reference_count=count,
                market_references_stale=refs_stale,
                needs_review=analysis.needs_review or refs_stale,
            )
        )
    return rows


@router.get("/by-barcode", response_model=ProductRead)
def get_product_by_barcode(
    code: str,
    db: Session = Depends(get_db),
) -> Product:
    """Busca un producto (activo o no) por su código de barras o QR exacto."""
    term = code.strip()
    if not term:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Indica el código a buscar.",
        )
    product = db.scalars(
        select(Product).where(Product.barcode == term).order_by(Product.active.desc())
    ).first()
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No hay ningún producto con ese código.",
        )
    return product


@router.get("/{product_id}", response_model=ProductRead)
def get_product(
    product_id: UUID,
    db: Session = Depends(get_db),
) -> Product:
    return _get_product_or_404(db, product_id)


@router.patch("/{product_id}", response_model=ProductRead)
def update_product(
    product_id: UUID,
    payload: ProductUpdate,
    db: Session = Depends(get_db),
) -> Product:
    product = _get_product_or_404(db, product_id)
    changes = payload.model_dump(exclude_unset=True)

    if "category_id" in changes:
        _validate_category(db, changes["category_id"])

    if "barcode" in changes and _barcode_exists(
        db,
        changes["barcode"],
        exclude_id=product.id,
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Ya existe un producto con ese código de barras",
        )

    next_price_mode = changes.get("price_mode", product.price_mode)
    next_sale_price = (
        changes["sale_price_clp"]
        if "sale_price_clp" in changes
        else product.sale_price_clp
    )
    _validate_price(next_price_mode, next_sale_price)

    try:
        validate_margin_pair(
            changes.get("min_margin", product.min_margin),
            changes.get("upper_margin", product.upper_margin),
        )
    except InvalidMarginError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    next_amount = changes.get("content_amount", product.content_amount)
    next_unit = changes.get("content_unit", product.content_unit)
    if (next_amount is None) != (next_unit is None):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="El contenido requiere cantidad y unidad",
        )

    price_note = changes.pop("price_note", None)
    if "sale_price_clp" in changes:
        # Todo cambio de precio queda en el historial, venga de donde venga.
        record_price_change(db, product, changes.pop("sale_price_clp"), note=price_note)

    for field, value in changes.items():
        setattr(product, field, value)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No fue posible actualizar el producto por un conflicto de datos",
        ) from exc

    db.refresh(product)
    return product


@router.put("/{product_id}/price", response_model=ProductRead)
def update_sale_price(
    product_id: UUID,
    payload: ProductPriceUpdate,
    db: Session = Depends(get_db),
) -> Product:
    """Cambio explícito del precio de venta decidido por el administrador."""
    product = _get_product_or_404(db, product_id)
    record_price_change(db, product, payload.sale_price_clp, note=payload.note)
    db.commit()
    db.refresh(product)
    return product


@router.put("/{product_id}/cost", response_model=ProductRead)
def update_cost(
    product_id: UUID,
    payload: ProductCostUpdate,
    db: Session = Depends(get_db),
) -> Product:
    """Registra el último costo unitario de compra conocido y el costo
    adicional de abastecimiento, conservando el historial."""
    product = _get_product_or_404(db, product_id)
    record_cost_change(
        db,
        product,
        unit_cost=payload.last_unit_cost_clp,
        extra_cost=payload.extra_supply_cost_clp,
        source=payload.source,
        note=payload.note,
    )
    db.commit()
    db.refresh(product)
    return product


@router.put("/{product_id}/stock", response_model=StockMovementRead | None)
def update_stock(
    product_id: UUID,
    payload: ProductStockUpdate,
    db: Session = Depends(get_db),
) -> StockMovement | None:
    """Fija la cantidad contada; la diferencia queda como movimiento."""
    product = _get_product_or_404(db, product_id)
    try:
        movement = set_counted_stock(db, product, payload.quantity, note=payload.note)
    except CatalogError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    db.commit()
    if movement is not None:
        db.refresh(movement)
    return movement


@router.get("/{product_id}/detail", response_model=ProductDetailRead)
def get_product_detail(
    product_id: UUID,
    db: Session = Depends(get_db),
) -> ProductDetailRead:
    """Todo lo necesario para decidir el precio de un producto."""
    product = _get_product_or_404(db, product_id)
    category = db.get(Category, product.category_id) if product.category_id else None
    costs = cost_history(db, product.id)
    prices = price_history(db, product.id)
    analysis = analyze_product(product, category, cost_changes=costs, price_changes=prices)

    stale_days = get_stale_days(db)
    on = today()
    references = product_references(db, product.id)
    summary = summarize_for_product(references, stale_days=stale_days, on=on)

    movements = list(
        db.scalars(
            select(StockMovement)
            .where(StockMovement.product_id == product.id)
            .order_by(StockMovement.created_at.desc())
        ).all()
    )

    def extreme(value):
        if value is None:
            return None
        return ComparableExtremeRead(
            price_clp=value.price_clp,
            reference_id=value.reference_id,
            source_name=value.source_name,
            scope=value.scope,
            observed_on=value.observed_on,
        )

    return ProductDetailRead(
        product=ProductRead.model_validate(product),
        category_name=category.name if category else None,
        quantity=get_expected_stock(db, product.id) if product.track_stock else None,
        pricing=analysis_read(analysis),
        cost_history=[CostChangeRead.model_validate(item) for item in reversed(costs)],
        price_history=[PriceChangeRead.model_validate(item) for item in reversed(prices)],
        stock_movements=[
            StockMovementRead(
                id=movement.id,
                movement_type=movement.movement_type.value,
                quantity_delta=movement.quantity_delta,
                note=movement.note,
                created_at=movement.created_at,
            )
            for movement in movements
        ],
        market=ProductMarketRead(
            stale_days=stale_days,
            has_references=summary.has_references,
            has_stale=summary.has_stale,
            exact_regular_low=extreme(summary.exact_regular_low),
            exact_regular_high=extreme(summary.exact_regular_high),
            references=[
                reference_detail(reference, stale_days=stale_days, on=on)
                for reference in references
            ],
        ),
    )
