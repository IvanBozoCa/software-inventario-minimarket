from datetime import datetime

from pydantic import BaseModel, Field


class PinPayload(BaseModel):
    pin: str = Field(
        min_length=4,
        max_length=8,
        pattern=r"^\d+$",
    )


class AdminSecurityStatusRead(BaseModel):
    configured: bool
    session_minutes: int


class AdminUnlockRead(BaseModel):
    token: str
    expires_at: datetime
    session_minutes: int


class AdminSessionRead(BaseModel):
    valid: bool
    expires_at: datetime | None = None


class AdminMessageRead(BaseModel):
    message: str
