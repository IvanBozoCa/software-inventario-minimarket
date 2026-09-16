from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.payment import Payment, PaymentStatus


@pytest.fixture
def recovery_context(tmp_path):
    database_path = tmp_path / "sale_recovery.db"
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

    with TestClient(app) as client:
        yield client, TestingSessionLocal

    app.dependency_overrides.clear()
    engine.dispose()


def create_draft(client: TestClient) -> dict:
    response = client.post("/sales/draft")
    assert response.status_code == 201
    return response.json()


def add_free_amount(client: TestClient, sale_id: str, amount: int = 1000) -> dict:
    response = client.post(
        f"/sales/{sale_id}/free-amount",
        json={"amount_clp": amount, "description": "Producto prueba"},
    )
    assert response.status_code == 201
    return response.json()


def create_product(client: TestClient) -> dict:
    response = client.post(
        "/products",
        json={
            "name": "Bebida prueba",
            "barcode": "780000000555",
            "sale_mode": "UNIT",
            "price_mode": "FIXED",
            "sale_price_clp": 1500,
            "track_stock": True,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_recovery_ignores_empty_draft(recovery_context):
    client, _ = recovery_context
    create_draft(client)

    response = client.get("/sales/recovery")

    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "NONE"
    assert body["sale"] is None
    assert body["open_sale_count"] == 0


def test_recovery_finds_single_draft_with_content(recovery_context):
    client, _ = recovery_context
    sale = create_draft(client)
    add_free_amount(client, sale["id"], 1800)

    response = client.get("/sales/recovery")

    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "FOUND"
    assert body["open_sale_count"] == 1
    assert body["sale"]["id"] == sale["id"]
    assert body["sale"]["status"] == "DRAFT"
    assert body["sale"]["total_clp"] == 1800
    assert body["pending_payment_id"] is None


def test_discard_draft_cancels_without_stock_movement(recovery_context):
    client, _ = recovery_context
    product = create_product(client)
    sale = create_draft(client)

    scanned = client.post(
        f"/sales/{sale['id']}/scan",
        json={"barcode": product["barcode"]},
    )
    assert scanned.status_code == 200

    before = client.get(f"/inventory/products/{product['id']}/stock")
    assert before.status_code == 200
    assert before.json()["expected_stock"] == "0.000"

    discarded = client.post(f"/sales/{sale['id']}/discard")

    assert discarded.status_code == 200
    assert discarded.json()["status"] == "CANCELLED"

    after = client.get(f"/inventory/products/{product['id']}/stock")
    assert after.status_code == 200
    assert after.json()["expected_stock"] == "0.000"

    recovery = client.get("/sales/recovery")
    assert recovery.json()["state"] == "NONE"


def test_recovery_restores_pending_card_payment_and_discard_cancels_payment(
    recovery_context,
):
    client, TestingSessionLocal = recovery_context
    sale = create_draft(client)
    add_free_amount(client, sale["id"], 2500)

    started = client.post(
        f"/sales/{sale['id']}/payments/card",
        json={},
    )
    assert started.status_code == 201
    payment_id = started.json()["payment"]["id"]

    recovery = client.get("/sales/recovery")

    assert recovery.status_code == 200
    body = recovery.json()
    assert body["state"] == "FOUND"
    assert body["sale"]["status"] == "PAYMENT_PENDING"
    assert body["pending_payment_id"] == payment_id

    discarded = client.post(f"/sales/{sale['id']}/discard")
    assert discarded.status_code == 200
    assert discarded.json()["status"] == "CANCELLED"

    with TestingSessionLocal() as db:
        payment = db.get(Payment, UUID(payment_id))
        assert payment is not None
        assert payment.status == PaymentStatus.CANCELLED


def test_recovery_reports_conflict_instead_of_guessing(recovery_context):
    client, _ = recovery_context
    first = create_draft(client)
    second = create_draft(client)
    add_free_amount(client, first["id"], 1000)
    add_free_amount(client, second["id"], 2000)

    response = client.get("/sales/recovery")

    assert response.status_code == 200
    body = response.json()
    assert body["state"] == "CONFLICT"
    assert body["sale"] is None
    assert body["pending_payment_id"] is None
    assert body["open_sale_count"] == 2
