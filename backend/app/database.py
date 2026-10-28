from collections.abc import Generator
import os

from sqlalchemy import MetaData, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

DATABASE_URL = os.getenv(
    "MINIMARKET_DATABASE_URL",
    "sqlite:///./minimarket.db",
)

# Esquema de Postgres donde viven las tablas de SIM cuando la base se comparte
# con otros productos (por ejemplo, Supabase). Vacío en SQLite y en local.
DATABASE_SCHEMA = os.getenv("SIM_DB_SCHEMA") or None

IS_SQLITE = DATABASE_URL.startswith("sqlite")

if IS_SQLITE:
    connect_args: dict[str, object] = {"check_same_thread": False}
    engine_kwargs: dict[str, object] = {}
else:
    # Supabase en modo "transaction pooler" no admite sentencias preparadas
    # con nombre; psycopg las desactiva con prepare_threshold=None.
    connect_args = {"prepare_threshold": None} if "psycopg" in DATABASE_URL else {}
    engine_kwargs = {"pool_pre_ping": True, "pool_recycle": 300}

engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    **engine_kwargs,
)

SessionLocal = sessionmaker(
    bind=engine,
    autoflush=False,
    autocommit=False,
)


class Base(DeclarativeBase):
    metadata = MetaData(schema=DATABASE_SCHEMA)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
