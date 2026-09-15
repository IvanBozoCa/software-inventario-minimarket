import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


@pytest.fixture
def client(tmp_path):
    database_path = tmp_path / "sales_api.db"
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


def create_product(
    client: TestClient,
    *,
    name: str = "Bebida Cola 1.5L",
    barcode: str = "780000000001",
    price: int | None = 1800,
    price_mode: str = "FIXED",
    sale_mode: str = "UNIT",
) -> dict:
    response = client.post(
        "/products",
        json={
            "name": name,
            "barcode": barcode,
            "sale_mode": sale_mode,
            "price_mode": price_mode,
            "sale_price_clp": price,
            "track_stock": True,
        },
    )
    assert response.status_code == 201
    return response.json()


def create_draft(client: TestClient) -> dict:
    response = client.post("/sales/draft")
    assert response.status_code == 201
    return response.json()


def test_create_empty_draft_sale(client: TestClient):
    sale = create_draft(client)

    assert sale["status"] == "DRAFT"
    assert sale["subtotal_clp"] == 0
    assert sale["total_clp"] == 0
    assert sale["items"] == []


def test_scanning_known_product_adds_snapshot_and_repeated_scan_increments_quantity(
    client: TestClient,
):
    product = create_product(client, price=1800)
    sale = create_draft(client)

    first = client.post(
        f"/sales/{sale['id']}/scan",
        json={"barcode": product["barcode"]},
    )
    second = client.post(
        f"/sales/{sale['id']}/scan",
        json={"barcode": product["barcode"]},
    )

    assert first.status_code == 200
    assert second.status_code == 200
    assert second.json()["result"] == "ADDED"

    updated_sale = second.json()["sale"]
    assert len(updated_sale["items"]) == 1

    item = updated_sale["items"][0]
    assert item["product_id"] == product["id"]
    assert item["item_type"] == "PRODUCT"
    assert item["description_snapshot"] == "Bebida Cola 1.5L"
    assert item["quantity"] == "2.000"
    assert item["unit_price_clp"] == 1800
    assert item["line_total_clp"] == 3600
    assert updated_sale["total_clp"] == 3600


def test_unknown_barcode_keeps_sale_open_and_free_amount_can_be_added(
    client: TestClient,
):
    sale = create_draft(client)

    unknown = client.post(
        f"/sales/{sale['id']}/scan",
        json={"barcode": "NO-REGISTRADO"},
    )

    assert unknown.status_code == 200
    assert unknown.json()["result"] == "UNKNOWN_BARCODE"
    assert unknown.json()["sale"]["status"] == "DRAFT"
    assert unknown.json()["sale"]["total_clp"] == 0
    assert unknown.json()["sale"]["items"] == []

    free_amount = client.post(
        f"/sales/{sale['id']}/free-amount",
        json={
            "amount_clp": 1750,
            "description": "Producto sin código",
        },
    )

    assert free_amount.status_code == 201
    body = free_amount.json()
    assert body["status"] == "DRAFT"
    assert body["total_clp"] == 1750
    assert len(body["items"]) == 1
    assert body["items"][0]["product_id"] is None
    assert body["items"][0]["item_type"] == "FREE_AMOUNT"
    assert body["items"][0]["description_snapshot"] == "Producto sin código"
    assert body["items"][0]["line_total_clp"] == 1750


def test_deleting_draft_line_recalculates_total(client: TestClient):
    product = create_product(client, price=1200)
    sale = create_draft(client)

    scanned = client.post(
        f"/sales/{sale['id']}/scan",
        json={"barcode": product["barcode"]},
    )
    product_item_id = scanned.json()["added_item_id"]

    free_amount = client.post(
        f"/sales/{sale['id']}/free-amount",
        json={"amount_clp": 800, "description": "Monto manual"},
    )
    assert free_amount.json()["total_clp"] == 2000

    deleted = client.delete(
        f"/sales/{sale['id']}/items/{product_item_id}"
    )

    assert deleted.status_code == 200
    body = deleted.json()
    assert body["total_clp"] == 800
    assert len(body["items"]) == 1
    assert body["items"][0]["item_type"] == "FREE_AMOUNT"


def test_draft_sale_operations_do_not_change_stock(client: TestClient):
    product = create_product(client, price=950)
    sale = create_draft(client)

    before = client.get(f"/inventory/products/{product['id']}/stock")
    assert before.status_code == 200
    assert before.json()["expected_stock"] == "0.000"

    scanned = client.post(
        f"/sales/{sale['id']}/scan",
        json={"barcode": product["barcode"]},
    )
    assert scanned.status_code == 200

    client.post(
        f"/sales/{sale['id']}/free-amount",
        json={"amount_clp": 500, "description": "Monto libre"},
    )

    after = client.get(f"/inventory/products/{product['id']}/stock")
    assert after.status_code == 200
    assert after.json()["expected_stock"] == "0.000"


def test_product_search_by_name_supports_sale_fallback(client: TestClient):
    create_product(
        client,
        name="Bebida Naranja 1.5L",
        barcode="780000000010",
        price=1700,
    )
    create_product(
        client,
        name="Arroz 1 kg",
        barcode="780000000011",
        price=1500,
    )

    response = client.get("/products", params={"search": "naranja"})

    assert response.status_code == 200
    products = response.json()
    assert len(products) == 1
    assert products[0]["name"] == "Bebida Naranja 1.5L"


def test_product_found_by_search_can_be_added_to_draft(client: TestClient):
    product = create_product(
        client,
        name="Arroz Grado 1",
        barcode="780000000012",
        price=1450,
    )
    sale = create_draft(client)

    response = client.post(
        f"/sales/{sale['id']}/items/product",
        json={"product_id": product["id"], "quantity": "2.000"},
    )

    assert response.status_code == 201
    body = response.json()
    assert body["status"] == "DRAFT"
    assert body["total_clp"] == 2900
    assert len(body["items"]) == 1
    assert body["items"][0]["product_id"] == product["id"]
    assert body["items"][0]["quantity"] == "2.000"
    assert body["items"][0]["unit_price_clp"] == 1450


def test_selected_product_with_free_price_requests_manual_amount(client: TestClient):
    product = create_product(
        client,
        name="Producto precio libre",
        barcode="780000000013",
        price=None,
        price_mode="FREE",
    )
    sale = create_draft(client)

    response = client.post(
        f"/sales/{sale['id']}/items/product",
        json={"product_id": product["id"]},
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Este producto necesita que ingreses el monto manualmente"
    )


def test_price_snapshot_is_preserved_if_catalog_price_changes_mid_sale(
    client: TestClient,
):
    product = create_product(client, price=1000)
    sale = create_draft(client)

    first = client.post(
        f"/sales/{sale['id']}/scan",
        json={"barcode": product["barcode"]},
    )
    assert first.status_code == 200

    update = client.patch(
        f"/products/{product['id']}",
        json={"sale_price_clp": 1200},
    )
    assert update.status_code == 200

    second = client.post(
        f"/sales/{sale['id']}/scan",
        json={"barcode": product["barcode"]},
    )
    assert second.status_code == 200

    items = second.json()["sale"]["items"]
    assert len(items) == 2
    assert sorted(item["unit_price_clp"] for item in items) == [1000, 1200]
    assert second.json()["sale"]["total_clp"] == 2200


def test_known_product_without_fixed_price_requests_manual_amount(client: TestClient):
    product = create_product(
        client,
        name="Producto precio libre",
        barcode="780000000099",
        price=None,
        price_mode="FREE",
    )
    sale = create_draft(client)

    response = client.post(
        f"/sales/{sale['id']}/scan",
        json={"barcode": product["barcode"]},
    )

    assert response.status_code == 200
    assert response.json()["result"] == "MANUAL_PRICE_REQUIRED"
    assert response.json()["sale"]["total_clp"] == 0
    assert response.json()["sale"]["items"] == []
