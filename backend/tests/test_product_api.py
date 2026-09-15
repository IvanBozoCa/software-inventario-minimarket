import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


@pytest.fixture
def client(tmp_path):
    database_path = tmp_path / "product_api.db"
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


def create_category(client: TestClient, name: str = "Bebidas") -> dict:
    response = client.post("/categories", json={"name": name})
    assert response.status_code == 201
    return response.json()


def test_create_list_and_get_product(client: TestClient):
    category = create_category(client)

    response = client.post(
        "/products",
        json={
            "name": "Bebida Cola 1.5L",
            "barcode": "780000000001",
            "category_id": category["id"],
            "sale_price_clp": 2200,
        },
    )

    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Bebida Cola 1.5L"
    assert created["barcode"] == "780000000001"
    assert created["category_id"] == category["id"]
    assert created["sale_price_clp"] == 2200
    assert created["active"] is True

    list_response = client.get("/products")
    assert list_response.status_code == 200
    assert [item["name"] for item in list_response.json()] == ["Bebida Cola 1.5L"]

    get_response = client.get(f"/products/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["id"] == created["id"]


def test_rejects_duplicate_barcode(client: TestClient):
    payload = {
        "name": "Producto uno",
        "barcode": "123456789",
        "sale_price_clp": 1000,
    }
    first = client.post("/products", json=payload)
    duplicate = client.post(
        "/products",
        json={
            "name": "Producto dos",
            "barcode": "123456789",
            "sale_price_clp": 1200,
        },
    )

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Ya existe un producto con ese código de barras"


def test_rejects_unknown_category(client: TestClient):
    response = client.post(
        "/products",
        json={
            "name": "Producto sin categoría válida",
            "category_id": "00000000-0000-0000-0000-000000000001",
            "sale_price_clp": 1500,
        },
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Categoría no encontrada"


def test_update_and_deactivate_product(client: TestClient):
    created = client.post(
        "/products",
        json={
            "name": "Galletas",
            "barcode": "111222333",
            "sale_price_clp": 900,
        },
    ).json()

    update_response = client.patch(
        f"/products/{created['id']}",
        json={"name": "Galletas Chocolate", "sale_price_clp": 1100},
    )
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Galletas Chocolate"
    assert update_response.json()["sale_price_clp"] == 1100

    deactivate_response = client.patch(
        f"/products/{created['id']}",
        json={"active": False},
    )
    assert deactivate_response.status_code == 200
    assert deactivate_response.json()["active"] is False

    active_list = client.get("/products")
    assert active_list.status_code == 200
    assert active_list.json() == []

    full_list = client.get("/products", params={"include_inactive": True})
    assert full_list.status_code == 200
    assert len(full_list.json()) == 1
    assert full_list.json()[0]["active"] is False


def test_update_rejects_fixed_price_without_amount(client: TestClient):
    created = client.post(
        "/products",
        json={
            "name": "Monto libre",
            "price_mode": "FREE",
            "sale_price_clp": None,
        },
    ).json()

    response = client.patch(
        f"/products/{created['id']}",
        json={"price_mode": "FIXED"},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Un producto con precio fijo requiere sale_price_clp"


def test_unknown_product_returns_404(client: TestClient):
    response = client.get("/products/00000000-0000-0000-0000-000000000000")

    assert response.status_code == 404
    assert response.json()["detail"] == "Producto no encontrado"
