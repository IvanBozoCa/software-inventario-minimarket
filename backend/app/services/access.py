"""Acceso con contraseña única para la instalación publicada en Internet.

En el equipo local no se define `SIM_ACCESS_PASSWORD` y la API queda abierta,
como hasta ahora. Cuando la variable existe, cada petición debe traer un token
firmado que se obtiene con la contraseña. El token no se guarda en ninguna
parte: es una fecha de expiración firmada con HMAC, así funciona igual en
varias instancias (Vercel) y tras reinicios.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone

PASSWORD_ENV = "SIM_ACCESS_PASSWORD"
SESSION_HOURS_ENV = "SIM_ACCESS_SESSION_HOURS"
DEFAULT_SESSION_HOURS = 12
MIN_PASSWORD_LENGTH = 8

# Rutas que no exigen token: salud, documentación e inicio de sesión.
PUBLIC_PATHS = {"/health", "/auth/login", "/auth/status", "/docs", "/openapi.json", "/redoc"}


def configured_password() -> str | None:
    value = os.getenv(PASSWORD_ENV, "").strip()
    return value or None


def access_required() -> bool:
    return configured_password() is not None


def session_hours() -> int:
    raw = os.getenv(SESSION_HOURS_ENV, "").strip()
    try:
        hours = int(raw) if raw else DEFAULT_SESSION_HOURS
    except ValueError:
        hours = DEFAULT_SESSION_HOURS
    return max(1, hours)


def _signing_key(password: str) -> bytes:
    # Clave derivada de la contraseña: cambiar la contraseña invalida todos
    # los tokens emitidos.
    return hashlib.sha256(("sim-access:" + password).encode("utf-8")).digest()


def verify_password(candidate: str) -> bool:
    expected = configured_password()
    if expected is None:
        return False
    return hmac.compare_digest(candidate.encode("utf-8"), expected.encode("utf-8"))


def issue_token(now: datetime | None = None) -> tuple[str, datetime]:
    password = configured_password()
    if password is None:
        raise RuntimeError("No hay contraseña de acceso configurada")

    now = now or datetime.now(timezone.utc)
    expires_at = (now + timedelta(hours=session_hours())).replace(microsecond=0)
    payload = f"{int(expires_at.timestamp())}.{secrets.token_hex(8)}"
    signature = hmac.new(_signing_key(password), payload.encode("ascii"), hashlib.sha256).digest()
    token = payload + "." + base64.urlsafe_b64encode(signature).decode("ascii").rstrip("=")
    return token, expires_at


def token_expiry(token: str, now: datetime | None = None) -> datetime | None:
    """Devuelve la expiración si el token es válido y vigente; si no, None."""
    password = configured_password()
    if password is None or not token:
        return None

    parts = token.split(".")
    if len(parts) != 3:
        return None
    expires_raw, nonce, signature_b64 = parts
    payload = f"{expires_raw}.{nonce}"
    expected = hmac.new(_signing_key(password), payload.encode("ascii"), hashlib.sha256).digest()
    try:
        padded = signature_b64 + "=" * (-len(signature_b64) % 4)
        actual = base64.urlsafe_b64decode(padded.encode("ascii"))
        expires_at = datetime.fromtimestamp(int(expires_raw), tz=timezone.utc)
    except (ValueError, TypeError):
        return None

    if not hmac.compare_digest(actual, expected):
        return None
    now = now or datetime.now(timezone.utc)
    if expires_at <= now:
        return None
    return expires_at


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def is_public_path(path: str) -> bool:
    return path in PUBLIC_PATHS or path.startswith("/docs/")
