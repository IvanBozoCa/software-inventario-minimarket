from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models.product import PriceMode, Product, SaleMode
from app.models.stock_movement import StockMovement, StockMovementType
from app.services.inventory import (
    InvalidInitialStockQuantityError,
    ProductNotFoundError,
    StockTrackingDisabledError,
    register_initial_stock,
)


def make_product(*, track_stock: bool = True) -> Product:
    return Product(
        name="Producto prueba",
        sale_mode=SaleMode.UNIT,
        price_mode=PriceMode.FIXED,
        sale_price_clp=1000,
        track_stock=track_stock,
    )


def make_engine(tmp_path, name: str):
    database_path = tmp_path / name
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    return engine


def movement_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(StockMovement)) or 0


def test_register_initial_stock_creates_movement_and_updates_stock(tmp_path):
    engine = make_engine(tmp_path, "initial_stock_success.db")

    with Session(engine) as db:
        product = make_product()
        db.add(product)
        db.commit()
        db.refresh(product)

        movement, stock = register_initial_stock(
            db,
            product.id,
            Decimal("12.5"),
            note="Conteo físico inicial",
        )

        assert movement.movement_type == StockMovementType.INITIAL_STOCK
        assert movement.quantity_delta == Decimal("12.500")
        assert movement.note == "Conteo físico inicial"
        assert stock == Decimal("12.500")
        assert movement_count(db) == 1

    engine.dispose()


def test_zero_initial_stock_is_rejected_without_creating_movement(tmp_path):
    engine = make_engine(tmp_path, "initial_stock_zero.db")

    with Session(engine) as db:
        product = make_product()
        db.add(product)
        db.commit()
        db.refresh(product)

        with pytest.raises(InvalidInitialStockQuantityError):
            register_initial_stock(db, product.id, Decimal("0"))

        assert movement_count(db) == 0

    engine.dispose()


def test_product_without_stock_tracking_rejects_initial_stock(tmp_path):
    engine = make_engine(tmp_path, "initial_stock_disabled.db")

    with Session(engine) as db:
        product = make_product(track_stock=False)
        db.add(product)
        db.commit()
        db.refresh(product)

        with pytest.raises(StockTrackingDisabledError):
            register_initial_stock(db, product.id, Decimal("4"))

        assert movement_count(db) == 0

    engine.dispose()


def test_unknown_product_rejects_initial_stock(tmp_path):
    engine = make_engine(tmp_path, "initial_stock_unknown.db")

    with Session(engine) as db:
        with pytest.raises(ProductNotFoundError):
            register_initial_stock(db, uuid4(), Decimal("3"))

        assert movement_count(db) == 0

    engine.dispose()
