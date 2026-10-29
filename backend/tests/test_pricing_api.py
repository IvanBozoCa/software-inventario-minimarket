from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


@pytest.fixture
def client(tmp_path):
    engine = create_engine(
        f"sqlite:///{(tmp_path / 'pricing.db').as_posix()}",
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


def _category(client, name="Bebidas", **margins):
    response = client.post("/categories", json={"name": name, **margins})
    assert response.status_code == 201, response.text
    return response.json()


def _product(client, **overrides):
    payload = {"name": "Bebida cola 1,5 L", "sale_price_clp": 2200}
    payload.update(overrides)
    response = client.post("/products", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_product_with_cost_quantity_and_history(client):
    category = _category(client, min_margin="0.25", upper_margin="0.40")
    product = _product(
        client,
        category_id=category["id"],
        brand="Coca-Cola",
        variant="Original",
        content_amount="1.5",
        content_unit="L",
        last_unit_cost_clp="1500",
        cost_source="Boleta distribuidor",
        initial_quantity="24",
    )
    assert product["brand"] == "Coca-Cola"
    assert product["last_unit_cost_clp"] == "1500.00"

    detail = client.get(f"/products/{product['id']}/detail").json()
    assert detail["quantity"] == "24.000"
    assert detail["category_name"] == "Bebidas"
    assert len(detail["price_history"]) == 1
    assert detail["price_history"][0]["previous_price_clp"] is None
    assert detail["price_history"][0]["new_price_clp"] == 2200
    assert len(detail["cost_history"]) == 1
    assert detail["cost_history"][0]["source"] == "Boleta distribuidor"
    assert detail["stock_movements"][0]["movement_type"] == "INITIAL_STOCK"

    pricing = detail["pricing"]
    assert pricing["range_available"] is True
    # 1500 / 0.75 = 2000 ; 1500 / 0.60 = 2500
    assert pricing["price_at_min_margin"] == "2000.00"
    assert pricing["price_at_upper_margin"] == "2500.00"
    # (2200 - 1500) / 2200
    assert pricing["current_gross_margin"] == "0.3182"
    assert pricing["warnings"] == []
    assert pricing["needs_review"] is False


def test_product_without_cost_is_saved_and_marked_pending(client):
    product = _product(client)
    detail = client.get(f"/products/{product['id']}/detail").json()

    assert detail["pricing"]["range_available"] is False
    codes = {w["code"] for w in detail["pricing"]["warnings"]}
    assert "COST_MISSING" in codes
    assert "MARGINS_MISSING" in codes

    overview = client.get("/products/overview").json()
    assert overview[0]["cost_pending"] is True
    assert overview[0]["margins_pending"] is True
    assert overview[0]["market_reference_count"] == 0


def test_price_and_cost_changes_keep_history_and_warn(client):
    category = _category(client, min_margin="0.25", upper_margin="0.40")
    product = _product(client, category_id=category["id"], last_unit_cost_clp="1500")

    response = client.put(
        f"/products/{product['id']}/cost",
        json={"last_unit_cost_clp": "1800", "source": "Factura 123", "note": "Subió el proveedor"},
    )
    assert response.status_code == 200
    assert response.json()["last_unit_cost_clp"] == "1800.00"

    detail = client.get(f"/products/{product['id']}/detail").json()
    assert len(detail["cost_history"]) == 2
    latest = detail["cost_history"][0]
    assert latest["previous_unit_cost_clp"] == "1500.00"
    assert latest["new_unit_cost_clp"] == "1800.00"
    codes = {w["code"] for w in detail["pricing"]["warnings"]}
    # 2200 con costo 1800 => margen 18,2 % < 25 % y el costo subió sin revisar precio
    assert codes == {"MARGIN_BELOW_MIN", "COST_INCREASED"}
    assert detail["pricing"]["needs_review"] is True

    response = client.put(
        f"/products/{product['id']}/price",
        json={"sale_price_clp": 2500, "note": "Ajuste por alza de costo"},
    )
    assert response.status_code == 200
    assert response.json()["sale_price_clp"] == 2500

    detail = client.get(f"/products/{product['id']}/detail").json()
    assert [h["new_price_clp"] for h in detail["price_history"]] == [2500, 2200]
    assert detail["price_history"][0]["previous_price_clp"] == 2200
    assert detail["pricing"]["warnings"] == []

    # Una edición de ficha que incluye el precio también deja historial.
    client.patch(f"/products/{product['id']}", json={"sale_price_clp": 2400})
    detail = client.get(f"/products/{product['id']}/detail").json()
    assert len(detail["price_history"]) == 3


def test_price_below_cost_warning_does_not_block_saving(client):
    product = _product(client, sale_price_clp=1000, last_unit_cost_clp="1200")
    detail = client.get(f"/products/{product['id']}/detail").json()
    assert "PRICE_BELOW_COST" in {w["code"] for w in detail["pricing"]["warnings"]}


def test_margin_validation(client):
    response = client.post("/categories", json={"name": "X", "min_margin": "1"})
    assert response.status_code == 422
    response = client.post(
        "/categories",
        json={"name": "X", "min_margin": "0.4", "upper_margin": "0.3"},
    )
    assert response.status_code == 422

    category = _category(client, min_margin="0.2", upper_margin="0.3")
    response = client.patch(f"/categories/{category['id']}", json={"upper_margin": "0.1"})
    assert response.status_code == 422
    response = client.patch(f"/categories/{category['id']}", json={"upper_margin": "0.5"})
    assert response.status_code == 200
    assert response.json()["upper_margin"] == "0.5000"


def test_stock_update_registers_adjustment(client):
    product = _product(client, initial_quantity="10")
    response = client.put(f"/products/{product['id']}/stock", json={"quantity": "7", "note": "Conteo"})
    assert response.status_code == 200
    assert response.json()["movement_type"] == "ADJUSTMENT"
    assert response.json()["quantity_delta"] == "-3.000"

    stock = client.get(f"/inventory/products/{product['id']}/stock").json()
    assert stock["expected_stock"] == "7.000"

    # Sin cambio: no se registra movimiento.
    response = client.put(f"/products/{product['id']}/stock", json={"quantity": "7"})
    assert response.status_code == 200
    assert response.json() is None


def test_deactivating_product_keeps_history(client):
    product = _product(client, last_unit_cost_clp="1000", initial_quantity="3")
    response = client.patch(f"/products/{product['id']}", json={"active": False})
    assert response.status_code == 200
    assert response.json()["active"] is False

    detail = client.get(f"/products/{product['id']}/detail").json()
    assert len(detail["cost_history"]) == 1
    assert len(detail["price_history"]) == 1
    assert detail["quantity"] == "3.000"

    assert client.get("/products/overview").json() == []
    assert len(client.get("/products/overview?include_inactive=true").json()) == 1


# --- Referencias de mercado ------------------------------------------------


def _source(client, name="Supermercado web", scope="WEB", source_type="SUPERMARKET_WEB"):
    response = client.post(
        "/market/sources",
        json={"name": name, "source_type": source_type, "scope": scope},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_market_references_regular_promo_stale_and_match_type(client):
    product = _product(client, content_amount="1.5", content_unit="L")
    web = _source(client)
    local = _source(client, name="Almacén local", scope="PICHILEMU", source_type="LOCAL_STORE")

    today = date.today()
    old = today - timedelta(days=45)

    exact = client.post(
        "/market/references",
        json={
            "source_id": web["id"],
            "product_name": "Bebida cola 1,5 L",
            "brand": "Coca-Cola",
            "content_amount": "1.5",
            "content_unit": "L",
            "product_id": product["id"],
            "match_type": "EXACT",
            "first_observation": {
                "price_clp": 2250,
                "price_type": "REGULAR",
                "observed_on": today.isoformat(),
            },
        },
    )
    assert exact.status_code == 201, exact.text
    exact = exact.json()
    assert exact["observations"][0]["unit_price_clp"] == "1500.00"
    assert exact["observations"][0]["unit_price_label"] == "L"
    assert exact["stale"] is False

    promo = client.post(
        f"/market/references/{exact['id']}/observations",
        json={
            "price_clp": 1450,
            "price_type": "PROMO",
            "observed_on": (today - timedelta(days=3)).isoformat(),
            "promo_valid_until": (today - timedelta(days=1)).isoformat(),
        },
    )
    assert promo.status_code == 201
    observations = {o["price_type"]: o for o in promo.json()["observations"]}
    assert observations["PROMO"]["promo_expired"] is True
    assert observations["PROMO"]["promo_current"] is False

    equivalent = client.post(
        "/market/references",
        json={
            "source_id": local["id"],
            "product_name": "Bebida cola 2 L",
            "content_amount": "2",
            "content_unit": "L",
            "product_id": product["id"],
            "match_type": "EQUIVALENT",
            "first_observation": {
                "price_clp": 2000,
                "price_type": "REGULAR",
                "observed_on": old.isoformat(),
            },
        },
    ).json()
    assert equivalent["stale"] is True
    assert equivalent["observations"][0]["age_days"] == 45

    detail = client.get(f"/products/{product['id']}/detail").json()
    market = detail["market"]
    assert market["stale_days"] == 30
    assert market["has_references"] is True
    assert market["has_stale"] is True
    # Solo la coincidencia exacta y vigente entra en los extremos.
    assert market["exact_regular_low"]["price_clp"] == 2250
    assert market["exact_regular_high"]["source_name"] == "Supermercado web"
    assert {r["match_type"] for r in market["references"]} == {"EXACT", "EQUIVALENT"}

    overview = client.get("/products/overview").json()[0]
    assert overview["market_reference_count"] == 2
    assert overview["market_references_stale"] is True
    assert overview["needs_review"] is True

    # Plazo configurable: con 60 días ya nada está desactualizado.
    response = client.put("/settings", json={"market_stale_days": 60})
    assert response.status_code == 200
    detail = client.get(f"/products/{product['id']}/detail").json()
    assert detail["market"]["has_stale"] is False


def test_link_requires_match_type_and_regular_has_no_promo_dates(client):
    product = _product(client)
    source = _source(client)
    response = client.post(
        "/market/references",
        json={"source_id": source["id"], "product_name": "Algo", "product_id": product["id"]},
    )
    assert response.status_code == 422

    reference = client.post(
        "/market/references",
        json={"source_id": source["id"], "product_name": "Algo"},
    ).json()
    response = client.post(
        f"/market/references/{reference['id']}/observations",
        json={
            "price_clp": 100,
            "price_type": "REGULAR",
            "observed_on": date.today().isoformat(),
            "promo_valid_until": date.today().isoformat(),
        },
    )
    assert response.status_code == 422

    response = client.put(
        f"/market/references/{reference['id']}/link",
        json={"product_id": product["id"], "match_type": "EQUIVALENT"},
    )
    assert response.status_code == 200
    assert response.json()["match_type"] == "EQUIVALENT"


def test_invalidate_and_correct_observation_keep_history(client):
    source = _source(client)
    reference = client.post(
        "/market/references",
        json={
            "source_id": source["id"],
            "product_name": "Pan",
            "first_observation": {
                "price_clp": 1900,
                "price_type": "REGULAR",
                "observed_on": date.today().isoformat(),
            },
        },
    ).json()
    original_id = reference["observations"][0]["id"]

    response = client.post(
        f"/market/observations/{original_id}/correct",
        json={"price_clp": 1990, "price_type": "REGULAR", "observed_on": date.today().isoformat()},
    )
    assert response.status_code == 200
    observations = response.json()["observations"]
    assert len(observations) == 2
    original = next(o for o in observations if o["id"] == original_id)
    replacement = next(o for o in observations if o["id"] != original_id)
    assert original["status"] == "INVALID"
    assert original["replaced_by_id"] == replacement["id"]
    assert replacement["status"] == "VALID"

    response = client.post(
        f"/market/observations/{replacement['id']}/invalidate",
        json={"reason": "Precio mal leído"},
    )
    assert response.status_code == 200
    assert response.json()["last_observed_on"] is None
    response = client.post(
        f"/market/observations/{replacement['id']}/invalidate",
        json={"reason": "otra vez"},
    )
    assert response.status_code == 409


def test_csv_import_is_idempotent_and_reports_errors(client):
    csv_text = (
        "fuente,tipo_fuente,cobertura,localidad,url_fuente,producto,marca,variante,contenido,unidad_contenido,precio_clp,tipo_precio,promo_desde,promo_hasta,fecha_observacion,url,notas\n"
        "Lider.cl,SUPERMARKET_WEB,WEB,,https://super.lider.cl,Bebida cola,Coca-Cola,Original,1.5,L,2250,REGULAR,,,2026-10-28,https://super.lider.cl/x,\n"
        "Lider.cl,SUPERMARKET_WEB,WEB,,https://super.lider.cl,Bebida cola,Coca-Cola,Original,1.5,L,1450,PROMO,,,2026-10-28,,Rebaja\n"
        "Lider.cl,SUPERMARKET_WEB,WEB,,,Arroz,Tucapel,,1,KG,abc,REGULAR,,,2026-10-28,,\n"
    )
    response = client.post("/market/import", json={"csv": csv_text})
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["sources_created"] == 1
    assert result["references_created"] == 1
    assert result["observations_created"] == 2
    assert len(result["errors"]) == 1
    assert "Línea 4" in result["errors"][0]

    response = client.post("/market/import", json={"csv": csv_text})
    result = response.json()
    assert result["observations_created"] == 0
    assert result["duplicates_skipped"] == 2

    references = client.get("/market/references?unlinked=true").json()
    assert len(references) == 1
    assert references[0]["source"]["scope"] == "WEB"
    assert len(references[0]["observations"]) == 2


def test_overview_query_count_does_not_grow_with_products(client):
    from sqlalchemy import event
    from sqlalchemy.engine import Engine

    def count_queries():
        statements = []

        def listener(*args):
            statements.append(args[2])

        event.listen(Engine, "before_cursor_execute", listener)
        try:
            response = client.get("/products/overview")
        finally:
            event.remove(Engine, "before_cursor_execute", listener)
        assert response.status_code == 200, response.text
        return len(statements)

    for index in range(3):
        _product(client, name=f"Producto {index}", initial_quantity="2")
    few = count_queries()
    for index in range(3, 12):
        _product(client, name=f"Producto {index}", last_unit_cost_clp="500")
    assert count_queries() == few
