"""Personas autorizadas a entrar a SIM y su rol en el negocio."""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum as PythonEnum
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, String, Uuid
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class UserRole(str, PythonEnum):
    # Administra todo: precios, costos, categorías, usuarios.
    ADMIN = "ADMIN"
    # Vende y ajusta cantidades; cambia precios solo si se le autoriza.
    SELLER = "SELLER"


class AppUser(Base):
    __tablename__ = "app_users"
    __table_args__ = (
        CheckConstraint("length(trim(email)) > 3", name="ck_app_users_email_not_blank"),
        CheckConstraint("length(trim(name)) > 0", name="ck_app_users_name_not_blank"),
    )

    id: Mapped[UUID] = mapped_column(Uuid(as_uuid=True), primary_key=True, default=uuid4)
    # Siempre en minúsculas: es el correo de la cuenta de Google o del enlace mágico.
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True, index=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False, create_constraint=True),
        nullable=False,
        default=UserRole.SELLER,
    )
    can_edit_prices: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, default=utc_now, onupdate=utc_now
    )
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
