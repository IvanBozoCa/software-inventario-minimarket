from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.product import Product
from app.schemas.inventory import InitialStockCreate, InitialStockRead, ProductStockRead
from app.services.inventory import (
    InvalidInitialStockQuantityError,
    ProductNotFoundError,
    StockTrackingDisabledError,
    get_expected_stock,
    register_initial_stock,
)

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.post(
    "/initial-stock",
    response_model=InitialStockRead,
    status_code=status.HTTP_201_CREATED,
)
def create_initial_stock(
    payload: InitialStockCreate,
    db: Session = Depends(get_db),
) -> InitialStockRead:
    try:
        movement, expected_stock = register_initial_stock(
            db,
            payload.product_id,
            payload.quantity,
            note=payload.note,
        )
    except ProductNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except StockTrackingDisabledError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except InvalidInitialStockQuantityError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc

    return InitialStockRead(
        movement_id=movement.id,
        product_id=movement.product_id,
        movement_type=movement.movement_type,
        quantity_delta=movement.quantity_delta,
        expected_stock=expected_stock,
        note=movement.note,
        created_at=movement.created_at,
    )


@router.get(
    "/products/{product_id}/stock",
    response_model=ProductStockRead,
)
def get_product_stock(
    product_id: UUID,
    db: Session = Depends(get_db),
) -> ProductStockRead:
    product = db.get(Product, product_id)
    if product is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Producto no encontrado",
        )

    return ProductStockRead(
        product_id=product.id,
        expected_stock=get_expected_stock(db, product.id),
        track_stock=product.track_stock,
    )
