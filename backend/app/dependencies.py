from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.access import auth_mode, bearer_token, is_public_path, supabase_claims, token_expiry
from app.services.admin_security import get_admin_session
from app.services.users import LOCAL_ADMIN, CurrentUser, forbidden_reason, resolve_user


def _extract_bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None

    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def require_admin_session(
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> str:
    token = _extract_bearer_token(authorization)
    if token is None or get_admin_session(db, token) is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autorización administrativa requerida",
        )
    return token


# --- Acceso de usuarios (instalación publicada) -----------------------------


def _current_user_for(token: str, db: Session) -> CurrentUser | None:
    mode = auth_mode()
    if mode == "none":
        return LOCAL_ADMIN
    if mode == "password":
        return LOCAL_ADMIN if token_expiry(token) is not None else None
    claims = supabase_claims(token)
    if claims is None:
        return None
    return resolve_user(db, str(claims["email"]))


def authorize_request(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    db: Session = Depends(get_db),
) -> None:
    """Dependencia global: exige sesión y aplica los permisos del rol.

    Deja el usuario en `request.state.user` para las rutas que lo necesiten.
    """
    if request.method == "OPTIONS" or is_public_path(request.url.path):
        return
    user = _current_user_for(bearer_token(authorization) or "", db)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Debes iniciar sesión para usar SIM",
        )
    reason = forbidden_reason(user, request.method, request.url.path)
    if reason is not None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=reason)
    request.state.user = user


def current_user(request: Request) -> CurrentUser:
    return getattr(request.state, "user", LOCAL_ADMIN)


def require_admin(user: CurrentUser = Depends(current_user)) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo un administrador puede hacer esto",
        )
    return user
