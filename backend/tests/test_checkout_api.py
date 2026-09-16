import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


@pytest.fixture
def client(tmp_path):
    database_path = tmp_path / "checkout_api.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    TestingSessionLocal = sessionmaker(
        bind=engine,
        autoflush=False,
        autocommit=False,
    )
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


def create_product(client: TestClient, *, price: int = 1800) -> dict:
    response = client.post(
        "/products",
        json={
            "name": "Bebida Cola 1.5L",
            "barcode": "7800000002001",
            "sale_mode": "UNIT",
            "price_mode": "FIXED",
            "sale_price_clp": price,
            "track_stock": True,
        },
    )
    assert response.status_code == 201
    return response.json()


def create_sale_with_product(client: TestClient, *, price: int = 1800) -> tuple[dict, dict]:
    product = create_product(client, price=price)
    draft = client.post("/sales/draft")
    assert draft.status_code == 201
    sale = draft.json()

    scanned = client.post(
        f"/sales/{sale['id']}/scan",
        json={"barcode": product["barcode"]},
    )
    assert scanned.status_code == 200
    return scanned.json()["sale"], product


def test_cash_checkout_completes_sale_and_decrements_stock(client: TestClient):
    sale, product = create_sale_with_product(client, price=1800)

    response = client.post(
        f"/sales/{sale['id']}/payments/cash",
        json={"cash_received_clp": 2000},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["sale"]["status"] == "COMPLETED"
    assert body["payment"]["method"] == "CASH"
    assert body["payment"]["status"] == "CONFIRMED"
    assert body["payment"]["amount_clp"] == 1800
    assert body["payment"]["cash_received_clp"] == 2000
    assert body["payment"]["change_clp"] == 200

    stock = client.get(f"/inventory/products/{product['id']}/stock")
    assert stock.status_code == 200
    assert stock.json()["expected_stock"] == "-1.000"


def test_insufficient_cash_does_not_complete_or_change_stock(client: TestClient):
    sale, product = create_sale_with_product(client, price=1800)

    response = client.post(
        f"/sales/{sale['id']}/payments/cash",
        json={"cash_received_clp": 1500},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "El efectivo recibido no alcanza para cubrir el total"

    persisted_sale = client.get(f"/sales/{sale['id']}")
    assert persisted_sale.status_code == 200
    assert persisted_sale.json()["status"] == "DRAFT"

    stock = client.get(f"/inventory/products/{product['id']}/stock")
    assert stock.status_code == 200
    assert stock.json()["expected_stock"] == "0.000"


def test_card_checkout_waits_for_approval_before_changing_stock(client: TestClient):
    sale, product = create_sale_with_product(client, price=1800)

    started = client.post(
        f"/sales/{sale['id']}/payments/card",
        json={},
    )

    assert started.status_code == 201
    pending = started.json()
    assert pending["sale"]["status"] == "PAYMENT_PENDING"
    assert pending["payment"]["method"] == "CARD"
    assert pending["payment"]["status"] == "PENDING"

    stock_before = client.get(f"/inventory/products/{product['id']}/stock")
    assert stock_before.status_code == 200
    assert stock_before.json()["expected_stock"] == "0.000"

    confirmed = client.post(
        f"/sales/{sale['id']}/payments/{pending['payment']['id']}/confirm",
        json={"provider": "terminal externo", "external_reference": "TEST-001"},
    )

    assert confirmed.status_code == 200
    body = confirmed.json()
    assert body["sale"]["status"] == "COMPLETED"
    assert body["payment"]["status"] == "CONFIRMED"
    assert body["payment"]["provider"] == "terminal externo"
    assert body["payment"]["external_reference"] == "TEST-001"

    stock_after = client.get(f"/inventory/products/{product['id']}/stock")
    assert stock_after.status_code == 200
    assert stock_after.json()["expected_stock"] == "-1.000"


def test_empty_sale_cannot_start_payment(client: TestClient):
    draft = client.post("/sales/draft")
    assert draft.status_code == 201
    sale = draft.json()

    response = client.post(
        f"/sales/{sale['id']}/payments/card",
        json={},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "La venta no tiene productos para cobrar"
