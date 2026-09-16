from __future__ import annotations

import base64
import hashlib
import hmac
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.admin_security import AdminSecurity, AuditLog

ADMIN_SESSION_MINUTES = 15
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1
_SCRYPT_KEY_LENGTH = 32


class AdminSecurityError(Exception):
    pass


class AdminPinAlreadyConfiguredError(AdminSecurityError):
    pass


class AdminPinNotConfiguredError(AdminSecurityError):
    pass


class InvalidAdminPinError(AdminSecurityError):
    pass


@dataclass(frozen=True)
class AdminSession:
    expires_at: datetime
    pin_hash_snapshot: str


_admin_sessions: dict[str, AdminSession] = {}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def get_admin_security(db: Session) -> AdminSecurity | None:
    return db.scalar(select(AdminSecurity).order_by(AdminSecurity.id).limit(1))


def is_admin_pin_configured(db: Session) -> bool:
    return get_admin_security(db) is not None


def hash_pin(pin: str) -> str:
    salt = secrets.token_bytes(16)
    derived_key = hashlib.scrypt(
        pin.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_SCRYPT_KEY_LENGTH,
    )
    return "$".join(
        [
            "scrypt",
            str(_SCRYPT_N),
            str(_SCRYPT_R),
            str(_SCRYPT_P),
            base64.urlsafe_b64encode(salt).decode("ascii"),
            base64.urlsafe_b64encode(derived_key).decode("ascii"),
        ]
    )


def verify_pin(pin: str, encoded_hash: str) -> bool:
    try:
        algorithm, n, r, p, salt_b64, expected_b64 = encoded_hash.split("$", 5)
        if algorithm != "scrypt":
            return False
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected = base64.urlsafe_b64decode(expected_b64.encode("ascii"))
        actual = hashlib.scrypt(
            pin.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
        )
    except (ValueError, TypeError):
        return False

    return hmac.compare_digest(actual, expected)


def record_audit(
    db: Session,
    *,
    action: str,
    success: bool,
    entity_type: str | None = None,
    entity_id: str | None = None,
    details: str | None = None,
) -> AuditLog:
    log = AuditLog(
        action=action,
        success=success,
        entity_type=entity_type,
        entity_id=entity_id,
        details=details,
    )
    db.add(log)
    return log


def setup_admin_pin(db: Session, pin: str) -> AdminSecurity:
    if get_admin_security(db) is not None:
        raise AdminPinAlreadyConfiguredError("El PIN de administrador ya está configurado")

    security = AdminSecurity(pin_hash=hash_pin(pin))
    db.add(security)
    record_audit(
        db,
        action="ADMIN_PIN_CONFIGURED",
        success=True,
        entity_type="AdminSecurity",
        entity_id="1",
        details="PIN administrativo configurado por primera vez",
    )
    db.commit()
    db.refresh(security)
    return security


def unlock_admin(db: Session, pin: str) -> tuple[str, datetime]:
    security = get_admin_security(db)
    if security is None:
        raise AdminPinNotConfiguredError("El PIN de administrador aún no está configurado")

    if not verify_pin(pin, security.pin_hash):
        record_audit(
            db,
            action="ADMIN_UNLOCK",
            success=False,
            entity_type="AdminSecurity",
            entity_id=str(security.id),
            details="Intento con PIN incorrecto",
        )
        db.commit()
        raise InvalidAdminPinError("PIN incorrecto")

    expires_at = utc_now() + timedelta(minutes=ADMIN_SESSION_MINUTES)
    token = secrets.token_urlsafe(32)
    _admin_sessions[token] = AdminSession(
        expires_at=expires_at,
        pin_hash_snapshot=security.pin_hash,
    )
    record_audit(
        db,
        action="ADMIN_UNLOCK",
        success=True,
        entity_type="AdminSecurity",
        entity_id=str(security.id),
        details=f"Acceso administrativo autorizado por {ADMIN_SESSION_MINUTES} minutos",
    )
    db.commit()
    return token, expires_at


def get_admin_session(db: Session, token: str) -> AdminSession | None:
    session = _admin_sessions.get(token)
    if session is None:
        return None

    if session.expires_at <= utc_now():
        _admin_sessions.pop(token, None)
        return None

    security = get_admin_security(db)
    if security is None or not hmac.compare_digest(
        session.pin_hash_snapshot,
        security.pin_hash,
    ):
        _admin_sessions.pop(token, None)
        return None

    return session


def lock_admin(db: Session, token: str) -> None:
    session = get_admin_session(db, token)
    if session is None:
        return

    _admin_sessions.pop(token, None)
    record_audit(
        db,
        action="ADMIN_LOCK",
        success=True,
        entity_type="AdminSecurity",
        entity_id="1",
        details="Sesión administrativa cerrada manualmente",
    )
    db.commit()


def clear_admin_sessions_for_tests() -> None:
    _admin_sessions.clear()
