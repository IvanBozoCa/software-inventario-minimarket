from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.schemas.payment import (
    CardPaymentRequest,
    CashPaymentRequest,
    CheckoutResponse,
    ConfirmCardPaymentRequest,
)
from app.schemas.sale import (
    AddFreeAmountRequest,
    AddProductRequest,
    SaleRead,
    ScanBarcodeRequest,
    ScanBarcodeResponse,
    ScanResultType,
)
from app.services.checkout import (
    EmptySaleError,
    InsufficientCashError,
    PaymentNotConfirmableError,
    PaymentNotFoundError,
    SaleNotFoundError as CheckoutSaleNotFoundError,
    SaleNotPayableError,
    complete_cash_payment,
    confirm_card_payment,
    start_card_payment,
)
from app.services.sales import (
    InvalidFreeAmountError,
    InvalidSaleQuantityError,
    ProductManualPriceRequiredError,
    ProductNotFoundError,
    SaleItemNotFoundError,
    SaleNotDraftError,
    SaleNotFoundError,
    ScanOutcome,
    add_free_amount,
    add_product_to_draft,
    create_draft_sale,
    delete_draft_item,
    get_sale,
    scan_product_by_barcode,
)

router = APIRouter(prefix="/sales", tags=["sales"])


def _raise_sale_http_error(exc: Exception) -> None:
    if isinstance(exc, (SaleNotFoundError, SaleItemNotFoundError, ProductNotFoundError)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    if isinstance(exc, SaleNotDraftError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    if isinstance(exc, ProductManualPriceRequiredError):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    if isinstance(exc, (InvalidFreeAmountError, InvalidSaleQuantityError)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    raise exc


def _raise_checkout_http_error(exc: Exception) -> None:
    if isinstance(exc, (CheckoutSaleNotFoundError, PaymentNotFoundError)):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    if isinstance(exc, InsufficientCashError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    if isinstance(
        exc,
        (EmptySaleError, SaleNotPayableError, PaymentNotConfirmableError),
    ):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
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
    "/{sale_id}/items/product",
    response_model=SaleRead,
    status_code=status.HTTP_201_CREATED,
)
def add_sale_product(
    sale_id: UUID,
    payload: AddProductRequest,
    db: Session = Depends(get_db),
):
    try:
        sale, _ = add_product_to_draft(
            db,
            sale_id,
            payload.product_id,
            quantity=payload.quantity,
        )
        return sale
    except (
        SaleNotFoundError,
        SaleNotDraftError,
        ProductNotFoundError,
        ProductManualPriceRequiredError,
        InvalidSaleQuantityError,
    ) as exc:
        _raise_sale_http_error(exc)


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


@router.post(
    "/{sale_id}/payments/cash",
    response_model=CheckoutResponse,
    status_code=status.HTTP_201_CREATED,
)
def pay_sale_with_cash(
    sale_id: UUID,
    payload: CashPaymentRequest,
    db: Session = Depends(get_db),
):
    try:
        sale, payment = complete_cash_payment(
            db,
            sale_id,
            payload.cash_received_clp,
        )
        return CheckoutResponse(sale=sale, payment=payment)
    except (
        CheckoutSaleNotFoundError,
        SaleNotPayableError,
        EmptySaleError,
        InsufficientCashError,
    ) as exc:
        _raise_checkout_http_error(exc)


@router.post(
    "/{sale_id}/payments/card",
    response_model=CheckoutResponse,
    status_code=status.HTTP_201_CREATED,
)
def begin_sale_card_payment(
    sale_id: UUID,
    payload: CardPaymentRequest,
    db: Session = Depends(get_db),
):
    try:
        sale, payment = start_card_payment(
            db,
            sale_id,
            provider=payload.provider,
            external_reference=payload.external_reference,
        )
        return CheckoutResponse(sale=sale, payment=payment)
    except (
        CheckoutSaleNotFoundError,
        SaleNotPayableError,
        EmptySaleError,
    ) as exc:
        _raise_checkout_http_error(exc)


@router.post(
    "/{sale_id}/payments/{payment_id}/confirm",
    response_model=CheckoutResponse,
)
def approve_sale_card_payment(
    sale_id: UUID,
    payment_id: UUID,
    payload: ConfirmCardPaymentRequest,
    db: Session = Depends(get_db),
):
    try:
        sale, payment = confirm_card_payment(
            db,
            sale_id,
            payment_id,
            provider=payload.provider,
            external_reference=payload.external_reference,
        )
        return CheckoutResponse(sale=sale, payment=payment)
    except (
        CheckoutSaleNotFoundError,
        SaleNotPayableError,
        PaymentNotFoundError,
        PaymentNotConfirmableError,
    ) as exc:
        _raise_checkout_http_error(exc)
