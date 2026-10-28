from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.services.access import (
    access_required,
    bearer_token,
    issue_token,
    session_hours,
    token_expiry,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginPayload(BaseModel):
    password: str = Field(min_length=1, max_length=200)


class AccessStatusRead(BaseModel):
    required: bool
    authenticated: bool
    expires_at: str | None = None


class LoginRead(BaseModel):
    token: str
    expires_at: str
    session_hours: int


@router.get("/status", response_model=AccessStatusRead)
def access_status(
    authorization: Annotated[str | None, Header()] = None,
) -> AccessStatusRead:
    if not access_required():
        return AccessStatusRead(required=False, authenticated=True)

    expires_at = token_expiry(bearer_token(authorization) or "")
    return AccessStatusRead(
        required=True,
        authenticated=expires_at is not None,
        expires_at=expires_at.isoformat() if expires_at else None,
    )


@router.post("/login", response_model=LoginRead)
def login(payload: LoginPayload) -> LoginRead:
    if not access_required():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta instalación no exige contraseña",
        )
    if not verify_password(payload.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Contraseña incorrecta",
        )
    token, expires_at = issue_token()
    return LoginRead(
        token=token,
        expires_at=expires_at.isoformat(),
        session_hours=session_hours(),
    )
