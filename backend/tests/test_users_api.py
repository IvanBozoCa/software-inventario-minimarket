"""Usuarios con roles: dueño (SIM_ALLOWED_EMAILS), administradores y vendedores."""

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
OWNER = "ivan.bozo@correo.cl"
DAD = "papa@correo.cl"


@pytest.fixture
def client(tmp_path):
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'users.db').as_posix()}",
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
def login(monkeypatch):
    """Modo Supabase con una clave de prueba; devuelve cabeceras por correo."""
    private_key = ec.generate_private_key(ec.SECP256R1())
    monkeypatch.setenv(access.SUPABASE_URL_ENV, SUPABASE_URL)
    monkeypatch.setenv(access.SUPABASE_ANON_KEY_ENV, "sb_publishable_prueba")
    monkeypatch.setenv(access.ALLOWED_EMAILS_ENV, OWNER)
    monkeypatch.setattr(access, "_supabase_signing_key", lambda token: private_key.public_key())

    def headers(email: str) -> dict[str, str]:
        now = datetime.now(timezone.utc)
        token = jwt.encode(
            {
                "aud": access.SUPABASE_AUDIENCE,
                "iss": f"{SUPABASE_URL}/auth/v1",
                "sub": email,
                "email": email,
                "iat": int(now.timestamp()),
                "exp": int((now + timedelta(hours=1)).timestamp()),
            },
            private_key,
            algorithm="ES256",
        )
        return {"Authorization": f"Bearer {token}"}

    return headers


def _product(client, headers) -> str:
    response = client.post(
        "/products",
        json={"name": "Arroz", "sale_price_clp": 1500, "price_mode": "FIXED"},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_owner_is_registered_as_admin_on_first_login(client, login):
    status = client.get("/auth/status", headers=login(OWNER)).json()

    assert status["authenticated"] is True
    assert status["role"] == "ADMIN"
    assert status["name"] == "Ivan Bozo"
    assert status["can_edit_prices"] is True

    users = client.get("/users", headers=login(OWNER)).json()
    assert [(u["email"], u["role"], u["owner"]) for u in users] == [(OWNER, "ADMIN", True)]


def test_unknown_email_cannot_enter_until_added(client, login):
    assert client.get("/auth/status", headers=login(DAD)).json()["authenticated"] is False
    assert client.get("/categories", headers=login(DAD)).status_code == 401

    created = client.post(
        "/users",
        json={"email": " Papa@Correo.cl ", "name": "  Papá  ", "role": "SELLER"},
        headers=login(OWNER),
    )
    assert created.status_code == 201, created.text
    assert created.json()["email"] == DAD
    assert created.json()["name"] == "Papá"

    status = client.get("/auth/status", headers=login(DAD)).json()
    assert status["authenticated"] is True
    assert status["role"] == "SELLER"
    assert status["can_edit_prices"] is False
    assert client.get("/categories", headers=login(DAD)).status_code == 200


def test_seller_can_adjust_stock_but_not_prices_or_catalog(client, login):
    client.post("/users", json={"email": DAD, "name": "Papá"}, headers=login(OWNER))
    product_id = _product(client, login(OWNER))
    dad = login(DAD)

    assert client.get("/products/overview", headers=dad).status_code == 200
    stock = client.put(f"/products/{product_id}/stock", json={"quantity": "12"}, headers=dad)
    assert stock.status_code == 200, stock.text

    price = client.put(f"/products/{product_id}/price", json={"sale_price_clp": 1700}, headers=dad)
    assert price.status_code == 403
    assert "precios" in price.json()["detail"]
    assert client.post("/categories", json={"name": "Nueva"}, headers=dad).status_code == 403
    assert client.post("/products", json={"name": "Otro"}, headers=dad).status_code == 403
    assert client.get("/users", headers=dad).status_code == 403


def test_admin_can_allow_a_seller_to_change_prices(client, login):
    dad_id = client.post("/users", json={"email": DAD, "name": "Papá"}, headers=login(OWNER)).json()["id"]
    product_id = _product(client, login(OWNER))

    updated = client.patch(f"/users/{dad_id}", json={"can_edit_prices": True}, headers=login(OWNER))
    assert updated.status_code == 200
    price = client.put(f"/products/{product_id}/price", json={"sale_price_clp": 1700}, headers=login(DAD))
    assert price.status_code == 200, price.text


def test_deactivated_user_loses_access_and_can_be_readded(client, login):
    dad_id = client.post("/users", json={"email": DAD, "name": "Papá"}, headers=login(OWNER)).json()["id"]
    client.patch(f"/users/{dad_id}", json={"active": False}, headers=login(OWNER))

    assert client.get("/categories", headers=login(DAD)).status_code == 401

    again = client.post("/users", json={"email": DAD, "name": "Papá", "role": "ADMIN"}, headers=login(OWNER))
    assert again.status_code == 201
    assert again.json()["active"] is True
    assert client.get("/users", headers=login(DAD)).status_code == 200


def test_duplicate_active_email_is_rejected(client, login):
    client.post("/users", json={"email": DAD, "name": "Papá"}, headers=login(OWNER))
    duplicate = client.post("/users", json={"email": DAD.upper(), "name": "Otro"}, headers=login(OWNER))
    assert duplicate.status_code == 409


def test_owner_cannot_be_demoted_and_last_admin_is_kept(client, login):
    client.get("/auth/status", headers=login(OWNER))
    owner_id = client.get("/users", headers=login(OWNER)).json()[0]["id"]
    blocked = client.patch(f"/users/{owner_id}", json={"role": "SELLER"}, headers=login(OWNER))
    assert blocked.status_code == 409

    dad_id = client.post(
        "/users", json={"email": DAD, "name": "Papá", "role": "ADMIN"}, headers=login(OWNER)
    ).json()["id"]
    # Un administrador no puede quitarse su propio acceso.
    self_demote = client.patch(f"/users/{dad_id}", json={"active": False}, headers=login(DAD))
    assert self_demote.status_code == 409
    # Pero el dueño sí puede pasarlo a vendedor.
    demoted = client.patch(f"/users/{dad_id}", json={"role": "SELLER"}, headers=login(OWNER))
    assert demoted.status_code == 200
    assert demoted.json()["role"] == "SELLER"


def test_invalid_email_is_rejected(client, login):
    response = client.post("/users", json={"email": "no-es-correo", "name": "X"}, headers=login(OWNER))
    assert response.status_code == 422


def test_local_mode_is_admin_without_login(client, monkeypatch):
    for name in (access.SUPABASE_URL_ENV, access.ALLOWED_EMAILS_ENV, access.PASSWORD_ENV):
        monkeypatch.delenv(name, raising=False)
    status = client.get("/auth/status").json()
    assert status["role"] == "ADMIN"
    assert client.get("/users").status_code == 200
