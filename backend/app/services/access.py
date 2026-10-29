"""Control de acceso de la instalación publicada en Internet.

Hay tres modos, decididos por variables de entorno:

* `none`: sin variables. La API queda abierta (uso en el equipo local).
* `supabase`: `SIM_SUPABASE_URL` + `SIM_ALLOWED_EMAILS`. El administrador entra
  con un enlace mágico que Supabase Auth envía a su correo; cada petición trae
  el JWT de Supabase (ES256, verificado con las claves públicas del proyecto)
  y solo se aceptan los correos de la lista.
* `password`: `SIM_ACCESS_PASSWORD`. Contraseña única; el token es una fecha de
  expiración firmada con HMAC, sin estado, así funciona en varias instancias
  (Vercel) y tras reinicios.

Si están configurados Supabase y la contraseña, manda Supabase.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Literal

import jwt
from jwt import PyJWKClient

PASSWORD_ENV = "SIM_ACCESS_PASSWORD"
SESSION_HOURS_ENV = "SIM_ACCESS_SESSION_HOURS"
DEFAULT_SESSION_HOURS = 12
MIN_PASSWORD_LENGTH = 8

SUPABASE_URL_ENV = "SIM_SUPABASE_URL"
SUPABASE_ANON_KEY_ENV = "SIM_SUPABASE_ANON_KEY"
ALLOWED_EMAILS_ENV = "SIM_ALLOWED_EMAILS"
SUPABASE_AUDIENCE = "authenticated"
SUPABASE_ALGORITHMS = ["ES256", "RS256"]

AuthMode = Literal["none", "password", "supabase"]

# Rutas que no exigen token: salud, documentación e inicio de sesión.
PUBLIC_PATHS = {"/health", "/auth/login", "/auth/status", "/docs", "/openapi.json", "/redoc"}


def configured_password() -> str | None:
    value = os.getenv(PASSWORD_ENV, "").strip()
    return value or None


def supabase_url() -> str | None:
    value = os.getenv(SUPABASE_URL_ENV, "").strip().rstrip("/")
    return value or None


def supabase_anon_key() -> str | None:
    value = os.getenv(SUPABASE_ANON_KEY_ENV, "").strip()
    return value or None


def allowed_emails() -> set[str]:
    raw = os.getenv(ALLOWED_EMAILS_ENV, "")
    return {item.strip().lower() for item in raw.split(",") if item.strip()}


def auth_mode() -> AuthMode:
    if supabase_url() and allowed_emails():
        return "supabase"
    if configured_password() is not None:
        return "password"
    return "none"


def access_required() -> bool:
    return auth_mode() != "none"


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


# --- Supabase Auth -----------------------------------------------------------

_jwks_clients: dict[str, PyJWKClient] = {}


def _supabase_signing_key(token: str):
    """Clave pública del proyecto Supabase que firmó el token (cacheada)."""
    url = supabase_url()
    if url is None:
        raise jwt.InvalidTokenError("Supabase no configurado")
    client = _jwks_clients.get(url)
    if client is None:
        client = PyJWKClient(f"{url}/auth/v1/.well-known/jwks.json", cache_keys=True)
        _jwks_clients[url] = client
    return client.get_signing_key_from_jwt(token).key


def supabase_session(token: str, now: datetime | None = None) -> dict[str, object] | None:
    """Devuelve `{"email", "expires_at"}` si el JWT de Supabase es válido,
    vigente y pertenece a un correo autorizado; si no, None."""
    url = supabase_url()
    if url is None or not token:
        return None
    try:
        key = _supabase_signing_key(token)
        claims = jwt.decode(
            token,
            key,
            algorithms=SUPABASE_ALGORITHMS,
            audience=SUPABASE_AUDIENCE,
            issuer=f"{url}/auth/v1",
            leeway=30,
        )
    except (jwt.PyJWTError, ValueError, OSError):
        return None

    email = str(claims.get("email") or "").strip().lower()
    if not email or email not in allowed_emails():
        return None
    exp = claims.get("exp")
    if not isinstance(exp, (int, float)):
        return None
    expires_at = datetime.fromtimestamp(int(exp), tz=timezone.utc)
    now = now or datetime.now(timezone.utc)
    if expires_at <= now:
        return None
    return {"email": email, "expires_at": expires_at}


def session_expiry(token: str, now: datetime | None = None) -> datetime | None:
    """Expiración de la sesión según el modo activo; None si no hay sesión."""
    mode = auth_mode()
    if mode == "supabase":
        session = supabase_session(token, now=now)
        return session["expires_at"] if session else None  # type: ignore[return-value]
    if mode == "password":
        return token_expiry(token, now=now)
    return None


def bearer_token(authorization: str | None) -> str | None:
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token.strip()


def is_public_path(path: str) -> bool:
    return path in PUBLIC_PATHS or path.startswith("/docs/")
