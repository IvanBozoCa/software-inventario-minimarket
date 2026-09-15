from decimal import Decimal

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.database import Base
from app.models.product import PriceMode, Product, SaleMode
from app.models.stock_movement import StockMovement, StockMovementType
from app.services.inventory import get_expected_stock


def make_product() -> Product:
    return Product(
        name="Producto prueba",
        sale_mode=SaleMode.UNIT,
        price_mode=PriceMode.FIXED,
        sale_price_clp=1000,
        track_stock=True,
    )


def test_product_without_movements_has_zero_stock(tmp_path):
    database_path = tmp_path / "inventory_zero.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)

    with Session(engine) as db:
        product = make_product()
        db.add(product)
        db.commit()
        db.refresh(product)

        assert get_expected_stock(db, product.id) == Decimal("0.000")

    engine.dispose()


def test_stock_is_reconstructed_from_all_movements(tmp_path):
    database_path = tmp_path / "inventory_sum.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)

    with Session(engine) as db:
        product = make_product()
        db.add(product)
        db.commit()
        db.refresh(product)

        db.add_all(
            [
                StockMovement(
                    product_id=product.id,
                    movement_type=StockMovementType.INITIAL_STOCK,
                    quantity_delta=Decimal("10.000"),
                ),
                StockMovement(
                    product_id=product.id,
                    movement_type=StockMovementType.PURCHASE,
                    quantity_delta=Decimal("5.500"),
                ),
                StockMovement(
                    product_id=product.id,
                    movement_type=StockMovementType.SALE,
                    quantity_delta=Decimal("-3.000"),
                ),
            ]
        )
        db.commit()

        assert get_expected_stock(db, product.id) == Decimal("12.500")

    engine.dispose()


def test_negative_stock_is_preserved(tmp_path):
    database_path = tmp_path / "inventory_negative.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)

    with Session(engine) as db:
        product = make_product()
        db.add(product)
        db.commit()
        db.refresh(product)

        db.add(
            StockMovement(
                product_id=product.id,
                movement_type=StockMovementType.SALE,
                quantity_delta=Decimal("-2.000"),
            )
        )
        db.commit()

        assert get_expected_stock(db, product.id) == Decimal("-2.000")

    engine.dispose()
