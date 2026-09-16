from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.payment import PaymentMethod, PaymentStatus
from app.schemas.sale import SaleRead


class CashPaymentRequest(BaseModel):
    cash_received_clp: int = Field(gt=0)


class CardPaymentRequest(BaseModel):
    provider: str | None = Field(default=None, max_length=100)
    external_reference: str | None = Field(default=None, max_length=200)


class ConfirmCardPaymentRequest(BaseModel):
    provider: str | None = Field(default=None, max_length=100)
    external_reference: str | None = Field(default=None, max_length=200)


class PaymentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    sale_id: UUID
    method: PaymentMethod
    status: PaymentStatus
    amount_clp: int
    cash_received_clp: int | None
    change_clp: int | None
    provider: str | None
    external_reference: str | None
    created_at: datetime
    confirmed_at: datetime | None


class CheckoutResponse(BaseModel):
    sale: SaleRead
    payment: PaymentRead
