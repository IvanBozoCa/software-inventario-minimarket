from decimal import Decimal

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import Base
from app.models.product import Product
from app.models.stock_movement import StockMovement, StockMovementType


def _create_engine(tmp_path):
    database_path = tmp_path / "stock_movement_model.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    return engine


def test_stock_is_reconstructed_by_summing_movements(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        product = Product(name="Arroz 1 kg", sale_price_clp=1500)
        db.add(product)
        db.flush()

        db.add_all(
            [
                StockMovement(
                    product_id=product.id,
                    movement_type=StockMovementType.INITIAL_STOCK,
                    quantity_delta=Decimal("10.000"),
                ),
                StockMovement(
                    product_id=product.id,
                    movement_type=StockMovementType.SALE,
                    quantity_delta=Decimal("-2.000"),
                ),
            ]
        )
        db.commit()

        stock = db.scalar(
            select(func.sum(StockMovement.quantity_delta)).where(
                StockMovement.product_id == product.id
            )
        )

        assert stock == Decimal("8.000")

    engine.dispose()


def test_zero_quantity_movement_is_rejected(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        product = Product(name="Bebida", sale_price_clp=1200)
        db.add(product)
        db.flush()

        db.add(
            StockMovement(
                product_id=product.id,
                movement_type=StockMovementType.INITIAL_STOCK,
                quantity_delta=Decimal("0.000"),
            )
        )

        with pytest.raises(IntegrityError):
            db.commit()

        db.rollback()

    engine.dispose()
