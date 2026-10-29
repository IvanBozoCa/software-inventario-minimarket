from typing import Annotated

from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, Field

from app.services.access import (
    AuthMode,
    access_required,
    auth_mode,
    bearer_token,
    issue_token,
    session_hours,
    supabase_anon_key,
    supabase_session,
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


class LoginRead(BaseModel):
    token: str
    expires_at: str
    session_hours: int


@router.get("/status", response_model=AccessStatusRead)
def access_status(
    authorization: Annotated[str | None, Header()] = None,
) -> AccessStatusRead:
    mode = auth_mode()
    if mode == "none":
        return AccessStatusRead(required=False, authenticated=True)

    token = bearer_token(authorization) or ""
    if mode == "supabase":
        session = supabase_session(token)
        return AccessStatusRead(
            required=True,
            authenticated=session is not None,
            expires_at=session["expires_at"].isoformat() if session else None,  # type: ignore[union-attr]
            mode=mode,
            supabase_url=supabase_url(),
            supabase_anon_key=supabase_anon_key(),
            email=str(session["email"]) if session else None,
        )

    expires_at = token_expiry(token)
    return AccessStatusRead(
        required=True,
        authenticated=expires_at is not None,
        expires_at=expires_at.isoformat() if expires_at else None,
        mode=mode,
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
