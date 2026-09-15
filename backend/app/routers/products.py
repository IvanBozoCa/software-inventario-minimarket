from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.category import Category
from app.models.product import PriceMode, Product
from app.schemas.product import ProductCreate, ProductRead, ProductUpdate

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

    product = Product(**payload.model_dump())
    db.add(product)

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="No fue posible guardar el producto por un conflicto de datos",
        ) from exc

    db.refresh(product)
    return product


@router.get("", response_model=list[ProductRead])
def list_products(
    include_inactive: bool = False,
    db: Session = Depends(get_db),
) -> list[Product]:
    statement = select(Product)
    if not include_inactive:
        statement = statement.where(Product.active.is_(True))
    statement = statement.order_by(Product.name)
    return list(db.scalars(statement).all())


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
