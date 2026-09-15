import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app


@pytest.fixture
def client(tmp_path):
    database_path = tmp_path / "category_api.db"
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


def test_create_list_and_get_category(client: TestClient):
    response = client.post("/categories", json={"name": "Bebidas"})

    assert response.status_code == 201
    created = response.json()
    assert created["name"] == "Bebidas"
    assert created["active"] is True

    list_response = client.get("/categories")
    assert list_response.status_code == 200
    assert [item["name"] for item in list_response.json()] == ["Bebidas"]

    get_response = client.get(f"/categories/{created['id']}")
    assert get_response.status_code == 200
    assert get_response.json()["id"] == created["id"]


def test_rejects_duplicate_category_name_ignoring_case(client: TestClient):
    first = client.post("/categories", json={"name": "Abarrotes"})
    duplicate = client.post("/categories", json={"name": "abarrotes"})

    assert first.status_code == 201
    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Ya existe una categoría con ese nombre"


def test_update_and_deactivate_category(client: TestClient):
    created = client.post("/categories", json={"name": "Dulces"}).json()

    update_response = client.patch(
        f"/categories/{created['id']}",
        json={"name": "Confites"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["name"] == "Confites"

    deactivate_response = client.patch(
        f"/categories/{created['id']}",
        json={"active": False},
    )
    assert deactivate_response.status_code == 200
    assert deactivate_response.json()["active"] is False

    active_list = client.get("/categories")
    assert active_list.status_code == 200
    assert active_list.json() == []

    full_list = client.get("/categories", params={"include_inactive": True})
    assert full_list.status_code == 200
    assert len(full_list.json()) == 1
    assert full_list.json()[0]["name"] == "Confites"
    assert full_list.json()[0]["active"] is False


def test_unknown_category_returns_404(client: TestClient):
    response = client.get("/categories/00000000-0000-0000-0000-000000000000")

    assert response.status_code == 404
    assert response.json()["detail"] == "Categoría no encontrada"
