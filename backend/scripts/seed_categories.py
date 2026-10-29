"""Precarga las categorías típicas de un minimarket.

Uso (desde backend/):
    python scripts/seed_categories.py

Es idempotente: solo crea las categorías que aún no existen (sin distinguir
mayúsculas) y no toca las existentes ni sus márgenes.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app.services.default_categories import seed_default_categories  # noqa: E402


def main() -> int:
    with SessionLocal() as db:
        created = seed_default_categories(db)
    print(f"Categorías creadas: {len(created)}")
    for name in created:
        print(f"  {name}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
