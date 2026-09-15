from decimal import Decimal

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import Base
from app.models.product import Product
from app.models.sale import Sale, SaleItem, SaleItemType, SaleStatus
from app.models.stock_movement import StockMovement


def _create_engine(tmp_path):
    database_path = tmp_path / "sale_models.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    return engine


def test_new_sale_is_empty_draft(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        sale = Sale()
        db.add(sale)
        db.commit()
        db.refresh(sale)

        assert sale.status == SaleStatus.DRAFT
        assert sale.subtotal_clp == 0
        assert sale.total_clp == 0
        assert sale.items == []

    engine.dispose()


def test_draft_supports_product_and_free_amount_lines_without_stock_movement(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        product = Product(name="Bebida 1.5 L", sale_price_clp=1800)
        sale = Sale(subtotal_clp=4300, total_clp=4300)
        db.add_all([product, sale])
        db.flush()

        sale.items.extend(
            [
                SaleItem(
                    product_id=product.id,
                    item_type=SaleItemType.PRODUCT,
                    description_snapshot=product.name,
                    quantity=Decimal("2.000"),
                    unit_price_clp=1800,
                    line_total_clp=3600,
                ),
                SaleItem(
                    product_id=None,
                    item_type=SaleItemType.FREE_AMOUNT,
                    description_snapshot="Monto libre",
                    quantity=Decimal("1.000"),
                    unit_price_clp=700,
                    line_total_clp=700,
                ),
            ]
        )
        db.commit()
        db.refresh(sale)

        assert len(sale.items) == 2
        assert sale.items[0].description_snapshot == "Bebida 1.5 L"
        assert sale.items[0].unit_price_clp == 1800
        assert sale.items[1].product_id is None
        assert sale.items[1].item_type == SaleItemType.FREE_AMOUNT

        movement_count = db.scalar(select(func.count()).select_from(StockMovement))
        assert movement_count == 0

    engine.dispose()


def test_free_amount_line_cannot_reference_product(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        product = Product(name="Pan", sale_price_clp=500)
        sale = Sale()
        db.add_all([product, sale])
        db.flush()

        db.add(
            SaleItem(
                sale_id=sale.id,
                product_id=product.id,
                item_type=SaleItemType.FREE_AMOUNT,
                description_snapshot="Monto libre inválido",
                quantity=Decimal("1.000"),
                unit_price_clp=500,
                line_total_clp=500,
            )
        )

        with pytest.raises(IntegrityError):
            db.commit()

        db.rollback()

    engine.dispose()
