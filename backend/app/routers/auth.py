from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.app_user import UserRole
from app.services.users import LOCAL_ADMIN, CurrentUser, resolve_user

from app.services.access import (
    AuthMode,
    access_required,
    auth_mode,
    bearer_token,
    issue_token,
    session_hours,
    supabase_anon_key,
    supabase_claims,
    supabase_url,
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
    # Cómo se entra: "none" (abierto), "password" o "supabase" (enlace mágico).
    mode: AuthMode = "none"
    # Datos públicos que el frontend necesita para hablar con Supabase Auth.
    supabase_url: str | None = None
    supabase_anon_key: str | None = None
    email: str | None = None
    # Quién entró y qué puede hacer (null si no hay sesión).
    name: str | None = None
    role: UserRole | None = None
    can_edit_prices: bool = False


def _with_user(status_read: AccessStatusRead, user: CurrentUser | None) -> AccessStatusRead:
    if user is not None:
        status_read.name = user.name
        status_read.role = user.role
        status_read.can_edit_prices = user.can_edit_prices
    return status_read


class LoginRead(BaseModel):
    token: str
    expires_at: str
    session_hours: int


@router.get("/status", response_model=AccessStatusRead)
def access_status(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> AccessStatusRead:
    mode = auth_mode()
    if mode == "none":
        return _with_user(AccessStatusRead(required=False, authenticated=True), LOCAL_ADMIN)

    token = bearer_token(authorization) or ""
    if mode == "supabase":
        claims = supabase_claims(token)
        user = resolve_user(db, str(claims["email"])) if claims else None
        return _with_user(
            AccessStatusRead(
                required=True,
                authenticated=user is not None,
                expires_at=claims["expires_at"].isoformat() if user and claims else None,  # type: ignore[union-attr]
                mode=mode,
                supabase_url=supabase_url(),
                supabase_anon_key=supabase_anon_key(),
                email=str(claims["email"]) if user and claims else None,
            ),
            user,
        )

    expires_at = token_expiry(token)
    return _with_user(
        AccessStatusRead(
            required=True,
            authenticated=expires_at is not None,
            expires_at=expires_at.isoformat() if expires_at else None,
            mode=mode,
        ),
        LOCAL_ADMIN if expires_at else None,
    )


@router.post("/login", response_model=LoginRead)
def login(payload: LoginPayload) -> LoginRead:
    if not access_required() or auth_mode() != "password":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esta instalación no usa contraseña",
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
