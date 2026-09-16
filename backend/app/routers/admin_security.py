from typing import Annotated

from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_admin_session
from app.schemas.admin_security import (
    AdminMessageRead,
    AdminSecurityStatusRead,
    AdminSessionRead,
    AdminUnlockRead,
    PinPayload,
)
from app.services.admin_security import (
    ADMIN_SESSION_MINUTES,
    AdminPinAlreadyConfiguredError,
    AdminPinNotConfiguredError,
    InvalidAdminPinError,
    get_admin_session,
    is_admin_pin_configured,
    lock_admin,
    setup_admin_pin,
    unlock_admin,
)

router = APIRouter(prefix="/admin/security", tags=["admin-security"])


def _bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


@router.get("/status", response_model=AdminSecurityStatusRead)
def security_status(
    db: Session = Depends(get_db),
) -> AdminSecurityStatusRead:
    return AdminSecurityStatusRead(
        configured=is_admin_pin_configured(db),
        session_minutes=ADMIN_SESSION_MINUTES,
    )


@router.post(
    "/setup",
    response_model=AdminMessageRead,
    status_code=status.HTTP_201_CREATED,
)
def setup_pin(
    payload: PinPayload,
    db: Session = Depends(get_db),
) -> AdminMessageRead:
    try:
        setup_admin_pin(db, payload.pin)
    except AdminPinAlreadyConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return AdminMessageRead(message="PIN de administrador configurado")


@router.post("/unlock", response_model=AdminUnlockRead)
def unlock(
    payload: PinPayload,
    db: Session = Depends(get_db),
) -> AdminUnlockRead:
    try:
        token, expires_at = unlock_admin(db, payload.pin)
    except AdminPinNotConfiguredError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    except InvalidAdminPinError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="PIN incorrecto",
        ) from exc

    return AdminUnlockRead(
        token=token,
        expires_at=expires_at,
        session_minutes=ADMIN_SESSION_MINUTES,
    )


@router.get("/session", response_model=AdminSessionRead)
def session_status(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> AdminSessionRead:
    token = _bearer_token(authorization)
    if token is None:
        return AdminSessionRead(valid=False)

    session = get_admin_session(db, token)
    if session is None:
        return AdminSessionRead(valid=False)

    return AdminSessionRead(valid=True, expires_at=session.expires_at)


@router.post("/lock", response_model=AdminMessageRead)
def lock(
    token: str = Depends(require_admin_session),
    db: Session = Depends(get_db),
) -> AdminMessageRead:
    lock_admin(db, token)
    return AdminMessageRead(message="Administración bloqueada")
