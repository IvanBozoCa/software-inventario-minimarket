"""Modo "supabase": sesiones por enlace mágico verificadas con JWT ES256."""

from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.services import access

SUPABASE_URL = "https://ejemplo.supabase.co"
ALLOWED = "Admin@Minimarket.cl"


@pytest.fixture
def client(tmp_path):
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'access.db').as_posix()}",
        connect_args={"check_same_thread": False},
    )
    TestingSessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
    Base.metadata.create_all(bind=engine)

    def override_get_db():
        db = TestingSessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def supabase(monkeypatch):
    """Configura el modo Supabase y sustituye la descarga de claves públicas
    por una clave EC generada en la prueba."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    other_key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setenv(access.SUPABASE_URL_ENV, SUPABASE_URL + "/")
    monkeypatch.setenv(access.SUPABASE_ANON_KEY_ENV, "sb_publishable_prueba")
    monkeypatch.setenv(access.ALLOWED_EMAILS_ENV, f" {ALLOWED}, otra@correo.cl ")
    monkeypatch.setattr(access, "_supabase_signing_key", lambda token: private_key.public_key())

    def make_token(email=ALLOWED.lower(), *, key=private_key, minutes=60, **overrides):
        now = datetime.now(timezone.utc)
        claims = {
            "aud": access.SUPABASE_AUDIENCE,
            "iss": f"{SUPABASE_URL}/auth/v1",
            "sub": "usuario-1",
            "email": email,
            "iat": int(now.timestamp()),
            "exp": int((now + timedelta(minutes=minutes)).timestamp()),
        }
        claims.update(overrides)
        return jwt.encode(claims, key, algorithm="ES256")

    make_token.other_key = other_key  # type: ignore[attr-defined]
    return make_token


def test_status_announces_supabase_mode(client, supabase):
    status = client.get("/auth/status").json()

    assert status["required"] is True
    assert status["authenticated"] is False
    assert status["mode"] == "supabase"
    assert status["supabase_url"] == SUPABASE_URL
    assert status["supabase_anon_key"] == "sb_publishable_prueba"
    assert client.get("/categories").status_code == 401
    # La contraseña no sirve en este modo.
    assert client.post("/auth/login", json={"password": "x"}).status_code == 409


def test_allowed_email_can_use_the_api(client, supabase):
    headers = {"Authorization": f"Bearer {supabase()}"}

    status = client.get("/auth/status", headers=headers).json()
    assert status["authenticated"] is True
    assert status["email"] == ALLOWED.lower()
    assert status["expires_at"] is not None
    assert client.get("/categories", headers=headers).status_code == 200


def test_supabase_takes_precedence_over_password(client, supabase, monkeypatch):
    monkeypatch.setenv(access.PASSWORD_ENV, "clave-segura-123")
    assert access.auth_mode() == "supabase"
    headers = {"Authorization": f"Bearer {supabase('ADMIN@minimarket.cl')}"}
    assert client.get("/categories", headers=headers).status_code == 200


@pytest.mark.parametrize(
    "variant",
    ["otro_correo", "sin_correo", "expirado", "otra_clave", "otra_audiencia", "otro_issuer", "basura"],
)
def test_rejected_tokens(client, supabase, variant):
    if variant == "otro_correo":
        token = supabase("intruso@correo.cl")
    elif variant == "sin_correo":
        token = supabase(email="")
    elif variant == "expirado":
        token = supabase(minutes=-5)
    elif variant == "otra_clave":
        token = supabase(key=supabase.other_key)
    elif variant == "otra_audiencia":
        token = supabase(aud="anon")
    elif variant == "otro_issuer":
        token = supabase(iss="https://otro.supabase.co/auth/v1")
    else:
        token = "no.es.un.jwt"

    headers = {"Authorization": f"Bearer {token}"}
    assert client.get("/categories", headers=headers).status_code == 401
    assert client.get("/auth/status", headers=headers).json()["authenticated"] is False
    assert access.supabase_session(token) is None


def test_mode_requires_url_and_emails(monkeypatch):
    monkeypatch.delenv(access.PASSWORD_ENV, raising=False)
    monkeypatch.setenv(access.SUPABASE_URL_ENV, SUPABASE_URL)
    monkeypatch.delenv(access.ALLOWED_EMAILS_ENV, raising=False)
    assert access.auth_mode() == "none"
    monkeypatch.setenv(access.ALLOWED_EMAILS_ENV, " , ")
    assert access.auth_mode() == "none"
    monkeypatch.setenv(access.ALLOWED_EMAILS_ENV, "a@b.cl")
    assert access.auth_mode() == "supabase"
    assert access.allowed_emails() == {"a@b.cl"}
