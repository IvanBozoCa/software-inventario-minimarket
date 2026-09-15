from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.sale import (
    AddFreeAmountRequest,
    SaleRead,
    ScanBarcodeRequest,
    ScanBarcodeResponse,
    ScanResultType,
)
from app.services.sales import (
    InvalidFreeAmountError,
    SaleItemNotFoundError,
    SaleNotDraftError,
    SaleNotFoundError,
    ScanOutcome,
    add_free_amount,
    create_draft_sale,
    delete_draft_item,
    get_sale,
    scan_product_by_barcode,
)

router = APIRouter(prefix="/sales", tags=["sales"])


def _raise_sale_http_error(exc: Exception) -> None:
    if isinstance(exc, SaleNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    if isinstance(exc, SaleItemNotFoundError):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    if isinstance(exc, SaleNotDraftError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    if isinstance(exc, InvalidFreeAmountError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    raise exc


@router.post(
    "/draft",
    response_model=SaleRead,
    status_code=status.HTTP_201_CREATED,
)
def create_sale_draft(db: Session = Depends(get_db)):
    return create_draft_sale(db)


@router.get("/{sale_id}", response_model=SaleRead)
def read_sale(
    sale_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        return get_sale(db, sale_id)
    except SaleNotFoundError as exc:
        _raise_sale_http_error(exc)


@router.post("/{sale_id}/scan", response_model=ScanBarcodeResponse)
def scan_sale_product(
    sale_id: UUID,
    payload: ScanBarcodeRequest,
    db: Session = Depends(get_db),
):
    try:
        outcome, sale, item = scan_product_by_barcode(
            db,
            sale_id,
            payload.barcode,
        )
    except (SaleNotFoundError, SaleNotDraftError) as exc:
        _raise_sale_http_error(exc)

    if outcome == ScanOutcome.UNKNOWN_BARCODE:
        return ScanBarcodeResponse(
            result=ScanResultType.UNKNOWN_BARCODE,
            message="Producto no registrado. Puedes usar AGREGAR MONTO.",
            added_item_id=None,
            sale=sale,
        )

    if outcome == ScanOutcome.MANUAL_PRICE_REQUIRED:
        return ScanBarcodeResponse(
            result=ScanResultType.MANUAL_PRICE_REQUIRED,
            message="Este producto necesita que ingreses el monto manualmente.",
            added_item_id=None,
            sale=sale,
        )

    return ScanBarcodeResponse(
        result=ScanResultType.ADDED,
        message="Producto agregado",
        added_item_id=item.id if item is not None else None,
        sale=sale,
    )


@router.post(
    "/{sale_id}/free-amount",
    response_model=SaleRead,
    status_code=status.HTTP_201_CREATED,
)
def add_sale_free_amount(
    sale_id: UUID,
    payload: AddFreeAmountRequest,
    db: Session = Depends(get_db),
):
    try:
        sale, _ = add_free_amount(
            db,
            sale_id,
            payload.amount_clp,
            description=payload.description,
        )
        return sale
    except (
        SaleNotFoundError,
        SaleNotDraftError,
        InvalidFreeAmountError,
    ) as exc:
        _raise_sale_http_error(exc)


@router.delete(
    "/{sale_id}/items/{item_id}",
    response_model=SaleRead,
)
def remove_sale_item(
    sale_id: UUID,
    item_id: UUID,
    db: Session = Depends(get_db),
):
    try:
        return delete_draft_item(db, sale_id, item_id)
    except (
        SaleNotFoundError,
        SaleNotDraftError,
        SaleItemNotFoundError,
    ) as exc:
        _raise_sale_http_error(exc)
