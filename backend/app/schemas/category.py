from datetime import datetime
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def margin_field():
    return Field(default=None, ge=0, lt=1, max_digits=6, decimal_places=4)


def _check_margins(min_margin: Decimal | None, upper_margin: Decimal | None) -> None:
    if min_margin is not None and upper_margin is not None and upper_margin < min_margin:
        raise ValueError(
            "El margen superior de referencia no puede ser menor que el margen mínimo"
        )


class CategoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    min_margin: Decimal | None = margin_field()
    upper_margin: Decimal | None = margin_field()

    @model_validator(mode="after")
    def validate_margins(self) -> "CategoryCreate":
        _check_margins(self.min_margin, self.upper_margin)
        return self

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("El nombre de la categoría no puede estar vacío")
        return value


class CategoryUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    active: bool | None = None
    min_margin: Decimal | None = margin_field()
    upper_margin: Decimal | None = margin_field()

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is None:
            return None
        value = value.strip()
        if not value:
            raise ValueError("El nombre de la categoría no puede estar vacío")
        return value


class CategoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    active: bool
    min_margin: Decimal | None
    upper_margin: Decimal | None
    created_at: datetime
    updated_at: datetime
