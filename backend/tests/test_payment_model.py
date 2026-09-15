from datetime import datetime, timezone

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import Base
from app.models.payment import Payment, PaymentMethod, PaymentStatus
from app.models.sale import Sale, SaleStatus


def _create_engine(tmp_path):
    database_path = tmp_path / "payment_model.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=engine)
    return engine


def test_cash_payment_stores_received_amount_and_change(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        sale = Sale(
            status=SaleStatus.PAYMENT_PENDING,
            subtotal_clp=1800,
            total_clp=1800,
        )
        db.add(sale)
        db.flush()

        confirmed_at = datetime.now(timezone.utc)
        payment = Payment(
            sale_id=sale.id,
            method=PaymentMethod.CASH,
            status=PaymentStatus.CONFIRMED,
            amount_clp=1800,
            cash_received_clp=2000,
            change_clp=200,
            confirmed_at=confirmed_at,
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)

        assert payment.method == PaymentMethod.CASH
        assert payment.status == PaymentStatus.CONFIRMED
        assert payment.amount_clp == 1800
        assert payment.cash_received_clp == 2000
        assert payment.change_clp == 200
        assert payment.confirmed_at is not None

    engine.dispose()


def test_card_payment_is_ready_for_future_terminal_integration(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        sale = Sale(
            status=SaleStatus.PAYMENT_PENDING,
            subtotal_clp=3500,
            total_clp=3500,
        )
        db.add(sale)
        db.flush()

        payment = Payment(
            sale_id=sale.id,
            method=PaymentMethod.CARD,
            status=PaymentStatus.PENDING,
            amount_clp=3500,
            provider="TERMINAL_PROVIDER",
            external_reference="terminal-tx-001",
        )
        db.add(payment)
        db.commit()
        db.refresh(payment)

        assert payment.method == PaymentMethod.CARD
        assert payment.status == PaymentStatus.PENDING
        assert payment.cash_received_clp is None
        assert payment.change_clp is None
        assert payment.provider == "TERMINAL_PROVIDER"
        assert payment.external_reference == "terminal-tx-001"

    engine.dispose()


def test_payment_amount_must_be_positive(tmp_path):
    engine = _create_engine(tmp_path)

    with Session(engine) as db:
        sale = Sale(
            status=SaleStatus.PAYMENT_PENDING,
            subtotal_clp=1000,
            total_clp=1000,
        )
        db.add(sale)
        db.flush()

        db.add(
            Payment(
                sale_id=sale.id,
                method=PaymentMethod.CASH,
                status=PaymentStatus.CONFIRMED,
                amount_clp=0,
                cash_received_clp=1000,
                change_clp=1000,
            )
        )

        with pytest.raises(IntegrityError):
            db.commit()

        db.rollback()

    engine.dispose()
