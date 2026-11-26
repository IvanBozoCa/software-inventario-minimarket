"""Usuarios de SIM: quién puede entrar y qué puede hacer.

Los correos de `SIM_ALLOWED_EMAILS` son los dueños: siempre entran como
administradores (así nadie queda fuera por error). El resto de las personas
las agrega un administrador desde la pantalla Usuarios y quedan en la tabla
`app_users` con su rol.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.app_user import AppUser, UserRole
from app.services.access import allowed_emails

# Cada cuánto se actualiza "última vez visto" (evita escribir en cada petición).
LAST_SEEN_EVERY = timedelta(minutes=10)

READ_METHODS = {"GET", "HEAD", "OPTIONS"}

# Cambios que un vendedor siempre puede hacer: cantidades y ventas.
_SELLER_WRITES = (
    re.compile(r"^/products/[^/]+/stock$"),
    re.compile(r"^/sales(/.*)?$"),
)
_PRICE_WRITE = re.compile(r"^/products/[^/]+/price$")
# Lecturas reservadas al administrador.
_ADMIN_READS = (re.compile(r"^/users(/.*)?$"),)


@dataclass(frozen=True)
class CurrentUser:
    email: str | None
    name: str
    role: UserRole
    can_edit_prices: bool
    # Dueño configurado en el servidor (no se puede quitar desde la app).
    owner: bool = False
    id: UUID | None = None

    @property
    def is_admin(self) -> bool:
        return self.role == UserRole.ADMIN


# Instalación local sin acceso restringido, o con contraseña única.
LOCAL_ADMIN = CurrentUser(email=None, name="Administrador", role=UserRole.ADMIN, can_edit_prices=True, owner=True)


def normalize_email(email: str) -> str:
    return email.strip().lower()


def default_name(email: str) -> str:
    local = email.split("@", 1)[0]
    words = re.split(r"[._\-+]+", local)
    return " ".join(word.capitalize() for word in words if word)[:80] or "Administrador"


def find_user(db: Session, email: str) -> AppUser | None:
    return db.scalar(select(AppUser).where(func.lower(AppUser.email) == normalize_email(email)))


def _touch(db: Session, user: AppUser, now: datetime) -> None:
    last = user.last_seen_at
    if last is not None and last.tzinfo is None:
        last = last.replace(tzinfo=timezone.utc)
    if last is None or now - last >= LAST_SEEN_EVERY:
        user.last_seen_at = now
        db.commit()


def resolve_user(db: Session, email: str, now: datetime | None = None) -> CurrentUser | None:
    """Usuario con acceso para ese correo, o None si no está autorizado."""
    email = normalize_email(email)
    if not email:
        return None
    now = now or datetime.now(timezone.utc)
    user = find_user(db, email)

    if email in allowed_emails():
        # Dueño: se registra en la tabla la primera vez que entra y siempre
        # queda como administrador activo.
        if user is None:
            user = AppUser(email=email, name=default_name(email), role=UserRole.ADMIN, can_edit_prices=True)
            db.add(user)
            try:
                db.commit()
            except IntegrityError:
                # Otra petición simultánea lo registró primero.
                db.rollback()
                user = find_user(db, email)
                if user is None:
                    raise
            db.refresh(user)
        elif user.role != UserRole.ADMIN or not user.active:
            user.role = UserRole.ADMIN
            user.active = True
            db.commit()
        _touch(db, user, now)
        return CurrentUser(
            email=email, name=user.name, role=UserRole.ADMIN, can_edit_prices=True, owner=True, id=user.id
        )

    if user is None or not user.active:
        return None
    _touch(db, user, now)
    return CurrentUser(
        email=email,
        name=user.name,
        role=user.role,
        can_edit_prices=user.role == UserRole.ADMIN or user.can_edit_prices,
        id=user.id,
    )


def forbidden_reason(user: CurrentUser, method: str, path: str) -> str | None:
    """Mensaje si el usuario no puede hacer esta petición; None si puede."""
    if user.is_admin:
        return None
    if method.upper() in READ_METHODS:
        if any(pattern.match(path) for pattern in _ADMIN_READS):
            return "Solo un administrador puede ver esta sección"
        return None
    if any(pattern.match(path) for pattern in _SELLER_WRITES):
        return None
    if _PRICE_WRITE.match(path):
        if user.can_edit_prices:
            return None
        return "No tienes permiso para cambiar precios. Pídeselo a un administrador."
    return "Solo un administrador puede hacer este cambio"
