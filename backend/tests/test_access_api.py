from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.services import access


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
def password(monkeypatch):
    monkeypatch.setenv(access.PASSWORD_ENV, "clave-segura-123")
    yield "clave-segura-123"


def test_without_password_everything_is_open(client, monkeypatch):
    monkeypatch.delenv(access.PASSWORD_ENV, raising=False)

    status = client.get("/auth/status").json()

    assert status == {"required": False, "authenticated": True, "expires_at": None}
    assert client.get("/categories").status_code == 200
    assert client.post("/auth/login", json={"password": "x"}).status_code == 409


def test_with_password_requests_need_token(client, password):
    assert client.get("/health").status_code == 200
    assert client.get("/auth/status").json()["required"] is True

    denied = client.get("/categories")
    assert denied.status_code == 401
    assert "iniciar sesión" in denied.json()["detail"]

    wrong = client.post("/auth/login", json={"password": "otra"})
    assert wrong.status_code == 401

    login = client.post("/auth/login", json={"password": password})
    assert login.status_code == 200
    token = login.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    assert client.get("/categories", headers=headers).status_code == 200
    status = client.get("/auth/status", headers=headers).json()
    assert status["authenticated"] is True
    assert status["expires_at"] is not None


def test_token_expires_and_is_bound_to_password(password, monkeypatch):
    token, expires_at = access.issue_token()
    assert access.token_expiry(token) == expires_at

    later = expires_at + timedelta(seconds=1)
    assert access.token_expiry(token, now=later) is None

    monkeypatch.setenv(access.PASSWORD_ENV, "otra-contraseña")
    assert access.token_expiry(token) is None

    monkeypatch.setenv(access.PASSWORD_ENV, password)
    tampered = token[:-2] + ("aa" if not token.endswith("aa") else "bb")
    assert access.token_expiry(tampered) is None
    assert access.token_expiry("sin.formato") is None


def test_session_hours_env(monkeypatch, password):
    monkeypatch.setenv(access.SESSION_HOURS_ENV, "2")
    now = datetime(2026, 10, 28, 12, 0, 0, 500, tzinfo=timezone.utc)
    _, expires_at = access.issue_token(now=now)
    assert expires_at == now.replace(microsecond=0) + timedelta(hours=2)

    monkeypatch.setenv(access.SESSION_HOURS_ENV, "no-numero")
    assert access.session_hours() == access.DEFAULT_SESSION_HOURS
