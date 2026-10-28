from logging.config import fileConfig

from alembic import context
from sqlalchemy import engine_from_config, pool, text

from app.database import Base, DATABASE_SCHEMA, DATABASE_URL
from app import models  # noqa: F401

config = context.config
config.set_main_option("sqlalchemy.url", DATABASE_URL)

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    context.configure(
        url=DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        version_table_schema=DATABASE_SCHEMA,
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connectable = engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    with connectable.connect() as connection:
        if DATABASE_SCHEMA and connection.dialect.name == "postgresql":
            # Las migraciones nombran las tablas sin esquema; el search_path
            # las dirige al esquema de SIM (p. ej. `sim` en Supabase).
            connection.execute(text(f'CREATE SCHEMA IF NOT EXISTS "{DATABASE_SCHEMA}"'))
            connection.execute(text(f'SET search_path TO "{DATABASE_SCHEMA}", public'))
            connection.commit()

        context.configure(
            connection=connection,
            target_metadata=target_metadata,
            version_table_schema=DATABASE_SCHEMA,
        )

        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
