"""Caja en el celular: cobrar, idempotencia, stock, vendedores y anulación."""

import uuid
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
OWNER = "ivan@correo.cl"
DAD = "papa@correo.cl"


@pytest.fixture
def client(tmp_path):
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'pos.db').as_posix()}", connect_args={"check_same_thread": False}
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


def ref() -> str:
    return uuid.uuid4().hex


def make_product(client, headers, **fields) -> str:
    body = {"name": "Arroz", "price_mode": "FIXED", "sale_price_clp": 1500, **fields}
    response = client.post("/products", json=body, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def stock(client, headers, product_id) -> float:
    rows = client.get("/pos/catalog", headers=headers).json()
    return float(next(row for row in rows if row["id"] == product_id)["quantity"])


@pytest.fixture
def shop(client, login):
    owner = login(OWNER)
    client.post("/users", json={"email": DAD, "name": "Papá", "role": "SELLER"}, headers=owner)
    rice = make_product(client, owner, barcode="7801234567890", initial_quantity="10")
    cheese = make_product(
        client, owner, name="Queso", sale_price_clp=9990, sale_mode="WEIGHT", stock_unit="KG", initial_quantity="3"
    )
    loose = make_product(client, owner, name="Pan amasado", price_mode="FREE", sale_price_clp=None)
    return {"owner": owner, "dad": login(DAD), "rice": rice, "cheese": cheese, "loose": loose}


def test_catalog_has_barcode_price_and_stock(client, shop):
    rows = client.get("/pos/catalog", headers=shop["dad"]).json()
    rice = next(row for row in rows if row["id"] == shop["rice"])
    assert rice["barcode"] == "7801234567890"
    assert rice["sale_price_clp"] == 1500
    assert float(rice["quantity"]) == 10


def test_seller_sale_uses_server_prices_discounts_stock_and_records_seller(client, shop):
    response = client.post(
        "/pos/sales",
        json={
            "client_ref": ref(),
            "lines": [
                {"product_id": shop["rice"], "quantity": "2", "unit_price_clp": 1500},
                {"product_id": shop["cheese"], "quantity": "0.25", "unit_price_clp": 9990},
                {"product_id": shop["loose"], "quantity": "1", "unit_price_clp": 1200},
                {"quantity": "1", "unit_price_clp": 500, "description": "Bolsa de verdura"},
            ],
            "payment_method": "CASH",
            "cash_received_clp": 10000,
            "expected_total_clp": 3000 + 2498 + 1200 + 500,
        },
        headers=shop["dad"],
    )
    assert response.status_code == 201, response.text
    sale = response.json()
    assert sale["total_clp"] == 7198
    assert sale["change_clp"] == 2802
    assert sale["seller_name"] == "Papá"
    assert sale["payment_method"] == "CASH"
    assert [line["description"] for line in sale["lines"]][-1] == "Bolsa de verdura"
    assert any("Pan amasado" in warning for warning in sale["warnings"])

    assert stock(client, shop["owner"], shop["rice"]) == 8
    assert stock(client, shop["owner"], shop["cheese"]) == pytest.approx(2.75)


def test_retry_with_same_client_ref_does_not_duplicate(client, shop):
    body = {
        "client_ref": ref(),
        "lines": [{"product_id": shop["rice"], "quantity": "1"}],
        "payment_method": "CARD",
    }
    first = client.post("/pos/sales", json=body, headers=shop["dad"])
    again = client.post("/pos/sales", json=body, headers=shop["dad"])
    assert first.status_code == 201
    assert again.status_code == 200
    assert again.json()["id"] == first.json()["id"]
    assert stock(client, shop["owner"], shop["rice"]) == 9


def test_changed_price_is_reported_before_charging(client, shop):
    client.put(f"/products/{shop['rice']}/price", json={"sale_price_clp": 1700}, headers=shop["owner"])
    response = client.post(
        "/pos/sales",
        json={
            "client_ref": ref(),
            "lines": [{"product_id": shop["rice"], "quantity": "1", "unit_price_clp": 1500}],
            "payment_method": "CASH",
        },
        headers=shop["dad"],
    )
    assert response.status_code == 409
    assert response.json()["price_changes"][0]["price_clp"] == 1700
    assert stock(client, shop["owner"], shop["rice"]) == 10


@pytest.mark.parametrize(
    "lines, message",
    [
        ([], None),
        ([{"product_id": "RICE", "quantity": "1.5"}], "por unidad"),
        ([{"product_id": "LOOSE", "quantity": "1"}], "no tiene precio"),
        ([{"quantity": "1"}], "monto"),
    ],
)
def test_invalid_sales_are_rejected(client, shop, lines, message):
    for line in lines:
        if line.get("product_id") == "RICE":
            line["product_id"] = shop["rice"]
        if line.get("product_id") == "LOOSE":
            line["product_id"] = shop["loose"]
    response = client.post(
        "/pos/sales",
        json={"client_ref": ref(), "lines": lines, "payment_method": "CASH"},
        headers=shop["dad"],
    )
    assert response.status_code in (400, 422)
    if message:
        assert message in response.json()["detail"]


def test_not_enough_cash_is_rejected(client, shop):
    response = client.post(
        "/pos/sales",
        json={
            "client_ref": ref(),
            "lines": [{"product_id": shop["rice"], "quantity": "1"}],
            "payment_method": "CASH",
            "cash_received_clp": 1000,
        },
        headers=shop["dad"],
    )
    assert response.status_code == 400
    assert "no alcanza" in response.json()["detail"]


def test_negative_stock_is_allowed_with_a_warning(client, shop):
    response = client.post(
        "/pos/sales",
        json={"client_ref": ref(), "lines": [{"product_id": shop["rice"], "quantity": "12"}], "payment_method": "TRANSFER"},
        headers=shop["dad"],
    )
    assert response.status_code == 201
    assert any("negativa" in warning for warning in response.json()["warnings"])


def test_day_summary_per_seller_and_method(client, shop):
    for headers, method, qty in ((shop["dad"], "CASH", "1"), (shop["dad"], "CARD", "2"), (shop["owner"], "TRANSFER", "1")):
        client.post(
            "/pos/sales",
            json={"client_ref": ref(), "lines": [{"product_id": shop["rice"], "quantity": qty}], "payment_method": method},
            headers=headers,
        )

    admin_view = client.get("/pos/sales", headers=shop["owner"]).json()
    assert admin_view["count"] == 3
    assert admin_view["total_clp"] == 6000
    assert admin_view["by_method"] == {"CASH": 1500, "CARD": 3000, "TRANSFER": 1500}
    assert [(s["seller_name"], s["count"]) for s in admin_view["sellers"]] == [("Papá", 2), ("Ivan", 1)]

    # El vendedor solo ve lo suyo, aunque pida otro vendedor.
    dad_view = client.get(f"/pos/sales?seller_id={uuid.uuid4()}", headers=shop["dad"]).json()
    assert dad_view["count"] == 2
    assert dad_view["total_clp"] == 4500


def test_only_admin_can_void_and_stock_returns(client, shop):
    sale = client.post(
        "/pos/sales",
        json={"client_ref": ref(), "lines": [{"product_id": shop["rice"], "quantity": "3"}], "payment_method": "CASH"},
        headers=shop["dad"],
    ).json()

    denied = client.post(f"/pos/sales/{sale['id']}/void", json={"reason": "error"}, headers=shop["dad"])
    assert denied.status_code == 403

    voided = client.post(f"/pos/sales/{sale['id']}/void", json={"reason": "Se cobró dos veces"}, headers=shop["owner"])
    assert voided.status_code == 200
    assert voided.json()["status"] == "VOIDED"
    assert voided.json()["voided_by_name"] == "Ivan"
    assert stock(client, shop["owner"], shop["rice"]) == 10

    again = client.post(f"/pos/sales/{sale['id']}/void", json={"reason": "otra vez"}, headers=shop["owner"])
    assert again.status_code == 400

    summary = client.get("/pos/sales", headers=shop["owner"]).json()
    assert summary["count"] == 0
    assert summary["voided_count"] == 1
