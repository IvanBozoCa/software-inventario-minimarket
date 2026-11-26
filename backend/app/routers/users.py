"""Pantalla Usuarios: el administrador da y quita acceso a SIM."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_admin
from app.models.app_user import AppUser, UserRole
from app.schemas.users import UserCreate, UserRead, UserUpdate
from app.services.access import allowed_emails
from app.services.users import CurrentUser, find_user

router = APIRouter(prefix="/users", tags=["users"])


def _read(user: AppUser) -> UserRead:
    data = UserRead.model_validate(user)
    data.owner = user.email in allowed_emails()
    return data


def _active_admins(db: Session) -> int:
    admins = db.scalars(
        select(AppUser).where(AppUser.role == UserRole.ADMIN, AppUser.active.is_(True))
    ).all()
    return len(admins)


@router.get("", response_model=list[UserRead])
def list_users(db: Session = Depends(get_db), _: CurrentUser = Depends(require_admin)) -> list[UserRead]:
    users = db.scalars(select(AppUser).order_by(AppUser.active.desc(), AppUser.name)).all()
    return [_read(user) for user in users]


@router.post("", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    db: Session = Depends(get_db),
    _: CurrentUser = Depends(require_admin),
) -> UserRead:
    existing = find_user(db, payload.email)
    if existing is not None:
        if existing.active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"{payload.email} ya tiene acceso como {existing.name}",
            )
        # Volver a dar acceso a alguien que se había desactivado.
        existing.name = payload.name
        existing.role = payload.role
        existing.can_edit_prices = payload.can_edit_prices
        existing.active = True
        db.commit()
        db.refresh(existing)
        return _read(existing)

    user = AppUser(
        email=payload.email,
        name=payload.name,
        role=payload.role,
        can_edit_prices=payload.can_edit_prices,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return _read(user)


@router.patch("/{user_id}", response_model=UserRead)
def update_user(
    user_id: UUID,
    payload: UserUpdate,
    db: Session = Depends(get_db),
    me: CurrentUser = Depends(require_admin),
) -> UserRead:
    user = db.get(AppUser, user_id)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Usuario no encontrado")

    changes = payload.model_dump(exclude_unset=True)
    loses_admin = (changes.get("role") == UserRole.SELLER or changes.get("active") is False) and (
        user.role == UserRole.ADMIN and user.active
    )
    if loses_admin:
        if user.email in allowed_emails():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Este correo es dueño de SIM (configurado en el servidor) y siempre es administrador",
            )
        if me.id is not None and user.id == me.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="No puedes quitarte tu propio acceso de administrador",
            )
        if _active_admins(db) <= 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Debe quedar al menos un administrador activo",
            )

    for field, value in changes.items():
        if value is not None:
            setattr(user, field, value)
    db.commit()
    db.refresh(user)
    return _read(user)
