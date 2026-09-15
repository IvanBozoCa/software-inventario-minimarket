import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


@pytest.fixture
def client(tmp_path):
    database_path = tmp_path / "inventory_api.db"
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


def create_product(client: TestClient, *, track_stock: bool = True) -> dict:
    response = client.post(
        "/products",
        json={
            "name": "Producto inventario",
            "sale_mode": "UNIT",
            "price_mode": "FIXED",
            "sale_price_clp": 1000,
            "track_stock": track_stock,
        },
    )
    assert response.status_code == 201
    return response.json()


def test_register_initial_stock_and_read_expected_stock(client: TestClient):
    product = create_product(client)

    response = client.post(
        "/inventory/initial-stock",
        json={
            "product_id": product["id"],
            "quantity": "12.500",
            "note": "Conteo inicial",
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["product_id"] == product["id"]
    assert body["movement_type"] == "INITIAL_STOCK"
    assert body["quantity_delta"] == "12.500"
    assert body["expected_stock"] == "12.500"
    assert body["note"] == "Conteo inicial"

    stock_response = client.get(f"/inventory/products/{product['id']}/stock")
    assert stock_response.status_code == 200
    assert stock_response.json() == {
        "product_id": product["id"],
        "expected_stock": "12.500",
        "track_stock": True,
    }


def test_initial_stock_accumulates_through_movements(client: TestClient):
    product = create_product(client)

    first = client.post(
        "/inventory/initial-stock",
        json={"product_id": product["id"], "quantity": "5.000"},
    )
    second = client.post(
        "/inventory/initial-stock",
        json={"product_id": product["id"], "quantity": "2.500"},
    )

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["expected_stock"] == "7.500"


def test_rejects_zero_initial_stock(client: TestClient):
    product = create_product(client)

    response = client.post(
        "/inventory/initial-stock",
        json={"product_id": product["id"], "quantity": "0"},
    )

    assert response.status_code == 422


def test_rejects_initial_stock_when_product_does_not_track_stock(client: TestClient):
    product = create_product(client, track_stock=False)

    response = client.post(
        "/inventory/initial-stock",
        json={"product_id": product["id"], "quantity": "3.000"},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == "El producto no controla stock"


def test_unknown_product_returns_404(client: TestClient):
    response = client.get(
        "/inventory/products/00000000-0000-0000-0000-000000000000/stock"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Producto no encontrado"
