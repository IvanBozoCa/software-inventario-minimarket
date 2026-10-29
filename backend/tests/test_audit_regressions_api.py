"""Regresiones de la auditoría de experiencia de uso (29-10-2026)."""

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
        f"sqlite:///{(tmp_path / 'audit.db').as_posix()}",
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


HEADER = "fuente,tipo_fuente,cobertura,producto,precio_clp,tipo_precio,fecha_observacion,promo_hasta"


def test_huge_price_is_rejected_with_422_instead_of_500(client):
    # H-09: un entero gigante provocaba un 500 sin cabecera CORS.
    response = client.post(
        "/products", json={"name": "Chicle", "sale_price_clp": 99999999999999999999}
    )
    assert response.status_code == 422
    product = client.post("/products", json={"name": "Chicle", "sale_price_clp": 300}).json()
    response = client.put(f"/products/{product['id']}/price", json={"sale_price_clp": 10**12})
    assert response.status_code == 422


def test_overview_search_ignores_accents_and_finds_barcode(client):
    # H-23
    client.post(
        "/products",
        json={"name": "Detergente Tritón", "sale_price_clp": 2500, "barcode": "7801234567890"},
    )
    names = lambda term: [  # noqa: E731
        row["name"] for row in client.get("/products/overview", params={"search": term}).json()
    ]
    assert names("triton") == ["Detergente Tritón"]
    assert names("TRITÓN") == ["Detergente Tritón"]
    assert names("7801234567890") == ["Detergente Tritón"]
    assert names("zzz") == []


def test_promo_cannot_end_before_observation_date(client):
    # H-29
    source = client.post(
        "/market/sources", json={"name": "Almacén", "source_type": "LOCAL_STORE", "scope": "PICHILEMU"}
    ).json()
    response = client.post(
        "/market/references",
        json={
            "source_id": source["id"],
            "product_name": "Queque",
            "first_observation": {
                "price_clp": 1500,
                "price_type": "PROMO",
                "observed_on": date.today().isoformat(),
                "promo_valid_until": "2020-01-01",
            },
        },
    )
    assert response.status_code == 422
    assert "antes de la fecha de observación" in response.text


def test_csv_import_accepts_semicolons_spanish_values_and_chilean_dates(client):
    # H-13
    observed = (date.today() - timedelta(days=2)).strftime("%d-%m-%Y")
    csv_text = (
        HEADER.replace(",", ";")
        + "\n"
        + f"Almacén Don Pedro;Negocio local;Pichilemu;Arroz 1 kg;$1.290;Habitual;{observed};\n"
        + f"Almacén Don Pedro;Negocio local;Pichilemu;Azúcar 1 kg;990;Promoción;{observed};\n"
    )
    result = client.post("/market/import", json={"csv": csv_text}).json()
    assert result["errors"] == []
    assert result["observations_created"] == 2
    references = client.get("/market/references", params={"search": "Arroz"}).json()
    assert references[0]["observations"][0]["price_clp"] == 1290
    assert references[0]["source"]["scope"] == "PICHILEMU"


def test_csv_import_rejects_future_dates_and_explains_unknown_values(client):
    # H-14 y mensajes de H-13
    future = (date.today() + timedelta(days=365)).isoformat()
    csv_text = (
        HEADER
        + "\n"
        + f"Almacén,LOCAL_STORE,PICHILEMU,Arroz,1290,REGULAR,{future},\n"
        + f"Almacén,LOCAL_STORE,PICHILEMU,Arroz,1290,Rebaja,{date.today().isoformat()},\n"
    )
    result = client.post("/market/import", json={"csv": csv_text}).json()
    assert result["observations_created"] == 0
    assert result["errors"][0] == "Línea 2: la fecha de observación está en el futuro"
    assert "Habitual o Promoción" in result["errors"][1]
