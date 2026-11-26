from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.app_user import UserRole

EMAIL_PATTERN = r"^[^@\s]+@[^@\s]+\.[^@\s]+$"


def _clean_name(value: str) -> str:
    value = " ".join(value.split())
    if not value:
        raise ValueError("Escribe el nombre")
    return value


class UserCreate(BaseModel):
    email: str = Field(max_length=254, pattern=EMAIL_PATTERN)
    name: str = Field(min_length=1, max_length=80)
    role: UserRole = UserRole.SELLER
    can_edit_prices: bool = False

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: object) -> object:
        return value.strip().lower() if isinstance(value, str) else value

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        return _clean_name(value)


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    role: UserRole | None = None
    can_edit_prices: bool | None = None
    active: bool | None = None

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str | None) -> str | None:
        return None if value is None else _clean_name(value)


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    email: str
    name: str
    role: UserRole
    can_edit_prices: bool
    active: bool
    owner: bool = False
    created_at: datetime
    last_seen_at: datetime | None
