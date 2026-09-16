import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.database import Base, get_db
from app.main import app
from app.models.admin_security import AdminSecurity, AuditLog
from app.services.admin_security import clear_admin_sessions_for_tests


@pytest.fixture
def admin_security_context(tmp_path):
    database_path = tmp_path / "admin_security.db"
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
    clear_admin_sessions_for_tests()

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
    clear_admin_sessions_for_tests()
    engine.dispose()


def setup_pin(client: TestClient, pin: str = "2580") -> None:
    response = client.post("/admin/security/setup", json={"pin": pin})
    assert response.status_code == 201


def test_security_status_starts_unconfigured(admin_security_context):
    client, _ = admin_security_context

    response = client.get("/admin/security/status")

    assert response.status_code == 200
    assert response.json() == {"configured": False, "session_minutes": 15}


def test_setup_requires_numeric_pin_between_four_and_eight_digits(
    admin_security_context,
):
    client, _ = admin_security_context

    assert client.post("/admin/security/setup", json={"pin": "123"}).status_code == 422
    assert client.post("/admin/security/setup", json={"pin": "12ab"}).status_code == 422
    assert client.post("/admin/security/setup", json={"pin": "123456789"}).status_code == 422


def test_setup_stores_hash_and_audits_configuration(admin_security_context):
    client, TestingSessionLocal = admin_security_context

    setup_pin(client, "2580")

    status = client.get("/admin/security/status")
    assert status.json()["configured"] is True

    with TestingSessionLocal() as db:
        security = db.scalar(select(AdminSecurity))
        assert security is not None
        assert security.pin_hash != "2580"
        assert security.pin_hash.startswith("scrypt$")

        logs = db.scalars(
            select(AuditLog).where(AuditLog.action == "ADMIN_PIN_CONFIGURED")
        ).all()
        assert len(logs) == 1
        assert logs[0].success is True


def test_setup_cannot_replace_existing_pin_without_authorized_flow(
    admin_security_context,
):
    client, _ = admin_security_context
    setup_pin(client)

    response = client.post("/admin/security/setup", json={"pin": "9876"})

    assert response.status_code == 409
    assert response.json()["detail"] == "El PIN de administrador ya está configurado"


def test_wrong_pin_returns_simple_message_and_is_audited(admin_security_context):
    client, TestingSessionLocal = admin_security_context
    setup_pin(client, "2580")

    response = client.post("/admin/security/unlock", json={"pin": "1111"})

    assert response.status_code == 401
    assert response.json()["detail"] == "PIN incorrecto"
    assert "token" not in response.json()

    with TestingSessionLocal() as db:
        failed = db.scalars(
            select(AuditLog).where(
                AuditLog.action == "ADMIN_UNLOCK",
                AuditLog.success.is_(False),
            )
        ).all()
        assert len(failed) == 1


def test_correct_pin_creates_temporary_admin_session(admin_security_context):
    client, _ = admin_security_context
    setup_pin(client, "2580")

    unlocked = client.post("/admin/security/unlock", json={"pin": "2580"})

    assert unlocked.status_code == 200
    body = unlocked.json()
    assert body["token"]
    assert body["session_minutes"] == 15
    assert body["expires_at"]

    headers = {"Authorization": f"Bearer {body['token']}"}
    session = client.get("/admin/security/session", headers=headers)
    assert session.status_code == 200
    assert session.json()["valid"] is True
    assert session.json()["expires_at"] is not None


def test_lock_invalidates_session_and_protected_endpoint_requires_token(
    admin_security_context,
):
    client, _ = admin_security_context
    setup_pin(client)
    unlocked = client.post("/admin/security/unlock", json={"pin": "2580"})
    token = unlocked.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    locked = client.post("/admin/security/lock", headers=headers)
    assert locked.status_code == 200
    assert locked.json()["message"] == "Administración bloqueada"

    session = client.get("/admin/security/session", headers=headers)
    assert session.status_code == 200
    assert session.json() == {"valid": False, "expires_at": None}

    second_lock = client.post("/admin/security/lock", headers=headers)
    assert second_lock.status_code == 401
    assert second_lock.json()["detail"] == "Autorización administrativa requerida"
