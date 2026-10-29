from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models import Category
from app.services.default_categories import (
    DEFAULT_CATEGORIES,
    seed_default_categories,
)


def test_seed_creates_missing_categories_once(tmp_path):
    database_path = tmp_path / "default_categories.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)

    with Session(engine) as db:
        db.add(Category(name="BEBIDAS"))
        db.commit()

        created = seed_default_categories(db)
        assert "Bebidas" not in created
        assert len(created) == len(DEFAULT_CATEGORIES) - 1
        assert seed_default_categories(db) == []

        total = db.scalar(select(func.count()).select_from(Category))
        assert total == len(DEFAULT_CATEGORIES)
        assert {"Helados", "Cecinas", "Frutas y verduras", "Cervezas"} <= set(
            db.scalars(select(Category.name))
        )

    engine.dispose()


def test_default_category_names_are_unique():
    lowered = [name.lower() for name in DEFAULT_CATEGORIES]
    assert len(lowered) == len(set(lowered))
