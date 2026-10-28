"""Carga referencias de mercado desde un CSV verificado.

Uso (desde backend/):
    python scripts/seed_market_references.py [ruta/al/archivo.csv]

Por defecto importa data/referencias_mercado_2026-10-28.csv. La importación es
idempotente: volver a ejecutarla no duplica observaciones.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import SessionLocal  # noqa: E402
from app.services.market import import_csv  # noqa: E402

DEFAULT_FILE = Path(__file__).resolve().parents[1] / "data" / "referencias_mercado_2026-10-28.csv"


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FILE
    content = path.read_text(encoding="utf-8-sig")
    with SessionLocal() as db:
        result = import_csv(db, content)
    print(f"Fuentes creadas: {result.sources_created}")
    print(f"Referencias creadas: {result.references_created}")
    print(f"Observaciones creadas: {result.observations_created}")
    print(f"Duplicados omitidos: {result.duplicates_skipped}")
    for error in result.errors:
        print(f"ERROR {error}")
    return 1 if result.errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
