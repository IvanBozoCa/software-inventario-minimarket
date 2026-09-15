from decimal import Decimal

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.database import Base
from app.models.payment import Payment, PaymentMethod, PaymentStatus
from app.models.product import Product
from app.models.sale import Sale, SaleItem, SaleItemType, SaleStatus
from app.models.stock_movement import StockMovement, StockMovementType
from app.services.checkout import (
    InsufficientCashError,
    complete_cash_payment,
    confirm_card_payment,
    start_card_payment,
)
from app.services.inventory import get_expected_stock


def _create_engine(tmp_path):
    database_path = tmp_path / "checkout_service.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    return engine


def _create_product_sale(
    db: Session,
    *,
    price: int = 1500,
    quantity: str = "1.000",
    track_stock: bool = True,
) -> tuple[Sale, Product]:
    product = Product(
        name="Producto de prueba",
        barcode="7800000002001",
        sale_price_clp=price,
        track_stock=track_stock,
    )
    db.add(product)
    db.flush()

    qty = Decimal(quantity)
    total = int(qty * Decimal(price))
    sale = Sale(
        status=SaleStatus.DRAFT,
        subtotal_clp=total,
        total_clp=total,
    )
    sale.items.append(
        SaleItem(
            product_id=product.id,
            item_type=SaleItemType.PRODUCT,
            description_snapshot=product.name,
            quantity=qty,
            unit_price_clp=price,
            line_total_clp=total,
        )
    )
    db.add(sale)
    db.commit()
    db.refresh(sale)
    return sale, product


def test_cash_exact_completes_sale_and_records_payment_and_stock(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        sale, product = _create_product_sale(db, price=1500)

        completed, payment = complete_cash_payment(db, sale.id, 1500)

        assert completed.status == SaleStatus.COMPLETED
        assert payment.method == PaymentMethod.CASH
        assert payment.status == PaymentStatus.CONFIRMED
        assert payment.amount_clp == 1500
        assert payment.cash_received_clp == 1500
        assert payment.change_clp == 0
        assert payment.confirmed_at is not None
        assert get_expected_stock(db, product.id) == Decimal("-1.000")

    engine.dispose()


def test_cash_with_change_calculates_change_automatically(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        sale, _ = _create_product_sale(db, price=1800)

        completed, payment = complete_cash_payment(db, sale.id, 2000)

        assert completed.status == SaleStatus.COMPLETED
        assert payment.amount_clp == 1800
        assert payment.cash_received_clp == 2000
        assert payment.change_clp == 200

    engine.dispose()


def test_insufficient_cash_does_not_complete_or_create_side_effects(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        sale, product = _create_product_sale(db, price=1800)

        with pytest.raises(InsufficientCashError):
            complete_cash_payment(db, sale.id, 1000)

        db.expire_all()
        persisted_sale = db.get(Sale, sale.id)
        assert persisted_sale is not None
        assert persisted_sale.status == SaleStatus.DRAFT
        assert db.scalar(select(func.count(Payment.id))) == 0
        assert get_expected_stock(db, product.id) == Decimal("0.000")

    engine.dispose()


def test_card_stays_pending_until_manual_approval(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        sale, product = _create_product_sale(db, price=2200)

        pending_sale, payment = start_card_payment(db, sale.id)

        assert pending_sale.status == SaleStatus.PAYMENT_PENDING
        assert payment.method == PaymentMethod.CARD
        assert payment.status == PaymentStatus.PENDING
        assert payment.confirmed_at is None
        assert get_expected_stock(db, product.id) == Decimal("0.000")

    engine.dispose()


def test_confirmed_card_completes_sale_and_stock_atomically(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        sale, product = _create_product_sale(db, price=2200, quantity="2.000")
        _, pending_payment = start_card_payment(
            db,
            sale.id,
            provider="terminal-demo",
        )

        completed, payment = confirm_card_payment(
            db,
            sale.id,
            pending_payment.id,
            external_reference="TX-001",
        )

        assert completed.status == SaleStatus.COMPLETED
        assert payment.status == PaymentStatus.CONFIRMED
        assert payment.external_reference == "TX-001"
        assert payment.confirmed_at is not None
        assert get_expected_stock(db, product.id) == Decimal("-2.000")

    engine.dispose()


def test_free_amount_and_non_stock_product_do_not_create_stock_movements(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        product = Product(
            name="Servicio sin stock",
            barcode="7800000002002",
            sale_price_clp=1000,
            track_stock=False,
        )
        db.add(product)
        db.flush()

        sale = Sale(status=SaleStatus.DRAFT, subtotal_clp=1500, total_clp=1500)
        sale.items.extend(
            [
                SaleItem(
                    product_id=product.id,
                    item_type=SaleItemType.PRODUCT,
                    description_snapshot=product.name,
                    quantity=Decimal("1.000"),
                    unit_price_clp=1000,
                    line_total_clp=1000,
                ),
                SaleItem(
                    product_id=None,
                    item_type=SaleItemType.FREE_AMOUNT,
                    description_snapshot="Monto libre",
                    quantity=Decimal("1.000"),
                    unit_price_clp=500,
                    line_total_clp=500,
                ),
            ]
        )
        db.add(sale)
        db.commit()

        complete_cash_payment(db, sale.id, 1500)

        movements = list(db.scalars(select(StockMovement)).all())
        assert movements == []

    engine.dispose()


def test_forced_commit_failure_rolls_back_sale_payment_and_stock(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        sale, product = _create_product_sale(db, price=1500)
        sale_id = sale.id
        product_id = product.id
        original_commit = db.commit

        def fail_commit():
            raise RuntimeError("forced commit failure")

        db.commit = fail_commit  # type: ignore[method-assign]
        with pytest.raises(RuntimeError, match="forced commit failure"):
            complete_cash_payment(db, sale_id, 1500)
        db.commit = original_commit  # type: ignore[method-assign]

    with Session(engine) as verification_db:
        persisted_sale = verification_db.get(Sale, sale_id)
        assert persisted_sale is not None
        assert persisted_sale.status == SaleStatus.DRAFT
        assert verification_db.scalar(select(func.count(Payment.id))) == 0
        assert verification_db.scalar(select(func.count(StockMovement.id))) == 0
        assert get_expected_stock(verification_db, product_id) == Decimal("0.000")

    engine.dispose()
