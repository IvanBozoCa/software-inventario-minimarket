from __future__ import annotations

import os
from pathlib import Path

# Playwright must never share the operator's local database. Configure the
# database before importing Alembic or the application so every component
# resolves the same isolated SQLite file.
E2E_DATABASE_PATH = Path("playwright.db")
os.environ["MINIMARKET_DATABASE_URL"] = "sqlite:///./playwright.db"

if E2E_DATABASE_PATH.exists():
    E2E_DATABASE_PATH.unlink()

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
import uvicorn  # noqa: E402


alembic_config = Config("alembic.ini")
command.upgrade(alembic_config, "head")

uvicorn.run(
    "app.main:app",
    host="127.0.0.1",
    port=8010,
    log_level="info",
)
