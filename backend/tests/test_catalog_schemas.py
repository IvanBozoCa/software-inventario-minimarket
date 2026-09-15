import pytest
from pydantic import ValidationError

from app.models.product import PriceMode, SaleMode
from app.schemas.category import CategoryCreate
from app.schemas.product import ProductCreate


def test_category_name_is_trimmed() -> None:
    category = CategoryCreate(name="  Bebidas  ")

    assert category.name == "Bebidas"


def test_blank_category_name_is_rejected() -> None:
    with pytest.raises(ValidationError):
        CategoryCreate(name="   ")


def test_fixed_price_product_requires_price() -> None:
    with pytest.raises(ValidationError):
        ProductCreate(
            name="Bebida lata",
            sale_mode=SaleMode.UNIT,
            price_mode=PriceMode.FIXED,
        )


def test_free_price_product_can_have_no_fixed_price() -> None:
    product = ProductCreate(
        name="Monto libre",
        barcode="   ",
        sale_mode=SaleMode.FREE_AMOUNT,
        price_mode=PriceMode.FREE,
    )

    assert product.name == "Monto libre"
    assert product.barcode is None
    assert product.sale_price_clp is None
