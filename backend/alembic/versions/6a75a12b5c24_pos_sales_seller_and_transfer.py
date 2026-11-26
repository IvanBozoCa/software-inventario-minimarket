"""pos sales: seller, client reference, void data and transfer payments

Revision ID: 6a75a12b5c24
Revises: febf1ffc5f39
Create Date: 2026-11-26 12:30:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "6a75a12b5c24"
down_revision: Union[str, Sequence[str], None] = "febf1ffc5f39"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("sales") as batch:
        batch.add_column(sa.Column("seller_id", sa.Uuid(), nullable=True))
        batch.add_column(sa.Column("seller_name", sa.String(length=80), nullable=True))
        batch.add_column(sa.Column("client_ref", sa.String(length=64), nullable=True))
        batch.add_column(sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("voided_at", sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("void_reason", sa.String(length=300), nullable=True))
        batch.add_column(sa.Column("voided_by_name", sa.String(length=80), nullable=True))
        batch.create_index("ix_sales_seller_id", ["seller_id"])
        batch.create_index("ix_sales_completed_at", ["completed_at"])
        batch.create_unique_constraint("uq_sales_client_ref", ["client_ref"])
        batch.create_foreign_key("fk_sales_seller_id_app_users", "app_users", ["seller_id"], ["id"])

    # Medio de pago "Transferencia": se amplía la columna y su CHECK.
    with op.batch_alter_table("payments") as batch:
        batch.drop_constraint("payment_method", type_="check")
        batch.alter_column(
            "method", existing_type=sa.String(length=4), type_=sa.String(length=8), existing_nullable=False
        )
        batch.create_check_constraint("payment_method", "method IN ('CASH', 'CARD', 'TRANSFER')")


def downgrade() -> None:
    with op.batch_alter_table("payments") as batch:
        batch.drop_constraint("payment_method", type_="check")
        batch.alter_column(
            "method", existing_type=sa.String(length=8), type_=sa.String(length=4), existing_nullable=False
        )
        batch.create_check_constraint("payment_method", "method IN ('CASH', 'CARD')")

    with op.batch_alter_table("sales") as batch:
        batch.drop_constraint("fk_sales_seller_id_app_users", type_="foreignkey")
        batch.drop_constraint("uq_sales_client_ref", type_="unique")
        batch.drop_index("ix_sales_completed_at")
        batch.drop_index("ix_sales_seller_id")
        for column in (
            "voided_by_name", "void_reason", "voided_at", "completed_at", "client_ref", "seller_name", "seller_id"
        ):
            batch.drop_column(column)
