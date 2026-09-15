from app.database import Base
from app.models import Category, PriceMode, Product, SaleMode


def test_catalog_models_are_registered_in_metadata():
    assert Category.__tablename__ == "categories"
    assert Product.__tablename__ == "products"
    assert "categories" in Base.metadata.tables
    assert "products" in Base.metadata.tables


def test_catalog_enums_have_expected_values():
    assert SaleMode.UNIT.value == "UNIT"
    assert SaleMode.WEIGHT.value == "WEIGHT"
    assert SaleMode.FREE_AMOUNT.value == "FREE_AMOUNT"
    assert PriceMode.FIXED.value == "FIXED"
    assert PriceMode.FREE.value == "FREE"
